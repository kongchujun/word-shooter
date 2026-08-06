import { clamp } from '../utils/math'

/** 跟随鼠标/手指的准星,开枪时有后坐力张开和枪口闪光 */
export class Crosshair {
  x = -999
  y = -999
  private recoil = 0
  private flash = 0
  private visible = false

  move(x: number, y: number): void {
    this.x = x
    this.y = y
    this.visible = true
  }

  fire(): void {
    this.recoil = 1
    this.flash = 1
  }

  update(dt: number): void {
    this.recoil = clamp(this.recoil - dt * 4, 0, 1)
    this.flash = clamp(this.flash - dt * 8, 0, 1)
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.visible) return
    const spread = 6 + this.recoil * 16
    const r = 20 + this.recoil * 10

    ctx.save()
    ctx.translate(this.x, this.y)

    if (this.flash > 0) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 70)
      g.addColorStop(0, `rgba(255,236,160,${this.flash * 0.55})`)
      g.addColorStop(1, 'rgba(255,200,80,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, 70, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.stroke()

    ctx.beginPath()
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      ctx.moveTo(dx * spread, dy * spread)
      ctx.lineTo(dx * (spread + 12), dy * (spread + 12))
    }
    ctx.stroke()

    ctx.fillStyle = 'rgba(255,80,80,0.95)'
    ctx.beginPath()
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }
}
