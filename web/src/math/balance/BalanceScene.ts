import type { Engine, Scene } from '../../core/Engine'
import { ParticleSystem } from '../../entities/Particle'
import { Background } from '../../render/Background'
import type { HUD } from '../../ui/HUD'
import { clamp, easeOutCubic, lerp } from '../../utils/math'
import { clearMonsterCache, monsterSprite, preloadMonsters } from './monsters'
import type { BalanceLevel } from './levels'
import { warriorSprite } from './warrior'
import { BALANCE_GAME, TRAY_STOCK, WEIGHT_VALUES, minPieces, type WeightValue } from './weights'

export interface BalanceRecord {
  target: number
  /** 用了几位勇士 */
  pieces: number
  /** 最优人数 */
  optimal: number
  ms: number
}

export interface BalanceResult {
  level: BalanceLevel
  records: BalanceRecord[]
  score: number
  bestCombo: number
}

type Phase = 'play' | 'attack'

interface PlacedWeight {
  value: WeightValue
  ox: number
  oy: number
}

interface DragState {
  value: WeightValue
  from: 'tray' | 'pan'
  x: number
  y: number
}

/**
 * 天平打怪:拖持剑勇士到左盘,战力凑平右盘怪物胸口数字,
 * 小勇士合成大英雄飞过去砍倒怪物。
 */
export class BalanceScene implements Scene {
  readonly aiming = false

  private bg = new Background()
  private particles = new ParticleSystem()

  private targets: number[]
  private records: BalanceRecord[] = []
  private index = 0
  private target = 0
  private monsterId = 0

  private tray: Record<WeightValue, number> = { ...TRAY_STOCK }
  private pan: PlacedWeight[] = []

  private phase: Phase = 'play'
  private phaseT = 0
  private roundStart = 0
  private tilt = 0
  private tiltTarget = 0

  private combo = 0
  private bestCombo = 0
  private score = 0
  private drag: DragState | null = null

  /** 攻击动画开始时左盘勇士的屏幕坐标快照 */
  private attackFrom: { x: number; y: number; value: WeightValue }[] = []
  private attackHeroPower = 1 as WeightValue

  private w = 800
  private h = 600

  constructor(
    private engine: Engine,
    private hud: HUD,
    readonly level: BalanceLevel,
    private onFinish: (result: BalanceResult) => void,
  ) {
    this.targets = level.build()
    preloadMonsters()
  }

  start(): void {
    this.bg.resize(this.engine.width, this.engine.height)
    this.w = this.engine.width
    this.h = this.engine.height
    this.startRound()
  }

  exit(): void {
    this.particles.clear()
    this.drag = null
    clearMonsterCache()
  }

  onResize(w: number, h: number): void {
    this.w = w
    this.h = h
    this.bg.resize(w, h)
  }

  // ---------- 布局 ----------

  private fulcrum(): { x: number; y: number } {
    return { x: this.w / 2, y: this.h * 0.42 }
  }

  private beamHalf(): number {
    return Math.min(220, this.w * 0.28)
  }

  private panHit(side: 'left' | 'right'): { x: number; y: number; r: number } {
    const f = this.fulcrum()
    const half = this.beamHalf()
    const ang = this.tilt
    const sx = side === 'left' ? -1 : 1
    const bx = f.x + Math.cos(ang) * half * sx
    const by = f.y + Math.sin(ang) * half * sx
    return { x: bx, y: by + 70, r: 56 }
  }

  private trayLayout(): { x: number; y: number; slotW: number; slots: { value: WeightValue; cx: number; cy: number }[] } {
    const y = this.h - 96
    const slotW = Math.min(130, (this.w - 48) / 3)
    const total = slotW * 3
    const x0 = (this.w - total) / 2
    const slots = WEIGHT_VALUES.map((value, i) => ({
      value,
      cx: x0 + slotW * i + slotW / 2,
      cy: y,
    }))
    return { x: x0, y, slotW, slots }
  }

  // ---------- 回合 ----------

