import type { Engine, Scene } from '../core/Engine'
import { HUD } from '../ui/HUD'
import { BalanceScene, type BalanceResult } from './balance/BalanceScene'
import type { BalanceLevel } from './balance/levels'
import { MathScreens } from './MathScreens'
import { QuizScene } from './QuizScene'
import type { LevelInfo, MathGame, QuizLevel } from './questions'
import type { QuizResult } from './types'

/**
 * 数学侧的应用外壳,和 Game 同构:自己一份 HUD 和面板,
 * 真正开打时把场景交给共用的 Engine。quiz / balance 两种玩法都走这里。
 */
export class MathApp {
  private hud: HUD
  private screens: MathScreens
  private play: Scene | null = null
  private game: MathGame | null = null

  /** 真正开打/收工时通知外壳,用来收放侧栏 */
  onPlaying: (playing: boolean) => void = () => {}

  constructor(
    private engine: Engine,
    ui: HTMLElement,
  ) {
    this.hud = new HUD(ui)
    this.hud.setReplayVisible(false)
    this.hud.onQuit = () => this.quitToMenu()
    this.screens = new MathScreens(ui)

    window.addEventListener('keydown', (e) => {
      // 单词射击也在同一块 canvas 上跑,只认自己的场景在台上的时候
      if (!this.play || this.engine.active !== this.play) return
      if (e.code === 'Escape') this.quitToMenu()
    })

    // dev 下挂个调试入口
    if (import.meta.env.DEV) (window as unknown as { __math: MathApp }).__math = this
  }

  /** 仅调试用:射击题看靶子;天平看当前目标和左盘 */
  debugTargets(): { n: number; x: number; y: number; correct: boolean }[] {
    if (this.play instanceof QuizScene) return this.play.debugTargets()
    return []
  }

  debugBalance(): {
    target: number
    sum: number
    pan: number[]
    layout?: { tray: Record<number, { x: number; y: number }>; leftPan: { x: number; y: number } }
  } | null {
    if (!(this.play instanceof BalanceScene)) return null
    return { ...this.play.debugState(), layout: this.play.debugLayout() }
  }

  enter(game: MathGame): void {
    this.teardownPlay()
    this.game = game
    this.screens.showMenu(game, (lv) => this.startLevel(lv))
  }

  leave(): void {
    this.teardownPlay()
    this.screens.hideAll()
    this.hud.hide()
  }

  private startLevel(level: LevelInfo): void {
    if (!this.game) return
    // 必须在点击的同步调用栈里解锁,否则 iOS 全程没声音。
    this.engine.audio.unlock()

    this.screens.hideAll()
    this.hud.setScore(0)
    this.hud.setCombo(0)
    this.hud.show()

    if (this.game.kind === 'quiz') {
      const quizLevel = level as QuizLevel
      const play = new QuizScene(this.engine, this.hud, quizLevel, (r) => this.finishQuiz(r))
      this.play = play
      this.engine.setScene(play)
      play.start()
    } else {
      const balLevel = level as BalanceLevel
      const play = new BalanceScene(this.engine, this.hud, balLevel, (r) => this.finishBalance(r))
      this.play = play
      this.engine.setScene(play)
      play.start()
    }
    this.onPlaying(true)
  }

  private finishQuiz(result: QuizResult): void {
    this.teardownPlay()
    this.screens.showQuizResult(
      result,
      () => this.startLevel(result.level),
      () => this.quitToMenu(),
    )
  }

  private finishBalance(result: BalanceResult): void {
    this.teardownPlay()
    this.screens.showBalanceResult(
      result,
      () => this.startLevel(result.level),
      () => this.quitToMenu(),
    )
  }

  private quitToMenu(): void {
    if (this.game) this.enter(this.game)
  }

  private teardownPlay(): void {
    const wasPlaying = this.play !== null
    this.engine.clearScene(this.play)
    this.play = null
    this.hud.hide()
    if (wasPlaying) this.onPlaying(false)
  }
}
