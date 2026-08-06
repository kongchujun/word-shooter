/** 战斗中的顶部条:分数 / 连击 / 进度 / 重听 / 退出。用 DOM 画,文字比 canvas 清晰。 */
export class HUD {
  private root: HTMLDivElement
  private scoreEl: HTMLSpanElement
  private comboEl: HTMLDivElement
  private roundEl: HTMLSpanElement

  onReplay: () => void = () => {}
  onQuit: () => void = () => {}

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hud hidden'
    this.root.innerHTML = `
      <button class="hud-btn" data-act="quit" title="返回选关">✕</button>
      <div class="hud-stat"><label>分数</label><span data-el="score">0</span></div>
      <div class="hud-stat"><label>进度</label><span data-el="round">1 / 10</span></div>
      <div class="hud-combo" data-el="combo"></div>
      <button class="hud-btn hud-replay" data-act="replay" title="再听一遍">🔊</button>
    `
    parent.appendChild(this.root)

    this.scoreEl = this.root.querySelector('[data-el="score"]')!
    this.roundEl = this.root.querySelector('[data-el="round"]')!
    this.comboEl = this.root.querySelector('[data-el="combo"]')!

    this.root.querySelector('[data-act="replay"]')!.addEventListener('click', () => this.onReplay())
    this.root.querySelector('[data-act="quit"]')!.addEventListener('click', () => this.onQuit())
  }

  show(): void {
    this.root.classList.remove('hidden')
  }

  hide(): void {
    this.root.classList.add('hidden')
  }

  setScore(v: number): void {
    this.scoreEl.textContent = String(v)
  }

  setRound(i: number, total: number): void {
    this.roundEl.textContent = `${i} / ${total}`
  }

  setCombo(v: number): void {
    if (v >= 2) {
      this.comboEl.textContent = `🔥 ${v} 连击`
      this.comboEl.classList.add('pulse')
      window.setTimeout(() => this.comboEl.classList.remove('pulse'), 300)
    } else {
      this.comboEl.textContent = ''
    }
  }
}
