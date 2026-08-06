export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  html = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  if (html) el.innerHTML = html
  return el
}

export function qs<T extends Element>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel)
  if (!el) throw new Error(`找不到元素: ${sel}`)
  return el
}

let toastTimer = 0

export function toast(msg: string, kind: 'ok' | 'error' = 'ok'): void {
  let el = document.getElementById('toast')
  if (!el) {
    el = h('div', { id: 'toast' })
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.className = `toast show ${kind}`
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    el!.className = 'toast'
  }, kind === 'error' ? 15000 : 2500)
}

/** base64 转 data URL,用来在页面上直接预览还没落盘的生成结果 */
export function dataURL(b64: string, mediaType: string): string {
  return `data:${mediaType};base64,${b64}`
}

export function fmtBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`
}

export function fmtCost(usd: number): string {
  return usd > 0 ? `$${usd.toFixed(4)}` : '—'
}

/** 单词 → 文件 id。和后端的白名单正则保持一致。 */
export function toId(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

export const ID_RE = /^[a-z][a-z0-9-]{0,31}$/
