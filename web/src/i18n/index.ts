import { en } from './en'
import { zh } from './zh'

/** zh 是文案的源:所有 key 以它为准,en 必须一一对应(见 en.ts 的类型约束)。
 *  用 Record 而不是 typeof zh —— 后者带 as const 的字面量类型,en 会因为
 *  "'Home' 不能赋给 '首页'" 而报错。 */
export type Messages = Record<keyof typeof zh, string>
export type MessageKey = keyof Messages

export const LOCALES = [
  { id: 'zh', name: '中文' },
  { id: 'en', name: 'English' },
] as const

export type Locale = (typeof LOCALES)[number]['id']

const STORAGE_KEY = 'word-shooter.locale'

const CATALOGS: Record<Locale, Messages> = { zh, en }

/**
 * 选语言的顺序:用户存过的 → 浏览器语言 → 中文。
 * 只认前缀,zh-CN / zh-TW / zh-Hans 都算中文。
 */
function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    // 隐私模式下读不了,往下走
  }
  const nav = (navigator.language || '').toLowerCase()
  if (nav.startsWith('zh')) return 'zh'
  if (nav.startsWith('en')) return 'en'
  return 'zh'
}

let current: Locale = detect()

export function getLocale(): Locale {
  return current
}

/**
 * 换语言。
 *
 * 这套界面全是 innerHTML 模板字符串渲染的,没有响应式框架,
 * 局部重绘要挨个调各页的 render 函数,很容易漏。整页重载最稳,
 * 而且换语言本来就是个低频动作 —— 不会在对局中途按。
 */
export function setLocale(next: Locale): void {
  if (next === current) return
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // 存不下就只在本次会话生效
  }
  location.reload()
}

/**
 * 取一条文案。
 *
 * 占位符写成 {name},第二个参数传值:t('game.words.count', { n: 12 })。
 * 取不到 key 时返回 key 本身 —— 界面上会直接看到 "some.missing.key",
 * 比显示空白容易发现。
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const catalog = CATALOGS[current] ?? zh
  let s: string = catalog[key] ?? zh[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v))
    }
  }
  return s
}

/** 把 <html lang> 同步过去,朗读软件和浏览器的断词行为会跟着走 */
export function applyDocumentLang(): void {
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en'
}
