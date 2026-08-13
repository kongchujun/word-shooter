import type { Engine } from '../core/Engine'
import type { ViewId } from '../shell/routes'
import { HUD } from '../ui/HUD'
import type { WhackGame, WhackLevel } from './sets'
import { moleWord, type WhackResult } from './types'
import { loadVoices } from './voices'
import { WhackScene } from './WhackScene'
import { WhackScreens } from './WhackScreens'

/**
 * 打地鼠的应用外壳,和 Game / MathApp 同构:自己一份 HUD 和面板,
 * 真正开打时把场景交给共用的 Engine。
 */
export class WhackApp {
  private hud: HUD
  private screens: WhackScreens
  private play: WhackScene | null = null
  private game: WhackGame | null = null

  onPlaying: (playing: boolean) => void = () => {}
  /** 首页上点了某一套地鼠,由 main.ts 转成路由跳转 */
  onPick: (view: ViewId) => void = () => {}

  constructor(
    private engine: Engine,
    ui: HTMLElement,
  ) {
    this.hud = new HUD(ui)
    this.hud.onReplay = () => this.play?.replayAudio()
    this.hud.onQuit = () => this.quitToMenu()
    this.screens = new WhackScreens(ui)

    window.addEventListener('keydown', (e) => {
      // 三个玩法共用一块 canvas,只认自己的场景在台上的时候
      if (!this.play || this.engine.active !== this.play) return
      if (e.code === 'Space') {
        e.preventDefault()
        this.play.replayAudio()
      } else if (e.code === 'Escape') {
        this.quitToMenu()
      }
    })

    if (import.meta.env.DEV) (window as unknown as { __whack: WhackApp }).__whack = this
  }

  /** 仅调试用:控制台里 __whack.debugHoles() 能看当前哪只是答案 */
  debugHoles(): { label: string; en: string; x: number; y: number; correct: boolean }[] {
    return this.play?.debugHoles() ?? []
  }

  /** 三套地鼠的入口页 */
  enterHome(): void {
    this.teardownPlay()
    this.game = null
    this.screens.showHome((view) => this.onPick(view))
  }

  enter(game: WhackGame): void {
    this.teardownPlay()
    this.game = game
    this.screens.showMenu(game, (lv) => void this.startLevel(lv))
  }

  leave(): void {
    this.teardownPlay()
    this.screens.hideAll()
    this.hud.hide()
  }

  private async startLevel(level: WhackLevel): Promise<void> {
    const game = this.game
    if (!game) return

    // 必须在点击的同步调用栈里解锁,否则 iOS 全程没声音
    this.engine.audio.unlock()
    this.screens.showLoading()
    // 词库里有同名词条的用真人发音,其余交给 TTS
    const voices = await loadVoices()
    await this.engine.audio.preload(
      game.moles.filter((m) => voices.has(m.id)).map((m) => moleWord(m, voices.get(m.id))),
    )

    // 加载期间可能已经切走了,别把场景硬塞回来
    if (this.game !== game) return

    this.screens.hideAll()
    this.hud.setScore(0)
    this.hud.setCombo(0)
    this.hud.show()

    const play = new WhackScene(this.engine, this.hud, game, level, voices, (r) => this.finish(r))
    this.play = play
    this.engine.setScene(play)
    play.start()
    this.onPlaying(true)
  }

  private finish(result: WhackResult): void {
    this.teardownPlay()
    this.screens.showResult(
      result,
      () => void this.startLevel(result.level),
      () => this.quitToMenu(),
    )
  }

  private quitToMenu(): void {
    this.teardownPlay()
    if (this.game) this.screens.showMenu(this.game, (lv) => void this.startLevel(lv))
  }

  private teardownPlay(): void {
    const wasPlaying = this.play !== null
    this.engine.clearScene(this.play)
    this.play = null
    this.hud.hide()
    if (wasPlaying) this.onPlaying(false)
  }
}
