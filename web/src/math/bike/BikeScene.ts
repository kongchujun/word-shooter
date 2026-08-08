import type { Engine, Scene } from '../../core/Engine'
import { ParticleSystem } from '../../entities/Particle'
import { Background } from '../../render/Background'
import type { GhostSample } from '../../systems/GhostStore'
import type { HUD } from '../../ui/HUD'
import { lerp } from '../../utils/math'
import type { Question } from '../questions'
import { drawBike, drawRoad, roundRect } from './draw'
import { BIKE, type BikeLevel } from './levels'

export interface BikeRecord {
  text: string
  answer: number
  picked: number | null
  ms: number
}

export interface BikeResult {
  level: BikeLevel
  records: BikeRecord[]
  /** 骑行距离(米),也是得分 */
  score: number
  bestCombo: number
  correct: number
  /** 距离时间线,留给双人幽灵车 */
  samples: GhostSample[]
}

type Phase = 'play' | 'feedback' | 'done'

interface ChoiceHit {
  value: number
  x: number
  y: number
  r: number
}

/**
 * 踩单车:30 秒内狂刷四则选择题,答对单车往前骑,距离就是分数。
 */
export class BikeScene implements Scene {
  readonly aiming = false

  private bg = new Background()
  private particles = new ParticleSystem()

  private records: BikeRecord[] = []
  private current: Question | null = null
  private choices: ChoiceHit[] = []
  private revealed: number | null = null

  private phase: Phase = 'play'
  private phaseT = 0
  private timeLeft: number
  private elapsed = 0
  private combo = 0
  private bestCombo = 0
  private correct = 0
  private distance = 0
  private displayDist = 0
  private scroll = 0
  private pedal = 0
  private questionAt = 0
  private lockT = 0
  private samples: GhostSample[] = []
  private sampleAcc = 0

  private w = 800
  private h = 600

  constructor(
    private engine: Engine,
    private hud: HUD,
    readonly level: BikeLevel,
    private onFinish: (result: BikeResult) => void,
  ) {
    this.timeLeft = level.duration
  }

  start(): void {
    this.w = this.engine.width
    this.h = this.engine.height
    this.bg.resize(this.w, this.h)
    this.hud.setScore(0)
    this.hud.setCombo(0)
    this.samples = [{ t: 0, dist: 0 }]
    this.nextQuestion()
    this.syncHud()
  }

  exit(): void {
    this.particles.clear()
    this.choices = []
  }

  onResize(w: number, h: number): void {
    this.w = w
    this.h = h
    this.bg.resize(w, h)
    this.layoutChoices()
  }

  private nextQuestion(): void {
    this.current = this.level.next()
    this.revealed = null
    this.phase = 'play'
    this.phaseT = 0
    this.questionAt = performance.now()
    this.layoutChoices()
  }

  private layoutChoices(): void {
    if (!this.current) {
      this.choices = []
      return
    }
    const n = this.current.choices.length
    const y = this.h - 78
    const gap = Math.min(120, (this.w - 80) / n)
    const x0 = this.w / 2 - ((n - 1) * gap) / 2
    this.choices = this.current.choices.map((value, i) => ({
      value,
      x: x0 + i * gap,
      y,
      r: 36,
    }))
  }

  private syncHud(): void {
    this.hud.setScore(Math.round(this.distance))
    this.hud.setRoundText(`${Math.ceil(Math.max(0, this.timeLeft))}s`)
    this.hud.setCombo(this.combo)
  }

  onPointerDown(x: number, y: number): void {
    if (this.phase !== 'play' || this.lockT > 0 || !this.current) return
    for (const c of this.choices) {
      if (Math.hypot(x - c.x, y - c.y) <= c.r + 6) {
        this.pick(c.value)
        return
      }
    }
  }

