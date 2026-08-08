// Package web 只做一件事:把前端构建产物嵌进二进制。
//
// embed 只能引用同目录或下级目录的文件,所以这个包必须待在 web/ 下,
// 不能挪到 internal/。
package web

import "embed"

// Dist 是 vite 的构建产物。dist/ 里平时只有 .gitkeep,
// 全新 clone 后不跑 npm build 也能编译通过 —— 这时会退化成一句提示页。
//
//go:embed all:dist
var Dist embed.FS
