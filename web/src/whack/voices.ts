import type { Manifest } from '../types'

let cache: Map<string, string> | null = null

/**
 * 地鼠的真人发音:词库里有同名词条(比如 `one`、`monday`)就用它的 mp3,没有就交给浏览器 TTS。
 *
 * 走 manifest 而不是直接猜 `/assets/audio/one.mp3`:后者在文件不存在时
 * 会给每只地鼠刷一条 404,后端没起的时候更是一片 500。
 * manifest 只列图和音都齐的词 —— 正好是后台批量生成出来的那些。
 *
 * 只查一次,之后整个会话都用缓存;查不到就返回空表,全程 TTS。
 */
export async function loadVoices(): Promise<ReadonlyMap<string, string>> {
  if (cache) return cache
  const map = new Map<string, string>()
  try {
    const res = await fetch('/api/words/manifest', { cache: 'no-cache' })
    if (res.ok) {
      const data = (await res.json()) as Manifest
      for (const w of data.words ?? []) {
        if (w.audio) map.set(w.id, w.audio)
      }
    }
  } catch {
    // 后端没起,全部走 TTS
  }
  cache = map
  return cache
}
