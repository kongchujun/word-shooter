// Package config 负责进程启动时的配置:.env 加载、只读的 Config,
// 以及后台可改的 Settings(存在素材目录里)。
package config

import (
	"log"
	"os"
	"path/filepath"
	"strings"
)

// LoadDotEnv 读二进制同目录的 .env(scp 部署的情况),取不到再往上一层
// (开发时二进制在 build/),最后退回当前目录(go run 的情况)。
// 真实环境变量优先于 .env 里的值。
func LoadDotEnv() {
	candidates := []string{}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, ".env"),
			filepath.Join(dir, "..", ".env"),
		)
	}
	candidates = append(candidates, ".env")

	for _, path := range candidates {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			key, val, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			key = strings.TrimSpace(key)
			val = strings.Trim(strings.TrimSpace(val), `"'`)
			if os.Getenv(key) == "" {
				os.Setenv(key, val)
			}
		}
		if abs, err := filepath.Abs(path); err == nil {
			path = abs
		}
		log.Printf("已加载配置: %s", path)
		return
	}
	log.Printf("没找到 .env(在二进制同目录、上一层和当前目录都找过),后台管理页将不可用")
}

// env 取第一个非空的环境变量。支持多个候选键名是因为 .env 里用的是
// 小写的 admin/password,同时也要认更常见的大写写法。
func env(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}
