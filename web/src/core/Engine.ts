import { Background } from '../render/Background'
import { AudioManager } from '../systems/AudioManager'

/**
 * 一个玩法场景。方法都是可选的,只要能画就行。
 * 坐标一律是逻辑 CSS 像素,DPR 已经在 ctx 上抹平了。
 */
export interface Scene {
  exit?(): void
  onResize?(w: number, h: number): void
  onPointerMove?(x: number, y: number): void
  onPointerDown?(x: number, y: number): void
  update(dt: number): void
  draw(ctx: CanvasRenderingContext2D): void
}

/**
 * canvas 那一摊公共的东西:尺寸、rAF 循环、指针输入、音频。
 * 单词射击和数学游戏共用一块 canvas,所以循环只能有一条,由这里管。
 */
export class Engine {
  width = 800
  height = 600

  readonly audio = new AudioManager()

  private scene: Scene | null = null
  private idleBg = new Background()
  private lastTime = 0
  /** 帧内异常计数,只打前几条,避免 60fps 刷爆控制台 */
  private frameErrors = 0

  constructor(
    readonly canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
  ) {
    this.resize()
    window.addEventListener('resize', () => this.resize())
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.audio.resume()
    })
    this.bindInput()

    // 星空背景每一页都在用,所以循环跟着构造走,不等进哪个游戏
    requestAnimationFrame((t) => this.frame(t))
  }

  get active(): Scene | null {
    return this.scene
  }

  /** 换场景。传 null 就回到只画背景的闲置状态。 */
  setScene(next: Scene | null): void {
    if (this.scene && this.scene !== next) this.scene.exit?.()
    this.scene = next
    // 瞄准状态下藏掉系统光标,场景自己画准星
    this.canvas.classList.toggle('aiming', next !== null)
    next?.onResize?.(this.width, this.height)
  }

  /** 当前场景正是 s 时才清掉,免得两个应用互相踢场景 */
  clearScene(s: Scene | null): void {
    if (s && this.scene === s) this.setScene(null)
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
    this.idleBg.resize(this.width, this.height)
    this.scene?.onResize?.(this.width, this.height)
  }

  private frame(now: number): void {
    // 先排下一帧。放在最后的话,这一帧只要抛一次异常整条 rAF 链就断了,画面永久冻住。
    requestAnimationFrame((t) => this.frame(t))

    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 1 / 20) : 1 / 60
    this.lastTime = now

    try {
      const scene = this.scene
      if (scene) {
        scene.update(dt)
        // update 里可能打完最后一题 → 场景被换掉,
        // 这时别再画已经退场的场景,直接落到下面画闲时背景。
        if (this.scene === scene) {
          scene.draw(this.ctx)
          return
        }
      }
      // 菜单/结算时 canvas 也别是空的
      this.idleBg.update(dt)
      this.idleBg.draw(this.ctx)
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
      this.scene?.onPointerDown?.(p.x, p.y)
    })
    this.canvas.addEventListener('pointermove', (e) => {
      const p = pos(e)
      this.scene?.onPointerMove?.(p.x, p.y)
    })
    // 触屏上别触发长按选中/滚动
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }
}
