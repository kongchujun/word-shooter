import { BALANCE } from '../config/balance'
import type { Sprite } from '../types'
import { clamp, easeOutBack, rand } from '../utils/math'

type State = 'entering' | 'alive' | 'dying'

/** 靶子只管画和动,挂着什么内容(单词、数字)由 T 决定 */
export class Target<T> {
  x: number
  y: number
  state: State = 'entering'

  private t = 0
  private fromX: number
  private fromY: number
  private floatPhase = rand(0, Math.PI * 2)
  private floatSpeed: number
  private scale = 0.2
  private alpha = 1
  private flashT = 0
  private shakeT = 0
  private popT = 0
  private growOnDeath = true

  constructor(
    readonly item: T,
    readonly sprite: Sprite,
    readonly isCorrect: boolean,
    /** 落位点,窗口尺寸变了会被 relocate 改写 */
    public homeX: number,
    public homeY: number,
    public r: number,
    speed: number,
    screenW: number,
    screenH: number,
  ) {
    // 从最近的屏幕外边缘飞进来
    const fromLeft = homeX < screenW / 2
    this.fromX = fromLeft ? -r * 2 : screenW + r * 2
    this.fromY = clamp(homeY + rand(-screenH * 0.2, screenH * 0.2), -r, screenH + r)
    this.x = this.fromX
    this.y = this.fromY
    this.floatSpeed = BALANCE.floatSpeed * speed * rand(0.85, 1.15)
  }

  get dead(): boolean {
    return this.state === 'dying' && this.popT >= 0.5
  }

  update(dt: number): void {
    this.t += dt
    this.flashT = Math.max(0, this.flashT - dt * 3)
    this.shakeT = Math.max(0, this.shakeT - dt * 2.5)

    if (this.state === 'entering') {
      const p = clamp(this.t / BALANCE.enterDuration, 0, 1)
      const e = easeOutBack(p)
      this.x = this.fromX + (this.homeX - this.fromX) * e
      this.y = this.fromY + (this.homeY - this.fromY) * e
      this.scale = 0.2 + 0.8 * e
      if (p >= 1) this.state = 'alive'
      return
    }

    if (this.state === 'dying') {
      this.popT += dt
      const p = clamp(this.popT / 0.45, 0, 1)
      this.scale = this.growOnDeath ? 1 + p * 0.9 : 1 - p * 0.55
      this.alpha = 1 - p
      return
    }

    // alive:绕落位点做利萨如运动,不会互相撞上
    const a = this.floatPhase + this.t * this.floatSpeed
    this.x = this.homeX + Math.cos(a) * BALANCE.floatRadiusX
    this.y = this.homeY + Math.sin(a * 1.37) * BALANCE.floatRadiusY
    this.scale = 1
  }

  /** 判定半径比视觉半径大一点,擦边也算中 */
  hitTest(px: number, py: number): boolean {
    if (this.state === 'dying') return false
    const rr = this.r * BALANCE.hitRadiusScale
    return (px - this.x) ** 2 + (py - this.y) ** 2 <= rr * rr
  }

  /** 窗口尺寸变了(比如平板转屏)重新落位,别把靶子留在屏幕外 */
  relocate(x: number, y: number, r: number): void {
    this.homeX = x
    this.homeY = y
    this.r = r
    if (this.state === 'entering') {
      // 入场途中改布局就直接落位,免得斜着从屏幕外飞过来
      this.state = 'alive'
      this.scale = 1
    }
    this.x = x
    this.y = y
  }

  /** 打中了:胀开炸掉 */
  pop(): void {
    this.state = 'dying'
    this.popT = 0
    this.growOnDeath = true
  }

  /** 本轮结束,没被打中的靶子悄悄缩掉 */
  dismiss(): void {
    if (this.state === 'dying') return
    this.state = 'dying'
    this.popT = 0
    this.growOnDeath = false
  }

  /** 打错了:红闪 + 抖一下 */
  reject(): void {
    this.flashT = 1
    this.shakeT = 1
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const shake = this.shakeT > 0 ? Math.sin(this.shakeT * 45) * 9 * this.shakeT : 0
    const d = this.r * 2 * this.scale

    ctx.save()
    ctx.globalAlpha = this.alpha
    ctx.translate(this.x + shake, this.y)

    // 底部投影,让靶子从背景里浮起来
    ctx.globalAlpha = this.alpha * 0.25
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(0, this.r * 0.92, this.r * 0.7, this.r * 0.16, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = this.alpha
    ctx.drawImage(this.sprite, -d / 2, -d / 2, d, d)

    if (this.flashT > 0) {
      ctx.globalAlpha = this.alpha * this.flashT * 0.9
      ctx.strokeStyle = '#ff4d4d'
      ctx.lineWidth = 7
      ctx.beginPath()
      ctx.arc(0, 0, this.r * 1.05, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.restore()
  }
}
