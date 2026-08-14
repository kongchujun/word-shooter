import type { Engine } from '../core/Engine'
import { t } from '../i18n'
import { ArenaSfx } from './sfx'
import type { ArenaWorld } from './ArenaWorld'
import type { ArenaTeam } from './online'

type ArenaWorldCtor = typeof import('./ArenaWorld')['ArenaWorld']

/**
 * 射击场的外壳。和别的玩法不同,它不往共用的 Engine 里塞场景 ——
 * 3D 那边有自己的 WebGL 画布和循环,进去时把 2D 那条循环挂起,出来再恢复。
 *
 * three 走动态 import:单词、数学、打地鼠那几个页面一个字节都不该为它买单。
 */
export class ArenaApp {
  private root: HTMLDivElement
  private world: ArenaWorld | null = null
  private worldCtor: ArenaWorldCtor | null = null
  private loading = false
  private loadToken = 0
  /** 枪声。AudioContext 必须在点击的同步调用栈里建,否则 iOS 全程静音 */
  private sfx = new ArenaSfx()

  onPlaying: (playing: boolean) => void = () => {}

  constructor(
    private engine: Engine,
    private ui: HTMLElement,
  ) {
    this.root = document.createElement('div')
    this.root.className = 'screen hidden'
    ui.appendChild(this.root)
  }

  enter(): void {
    this.teardownWorld()
    const token = ++this.loadToken
    void this.prepareMenu(token)
  }

  leave(): void {
    this.loadToken++
    this.teardownWorld()
    this.root.classList.add('hidden')
    this.root.innerHTML = ''
  }

  private showMenu(): void {
    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel menu">
        <div class="logo">🎯</div>
        <h1>${t('nav.arena')}</h1>
        <p class="muted">${t('arena.menu.subtitle')}</p>
        <div class="levels arena-teams">
          <button class="level-card arena-team red" data-team="red">
            <span class="lv-emoji">🔴</span><span class="lv-name">${t('arena.team.red')}</span><span class="lv-meta">${t('arena.team.join')}</span>
          </button>
          <button class="level-card arena-team blue" data-team="blue">
            <span class="lv-emoji">🔵</span><span class="lv-name">${t('arena.team.blue')}</span><span class="lv-meta">${t('arena.team.join')}</span>
          </button>
        </div>
        <p class="note">${t('arena.menu.note')}</p>
      </div>
    `
    this.root.querySelectorAll<HTMLElement>('[data-team]').forEach(el=>el.addEventListener('click',()=>this.startBattle(el.dataset.team as ArenaTeam)))
  }

  private showLoading(): void {
    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel loading">
        <div class="logo">🎯</div>
        <h1>${t('nav.arena')}</h1>
        <p class="muted">${t('arena.loading')}</p>
        <div class="bar"><i style="width:60%"></i></div>
      </div>
    `
  }

  /**
   * 进竞技场菜单时先把 Three.js chunk 下载好。这样真正点“进入战场”时不再 await,
   * Pointer Lock 才仍处于浏览器认可的用户手势调用栈里。
   */
  private async prepareMenu(token: number): Promise<void> {
    this.showLoading()
    try {
      const { ArenaWorld } = await import('./ArenaWorld')
      if (token !== this.loadToken) return
      this.worldCtor = ArenaWorld
      this.showMenu()
    } catch (err) {
      if (token !== this.loadToken) return
      this.showFailure(err)
    }
  }

  private startBattle(team: ArenaTeam): void {
    if (this.loading || this.world || !this.worldCtor) return
    this.loading = true
    // 就是现在这一下点击 —— 挪到 await 之后就不算手势了
    this.sfx.unlock()
    try {
      this.root.classList.add('hidden')
      this.root.innerHTML = ''
      // 2D 那条循环每帧都在画星空,进 3D 之前停掉,别白烧一份 CPU
      this.engine.setSuspended(true)
      // 第四个参数让构造过程在这次 click 还没结束时同步申请 Pointer Lock。
      this.world = new this.worldCtor(this.ui, () => this.quitToMenu(), this.sfx, team, true)
      this.world.start()
      this.onPlaying(true)
    } catch (err) {
      this.engine.setSuspended(false)
      this.showFailure(err)
    } finally {
      this.loading = false
    }
  }

  private showFailure(err: unknown): void {
    console.error('[arena] 加载失败', err)
    this.root.classList.remove('hidden')
    this.root.innerHTML = `
        <div class="panel">
          <div class="logo">😵</div>
          <h1>${t('arena.fail.title')}</h1>
          <p class="muted">${t('arena.fail.hint')}</p>
          <div class="actions"><button class="btn primary" data-act="retry">${t('math.result.retry')}</button></div>
        </div>
    `
    this.root.querySelector('[data-act="retry"]')!.addEventListener('click', () => {
      const token = ++this.loadToken
      void this.prepareMenu(token)
    })
  }

  private quitToMenu(): void {
    this.teardownWorld()
    this.showMenu()
  }

  private teardownWorld(): void {
    if (!this.world) return
    this.world.dispose()
    this.world = null
    this.engine.setSuspended(false)
    this.onPlaying(false)
  }
}
