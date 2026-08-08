package main

import (
	"embed"
	"log"
	"strings"
	"sync"

	"github.com/lionsoul2014/ip2region/binding/golang/xdb"
)

// ip2region 的数据文件打进二进制,部署仍然只有一个文件 ——
// deploy.sh 只下载二进制,分离的数据文件迟早会在某次换服务器时被漏掉。
//
// xdb 本身不进仓库(11MB),由 build.sh 和 CI 在构建前下载。
// 没下到也能编译:embed 的是目录,里面只有 .gitkeep 时归属地功能自动关掉。
//
//go:embed all:geoip
var geoipFS embed.FS

const geoipFile = "geoip/ip2region_v4.xdb"

var (
	geoOnce     sync.Once
	geoSearcher *xdb.Searcher
)

// geoReady 说明数据文件在不在。后台据此决定要不要显示「归属地」这一列。
func geoReady() bool {
	initGeo()
	return geoSearcher != nil
}

func initGeo() {
	geoOnce.Do(func() {
		buf, err := geoipFS.ReadFile(geoipFile)
		if err != nil || len(buf) == 0 {
			log.Printf("[geoip] 没有内置 %s,访问页只显示 IP 不显示归属地", geoipFile)
			return
		}
		s, err := xdb.NewWithBuffer(xdb.IPv4, buf)
		if err != nil {
			log.Printf("[geoip] 数据文件读不了,归属地功能关闭: %v", err)
			return
		}
		geoSearcher = s
		log.Printf("[geoip] 已加载 IP 归属地库(%.1f MB,离线查询)", float64(len(buf))/(1<<20))
	})
}

// regionOf 查 IP 归属地。内网地址和查不到的都返回空字符串。
// 纯本地查询,不外发任何请求。
func regionOf(ip string) string {
	if ip == "" || isPrivateIP(ip) {
		return ""
	}
	initGeo()
	if geoSearcher == nil {
		return ""
	}
	raw, err := geoSearcher.Search(ip)
	if err != nil {
		return ""
	}
	return formatRegion(raw)
}

// formatRegion 把 "中国|江苏省|南京市|0|CN" 整成 "江苏省 南京市"。
//
// 字段是 国家|省|市|ISP|国家码;"0" 表示这一级没数据。
// 国内不重复写「中国」,末尾的国家码和前面的国家名重复,也丢掉。
func formatRegion(raw string) string {
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