  private pick(value: number): void {
    const q = this.current!
    const ms = Math.round(performance.now() - this.questionAt)
    this.records.push({ text: q.text, answer: q.answer, picked: value, ms })
    this.revealed = q.answer

    if (value === q.answer) {
      this.correct++
      this.combo++
      this.bestCombo = Math.max(this.bestCombo, this.combo)
      const gain = BIKE.baseMeters + Math.max(0, this.combo - 1) * BIKE.comboMeters
      this.distance += gain
      this.particles.burst(this.bikeX(), this.bikeY() - 20, 48, 18, 0.9)
      this.engine.audio.playSfx('hit')
    } else {
      this.combo = 0
      this.lockT = BIKE.missLock
      this.engine.audio.playSfx('miss')
    }

    this.samples.push({ t: this.elapsed, dist: this.distance })
    this.syncHud()
    this.phase = 'feedback'
    this.phaseT = 0
  }

  private bikeX(): number {
    return Math.min(160, this.w * 0.22)
  }

  private bikeY(): number {
    return this.h * 0.52
  }

  private finish(): void {
    if (this.phase === 'done') return
    this.phase = 'done'
    this.samples.push({ t: this.elapsed, dist: this.distance })
    this.onFinish({
      level: this.level,
      records: this.records,
      score: Math.round(this.distance),
      bestCombo: this.bestCombo,
      correct: this.correct,
      samples: this.samples,
    })
  }

  update(dt: number): void {
    this.bg.update(dt)
    this.particles.update(dt)
    this.displayDist = lerp(this.displayDist, this.distance, 1 - Math.pow(0.001, dt))
    this.scroll += (40 + this.distance * 0.35) * dt
    this.pedal += dt * (2.5 + this.combo * 0.4)

    if (this.lockT > 0) this.lockT = Math.max(0, this.lockT - dt)

    if (this.phase === 'done') return

    this.elapsed += dt
    this.sampleAcc += dt
    if (this.sampleAcc >= 0.25) {
      this.sampleAcc = 0
      this.samples.push({ t: this.elapsed, dist: this.distance })
    }

    const prevBucket = Math.floor(this.timeLeft * 5)
    this.timeLeft -= dt
    if (this.timeLeft <= 0) {
      this.timeLeft = 0
      this.syncHud()
      this.finish()
      return
    }
    if (Math.floor(this.timeLeft * 5) !== prevBucket) this.syncHud()

    if (this.phase === 'feedback') {
      this.phaseT += dt
      if (this.phaseT >= BIKE.feedback) this.nextQuestion()
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.bg.draw(ctx)
    drawRoad(ctx, this.w, this.h, this.scroll, this.h * 0.42, this.h * 0.72)
    drawBike(ctx, this.bikeX(), this.bikeY(), this.pedal)
    this.particles.draw(ctx)
    this.drawHudPanel(ctx)
    this.drawQuestion(ctx)
    this.drawChoices(ctx)
  }

  private drawHudPanel(ctx: CanvasRenderingContext2D): void {
    const urgent = this.timeLeft <= 5
    ctx.fillStyle = urgent ? 'rgba(180,40,40,0.55)' : 'rgba(20,26,40,0.55)'
    roundRect(ctx, this.w / 2 - 90, 72, 180, 36, 12)
    ctx.fill()
    ctx.fillStyle = urgent ? '#ffd0d0' : '#fff'
    ctx.font = 'bold 20px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`⏱ ${this.timeLeft.toFixed(1)}s`, this.w / 2, 90)

    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.font = '15px system-ui, sans-serif'
    ctx.fillText(`${Math.round(this.displayDist)} m · ✓${this.correct}`, this.w / 2, 128)
  }

  private drawQuestion(ctx: CanvasRenderingContext2D): void {
    if (!this.current) return
    const y = this.h - 150
    ctx.fillStyle = 'rgba(20,26,40,0.88)'
    roundRect(ctx, this.w / 2 - 160, y - 28, 320, 52, 14)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 28px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tail = this.revealed !== null ? this.revealed : '?'
    ctx.fillText(`${this.current.text} = ${tail}`, this.w / 2, y)
  }

  private drawChoices(ctx: CanvasRenderingContext2D): void {
    for (const c of this.choices) {
      let fill = '#3d7cff'
      if (this.revealed !== null) {
        if (c.value === this.revealed) fill = '#2ecc71'
        else if (this.records[this.records.length - 1]?.picked === c.value) fill = '#e74c3c'
        else fill = '#556'
      }
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 22px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(c.value), c.x, c.y + 1)
    }
  }
}
