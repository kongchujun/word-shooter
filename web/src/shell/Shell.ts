import { GAMES } from '../math/questions'
import type { ViewId } from './routes'

interface NavItem {
  id: ViewId
  icon: string
  name: string
  short: string
  /** 首页卡片上的一句话说明,只有顶层项要 */
  tip?: string
  children?: NavItem[]
}

const NAV: NavItem[] = [
  { id: 'home', icon: '🏠', name: '首页', short: '首页', tip: '选一个开始' },
  { id: 'words', icon: '🎯', name: '单词射击', short: '单词', tip: '听到单词,瞄准对应的图片开枪' },
  {
    id: 'math',
    icon: '🔢',
    name: '数学计算',
    short: '数学',
    tip: '算得又快又准',
    // 子项跟着游戏清单走,加新游戏不用两头改
    children: GAMES.map((g) => ({ id: g.view, icon: g.icon, name: g.name, short: g.short })),
  },
]

const ALL_IDS = NAV.flatMap((n) => [n.id, ...(n.children ?? []).map((c) => c.id)])

/**
 * 左侧导航栏 + 首页面板。各个功能页自己管自己的 DOM,这里只负责切换。
 *
 * 路由用 hash 不用 pathname:后端虽然有 SPA 兜底,但 hash 完全不牵扯服务端,
 * 刷新和微信里分享出去的链接都能停在原页。
 */
export class Shell {
  private bar: HTMLElement
  private home: HTMLElement
  private view: ViewId = 'home'

  /** 切页时通知外面,由 main.ts 决定谁显示谁隐藏 */
  onNavigate: (view: ViewId) => void = () => {}

  constructor(parent: HTMLElement) {
    this.bar = document.createElement('nav')
    this.bar.className = 'sidebar'
    this.bar.innerHTML = NAV.map((n) => navButton(n) + (n.children ?? []).map((c) => navButton(c, true)).join('')).join('')
    parent.appendChild(this.bar)

    this.home = document.createElement('div')
    this.home.className = 'screen hidden'
    this.home.innerHTML = `
      <div class="panel">
        <div class="logo">📚</div>
        <h1>今天学点什么</h1>
        <p class="muted">左边选一个,或者点下面的卡片</p>
        <div class="levels">
          ${NAV.filter((n) => n.id !== 'home')
            .map(
              (n) => `
            <button class="level-card" data-view="${n.id}">
              <span class="lv-emoji">${n.icon}</span>
              <span class="lv-name">${n.name}</span>
              <span class="lv-meta">${n.tip}</span>
            </button>`,
            )
            .join('')}
        </div>
      </div>
    `
    parent.appendChild(this.home)

    for (const el of parent.querySelectorAll<HTMLElement>('[data-view]')) {
      el.addEventListener('click', () => this.go(el.dataset.view as ViewId))
    }
    window.addEventListener('hashchange', () => this.apply())
  }

  /** 按当前 hash 落到对应的页面。开机时调一次。 */
  start(): void {
    this.apply()
  }

  go(view: ViewId): void {
    const next = hashOf(view)
    if (location.hash === next) {
      // hash 没变就不会触发 hashchange,手动走一遍(比如在首页又点了首页)
      this.apply()
      return
    }
    location.hash = next
  }

  /** 开打时把侧栏收起来,给 canvas 让出整个屏幕 */
  setBarVisible(v: boolean): void {
    this.bar.classList.toggle('hidden', !v)
    document.body.classList.toggle('with-sidebar', v)
  }

  private apply(): void {
    this.view = parseHash()
    for (const el of this.bar.querySelectorAll<HTMLElement>('.nav-item')) {
      const id = el.dataset.view as ViewId
      el.classList.toggle('active', id === this.view)
      // 子项平时收着,进了这个分支才展开
      if (el.classList.contains('nav-sub')) {
        el.classList.toggle('hidden', !this.view.startsWith(branchOf(id)))
      }
    }
    this.home.classList.toggle('hidden', this.view !== 'home')
    this.onNavigate(this.view)
  }
}

function navButton(n: NavItem, sub = false): string {
  return `
    <button class="nav-item${sub ? ' nav-sub hidden' : ''}" data-view="${n.id}">
      <span class="nav-icon">${n.icon}</span>
      <span class="nav-name">${n.name}</span>
      <span class="nav-short">${n.short}</span>
    </button>`
}

/** 'math/mult' 属于 'math' 这一支 */
function branchOf(id: ViewId): string {
  return id.split('/')[0]
}

function hashOf(view: ViewId): string {
  return view === 'home' ? '#/' : `#/${view}`
}

function parseHash(): ViewId {
  const id = location.hash.replace(/^#\/?/, '')
  return id !== 'home' && ALL_IDS.includes(id as ViewId) ? (id as ViewId) : 'home'
}
