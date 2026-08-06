import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// dev 时前端跑 5181,把 /api 和 /assets 代理到 Go 后端 :8091。
// 后端没起也能玩 —— AssetLoader 会回退到内置的 emoji 占位词库。
export default defineConfig({
  server: {
    port: 5181,
    // 绑所有网卡,不然只有 localhost 能开,平板连不上
    host: true,
    proxy: {
      '/api': 'http://localhost:8091',
      '/assets': 'http://localhost:8091',
    },
  },
  build: {
    outDir: 'dist',
    // 产物必须放 static/ —— /assets/ 那条路由是留给图片音频素材的,会被后端接管
    assetsDir: 'static',
    // 两个入口:游戏本体和后台管理页,打进同一个二进制
    rollupOptions: {
      input: {
        game: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
})
