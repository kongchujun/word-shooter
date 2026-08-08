// Package media 负责调外部服务生成素材:图片走 OpenRouter,
// 发音有 OpenRouter 和 Azure 两个源。
package media

import "slices"

// slicesContains 是 slices.Contains 的薄封装,
// 单独留一层是因为调用点很多,换实现时只动这里。
func slicesContains(list []string, v string) bool {
	return slices.Contains(list, v)
}
