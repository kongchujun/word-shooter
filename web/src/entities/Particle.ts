import { rand } from '../utils/math'

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  hue: number
}

export class ParticleSystem {
  private items: Particle[] = []

  burst(x: number, y: number, hue: number, count: number, power = 1): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2)
      const sp = rand(120, 420) * power
      const life = rand(0.35, 0.8)
      this.items.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        maxLife: life,
        size: rand(3, 9),
        hue: hue + rand(-25, 25),
      })
    }
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]
      p.life -= dt
      if (p.life <= 0) {
        this.items.splice(i, 1)
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 900 * dt // 重力
      p.vx *= 1 - 1.6 * dt // 空气阻力
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const p of this.items) {
      const k = p.life / p.maxLife
      ctx.globalAlpha = k
      ctx.fillStyle = `hsl(${p.hue} 95% ${55 + k * 25}%)`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * k, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  clear(): void {
    this.items.length = 0
  }
}
