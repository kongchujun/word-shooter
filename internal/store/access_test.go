package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// 直接插,不走异步队列 —— 测试要的是确定性。
func insertAt(t *testing.T, s *AccessStore, when time.Time, ip, path string, status int, ua string) {
	t.Helper()
	s.insert(AccessEntry{Time: when, IP: ip, Method: "GET", Path: path, Status: status, Ms: 1, UA: ua})
}

func newTestStore(t *testing.T, keepDays int) *AccessStore {
	t.Helper()
	s, err := OpenAccessStore(filepath.Join(t.TempDir(), "access.db"), keepDays)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestStatsAggregatesPerIP(t *testing.T) {
	s := newTestStore(t, 5)
	now := time.Now()

	insertAt(t, s, now.Add(-2*time.Hour), "1.2.3.4", "/", 200, "curl/8")
	insertAt(t, s, now.Add(-time.Hour), "1.2.3.4", "/api/x", 404, "curl/8")
	// 最近一条用 iPad 的 UA:设备判定应该跟着它走,而不是第一条的 curl
	insertAt(t, s, now, "1.2.3.4", "/admin", 200, "Mozilla/5.0 (iPad)")
	insertAt(t, s, now, "5.6.7.8", "/", 200, "")

	stats, err := s.Stats(5)
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if len(stats) != 2 {
		t.Fatalf("想要 2 个 IP,拿到 %d 个", len(stats))
	}

	var got IPStat
	for _, v := range stats {
		if v.IP == "1.2.3.4" {
			got = v
		}
	}
	if got.Count != 3 {
		t.Errorf("请求数:想要 3,拿到 %d", got.Count)
	}
	if got.Errors != 1 {
		t.Errorf("出错数:想要 1,拿到 %d", got.Errors)
	}
	if got.LastPath != "/admin" {
		t.Errorf("最近页面:想要 /admin,拿到 %q", got.LastPath)
	}
	if got.LastUA != "Mozilla/5.0 (iPad)" {
		t.Errorf("最近 UA 应该是 iPad 那条,拿到 %q", got.LastUA)
	}
}

func TestRecentIsNewestFirst(t *testing.T) {
	s := newTestStore(t, 5)
	now := time.Now()
	insertAt(t, s, now.Add(-time.Minute), "1.1.1.1", "/old", 200, "")
	insertAt(t, s, now, "1.1.1.1", "/new", 200, "")

	got, err := s.Recent(5, 10)
	if err != nil {
		t.Fatalf("Recent: %v", err)
	}
	if len(got) != 2 || got[0].Path != "/new" {
		t.Fatalf("想要新的排在最前,拿到 %+v", got)
	}
}

// 这是用户最关心的一条:超过保留期的数据要真的被删掉,
// 而且文件不能只涨不落。
func TestPruneDropsOldRowsAndShrinksFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "access.db")
	s, err := OpenAccessStore(path, 5)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	defer s.Close()

	old := time.Now().AddDate(0, 0, -10) // 早就过期
	fresh := time.Now()
	for i := 0; i < 2000; i++ {
		insertAt(t, s, old, "9.9.9.9", "/old", 200, "some reasonably long user agent string here")
	}
	for i := 0; i < 10; i++ {
		insertAt(t, s, fresh, "8.8.8.8", "/new", 200, "ua")
	}

	// 把 WAL 落进主库,才能量到真实文件大小
	if err := s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`).Error; err != nil {
		t.Fatalf("checkpoint: %v", err)
	}
	before := fileSize(t, path)

	s.Prune()

	total, err := s.Total(5)
	if err != nil {
		t.Fatalf("Total: %v", err)
	}
	if total != 10 {
		t.Errorf("清理后应只剩 10 条,拿到 %d", total)
	}

	if err := s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`).Error; err != nil {
		t.Fatalf("checkpoint: %v", err)
	}
	after := fileSize(t, path)
	if after >= before {
		t.Errorf("清理后文件没变小:之前 %d 字节,之后 %d 字节 —— "+
			"多半是 auto_vacuum 没生效(它必须在建表前设置)", before, after)
	}
}

func fileSize(t *testing.T, path string) int64 {
	t.Helper()
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	return fi.Size()
}

// auto_vacuum 一旦没生效,删数据就不会释放空间,而且不会报任何错 ——
// 只会表现为"用着用着数据库越来越大"。这条直接盯住那个开关。
func TestAutoVacuumIsIncremental(t *testing.T) {
	s := newTestStore(t, 5)

	var mode int
	if err := s.db.Raw(`PRAGMA auto_vacuum`).Scan(&mode).Error; err != nil {
		t.Fatalf("读 auto_vacuum: %v", err)
	}
	if mode != 2 {
		t.Fatalf("auto_vacuum 应该是 2(incremental),拿到 %d —— "+
			"删掉的数据将永远不还给文件系统", mode)
	}
}

// 重开已有的库不该重复 VACUUM(那会在大库上卡住启动),
// 但设置必须还在。
func TestAutoVacuumSurvivesReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "access.db")

	first, err := OpenAccessStore(path, 5)
	if err != nil {
		t.Fatalf("首次打开: %v", err)
	}
	insertAt(t, first, time.Now(), "1.1.1.1", "/", 200, "ua")
	if err := first.Close(); err != nil {
		t.Fatalf("关闭: %v", err)
	}

	again, err := OpenAccessStore(path, 5)
	if err != nil {
		t.Fatalf("重新打开: %v", err)
	}
	defer again.Close()

	var mode int
	if err := again.db.Raw(`PRAGMA auto_vacuum`).Scan(&mode).Error; err != nil {
		t.Fatalf("读 auto_vacuum: %v", err)
	}
	if mode != 2 {
		t.Errorf("重开后 auto_vacuum 应该还是 2,拿到 %d", mode)
	}

	n, err := again.Total(5)
	if err != nil {
		t.Fatalf("Total: %v", err)
	}
	if n != 1 {
		t.Errorf("重开后数据应该还在,拿到 %d 条", n)
	}
}
