// Package geoip 用内置的离线库查 IP 归属地。
//
// 全程本地查表,不调任何第三方接口 —— 访问者的 IP 不会离开这台机器。
package geoip

import (
	"embed"
	"log"
	"net"
	"strings"
	"sync"

	"github.com/lionsoul2014/ip2region/binding/golang/xdb"
)

// 数据文件打进二进制,部署仍然只有一个文件 —— deploy.sh 只下载二进制,
// 分离的数据文件迟早会在某次换服务器时被漏掉。
//
// xdb 本身不进仓库(11MB),由 scripts/fetch-geoip.sh 在构建前下载。
// 没下到也能编译:embed 的是目录,里面只有 .gitkeep 时归属地功能自动关掉。
//
//go:embed all:data
var dataFS embed.FS

const dataFile = "data/ip2region_v4.xdb"

// Lookup 是归属地查询器。零值不可用,请用 New。
type Lookup struct {
	searcher *xdb.Searcher
}

var (
	once   sync.Once
	shared *Lookup
)

// New 加载内置的归属地库。数据文件不在时返回一个"永远查不到"的实例,
// 而不是报错 —— 归属地只是锦上添花,不该让服务起不来。
func New() *Lookup {
	once.Do(func() {
		shared = &Lookup{}

		buf, err := dataFS.ReadFile(dataFile)
		if err != nil || len(buf) == 0 {
			log.Printf("[geoip] 没有内置 %s,访问页只显示 IP 不显示归属地", dataFile)
			return
		}
		s, err := xdb.NewWithBuffer(xdb.IPv4, buf)
		if err != nil {
			log.Printf("[geoip] 数据文件读不了,归属地功能关闭: %v", err)
			return
		}
		shared.searcher = s
		log.Printf("[geoip] 已加载 IP 归属地库(%.1f MB,离线查询)", float64(len(buf))/(1<<20))
	})
	return shared
}

// Available 说明数据文件在不在。后台据此决定要不要显示「归属地」这一列。
func (l *Lookup) Available() bool { return l != nil && l.searcher != nil }

// Region 查 IP 归属地。内网地址和查不到的都返回空字符串。
func (l *Lookup) Region(ip string) string {
	if !l.Available() || ip == "" || IsPrivate(ip) {
		return ""
	}
	raw, err := l.searcher.Search(ip)
	if err != nil {
		return ""
	}
	return format(raw)
}

// IsPrivate 判断是不是内网地址(含回环)。
func IsPrivate(s string) bool {
	ip := net.ParseIP(s)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

// format 把 "中国|江苏省|南京市|0|CN" 整成 "江苏省 南京市"。
//
// 字段是 国家|省|市|ISP|国家码;"0" 表示这一级没数据。
// 国内不重复写「中国」,末尾的国家码和前面的国家名重复,也丢掉。
func format(raw string) string {
	f := strings.Split(raw, "|")
	n := len(f)
	if n > 4 {
		n = 4
	}
	keep := make([]string, 0, 4)
	for i := 0; i < n; i++ {
		v := strings.TrimSpace(f[i])
		if v == "" || v == "0" {
			continue
		}
		if i == 0 && v == "中国" {
			continue
		}
		keep = append(keep, v)
	}
	return strings.Join(keep, " ")
}