  private startRound(): void {
    if (this.index >= this.targets.length) {
      this.onFinish({ level: this.level, records: this.records, score: this.score, bestCombo: this.bestCombo })
      return
    }
    this.target = this.targets[this.index]
    this.monsterId = this.index
    this.tray = { ...TRAY_STOCK }
    this.pan = []
    this.drag = null
    this.phase = 'play'
    this.phaseT = 0
    this.attackFrom = []
    this.roundStart = performance.now()
    this.updateTiltTarget()
    this.hud.setRound(this.index + 1, this.targets.length)
    this.hud.setScore(this.score)
    this.hud.setCombo(this.combo)
  }

  private leftSum(): number {
    return this.pan.reduce((s, p) => s + p.value, 0)
  }

  private updateTiltTarget(): void {
    const diff = this.leftSum() - this.target
    this.tiltTarget = clamp(diff * 0.045, -BALANCE_GAME.maxTilt, BALANCE_GAME.maxTilt)
  }

  private tryBalance(): void {
    if (this.phase !== 'play') return
    if (this.leftSum() !== this.target) return

    const pieces = this.pan.length
    const optimal = minPieces(this.target)
    const ms = Math.round(performance.now() - this.roundStart)
    this.records.push({ target: this.target, pieces, optimal, ms })

    const efficient = pieces <= optimal
    if (efficient) {
      this.combo++
      this.bestCombo = Math.max(this.bestCombo, this.combo)
    } else {
      this.combo = 0
    }

    let gain = BALANCE_GAME.baseScore
    if (efficient) gain += BALANCE_GAME.efficiencyBonus
    if (this.combo >= 2) gain += BALANCE_GAME.comboBonus * (this.combo - 1)
    this.score += gain
    this.hud.setScore(this.score)
    this.hud.setCombo(this.combo)

    // 快照左盘勇士的世界坐标,攻击动画用
    const left = this.panHit('left')
    this.attackFrom = this.pan.map((p) => ({ x: left.x + p.ox, y: left.y + p.oy - 10, value: p.value }))
    this.attackHeroPower = (this.target >= 5 ? 5 : this.target >= 2 ? 2 : 1) as WeightValue
    this.pan = []
    this.tiltTarget = 0
    this.phase = 'attack'
    this.phaseT = 0
    this.engine.audio.playSfx('levelup')
  }

  // ---------- 拖拽 ----------

  onPointerDown(x: number, y: number): void {
    if (this.phase !== 'play') return

    const left = this.panHit('left')
    for (let i = this.pan.length - 1; i >= 0; i--) {
      const p = this.pan[i]
      const wx = left.x + p.ox
      const wy = left.y + p.oy
      if (Math.hypot(x - wx, y - wy) <= 32) {
        const [taken] = this.pan.splice(i, 1)
        this.drag = { value: taken.value, from: 'pan', x, y }
        this.updateTiltTarget()
        return
      }
    }

    const tray = this.trayLayout()
    for (const s of tray.slots) {
      if (this.tray[s.value] <= 0) continue
      if (Math.hypot(x - s.cx, y - s.cy) <= 40) {
        this.tray[s.value]--
        this.drag = { value: s.value, from: 'tray', x, y }
        return
      }
    }
  }

  onPointerMove(x: number, y: number): void {
    if (!this.drag) return
    this.drag.x = x
    this.drag.y = y
  }

  onPointerUp(x: number, y: number): void {
    if (!this.drag || this.phase !== 'play') {
      this.drag = null
      return
    }
    const d = this.drag
    this.drag = null

    const left = this.panHit('left')
    const onPan = Math.hypot(x - left.x, y - left.y) <= left.r + 28

    if (onPan) {
      this.pan.push({ value: d.value, ox: (Math.random() - 0.5) * 48, oy: (Math.random() - 0.5) * 24 })
      this.engine.audio.playSfx('blank')
      this.updateTiltTarget()
      this.tryBalance()
    } else {
      this.tray[d.value]++
      this.updateTiltTarget()
    }
  }

  // ---------- 循环 ----------

