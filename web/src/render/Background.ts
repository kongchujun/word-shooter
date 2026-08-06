import { rand } from '../utils/math'

interface Star {
  x: number
  y: number
  r: number
  tw: number
}

/** 夜空 + 星星 + 远山剪影。星星只在 resize 时重算,每帧只画。 */
export class Background {
  private stars: Star[] = []
  private w = 0
  private h = 0
  private t = 0

  resize(w: number, h: number): void {
    this.w = w
    this.h = h
    const count = Math.round((w * h) / 14000)
    this.stars = Array.from({ length: count }, () => ({
      x: rand(0, w),
      y: rand(0, h * 0.75),
      r: rand(0.6, 1.9),
      tw: rand(0, Math.PI * 2),
    }))
  }

  update(dt: number): void {
    this.t += dt
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this

    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#0a0f24')
    sky.addColorStop(0.55, '#152246')
    sky.addColorStop(1, '#2b3a63')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)

    ctx.fillStyle = '#fff'
    for (const s of this.stars) {
      ctx.globalAlpha = 0.35 + 0.45 * Math.sin(this.t * 1.4 + s.tw)
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // 远山:两层剪影,靠正弦叠出起伏
    this.hills(ctx, h * 0.82, h * 0.06, 'rgba(20,28,54,0.85)', 1.3)
    this.hills(ctx, h * 0.9, h * 0.05, 'rgba(11,16,34,0.95)', 2.1)
  }

  private hills(ctx: CanvasRenderingContext2D, baseY: number, amp: number, color: string, freq: number): void {
    const { w, h } = this
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += 12) {
      const y = baseY + Math.sin((x / w) * Math.PI * 2 * freq) * amp + Math.sin((x / w) * Math.PI * 6 * freq) * amp * 0.3
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }
}
