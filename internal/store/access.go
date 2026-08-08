// Package store 管两样持久化的东西:词库元数据(words.json)和访问日志(SQLite)。
package store

import (
	"fmt"
	"log"
	"sync"
	"time"

	// 纯 Go 的 SQLite 驱动。GORM 默认的 gorm.io/driver/sqlite 底层是
	// mattn/go-sqlite3,要 CGO —— 一旦开了 CGO 就没法 CGO_ENABLED=0
	// 交叉编译 linux/arm64,deploy.sh 那套"下载一个静态二进制就能跑"
	// 会直接断掉。这个驱动包的是 modernc.org/sqlite,纯 Go。
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// AccessLog 是访问日志表。
//
// 字段上的 index 标签会由 AutoMigrate 建出索引:ts 用于按时间范围查,
// (ip, ts) 用于按 IP 聚合时定位每个 IP 的最近一条。
type AccessLog struct {
	ID     uint   `gorm:"primaryKey"                json:"-"`
	TS     int64  `gorm:"not null;index:idx_ts;index:idx_ip_ts,priority:2" json:"-"`
	IP     string `gorm:"not null;index:idx_ip_ts,priority:1"              json:"ip"`
	Method string `gorm:"not null"                  json:"m"`
	Path   string `gorm:"not null"                  json:"p"`
	Status int    `gorm:"not null"                  json:"s"`
	Ms     int64  `gorm:"not null"                  json:"ms"`
	UA     string `gorm:"not null;default:''"       json:"ua,omitempty"`
}

// TableName 固定表名。不写的话 GORM 会推导成 access_logs,
// 以后改结构体名字会连带把表名改掉,老数据就读不到了。
func (AccessLog) TableName() string { return "access" }

// AccessEntry 是对外的一条访问记录,时间用 time.Time 而不是毫秒数。
type AccessEntry struct {
	Time   time.Time `json:"t"`
	IP     string    `json:"ip"`
	Method string    `json:"m"`
	Path   string    `json:"p"`
	Status int       `json:"s"`
	Ms     int64     `json:"ms"`
	UA     string    `json:"ua,omitempty"`
}

func (e AccessEntry) toModel() AccessLog {
	return AccessLog{
		TS: e.Time.UnixMilli(), IP: e.IP, Method: e.Method,
		Path: e.Path, Status: e.Status, Ms: e.Ms, UA: e.UA,
	}
}

func (m AccessLog) toEntry() AccessEntry {
	return AccessEntry{
		Time: time.UnixMilli(m.TS), IP: m.IP, Method: m.Method,
		Path: m.Path, Status: m.Status, Ms: m.Ms, UA: m.UA,
	}
}

// IPStat 是按 IP 聚合后的统计,给后台的表格用。
type IPStat struct {
	IP      string `gorm:"column:ip"      json:"ip"`
	Private bool   `gorm:"-"              json:"private"`
	// 归属地由上层填(需要 geoip 包),store 只管数据
	Region   string    `gorm:"-"              json:"region,omitempty"`
	Count    int       `gorm:"column:cnt"     json:"count"`
	Errors   int       `gorm:"column:errs"    json:"errors"`
	Device   string    `gorm:"-"              json:"device"`
	First    time.Time `gorm:"-"              json:"first"`
	Last     time.Time `gorm:"-"              json:"last"`
	LastPath string    `gorm:"column:path"    json:"lastPath"`
	// LastUA 给上层判设备用,不发给前端
	LastUA string `gorm:"column:ua" json:"-"`

	// 扫描用的原始毫秒时间戳,转成 First/Last 后就没用了
	FirstTS int64 `gorm:"column:first_ts" json:"-"`
	LastTS  int64 `gorm:"column:last_ts"  json:"-"`
}

// 写入队列的容量。满了就丢 —— 记日志绝不能拖慢或拖垮请求。
const writeQueueSize = 512

// AccessStore 把访问记录写进 SQLite。
//
// 写入是异步的:请求线程只往 channel 塞,单独一个 goroutine 落盘。
// 这样磁盘抖动不会传导到响应延迟上。
type AccessStore struct {
	db       *gorm.DB
	keepDays int
	path     string

	queue chan AccessEntry
	done  chan struct{}

	dropOnce sync.Once
}

// OpenAccessStore 打开(必要时创建)数据库并起写入 goroutine。
func OpenAccessStore(path string, keepDays int) (*AccessStore, error) {
	if keepDays < 1 {
		keepDays = 1
	}

	//   journal_mode=WAL —— 读写不互相阻塞,后台查报表时不卡住正在记录的请求
	//   busy_timeout —— 撞锁先等一会儿,别直接报 database is locked
	// auto_vacuum 不放这儿:见下面 enableAutoVacuum 的说明。
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)" +
		"&_pragma=synchronous(NORMAL)"

	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		// GORM 默认会把每条 SQL 打到标准输出,这里每个请求都写一条,
		// 开着等于把终端刷爆。
		Logger: logger.Discard,
		// 访问日志不需要 created_at/updated_at,少两列少两次赋值
		SkipDefaultTransaction: true,
	})
	if err != nil {
		return nil, fmt.Errorf("打开数据库: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("取底层连接: %w", err)
	}
	// 纯 Go 驱动下多连接写更容易撞锁,写入本来就串行,一条连接足够
	sqlDB.SetMaxOpenConns(1)

	if err := enableAutoVacuum(db); err != nil {
		sqlDB.Close()
		return nil, err
	}

	if err := db.AutoMigrate(&AccessLog{}); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("建表: %w", err)
	}

	s := &AccessStore{
		db:       db,
		keepDays: keepDays,
		path:     path,
		queue:    make(chan AccessEntry, writeQueueSize),
		done:     make(chan struct{}),
	}
	go s.writeLoop()
	return s, nil
}