  update(dt: number): void {
    this.bg.update(dt)
    this.particles.update(dt)
    this.tilt = lerp(this.tilt, this.tiltTarget, 1 - Math.pow(0.001, dt))

    if (this.phase === 'attack') {
      this.phaseT += dt
      // 砍中瞬间爆一下粒子
      if (this.phaseT >= 0.85 && this.phaseT - dt < 0.85) {
        const right = this.panHit('right')
        this.particles.burst(right.x, right.y - 30, 25, 28, 1.15)
        this.engine.audio.playSfx('hit')
      }
      if (this.phaseT >= BALANCE_GAME.attackDuration) {
        this.index++
        this.startRound()
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.bg.draw(ctx)
    this.drawScale(ctx)
    this.drawTray(ctx)
    if (this.drag) this.drawWarriorAt(ctx, this.drag.x, this.drag.y, this.drag.value, 1.12)
    if (this.phase === 'attack') this.drawAttack(ctx)
    this.particles.draw(ctx)
  }

  private drawScale(ctx: CanvasRenderingContext2D): void {
    const f = this.fulcrum()
    const half = this.beamHalf()

    ctx.fillStyle = '#3a4558'
    ctx.beginPath()
    ctx.moveTo(f.x - 36, f.y + 110)
    ctx.lineTo(f.x + 36, f.y + 110)
    ctx.lineTo(f.x + 14, f.y + 8)
    ctx.lineTo(f.x - 14, f.y + 8)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = '#c9d4e8'
    ctx.beginPath()
    ctx.arc(f.x, f.y, 10, 0, Math.PI * 2)
    ctx.fill()

    ctx.save()
    ctx.translate(f.x, f.y)
    ctx.rotate(this.tilt)

    ctx.strokeStyle = '#d7e0f0'
    ctx.lineWidth = 8
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-half, 0)
    ctx.lineTo(half, 0)
    ctx.stroke()

    for (const side of [-1, 1] as const) {
      const px = side * half
      ctx.strokeStyle = '#9aa8c0'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, 55)
      ctx.stroke()

      ctx.fillStyle = 'rgba(40,48,68,0.92)'
      ctx.strokeStyle = '#8fa0bc'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.ellipse(px, 72, 54, 16, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // 左盘勇士(攻击阶段盘上已清空,由 drawAttack 画)
    if (this.phase === 'play') {
      for (const p of this.pan) {
        this.drawWarriorAt(ctx, -half + p.ox, 48 + p.oy, p.value, 0.95)
      }
    }

    // 右盘怪物
    this.drawMonster(ctx, half)

    ctx.restore()

    if (this.phase === 'play') {
      const sum = this.leftSum()
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = '16px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const tip = sum === 0 ? '拖勇士到左边,凑出怪物胸口的数' : `战力 ${sum}  ·  目标 ${this.target}`
      ctx.fillText(tip, f.x, f.y + 128)
    } else if (this.phaseT < 0.85) {
      ctx.fillStyle = '#ffe08a'
      ctx.font = 'bold 20px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(this.phaseT < 0.3 ? '合 成！' : '冲 啊！', f.x, f.y + 128)
    } else {
      ctx.fillStyle = '#ffe08a'
      ctx.font = 'bold 22px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('砍倒了！', f.x, f.y + 128)
    }
  }

  private drawMonster(ctx: CanvasRenderingContext2D, half: number): void {
    const t = this.phase === 'attack' ? this.phaseT : 0
    let alpha = 1
    let fall = 0
    let rot = 0
    if (t >= 0.85) {
      const k = clamp((t - 0.85) / 0.45, 0, 1)
      alpha = 1 - k
      fall = k * 80
      rot = k * 1.1
    }

    ctx.save()
    ctx.translate(half, 55 + fall)
    ctx.rotate(rot)
    ctx.globalAlpha = alpha
    const sprite = monsterSprite(this.monsterId)
    ctx.drawImage(sprite, -55, -47, 110, 110)
    ctx.fillStyle = '#1a1a2e'
    ctx.font = 'bold 28px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(this.target), 0, 33)
    ctx.restore()
  }

  /**
   * 攻击三段:合成(小的聚到一起) → 大英雄飞过去 → 挥砍。
   * 坐标用屏幕绝对坐标,不跟着天平转。
   */
  private drawAttack(ctx: CanvasRenderingContext2D): void {
    const t = this.phaseT
    const left = this.panHit('left')
    const right = this.panHit('right')
    const mergeX = left.x
    const mergeY = left.y - 24
    const destX = right.x
    const destY = right.y - 30

    if (t < 0.32) {
      // 小勇士往合并点收拢并缩小
      const k = easeOutCubic(t / 0.32)
      for (const w of this.attackFrom) {
        const x = lerp(w.x, mergeX, k)
        const y = lerp(w.y, mergeY, k)
        const sc = lerp(1, 0.35, k)
        ctx.globalAlpha = 1 - k * 0.4
        this.drawWarriorAt(ctx, x, y, w.value, sc)
        ctx.globalAlpha = 1
      }
      // 大英雄淡入
      ctx.globalAlpha = k
      this.drawWarriorAt(ctx, mergeX, mergeY, this.attackHeroPower, 0.6 + k * 0.7, true)
      ctx.globalAlpha = 1
      return
    }

    if (t < 0.85) {
      const k = easeOutCubic((t - 0.32) / 0.53)
      const x = lerp(mergeX, destX, k)
      const y = lerp(mergeY, destY, k) - Math.sin(k * Math.PI) * 60
      const ang = -0.35 + k * 0.9
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(ang)
      this.drawWarriorAt(ctx, 0, 0, this.attackHeroPower, 1.35, true)
      ctx.restore()
      return
    }

    // 挥砍:英雄在怪物旁亮一下剑光
    const slashK = clamp((t - 0.85) / 0.25, 0, 1)
    ctx.save()
    ctx.translate(destX + 10, destY)
    ctx.rotate(-0.2 + slashK * 1.4)
    this.drawWarriorAt(ctx, 0, 0, this.attackHeroPower, 1.35, true)
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = `rgba(255,230,120,${1 - slashK})`
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(destX, destY, 40 + slashK * 30, -1.2, -1.2 + slashK * 2.2)
    ctx.stroke()
    ctx.restore()
  }

  private drawTray(ctx: CanvasRenderingContext2D): void {
    const tray = this.trayLayout()
    ctx.fillStyle = 'rgba(20,26,40,0.82)'
    roundRect(ctx, tray.x - 12, tray.y - 64, tray.slotW * 3 + 24, 118, 16)
    ctx.fill()

    for (const s of tray.slots) {
      const n = this.tray[s.value]
      const draggingThis = this.drag?.from === 'tray' && this.drag.value === s.value
      const scale = draggingThis ? 0.85 : 1.08
      this.drawWarriorAt(ctx, s.cx, s.cy - 10, s.value, scale)
      ctx.fillStyle = n > 0 ? '#fff' : 'rgba(255,255,255,0.35)'
      ctx.font = 'bold 14px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(`×${n}`, s.cx, s.cy + 36)
    }
  }

  private drawWarriorAt(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    value: WeightValue,
    scale: number,
    big = false,
  ): void {
    const sprite = warriorSprite(value, big)
    const w = sprite.width * scale * (big ? 0.92 : 1)
    const h = sprite.height * scale * (big ? 0.92 : 1)
    ctx.drawImage(sprite, x - w / 2, y - h / 2, w, h)
  }

  /** 仅调试用 */
  debugState(): { target: number; sum: number; pan: number[] } {
    return { target: this.target, sum: this.leftSum(), pan: this.pan.map((p) => p.value) }
  }

  /** 仅调试用 */
  debugLayout(): { tray: Record<number, { x: number; y: number }>; leftPan: { x: number; y: number } } {
    const tray = this.trayLayout()
    const left = this.panHit('left')
    const slots: Record<number, { x: number; y: number }> = {}
    for (const s of tray.slots) slots[s.value] = { x: s.cx, y: s.cy }
    return { tray: slots, leftPan: { x: left.x, y: left.y } }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
