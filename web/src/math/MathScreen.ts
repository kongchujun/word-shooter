import type { ViewId } from '../shell/routes'
import { MATH } from './quizTiming'
import { GAMES } from './questions'

/**
 * 数学首页:上面是计算游戏的入口,下面挂一张九九乘法表当参考。
 * 具体玩法在 MathApp 里,这里只负责导流。
 */
export class MathScreen {
  private root: HTMLDivElement

  /** 点了游戏卡片,由 main.ts 转成路由跳转 */
  onPick: (view: ViewId) => void = () => {}

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'screen hidden'
    parent.appendChild(this.root)
  }

  hide(): void {
    this.root.classList.add('hidden')
  }

  show(): void {
    this.root.classList.remove('hidden')
    if (!this.root.innerHTML) this.render()
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="panel">
        <div class="logo">🔢</div>
        <h1>数学计算</h1>
        <p class="muted">挑一个开始练,每题 ${MATH.questionTime} 秒</p>
        <div class="levels">
          ${GAMES.map(
            (g) => `
            <button class="level-card" data-view="${g.view}">
              <span class="lv-emoji">${g.icon}</span>
              <span class="lv-name">${g.name}</span>
              <span class="lv-meta">${g.desc}</span>
            </button>`,
          ).join('')}
        </div>
        <h3 class="sub-title">参考:九九乘法表</h3>
        <div class="mult-table">${rows()}</div>
      </div>
    `
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-view]')) {
      el.addEventListener('click', () => this.onPick(el.dataset.view as ViewId))
    }
  }
}

/** 传统的下三角写法:第 i 行只到 i 列,不重复 3×2 和 2×3 */
function rows(): string {
  const out: string[] = []
  for (let i = 1; i <= 9; i++) {
    const cells: string[] = []
    for (let j = 1; j <= i; j++) {
      cells.push(`<span class="mult-cell">${j}×${i}=${i * j}</span>`)
    }
    out.push(`<div class="mult-row">${cells.join('')}</div>`)
  }
  return out.join('')
}
