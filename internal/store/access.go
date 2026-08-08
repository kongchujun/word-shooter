// Package store 管两样持久化的东西:词库元数据(words.json)和访问日志(SQLite)。
package store

import (
	"database/sql"
	"fmt"
	"log"
	"sync"
	"time"

	// 纯 Go 的 SQLite 实现。用它而不是 mattn/go-sqlite3 是因为后者要 CGO,
	// 一旦开了 CGO 就没法用 CGO_ENABLED=0 交叉编译 linux/arm64,
	// deploy.sh 那套"下载一个静态二进制就能跑"的部署方式会直接断掉。
	_ "modernc.org/sqlite"
)

// AccessEntry 是一条访问记录。
type AccessEntry struct {
	Time   time.Time `json:"t"`
	IP     string    `json:"ip"`
	Method string    `json:"m"`
	Path   string    `json:"p"`
	Status int       `json:"s"`
	Ms     int64     `json:"ms"`
	UA     string    `json:"ua,omitempty"`
}

// IPStat 是按 IP 聚合后的统计,给后台的表格用。
type IPStat struct {
	IP      string `json:"ip"`
	Private bool   `json:"private"`
	// 归属地由上层填(需要 geoip 包),store 只管数据
	Region   string    `json:"region,omitempty"`
	Count    int       `json:"count"`
	Errors   int       `json:"errors"`
	Device   string    `json:"device"`
	First    time.Time `json:"first"`
	Last     time.Time `json:"last"`
	LastPath string    `json:"lastPath"`
	// LastUA 给上层判设备用,不发给前端
	LastUA string `json:"-"`
}

// 写入队列的容量。满了就丢 —— 记日志绝不能拖慢或拖垮请求。
const writeQueueSize = 512

// AccessStore 把访问记录写进 SQLite。
//
// 写入是异步的:请求线程只往 channel 塞,单独一个 goroutine 落盘。
// 这样磁盘抖动不会传导到响应延迟上。
type AccessStore struct {
	db       *sql.DB
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

	// WAL:读写不互相阻塞,后台查报表时不会卡住正在记录的请求。
	// auto_vacuum=incremental:必须在建表前设置,否则删了数据文件也不会变小。
	// busy_timeout:并发写时先等一会儿,别直接报 database is locked。
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=auto_vacuum(2)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("打开数据库: %w", err)
	}
	// 纯 Go 驱动下多连接写会更容易撞锁,写入本来就串行,一条连接足够
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS access (
			id     INTEGER PRIMARY KEY AUTOINCREMENT,
			ts     INTEGER NOT NULL,
			ip     TEXT    NOT NULL,
			method TEXT    NOT NULL,
			path   TEXT    NOT NULL,
			status INTEGER NOT NULL,
			ms     INTEGER NOT NULL,
			ua     TEXT    NOT NULL DEFAULT ''
		);
		CREATE INDEX IF NOT EXISTS idx_access_ts    ON access(ts);
		CREATE INDEX IF NOT EXISTS idx_access_ip_ts ON access(ip, ts);
	`); err != nil {
		db.Close()
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
	return s.db.Close()
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
	_, err := s.db.Exec(
		`INSERT INTO access (ts, ip, method, path, status, ms, ua) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		e.Time.UnixMilli(), e.IP, e.Method, e.Path, e.Status, e.Ms, e.UA,
	)
	if err != nil {
		log.Printf("[access] 写入失败: %v", err)
	}
}

// Prune 删掉超过保留期的记录,并把腾出来的页还给文件系统。
//
// 只 DELETE 的话 SQLite 文件不会变小,空页会一直留着 —— 用户担心的
// "数据库会变大"正是这个。auto_vacuum=incremental 加上这里的
// incremental_vacuum,才能真的把文件压回去。
func (s *AccessStore) Prune() {
	cutoff := time.Now().AddDate(0, 0, -s.keepDays).UnixMilli()
	res, err := s.db.Exec(`DELETE FROM access WHERE ts < ?`, cutoff)
	if err != nil {
		log.Printf("[access] 清理过期记录失败: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		if _, err := s.db.Exec(`PRAGMA incremental_vacuum`); err != nil {
			log.Printf("[access] 回收空间失败: %v", err)
		}
		log.Printf("[access] 清理了 %d 条超过 %d 天的记录", n, s.keepDays)
	}
}

// Stats 按 IP 聚合最近 days 天的访问。
func (s *AccessStore) Stats(days int) ([]IPStat, error) {
	since := time.Now().AddDate(0, 0, -days).UnixMilli()

	// 用窗口函数一次拿到聚合值和"最近一条"的 path/ua,
	// 省掉再查一遍或者在 Go 里排序全量记录。
	rows, err := s.db.Query(`
		SELECT ip, cnt, errs, first_ts, last_ts, path, ua FROM (
			SELECT
				ip,
				COUNT(*)        OVER w AS cnt,
				SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) OVER w AS errs,
				MIN(ts)         OVER w AS first_ts,
				MAX(ts)         OVER w AS last_ts,
				path, ua, ts,
				ROW_NUMBER() OVER (PARTITION BY ip ORDER BY ts DESC) AS rn
			FROM access WHERE ts >= ?
			WINDOW w AS (PARTITION BY ip)
		) WHERE rn = 1
		ORDER BY last_ts DESC`, since)
	if err != nil {
		return nil, fmt.Errorf("统计访问: %w", err)
	}
	defer rows.Close()

	out := make([]IPStat, 0, 32)
	for rows.Next() {
		var s IPStat
		var firstTS, lastTS int64
		if err := rows.Scan(&s.IP, &s.Count, &s.Errors, &firstTS, &lastTS, &s.LastPath, &s.LastUA); err != nil {
			return nil, fmt.Errorf("读取统计行: %w", err)
		}
		s.First = time.UnixMilli(firstTS)
		s.Last = time.UnixMilli(lastTS)
		out = append(out, s)
	}
	return out, rows.Err()
}

// Recent 返回最近 limit 条流水,新的在前。
func (s *AccessStore) Recent(days, limit int) ([]AccessEntry, error) {
	since := time.Now().AddDate(0, 0, -days).UnixMilli()
	rows, err := s.db.Query(
		`SELECT ts, ip, method, path, status, ms, ua FROM access
		 WHERE ts >= ? ORDER BY ts DESC LIMIT ?`, since, limit)
	if err != nil {
		return nil, fmt.Errorf("查询流水: %w", err)
	}
	defer rows.Close()

	out := make([]AccessEntry, 0, limit)
	for rows.Next() {
		var e AccessEntry
		var ts int64
		if err := rows.Scan(&ts, &e.IP, &e.Method, &e.Path, &e.Status, &e.Ms, &e.UA); err != nil {
			return nil, fmt.Errorf("读取流水行: %w", err)
		}
		e.Time = time.UnixMilli(ts)
		out = append(out, e)
	}
	return out, rows.Err()
}

// Total 是最近 days 天的请求总数。
func (s *AccessStore) Total(days int) (int, error) {
	since := time.Now().AddDate(0, 0, -days).UnixMilli()
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM access WHERE ts >= ?`, since).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("统计总数: %w", err)
	}
	return n, nil
}
