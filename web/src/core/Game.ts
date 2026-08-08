import { buildLevels } from '../config/levels'
import { PlayScene } from '../scenes/PlayScene'
import { AssetLoader } from '../systems/AssetLoader'
import type { AudioManager } from '../systems/AudioManager'
import { HUD } from '../ui/HUD'
import { Screens } from '../ui/Screens'
import type { LevelDef, LevelResult, Word } from '../types'
import type { Engine } from './Engine'
import { t } from '../i18n'

export class Game {
  readonly loader = new AssetLoader()
  readonly hud: HUD

  private screens: Screens
  private play: PlayScene | null = null
  private levels: LevelDef[] = []
  private words: Word[] = []
  /** 词库清单已就绪(菜单能出)。图片按关加载,不挡选关。 */
  private ready = false

  /** 真正开打/收工时通知外壳,用来收放侧栏 */
  onPlaying: (playing: boolean) => void = () => {}

  constructor(
    private engine: Engine,
    ui: HTMLElement,
  ) {
    this.hud = new HUD(ui)
    this.screens = new Screens(ui)
    this.hud.onReplay = () => this.play?.replayAudio()
    this.hud.onQuit = () => this.quitToMenu()

    window.addEventListener('keydown', (e) => {
      // 数学游戏也在同一块 canvas 上跑,只认自己的场景在台上的时候
      if (!this.play || this.engine.active !== this.play) return
      if (e.code === 'Space') {
        e.preventDefault()
        this.play.replayAudio()
      } else if (e.code === 'Escape') {
        this.quitToMenu()
      }
    })

    // dev 下挂个调试入口:控制台里 __game.debugTargets() 能看当前哪个是正确答案
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this
  }

  // PlayScene 只认 game.width / game.audio 这几个口子,转发一下就不用改它
  get width(): number {
    return this.engine.width
  }

  get height(): number {
    return this.engine.height
  }

  get audio(): AudioManager {
    return this.engine.audio
  }

  /** 仅调试用:列出当前回合的靶子位置和正确答案 */
  debugTargets(): { en: string; x: number; y: number; correct: boolean }[] {
    return this.play?.debugTargets() ?? []
  }

  /**
   * 进入单词区。只拉词库清单就出菜单 —— 图按关现加载,
   * 整库在后台慢慢预热,别让几百张图堵住选关。
   */
  async enter(): Promise<void> {
    if (this.ready) {
      this.showMenu()
      return
    }

    this.screens.showLoading(t('game.loading.words'))
    const manifest = await this.loader.loadManifest()
    this.words = manifest.words
    this.audio.setSfx(manifest.sfx)
    this.levels = buildLevels(this.words, manifest.categories ?? [])
    this.ready = true
    this.showMenu()

    // 不 await:用户可以先选关,后台顺便把别的图也暖上
    void this.loader.ensureImages(this.words)
  }

  /** 切到别的功能页时收起自己的界面。背景循环留着,各页共用。 */
  leave(): void {
    this.teardownPlay()
    this.screens.hideAll()
    this.hud.hide()
  }

  // ---------- 流程 ----------

  private showMenu(): void {
    this.screens.showMenu(this.levels, this.assetNote(), (lv) => void this.startLevel(lv))
  }

  private assetNote(): string {
    const noFile = this.words.filter((w) => !w.image).length
    const failed = this.loader.placeholderCount
    const missing = Math.max(noFile, failed)
    if (missing === this.words.length) {
      return t('game.note.placeholder')
    }
    if (missing > 0) {
      return t('game.note.missing', { total: this.words.length, missing })
    }
    return t('game.note.ready', { total: this.words.length })
  }

  private async startLevel(level: LevelDef): Promise<void> {
    // 必须在点击的同步调用栈里解锁,否则 iOS 全程没声音
    this.audio.unlock()

    this.screens.showLoading(t('game.loading.level'))

    // 图和声并行;图只补本关还没缓存的
    let imgDone = 0
    let imgTotal = level.words.length
    let audDone = 0
    let audTotal = 0
    const tick = (label: string): void => {
      const total = imgTotal + Math.max(audTotal, 1)
      this.screens.setProgress(imgDone + audDone, total, label)
    }

    await Promise.all([
      // 回调参数别叫 t —— 会把 i18n 的 t() 遮蔽掉
      this.loader.ensureImages(level.words, (done, total) => {
        imgDone = done
        imgTotal = total
        tick(t('game.loading.images'))
      }),
      this.audio.preload(level.words, (done, total) => {
        audDone = done
        audTotal = total
        tick(t('game.loading.audio'))
      }),
    ])

    this.screens.hideAll()

    this.hud.setScore(0)
    this.hud.setCombo(0)
    this.hud.show()

    this.play = new PlayScene(this, level, (r) => this.finishLevel(r))
    this.engine.setScene(this.play)
    this.play.enter()
    this.onPlaying(true)
  }

  private finishLevel(result: LevelResult): void {
    this.teardownPlay()
    this.screens.showResult(
      result,
      () => void this.startLevel(result.level),
      () => this.showMenu(),
    )
  }

  private quitToMenu(): void {
    this.teardownPlay()
    this.showMenu()
  }

  private teardownPlay(): void {
    const wasPlaying = this.play !== null
    this.engine.clearScene(this.play)
    this.play = null
    this.hud.hide()
    if (wasPlaying) this.onPlaying(false)
  }
}
