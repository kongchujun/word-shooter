import { BALANCE } from '../config/balance'
import type { Game } from '../core/Game'
import { Crosshair } from '../entities/Crosshair'
import { ParticleSystem } from '../entities/Particle'
import { Target } from '../entities/Target'
import { Background } from '../render/Background'
import type { LevelDef, LevelResult, RoundRecord, Word } from '../types'
import { gridSlots } from '../utils/layout'
import { clamp, hashHue, shuffle } from '../utils/math'

type Phase = 'spawning' | 'listening' | 'feedback'

/**
 * 一轮 = 生成靶子 → 播语音 → 等玩家开枪 → 反馈。
 * 打错不结束这一轮:红闪 + 自动重播语音,让孩子改对为止。
 */
export class PlayScene {
  private bg = new Background()
  private particles = new ParticleSystem()
  private crosshair = new Crosshair()
  private targets: Target<Word>[] = []

  private queue: Word[] = []
  private records: RoundRecord[] = []
  private current: Word | null = null

  private phase: Phase = 'spawning'
  private phaseT = 0
  private spoken = false
  private listenStart = 0
  private replayTimer = 0

  private roundIndex = 0
  private misses = 0
  private combo = 0
  private bestCombo = 0
  private score = 0
  private banner: { en: string; zh: string; x: number; y: number; r: number; t: number } | null = null

  constructor(
    private game: Game,
    readonly level: LevelDef,
    private onFinish: (result: LevelResult) => void,
  ) {}

  enter(): void {
    this.bg.resize(this.game.width, this.game.height)
    // 词不够铺满 rounds 时循环取,但同一轮内不重复
    let q: Word[] = []
    while (q.length < this.level.rounds) q = q.concat(shuffle(this.level.words))
    this.queue = q.slice(0, this.level.rounds)
    this.startRound()
  }

  exit(): void {
    window.clearTimeout(this.replayTimer)
    this.game.audio.stopVoice()
    this.particles.clear()
    this.targets = []
  }

  onResize(w: number, h: number): void {
    this.bg.resize(w, h)
    // 平板转屏后按新尺寸重新排一次,否则靶子会留在屏幕外点不着
    const alive = this.targets.filter((t) => t.state !== 'dying')
    const slots = this.layout(alive.length)
    alive.forEach((t, i) => t.relocate(slots[i].x, slots[i].y, slots[i].r))
  }

  /** 仅调试用 */
  debugTargets(): { en: string; x: number; y: number; correct: boolean }[] {
    return this.targets.map((t) => ({ en: t.item.en, x: Math.round(t.x), y: Math.round(t.y), correct: t.isCorrect }))
  }

  /** HUD 上的 🔊 按钮 */
  replayAudio(): void {
    if (!this.current || this.phase === 'feedback') return
    this.game.audio.speak(this.current)
  }

  // ---------- 回合 ----------

  private startRound(): void {
    const correct = this.queue[this.roundIndex]
    const others = shuffle(this.level.words.filter((w) => w.id !== correct.id)).slice(0, this.level.targetCount - 1)
    const words = shuffle([correct, ...others])
    const slots = this.layout(words.length)

    this.targets = words.map((w, i) =>
      new Target(
        w,
        this.game.loader.get(w.id)!,
        w.id === correct.id,
        slots[i].x,
        slots[i].y,
        slots[i].r,
        this.level.speed,
        this.game.width,
        this.game.height,
      ),
    )

    this.current = correct
    this.phase = 'spawning'
    this.phaseT = 0
    this.spoken = false
    this.listenStart = 0
    this.misses = 0
    this.banner = null
    this.game.hud.setRound(this.roundIndex + 1, this.level.rounds)
  }

  /** 顶上 96 给 HUD 让位,底下留一点边 */
  private layout(n: number) {
    return gridSlots(n, this.game.width, this.game.height, 96, 32)
  }

  private nextRound(): void {
    this.roundIndex++
    if (this.roundIndex >= this.level.rounds) {
      this.game.audio.playSfx('levelup')
      this.onFinish({ level: this.level, records: this.records, score: this.score, bestCombo: this.bestCombo })
      return
    }
    this.startRound()
  }

  // ---------- 输入 ----------

  onPointerMove(x: number, y: number): void {
    this.crosshair.move(x, y)
  }

