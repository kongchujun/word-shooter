import type { Engine, Scene } from '../core/Engine'
import { Crosshair } from '../entities/Crosshair'
import { ParticleSystem } from '../entities/Particle'
import { Target } from '../entities/Target'
import { Background } from '../render/Background'
import type { HUD } from '../ui/HUD'
import { gridSlots } from '../utils/layout'
import { clamp, shuffle } from '../utils/math'
import { MATH } from './balance'
import { numberSprite } from './numberSprite'
import type { QuizLevel, Question } from './questions'
import type { QuizRecord, QuizResult } from './types'

type Phase = 'enter' | 'answer' | 'feedback'

/** 底部题干条占掉的高度,靶子不许下来 */
const BOTTOM = 170
/** 三个球的配色。每题打乱,免得颜色和对错挂上钩 */
const HUES = [212, 272, 148]

/**
 * 一题 = 三个数字飞进来 → 限时内点一个 → 亮答案。
 * 和运算种类无关,题面和选项都由 QuizLevel 出,乘法和加减共用这一套。
 *
 * 和单词射击不同,这里点错不给重来 —— 限时之下重试没有意义。
 */
export class QuizScene implements Scene {
  private bg = new Background()
  private particles = new ParticleSystem()
  private crosshair = new Crosshair()
  private targets: Target<number>[] = []

  private questions: Question[]
  private records: QuizRecord[] = []
  private index = 0
  private current: Question | null = null
  private revealed: number | null = null

  private phase: Phase = 'enter'
  private phaseT = 0
  private timeLeft: number = MATH.questionTime
  private combo = 0
  private bestCombo = 0
  private score = 0

  constructor(
    private engine: Engine,
    private hud: HUD,
    readonly level: QuizLevel,
    private onFinish: (result: QuizResult) => void,
  ) {
    this.questions = level.build()
  }

  start(): void {
    this.bg.resize(this.engine.width, this.engine.height)
    this.startRound()
  }

  exit(): void {
    this.particles.clear()
    this.targets = []
  }

  /** 仅调试用:列出当前题的靶子位置和哪个是正确答案 */
  debugTargets(): { n: number; x: number; y: number; correct: boolean }[] {
    return this.targets.map((t) => ({ n: t.item, x: Math.round(t.x), y: Math.round(t.y), correct: t.isCorrect }))
  }

  onResize(w: number, h: number): void {
    this.bg.resize(w, h)
    const alive = this.targets.filter((t) => t.state !== 'dying')
    const slots = gridSlots(alive.length, w, h, 96, BOTTOM)
    alive.forEach((t, i) => t.relocate(slots[i].x, slots[i].y, slots[i].r))
  }

  // ---------- 回合 ----------

  private startRound(): void {
    const q = this.questions[this.index]
    const slots = gridSlots(q.choices.length, this.engine.width, this.engine.height, 96, BOTTOM)
    const hues = shuffle(HUES)

    this.targets = q.choices.map(
      (n, i) =>
        new Target<number>(
          n,
          numberSprite(n, hues[i % hues.length]),
          n === q.answer,
          slots[i].x,
          slots[i].y,
          slots[i].r,
          1,
          this.engine.width,
          this.engine.height,
        ),
    )

    this.current = q
    this.revealed = null
    this.phase = 'enter'
    this.phaseT = 0
    this.timeLeft = MATH.questionTime
    this.hud.setRound(this.index + 1, this.questions.length)
  }

  private nextRound(): void {
    this.index++
    if (this.index >= this.questions.length) {
      this.engine.audio.playSfx('levelup')
      this.onFinish({ level: this.level, records: this.records, score: this.score, bestCombo: this.bestCombo })
      return
    }
    this.startRound()
  }

  // ---------- 判定 ----------

  onPointerMove(x: number, y: number): void {
    this.crosshair.move(x, y)
  }