// enableAutoVacuum 让删掉的数据能把磁盘空间还回去。
//
// SQLite 只 DELETE 是不会缩小文件的,空页会一直留着 —— 这正是
// "数据库会越来越大"的根因。auto_vacuum 又只在**文件还没建页**时
// 设置才生效,建完表再设是哑的。
//
// 这里不靠 DSN 里的 _pragma:实测 glebarez 驱动下 journal_mode 生效、
// auto_vacuum 却是 0(pragma 的执行顺序把它盖掉了),而这种依赖顺序的
// 写法换个驱动版本就可能再次失效。改成显式设置 + VACUUM 重建整个文件,
// 不依赖顺序,顺带还能把早先建的旧库转成 incremental 模式。
func enableAutoVacuum(db *gorm.DB) error {
	var mode int
	if err := db.Raw(`PRAGMA auto_vacuum`).Scan(&mode).Error; err != nil {
		return fmt.Errorf("读 auto_vacuum: %w", err)
	}
	if mode == 2 { // 已经是 incremental,不用重建
		return nil
	}
	if err := db.Exec(`PRAGMA auto_vacuum=INCREMENTAL`).Error; err != nil {
		return fmt.Errorf("设置 auto_vacuum: %w", err)
	}
	// VACUUM 会按新设置重写整个文件,这一步才是真正让它生效的
	if err := db.Exec(`VACUUM`).Error; err != nil {
		return fmt.Errorf("重建数据库以启用 auto_vacuum: %w", err)
	}
	return nil
}

func (s *AccessStore) Path() string  { return s.path }
func (s *AccessStore) KeepDays() int { return s.keepDays }

// Record 排队写一条记录。队列满了就丢弃,不阻塞调用方。
func (s *AccessStore) Record(e AccessEntry) {
	select {
	case s.queue <- e:
	default:
		// 只提醒一次,别在压力大的时候把日志刷爆
		s.dropOnce.Do(func() {
			log.Printf("[access] 写入队列已满,部分访问记录被丢弃(不影响请求)")
		})
	}
}