  onPointerDown(x: number, y: number): void {
    this.crosshair.move(x, y)
    this.crosshair.fire()
    if (this.phase === 'feedback' || !this.current) return

    // 后画的在上层,命中判定从上往下找
    let hit: Target<Word> | null = null
    for (let i = this.targets.length - 1; i >= 0; i--) {
      if (this.targets[i].hitTest(x, y)) {
        hit = this.targets[i]
        break
      }
    }
    if (!hit) {
      this.game.audio.playSfx('blank')
      return
    }
    if (hit.isCorrect) this.onCorrect(hit)
    else this.onWrong(hit)
  }

  private onCorrect(t: Target<Word>): void {
    window.clearTimeout(this.replayTimer)
    this.game.audio.stopVoice()
    this.game.audio.playSfx('hit')

    t.pop()
    this.particles.burst(t.x, t.y, hashHue(t.item.id), BALANCE.particleCount)
    for (const o of this.targets) if (o !== t) o.dismiss()

    const reactionMs = this.listenStart ? performance.now() - this.listenStart : 0
    const speedBonus =
      this.misses === 0
        ? Math.round(BALANCE.speedBonusMax * clamp(1 - reactionMs / BALANCE.speedBonusWindowMs, 0, 1))
        : 0

    // 打错过的这一轮不算进连击,连击 = 连续几轮一次命中
    this.combo = this.misses === 0 ? this.combo + 1 : 0
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    this.score += BALANCE.baseScore + this.combo * BALANCE.comboBonus + speedBonus
    this.records.push({ word: t.item, misses: this.misses, reactionMs })

    this.banner = { en: t.item.en, zh: t.item.zh, x: t.x, y: t.y, r: t.r, t: 0 }
    this.game.hud.setScore(this.score)
    this.game.hud.setCombo(this.combo)
    this.phase = 'feedback'
    this.phaseT = 0
  }

  private onWrong(t: Target<Word>): void {
    t.reject()
    this.game.audio.playSfx('miss')
    this.misses++
    this.combo = 0
    this.score = Math.max(0, this.score - BALANCE.missPenalty)
    this.game.hud.setScore(this.score)
    this.game.hud.setCombo(0)

    // 打错自动重播,不用他自己去点喇叭
    window.clearTimeout(this.replayTimer)
    this.replayTimer = window.setTimeout(() => this.replayAudio(), BALANCE.replayDelay * 1000)
  }

  // ---------- 循环 ----------

  update(dt: number): void {
    this.bg.update(dt)
    this.crosshair.update(dt)
    this.particles.update(dt)

    for (const t of this.targets) t.update(dt)
    this.targets = this.targets.filter((t) => !t.dead)
    if (this.banner) this.banner.t += dt

    this.phaseT += dt
    if (this.phase === 'spawning') {
      if (!this.spoken && this.phaseT >= BALANCE.enterDuration + BALANCE.speakDelay) {
        this.spoken = true
        const word = this.current!
        this.game.audio.speak(word, () => {
          // 语音播完才开始计反应时间
          if (this.current === word && this.phase === 'spawning') {
            this.phase = 'listening'
            this.listenStart = performance.now()
          }
        })
      }
    } else if (this.phase === 'feedback' && this.phaseT >= BALANCE.feedbackDuration) {
      this.nextRound()
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.bg.draw(ctx)
    for (const t of this.targets) t.draw(ctx)
    this.particles.draw(ctx)
    this.drawBanner(ctx)
    this.crosshair.draw(ctx)
  }

  /** 打中后从靶子位置浮起来的 单词 / 中文 */
  private drawBanner(ctx: CanvasRenderingContext2D): void {
    const b = this.banner
    if (!b) return
    const p = clamp(b.t / BALANCE.feedbackDuration, 0, 1)
    // 浮在靶子正上方,别压住图;贴边时往里收,别飞出屏幕
    const y = Math.max(130, b.y - b.r - 34 - p * 46)
    const x = clamp(b.x, 130, this.game.width - 130)

    ctx.save()
    ctx.globalAlpha = 1 - Math.max(0, (p - 0.65) / 0.35)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'

    ctx.font = 'bold 54px system-ui,-apple-system,"PingFang SC",sans-serif'
    ctx.lineWidth = 9
    ctx.strokeStyle = 'rgba(6,10,24,0.85)'
    ctx.strokeText(b.en, x, y)
    ctx.fillStyle = '#fff'
    ctx.fillText(b.en, x, y)

    ctx.font = 'bold 30px system-ui,-apple-system,"PingFang SC",sans-serif'
    ctx.lineWidth = 7
    ctx.strokeText(b.zh, x, y + 44)
    ctx.fillStyle = '#ffd76a'
    ctx.fillText(b.zh, x, y + 44)
    ctx.restore()
  }
}