  onPointerDown(x: number, y: number): void {
    this.crosshair.move(x, y)
    this.crosshair.fire()
    // 入场动画和亮答案的时候不接受作答
    if (this.phase !== 'answer' || !this.current) return

    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i]
      if (!t.hitTest(x, y)) continue
      if (t.isCorrect) this.onCorrect(t)
      else this.onWrong(t)
      return
    }
    // 打空不罚,只出个声
    this.engine.audio.playSfx('blank')
  }

  private onCorrect(t: Target<number>): void {
    const q = this.current!
    this.engine.audio.playSfx('hit')
    t.pop()
    this.particles.burst(t.x, t.y, 140, MATH.particleCount)
    for (const o of this.targets) if (o !== t) o.dismiss()

    // 剩得越多加得越多:秒答满 100,拖到超时归零
    const speedBonus = Math.round(MATH.speedBonusMax * clamp(this.timeLeft / MATH.questionTime, 0, 1))
    this.combo++
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    this.score += MATH.baseScore + this.combo * MATH.comboBonus + speedBonus

    this.record(q.answer)
    this.hud.setScore(this.score)
    this.hud.setCombo(this.combo)
    this.endRound()
  }

  private onWrong(t: Target<number>): void {
    this.engine.audio.playSfx('miss')
    t.reject()
    // 亮出正确答案,顺手把第三个收掉,画面只剩"你点的"和"对的"
    for (const o of this.targets) {
      if (o.isCorrect) {
        o.pop()
        this.particles.burst(o.x, o.y, 45, MATH.particleCount)
      } else if (o !== t) {
        o.dismiss()
      }
    }

    this.combo = 0
    this.record(t.item)
    this.hud.setCombo(0)
    this.endRound()
  }

  private onTimeout(): void {
    this.engine.audio.playSfx('miss')
    for (const o of this.targets) {
      if (o.isCorrect) {
        o.pop()
        this.particles.burst(o.x, o.y, 45, MATH.particleCount)
      } else {
        o.dismiss()
      }
    }

    this.combo = 0
    this.record(null)
    this.hud.setCombo(0)
    this.endRound()
  }

  private record(picked: number | null): void {
    const q = this.current!
    const used = MATH.questionTime - Math.max(0, this.timeLeft)
    this.records.push({ text: q.text, answer: q.answer, picked, ms: Math.round(used * 1000) })
  }

  private endRound(): void {
    this.revealed = this.current?.answer ?? null
    this.phase = 'feedback'
    this.phaseT = 0
  }

  // ---------- 循环 ----------

  update(dt: number): void {
    this.bg.update(dt)
    this.crosshair.update(dt)
    this.particles.update(dt)

    for (const t of this.targets) t.update(dt)
    this.targets = this.targets.filter((t) => !t.dead)

    this.phaseT += dt
    if (this.phase === 'enter') {
      // 靶子落位之后才开始计时,飞进来的这半秒不算他的
      if (this.phaseT >= MATH.enterDuration) {
        this.phase = 'answer'
        this.phaseT = 0
      }
    } else if (this.phase === 'answer') {
      this.timeLeft -= dt
      if (this.timeLeft <= 0) {
        this.timeLeft = 0
        this.onTimeout()
      }
    } else if (this.phaseT >= MATH.feedbackDuration) {
      this.nextRound()
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.bg.draw(ctx)
    for (const t of this.targets) t.draw(ctx)
    this.particles.draw(ctx)
    this.drawQuestion(ctx)
    this.crosshair.draw(ctx)
  }

  /** 屏幕下方的题干 + 倒计时条 */
  private drawQuestion(ctx: CanvasRenderingContext2D): void {
    const q = this.current
    if (!q) return

    const w = this.engine.width
    const h = this.engine.height
    const boxW = Math.min(440, w - 32)
    const boxH = 116
    const x = (w - boxW) / 2
    const y = h - boxH - 20

    ctx.save()
    ctx.globalAlpha = 0.86
    ctx.fillStyle = 'rgba(10,15,36,0.9)'
    roundRect(ctx, x, y, boxW, boxH, 20)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.lineWidth = 1
    ctx.stroke()

    const tail = this.revealed === null ? '?' : String(this.revealed)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 42px system-ui,-apple-system,"PingFang SC",sans-serif'
    ctx.fillStyle = this.revealed === null ? '#fff' : '#ffd76a'
    ctx.fillText(`${q.text} = ${tail}`, w / 2, y + 42)

    // 倒计时条:剩余时间越少越短,快到点了转红
    const barW = boxW - 44
    const barX = x + 22
    const barY = y + 78
    const p = clamp(this.timeLeft / MATH.questionTime, 0, 1)
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    roundRect(ctx, barX, barY, barW, 12, 6)
    ctx.fill()
    if (p > 0) {
      ctx.fillStyle = this.timeLeft <= MATH.urgentAt ? '#ff6b6b' : '#4d8dff'
      roundRect(ctx, barX, barY, Math.max(12, barW * p), 12, 6)
      ctx.fill()
    }

    ctx.font = 'bold 15px system-ui,-apple-system,"PingFang SC",sans-serif'
    ctx.fillStyle = this.timeLeft <= MATH.urgentAt ? '#ff9d9d' : '#9aa7c7'
    ctx.fillText(`${this.timeLeft.toFixed(1)}s`, w / 2, barY + 30)
    ctx.restore()
  }
}

/** 自己描一个圆角矩形:微信的老内核不一定有 ctx.roundRect */
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