// Close 冲干净队列再关库。
func (s *AccessStore) Close() error {
	close(s.queue)
	<-s.done

	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

// writeLoop 是唯一的写入者。顺带每小时清一次过期数据。
func (s *AccessStore) writeLoop() {
	defer close(s.done)

	prune := time.NewTicker(time.Hour)
	defer prune.Stop()

	// 启动时先清一次,把上次运行留下的过期数据处理掉
	s.Prune()

	for {
		select {
		case e, ok := <-s.queue:
			if !ok {
				return
			}
			s.insert(e)
		case <-prune.C:
			s.Prune()
		}
	}
}

func (s *AccessStore) insert(e AccessEntry) {
	m := e.toModel()
	if err := s.db.Create(&m).Error; err != nil {
		log.Printf("[access] 写入失败: %v", err)
	}
}

// Prune 删掉超过保留期的记录,并把腾出来的页还给文件系统。
//
// 只 DELETE 的话 SQLite 文件不会变小,空页会一直留着。配合建库时的
// auto_vacuum=incremental,这里的 incremental_vacuum 才能真的把文件压回去。
func (s *AccessStore) Prune() {
	cutoff := time.Now().AddDate(0, 0, -s.keepDays).UnixMilli()

	res := s.db.Where("ts < ?", cutoff).Delete(&AccessLog{})
	if res.Error != nil {
		log.Printf("[access] 清理过期记录失败: %v", res.Error)
		return
	}
	if res.RowsAffected > 0 {
		if err := s.db.Exec(`PRAGMA incremental_vacuum`).Error; err != nil {
			log.Printf("[access] 回收空间失败: %v", err)
		}
		log.Printf("[access] 清理了 %d 条超过 %d 天的记录", res.RowsAffected, s.keepDays)
	}
}

// Stats 按 IP 聚合最近 days 天的访问。
//
// 这段没用 GORM 的链式 API 而是原生 SQL:要在一次查询里同时拿到聚合值
// 和"最近一条"的 path/ua,得靠窗口函数,用 ORM 拼反而更绕更难读。
func (s *AccessStore) Stats(days int) ([]IPStat, error) {
	since := time.Now().AddDate(0, 0, -days).UnixMilli()

	var out []IPStat
	err := s.db.Raw(`
		SELECT ip, cnt, errs, first_ts, last_ts, path, ua FROM (
			SELECT
				ip,
				COUNT(*) OVER w AS cnt,
				SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) OVER w AS errs,
				MIN(ts)  OVER w AS first_ts,
				MAX(ts)  OVER w AS last_ts,
				path, ua, ts,
				ROW_NUMBER() OVER (PARTITION BY ip ORDER BY ts DESC) AS rn
			FROM access WHERE ts >= ?
			WINDOW w AS (PARTITION BY ip)
		) WHERE rn = 1
		ORDER BY last_ts DESC`, since).Scan(&out).Error
	if err != nil {
		return nil, fmt.Errorf("统计访问: %w", err)
	}

	for i := range out {
		out[i].First = time.UnixMilli(out[i].FirstTS)
		out[i].Last = time.UnixMilli(out[i].LastTS)
	}
	return out, nil
}

// Recent 返回最近 limit 条流水,新的在前。
func (s *AccessStore) Recent(days, limit int) ([]AccessEntry, error) {
	since := time.Now().AddDate(0, 0, -days).UnixMilli()

	var rows []AccessLog
	err := s.db.Where("ts >= ?", since).Order("ts DESC").Limit(limit).Find(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("查询流水: %w", err)
	}

	out := make([]AccessEntry, 0, len(rows))
	for _, m := range rows {
		out = append(out, m.toEntry())
	}
	return out, nil
}

// Total 是最近 days 天的请求总数。
func (s *AccessStore) Total(days int) (int, error) {
	since := time.Now().AddDate(0, 0, -days).UnixMilli()

	var n int64
	if err := s.db.Model(&AccessLog{}).Where("ts >= ?", since).Count(&n).Error; err != nil {
		return 0, fmt.Errorf("统计总数: %w", err)
	}
	return int(n), nil
}
