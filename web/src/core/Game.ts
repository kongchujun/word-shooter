import { buildLevels } from '../config/levels'
import { Background } from '../render/Background'
import { PlayScene } from '../scenes/PlayScene'
import { AssetLoader } from '../systems/AssetLoader'
import { AudioManager } from '../systems/AudioManager'
import { HUD } from '../ui/HUD'
import { Screens } from '../ui/Screens'
import type { LevelDef, LevelResult, Word } from '../types'

export class Game {
  width = 800
  height = 600

  readonly audio = new AudioManager()
  readonly loader = new AssetLoader()
  readonly hud: HUD

  private screens: Screens
  private menuBg = new Background()
  private play: PlayScene | null = null
  private levels: LevelDef[] = []
  private words: Word[] = []
  private lastTime = 0
  /** 帧内异常计数,只打前几条,避免 60fps 刷爆控制台 */
  private frameErrors = 0

  constructor(
    readonly canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
    ui: HTMLElement,
  ) {
    this.hud = new HUD(ui)
    this.screens = new Screens(ui)
    this.hud.onReplay = () => this.play?.replayAudio()
    this.hud.onQuit = () => this.quitToMenu()

    this.resize()
    window.addEventListener('resize', () => this.resize())
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.audio.resume()
    })
    this.bindInput()

    // dev 下挂个调试入口:控制台里 __game.debugTargets() 能看当前哪个是正确答案
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this
  }

  /** 仅调试用:列出当前回合的靶子位置和正确答案 */
  debugTargets(): { en: string; x: number; y: number; correct: boolean }[] {
    return this.play?.debugTargets() ?? []
  }

  async start(): Promise<void> {
    requestAnimationFrame((t) => this.frame(t))
    this.screens.showLoading()
    const manifest = await this.loader.loadManifest()
    this.words = manifest.words
    this.audio.setSfx(manifest.sfx)
    await this.loader.preloadImages(this.words, (d, t) => this.screens.setProgress(d, t))
    this.levels = buildLevels(this.words, manifest.categories ?? [])
    this.showMenu()
  }

  // ---------- 流程 ----------

  private showMenu(): void {
    this.screens.showMenu(this.levels, this.assetNote(), (lv) => void this.startLevel(lv))
  }

  private assetNote(): string {
    const missing = this.loader.placeholderCount
    if (missing === this.words.length) {
      return '现在用的是内置占位素材(emoji 图 + 浏览器发音)。把 <code>apple.webp</code> 和 <code>apple.mp3</code> 丢进 assets/images 和 assets/audio,刷新页面就会自动换成你的图和真人发音。'
    }
    if (missing > 0) {
      return `共 ${this.words.length} 个词,其中 ${missing} 个还缺图片,暂时用占位图顶着。`
    }
    return `共 ${this.words.length} 个词,素材已全部就位。`
  }

  private async startLevel(level: LevelDef): Promise<void> {
    // 必须在点击的同步调用栈里解锁,否则 iOS 全程没声音
    this.audio.unlock()

    this.screens.showLoading('正在准备这一关的声音…')
    await this.audio.preload(level.words, (d, t) => this.screens.setProgress(d, t))
    this.screens.hideAll()

    this.hud.setScore(0)
    this.hud.setCombo(0)
    this.hud.show()
    this.canvas.classList.add('aiming')

    this.play = new PlayScene(this, level, (r) => this.finishLevel(r))
    this.play.enter()
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
    this.play?.exit()
    this.play = null
    this.hud.hide()
    this.canvas.classList.remove('aiming')
  }

  // ---------- 画布 ----------

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.canvas.width = this.width * dpr
    this.canvas.height = this.height * dpr
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.menuBg.resize(this.width, this.height)
    this.play?.onResize(this.width, this.height)
  }

  private frame(now: number): void {
    // 先排下一帧。放在最后的话,这一帧只要抛一次异常整条 rAF 链就断了,画面永久冻住。
    requestAnimationFrame((t) => this.frame(t))

    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 1 / 20) : 1 / 60
    this.lastTime = now

    try {
      const play = this.play
      if (play) {
        play.update(dt)
        // update 里可能打完最后一轮 → finishLevel() 把 this.play 置空,
        // 这时别再画已经退场的场景,直接落到下面画菜单背景。
        if (this.play === play) {
          play.draw(this.ctx)
          return
        }
      }
      // 菜单/结算时 canvas 也别是空的
      this.menuBg.update(dt)
      this.menuBg.draw(this.ctx)
    } catch (err) {
      if (this.frameErrors++ < 10) console.error('[frame] 这一帧出错,已跳过', err)
    }
  }

  // ---------- 输入 ----------

  private bindInput(): void {
    const pos = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect()
      return {
        x: ((e.clientX - r.left) / r.width) * this.width,
        y: ((e.clientY - r.top) / r.height) * this.height,
      }
    }
    this.canvas.addEventListener('pointerdown', (e) => {
      // 从微信别的页面切回来时 context 常常还挂着,借这次点击把它拉起来
      this.audio.resume()
      const p = pos(e)
      this.play?.onPointerDown(p.x, p.y)
    })
    this.canvas.addEventListener('pointermove', (e) => {
      const p = pos(e)
      this.play?.onPointerMove(p.x, p.y)
    })
    // 触屏上别触发长按选中/滚动
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    window.addEventListener('keydown', (e) => {
      if (!this.play) return
      if (e.code === 'Space') {
        e.preventDefault()
        this.play.replayAudio()
      } else if (e.code === 'Escape') {
        this.quitToMenu()
      }
    })
  }
}
