import { t } from '../i18n'

/**
 * 战场上的覆盖层:准星、性能读数、退出键。
 * 全用 DOM —— 文字比画在 canvas 上清晰,也不占 3D 那边的 draw call。
 *
 * 性能读数是第 0 步的主角:这一期就是要拿它去真机上看帧率。
 */
export class ArenaHud {
  private root: HTMLElement
  private fpsEl: HTMLElement
  private lowEl: HTMLElement
  private drawEl: HTMLElement
  private triEl: HTMLElement
  private dprEl: HTMLElement
  private posEl: HTMLElement
  private hintEl: HTMLElement
  private crossEl: HTMLElement
  private toastEl: HTMLElement
  private ammoEl: HTMLElement
  private magEl: HTMLElement
  private gunEl: HTMLElement
  private scopeEl: HTMLElement
  private healthEl: HTMLElement
  private teamEl: HTMLElement
  private deathEl: HTMLElement
  private respawnEl: HTMLElement

  onQuit: () => void = () => {}

  constructor(host: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'arena-hud'
    this.root.innerHTML = `
      <button class="arena-quit" data-act="quit" type="button">← ${t('game.hud.quitShort')}</button>
      <div class="arena-player-card">
        <span data-el="team"></span>
        <div><label>${t('arena.hud.health')}</label><b data-el="health">100</b><i><u data-el="healthbar"></u></i></div>
      </div>
      <div class="arena-perf">
        <div><label>FPS</label><b data-el="fps">–</b></div>
        <div><label>${t('arena.perf.low')}</label><b data-el="low">–</b></div>
        <div><label>Draw</label><b data-el="draw">–</b></div>
        <div><label>△</label><b data-el="tri">–</b></div>
        <div><label>DPR</label><b data-el="dpr">–</b></div>
      </div>
      <div class="arena-cross" data-el="cross" aria-hidden="true"><i></i><i></i><i></i><i></i><u></u></div>
      <div class="arena-scope" data-el="scope" aria-hidden="true"><i></i><b></b></div>
      <div class="arena-toast" data-el="toast"></div>
      <div class="arena-death" data-el="death">
        <strong>${t('arena.death.title')}</strong>
        <span>${t('arena.death.home')}</span>
        <b data-el="respawn">3</b>
      </div>
      <div class="arena-ammo">
        <span class="arena-gun" data-el="gun"></span>
        <span class="arena-mag"><b data-el="ammo">0</b><i data-el="mag">/0</i></span>
      </div>
      <div class="arena-foot">
        <span data-el="pos"></span>
        <span class="arena-hint" data-el="hint"></span>
      </div>
    `
    host.appendChild(this.root)

    this.fpsEl = this.q('fps')
    this.lowEl = this.q('low')
    this.drawEl = this.q('draw')
    this.triEl = this.q('tri')
    this.dprEl = this.q('dpr')
    this.posEl = this.q('pos')
    this.hintEl = this.q('hint')
    this.crossEl = this.q('cross')
    this.toastEl = this.q('toast')
    this.ammoEl = this.q('ammo')
    this.magEl = this.q('mag')
    this.gunEl = this.q('gun')
    this.scopeEl = this.q('scope')
    this.healthEl = this.q('health')
    this.teamEl = this.q('team')
    this.deathEl = this.q('death')
    this.respawnEl = this.q('respawn')

    this.root.querySelector('[data-act="quit"]')!.addEventListener('click', () => this.onQuit())
  }

  /** 准星张开多少(像素)。跑动和跳跃时张开,开镜时收拢 —— 张多开就可能偏多少 */
  setSpread(px: number): void {
    this.crossEl.style.setProperty('--spread', `${px.toFixed(1)}px`)
  }

  /** 右键按住才进入瞄准;狙击枪额外显示圆形镜片和刻度。 */
  setAim(ads: boolean, sniper: boolean): void {
    this.root.classList.toggle('ads', ads)
    this.scopeEl.classList.toggle('on', ads && sniper)
    this.crossEl.classList.toggle('scope-hidden', ads && sniper)
  }

  /** 打中了:准星闪一下叉 */
  hitMark(head: boolean): void {
    this.crossEl.classList.remove('hit', 'head')
    // 强制重排,连着命中时动画才会重新播
    void this.crossEl.offsetWidth
    this.crossEl.classList.add('hit')
    if (head) this.crossEl.classList.add('head')
  }

  /** 屏幕中上方的一句话:击倒、空仓、换弹 */
  toast(text: string, tone: 'good' | 'warn' = 'good'): void {
    this.toastEl.textContent = text
    this.toastEl.dataset.tone = tone
    this.toastEl.classList.remove('show')
    void this.toastEl.offsetWidth
    this.toastEl.classList.add('show')
  }

  setAmmo(cur: number, mag: number, gunName: string, reloading: boolean): void {
    this.ammoEl.textContent = reloading ? '…' : String(cur)
    this.ammoEl.dataset.tone = reloading ? 'warn' : cur === 0 ? 'bad' : cur <= mag * 0.25 ? 'warn' : 'good'
    this.magEl.textContent = `/${mag}`
    this.gunEl.textContent = gunName
  }

  setPlayer(team: 'red' | 'blue', hp: number, number?: number): void {
    const name = team === 'red' ? t('arena.team.redShort') : t('arena.team.blueShort')
    this.teamEl.textContent = number ? `${name} #${number}` : name
    this.teamEl.dataset.team = team
    this.healthEl.textContent = String(hp)
    const bar = this.q('healthbar')
    bar.style.width = `${Math.max(0, hp)}%`
    bar.dataset.tone = hp > 50 ? 'good' : hp > 20 ? 'warn' : 'bad'
  }

  setDead(dead: boolean, seconds: number): void {
    this.root.classList.toggle('is-dead', dead)
    this.deathEl.classList.toggle('show', dead)
    this.respawnEl.textContent = String(Math.max(0, seconds))
  }

  setHint(text: string): void {
    this.hintEl.textContent = text
  }

  /** 每秒刷一次就够,每帧写 DOM 本身就会拖低帧率 */
  setPerf(fps: number, low: number, draws: number, tris: number, dpr: number): void {
    this.fpsEl.textContent = String(Math.round(fps))
    this.fpsEl.dataset.tone = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'bad'
    this.lowEl.textContent = String(Math.round(low))
    this.lowEl.dataset.tone = low >= 45 ? 'good' : low >= 25 ? 'ok' : 'bad'
    this.drawEl.textContent = String(draws)
    this.triEl.textContent = tris >= 1000 ? `${(tris / 1000).toFixed(1)}k` : String(tris)
    this.dprEl.textContent = dpr.toFixed(2)
  }

  setPos(x: number, y: number, z: number): void {
    this.posEl.textContent = `x ${x.toFixed(0)}  y ${y.toFixed(1)}  z ${z.toFixed(0)}`
  }

  dispose(): void {
    this.root.remove()
  }

  private q(name: string): HTMLElement {
    return this.root.querySelector(`[data-el="${name}"]`)!
  }
}
