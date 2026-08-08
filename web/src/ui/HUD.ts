import { t } from '../i18n'
/** 战斗中的顶部条:分数 / 连击 / 进度 / 重听 / 退出。用 DOM 画,文字比 canvas 清晰。 */
export class HUD {
  private root: HTMLDivElement
  private scoreEl: HTMLSpanElement
  private scoreLabelEl: HTMLElement
  private comboEl: HTMLDivElement
  private roundEl: HTMLSpanElement
  private roundLabelEl: HTMLElement
  private replayEl: HTMLButtonElement

  onReplay: () => void = () => {}
  onQuit: () => void = () => {}

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hud hidden'
    this.root.innerHTML = `
      <button class="hud-btn hud-quit" data-act="quit" title="${t('game.hud.quit')}" aria-label="${t('game.hud.quit')}">
        <span class="hud-quit-icon" aria-hidden="true">←</span>
        <span class="hud-quit-label">${t('game.hud.quitShort')}</span>
      </button>
      <div class="hud-stat"><label data-el="score-label">${t('game.hud.score')}</label><span data-el="score">0</span></div>
      <div class="hud-stat"><label data-el="round-label">${t('game.hud.round')}</label><span data-el="round">1 / 10</span></div>
      <div class="hud-combo" data-el="combo"></div>
      <button class="hud-btn hud-replay" data-act="replay" title="${t('game.hud.replay')}">🔊</button>
    `
    parent.appendChild(this.root)

    this.scoreEl = this.root.querySelector('[data-el="score"]')!
    this.scoreLabelEl = this.root.querySelector('[data-el="score-label"]')!
    this.roundEl = this.root.querySelector('[data-el="round"]')!
    this.roundLabelEl = this.root.querySelector('[data-el="round-label"]')!
    this.comboEl = this.root.querySelector('[data-el="combo"]')!
    this.replayEl = this.root.querySelector('[data-act="replay"]')!

    this.replayEl.addEventListener('click', () => this.onReplay())
    this.root.querySelector('[data-act="quit"]')!.addEventListener('click', () => this.onQuit())
  }

  /** 数学题没有语音可重听,把喇叭收掉 */
  setReplayVisible(v: boolean): void {
    this.replayEl.classList.toggle('hidden', !v)
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

  /** 踩单车之类不按「第几题」显示的玩法 */
  setRoundText(text: string): void {
    this.roundEl.textContent = text
  }

  setStatLabels(score: string, round: string): void {
    this.scoreLabelEl.textContent = score
    this.roundLabelEl.textContent = round
  }

  setCombo(v: number): void {
    if (v >= 2) {
      this.comboEl.textContent = t('game.hud.combo', { n: v })
      this.comboEl.classList.add('pulse')
      window.setTimeout(() => this.comboEl.classList.remove('pulse'), 300)
    } else {
      this.comboEl.textContent = ''
    }
  }
}
