import type { Engine, Scene } from '../core/Engine'
import { t } from '../i18n'
import { GhostStore } from '../systems/GhostStore'
import { HUD } from '../ui/HUD'
import { BalanceScene, type BalanceResult } from './balance/BalanceScene'
import type { BalanceLevel } from './balance/levels'
import type { BikeLevel } from './bike/levels'
import { BikeDuelScene, type BikeDuelOpts, type BikeDuelResult } from './bikeDuel/BikeDuelScene'
import { leaveRoom, type BikeSession } from './bikeDuel/online'
import { bikeDuelLevel } from './bikeDuel/levels'
import { MathScreens } from './MathScreens'
import { QuizScene } from './QuizScene'
import type { LevelInfo, MathGame, QuizLevel } from './questions'
import type { QuizResult } from './types'

/**
 * 数学侧的应用外壳,和 Game 同构:自己一份 HUD 和面板,
 * 真正开打时把场景交给共用的 Engine。
 */
export class MathApp {
  private hud: HUD
  private screens: MathScreens
  private play: Scene | null = null
  private game: MathGame | null = null
  /** 比赛中的在线会话;中途退出要 leave */
  private onlineSession: BikeSession | null = null
  private onlineFinished = false

  onPlaying: (playing: boolean) => void = () => {}

  constructor(
    private engine: Engine,
    ui: HTMLElement,
  ) {
    this.hud = new HUD(ui)
    this.hud.setReplayVisible(false)
    this.hud.onQuit = () => void this.quitToMenu()
    this.screens = new MathScreens(ui)

    window.addEventListener('keydown', (e) => {
      if (!this.play || this.engine.active !== this.play) return
      if (e.code === 'Escape') void this.quitToMenu()
    })

    if (import.meta.env.DEV) (window as unknown as { __math: MathApp }).__math = this
  }

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
    void this.teardownPlay()
    this.game = game
    // 多人:点侧栏就进开房/加入
    if (game.kind === 'bikeDuel') {
      this.openOnlineLobby()
      return
    }
    this.screens.showMenu(game, (lv) => this.startLevel(lv))
  }

  async leave(): Promise<void> {
    await this.teardownPlay()
    await this.screens.hideAll()
    this.hud.hide()
  }

  private startLevel(level: LevelInfo): void {
    if (!this.game || this.game.kind === 'bikeDuel') return

    if (this.game.kind === 'bike') {
      const bikeLevel = level as BikeLevel
      const ghost = GhostStore.getForMax(bikeLevel.max) ?? null
      this.launchDuel(bikeLevel, { mode: 'ghost', ghost })
      return
    }

    this.engine.audio.unlock()
    this.screens.hideAll()
    this.hud.setScore(0)
    this.hud.setCombo(0)
    this.hud.show()

    if (this.game.kind === 'quiz') {
      this.hud.setStatLabels(t('game.hud.score'), t('game.hud.round'))
      const quizLevel = level as QuizLevel
      const play = new QuizScene(this.engine, this.hud, quizLevel, (r) => this.finishQuiz(r))
      this.play = play
      this.engine.setScene(play)
      play.start()
    } else {
      this.hud.setStatLabels(t('game.hud.score'), t('game.hud.round'))
      const balLevel = level as BalanceLevel
      const play = new BalanceScene(this.engine, this.hud, balLevel, (r) => this.finishBalance(r))
      this.play = play
      this.engine.setScene(play)
      play.start()
    }
    this.onPlaying(true)
  }

  private openOnlineLobby(): void {
    const level = bikeDuelLevel()
    this.screens.showBikeOnlineLobby(level, {
      onStart: (session, startAt) => {
        this.launchDuel(level, { mode: 'online', online: session, startAt })
      },
    })
  }

  private launchDuel(level: BikeLevel, opts: BikeDuelOpts): void {
    this.engine.audio.unlock()
    this.screens.releaseLobbySession()
    void this.screens.hideAll()
    this.onlineSession = opts.mode === 'online' ? opts.online ?? null : null
    this.onlineFinished = false
    this.hud.setStatLabels(t('game.hud.distance'), t('game.hud.timeLeft'))
    this.hud.setScore(0)
    this.hud.setCombo(0)
    this.hud.show()
    const play = new BikeDuelScene(this.engine, this.hud, level, opts, (r) => this.finishBikeDuel(r))
    this.play = play
    this.engine.setScene(play)
    play.start()
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

  private finishBikeDuel(result: BikeDuelResult): void {
    this.onlineFinished = true
    this.onlineSession = null
    void this.teardownPlay()
    if (result.mode === 'online' && result.outcome === 'win') {
      this.engine.audio.playSfx('levelup')
    }
    const retry =
      this.game?.kind === 'bike' ? () => this.startLevel(result.level) : () => this.openOnlineLobby()
    this.screens.showBikeDuelResult(result, retry, () => void this.quitToMenu())
  }

  private async quitToMenu(): Promise<void> {
    if (this.game) {
      await this.leave()
      this.enter(this.game)
    }
  }

  private async teardownPlay(): Promise<void> {
    const wasPlaying = this.play !== null
    const abandon = !this.onlineFinished ? this.onlineSession : null
    this.onlineSession = null
    this.onlineFinished = false
    this.engine.clearScene(this.play)
    this.play = null
    this.hud.hide()
    if (wasPlaying) this.onPlaying(false)
    if (abandon) await leaveRoom(abandon)
  }
}
