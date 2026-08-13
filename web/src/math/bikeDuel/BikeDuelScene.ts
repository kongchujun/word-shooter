import type { Engine, Scene } from '../../core/Engine'
import { ParticleSystem } from '../../entities/Particle'
import { t } from '../../i18n'
import { Background } from '../../render/Background'
import { GhostStore, type GhostRun, type GhostSample } from '../../systems/GhostStore'
import type { HUD } from '../../ui/HUD'
import { clamp, lerp } from '../../utils/math'
import { drawBike, drawRoad, roundRect } from '../bike/draw'
import { BIKE, type BikeLevel } from '../bike/levels'
import type { Question } from '../questions'
import type { BikePlayerView, BikeSession } from './online'
import { syncRoom } from './online'

export type DuelMode = 'ghost' | 'online'

export interface BikeDuelResult {
  level: BikeLevel
  mode: DuelMode
  score: number
  rivalScore: number
  bestCombo: number
  correct: number
  samples: GhostSample[]
  outcome: 'win' | 'lose' | 'tie'
  mySeat?: number
  winnerSeat?: number
  standings?: { seat: number; distance: number }[]
}

type Phase = 'countdown' | 'play' | 'feedback' | 'done'

interface ChoiceHit {
  value: number
  x: number
  y: number
  r: number
}

interface RacerState {
  seat: number
  dist: number
  display: number
  pedal: number
}

const SEAT_STYLE: { frame: string; helmet: string }[] = [
  { frame: '#4d8dff', helmet: '#e85d4c' },
  { frame: '#2ecc71', helmet: '#1e8449' },
  { frame: '#f1c40f', helmet: '#d68910' },
  { frame: '#e74c3c', helmet: '#922b21' },
  { frame: '#9b6bff', helmet: '#6c3483' },
]

export interface BikeDuelOpts {
  mode: DuelMode
  ghost?: GhostRun | null
  online?: BikeSession | null
  startAt?: number
}

/**
 * 踩单车对决:幽灵纪录,或多人在线(最多 5 人)。
 * 题各自出,只比距离;头顶显示座位号,自己额外标「这是我」。
 */
export class BikeDuelScene implements Scene {
  readonly aiming = false

  private bg = new Background()
  private particles = new ParticleSystem()

  private current: Question | null = null
  private choices: ChoiceHit[] = []
  private revealed: number | null = null
  private lastPicked: number | null = null

  private phase: Phase = 'countdown'
  private phaseT = 0
  private timeLeft: number
  private elapsed = 0
  private combo = 0
  private bestCombo = 0
  private correct = 0
  private distance = 0
  private displayDist = 0
  private rivalDist = 0
  private displayRival = 0
  private scroll = 0
  private pedal = 0
  private rivalPedal = 0
  private lockT = 0
  private samples: GhostSample[] = []
  private sampleAcc = 0
  private pollAcc = 0
  private countdownLeft = 1.5
  private finishedSent = false

  private mySeat = 0
  private racers: RacerState[] = []
  private winnerSeat = 0
  private standings: { seat: number; distance: number }[] = []

  /** 上一次答对的对局时间;用来判断「答得飞快」 */
  private lastCorrectAt = -1
  /** 加速 / 火箭特效剩余时间 */
  private boostT = 0
  private boostKind: 'nitro' | 'rocket' | null = null
  private boostFlash = 0
  private boostLabel = ''
  private shakeT = 0
  private jetAcc = 0

  private w = 800
  private h = 600
  private safe = { top: 0, right: 0, bottom: 0, left: 0 }

  constructor(
    private engine: Engine,
    private hud: HUD,
    readonly level: BikeLevel,
    private opts: BikeDuelOpts,
    private onFinish: (result: BikeDuelResult) => void,
  ) {
    this.timeLeft = level.duration
    if (opts.mode === 'online' && opts.online) {
      this.mySeat = opts.online.seat
      this.racers = [{ seat: this.mySeat, dist: 0, display: 0, pedal: 0 }]
    }
    if (opts.mode === 'online' && opts.startAt) {
      this.countdownLeft = Math.max(0, (opts.startAt - Date.now()) / 1000)
    }
  }

  start(): void {
    this.w = this.engine.width
    this.h = this.engine.height
    this.refreshSafeArea()
    this.bg.resize(this.w, this.h)
    this.hud.setScore(0)
    this.hud.setCombo(0)
    this.samples = [{ t: 0, dist: 0 }]
    this.syncHud()
    if (this.countdownLeft <= 0) this.beginPlay()
  }

  exit(): void {
    this.particles.clear()
    this.choices = []
  }

  onResize(w: number, h: number): void {
    this.w = w
    this.h = h
    this.refreshSafeArea()
    this.bg.resize(w, h)
    this.layoutChoices()
  }

  /** 读 iOS/Android 安全区,竖屏底部 Home 条尤其影响选项命中 */
  private refreshSafeArea(): void {
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
    document.body.appendChild(probe)
    const cs = getComputedStyle(probe)
    this.safe = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    }
    probe.remove()
  }

  /** 竖屏/矮屏:压缩赛道与答题区,避免题板和选项贴边溢出 */
  private raceLayout() {
    const compact = this.h > this.w || this.h < 560 || this.w < 480
    const narrow = this.w < 420
    const padB = Math.max(compact ? 14 : 10, this.safe.bottom + (compact ? 10 : 4))
    const choiceR = narrow ? 28 : compact ? 32 : 36
    const choiceY = this.h - padB - choiceR
    const qH = narrow ? 42 : compact ? 46 : 52
    const qFont = narrow ? 20 : compact ? 24 : 28
    const qW = Math.min(compact ? 300 : 320, this.w - (narrow ? 16 : 24))
    const qY = choiceY - choiceR - (compact ? 14 : 18) - qH / 2

    const hudEl = document.querySelector('.hud:not(.hidden)') as HTMLElement | null
    const hudBottom = hudEl
      ? hudEl.getBoundingClientRect().bottom + 6
      : Math.max(56, this.safe.top + 48)
    const panelTop = Math.max(hudBottom, this.safe.top + 44)
    const panelW = Math.min(compact ? 260 : 280, this.w - 20)
    const panelH = compact ? 58 : 52
    const panelStacked = compact || narrow

    // 赛道夹在顶部信息条和题板之间
    let roadTop = compact
      ? panelTop + panelH + 10
      : this.h * 0.38
    let roadBot = compact
      ? qY - 40
      : this.h * 0.78
    const minBand = compact ? 88 : 140
    if (roadBot - roadTop < minBand) {
      const mid = (roadTop + roadBot) / 2
      roadTop = mid - minBand / 2
      roadBot = mid + minBand / 2
    }
    const bikeScale = narrow ? 0.72 : compact ? 0.82 : 1
    const midX = this.w * (narrow ? 0.34 : compact ? 0.3 : 0.28)

    return {
      compact,
      narrow,
      choiceR,
      choiceY,
      qH,
      qFont,
      qW,
      qY,
      panelTop,
      panelW,
      panelH,
      panelStacked,
      roadTop,
      roadBot,
      bikeScale,
      midX,
    }
  }

  private beginPlay(): void {
    this.phase = 'play'
    this.phaseT = 0
    this.elapsed = 0
    this.timeLeft = this.level.duration
    this.lastCorrectAt = -1
    this.boostT = 0
    this.boostKind = null
    this.boostFlash = 0
    this.shakeT = 0
    this.nextQuestion()
    this.syncHud()
  }

  private nextQuestion(): void {
    this.current = this.level.next()
    this.revealed = null
    this.lastPicked = null
    this.phase = 'play'
    this.phaseT = 0
    this.layoutChoices()
  }

  private layoutChoices(): void {
    if (!this.current) {
      this.choices = []
      return
    }
    const n = this.current.choices.length
    const L = this.raceLayout()
    const side = L.narrow ? 20 : 40
    const gap = Math.min(L.narrow ? 78 : 120, (this.w - side * 2) / Math.max(1, n))
    const x0 = this.w / 2 - ((n - 1) * gap) / 2
    this.choices = this.current.choices.map((value, i) => ({
      value,
      x: x0 + i * gap,
      y: L.choiceY,
      r: L.choiceR,
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
    this.revealed = q.answer
    this.lastPicked = value

    if (value === q.answer) {
      this.correct++
      this.combo++
      this.bestCombo = Math.max(this.bestCombo, this.combo)
      const gap = this.lastCorrectAt < 0 ? 99 : this.elapsed - this.lastCorrectAt
      this.lastCorrectAt = this.elapsed
      let gain = BIKE.baseMeters + Math.max(0, this.combo - 1) * BIKE.comboMeters
      const bx = this.myBikeX()
      const by = this.myBikeY()
      this.particles.burst(bx, by - 20, 48, 18, 0.9)
      // 连击 + 答得够快 → 加速 / 喷火箭
      if (this.combo >= 2 && gap <= BIKE.fastGap) {
        const rocket = this.combo >= BIKE.rocketCombo && gap <= BIKE.rocketGap
        gain += rocket ? BIKE.rocketBonus : BIKE.boostBonus
        this.triggerBoost(rocket ? 'rocket' : 'nitro', bx, by)
      } else {
        this.engine.audio.playSfx('hit')
      }
      this.distance += gain
    } else {
      this.combo = 0
      this.lastCorrectAt = -1
      this.lockT = BIKE.missLock
      this.engine.audio.playSfx('miss')
    }

    this.pushSample()
    this.syncHud()
    void this.pushOnline()
    this.phase = 'feedback'
    this.phaseT = 0
  }

  private triggerBoost(kind: 'nitro' | 'rocket', x: number, y: number): void {
    this.boostKind = kind
    this.boostT = kind === 'rocket' ? BIKE.rocketHold : BIKE.boostHold
    this.boostFlash = 0.85
    this.boostLabel = kind === 'rocket' ? t('math.duel.rocket') : t('math.duel.boost')
    this.shakeT = kind === 'rocket' ? 0.35 : 0.2
    const power = kind === 'rocket' ? 1.45 : 1
    this.particles.jet(x - 28, y + 6, kind === 'rocket' ? 28 : 16, power, kind === 'rocket' ? 18 : 32)
    this.particles.burst(x, y - 10, kind === 'rocket' ? 15 : 40, kind === 'rocket' ? 22 : 12, power)
    this.engine.audio.playSfx(kind === 'rocket' ? 'levelup' : 'hit')
  }

  private pushSample(): void {
    this.samples.push({ t: this.elapsed, dist: this.distance })
  }

  private applyPlayers(list: BikePlayerView[]): void {
    for (const p of list) {
      let r = this.racers.find((x) => x.seat === p.seat)
      if (!r) {
        r = { seat: p.seat, dist: p.distance, display: p.distance, pedal: 0 }
        this.racers.push(r)
      }
      if (p.distance > r.dist) r.dist = p.distance
      if (p.you) {
        this.mySeat = p.seat
        r.dist = Math.max(r.dist, Math.round(this.distance))
      }
    }
    this.racers.sort((a, b) => a.seat - b.seat)
  }

  private leaderDist(): number {
    if (this.opts.mode === 'ghost') return this.rivalDist
    let best = this.distance
    for (const r of this.racers) best = Math.max(best, r.dist)
    return best
  }

  private async pushOnline(finished = false): Promise<void> {
    if (this.opts.mode !== 'online' || !this.opts.online) return
    try {
      const st = await syncRoom(this.opts.online, {
        distance: Math.round(this.distance),
        correct: this.correct,
        finished,
      })
      this.applyPlayers(st.players)
      if (st.winnerSeat) this.winnerSeat = st.winnerSeat
      this.standings = st.players.map((p) => ({ seat: p.seat, distance: p.distance }))
      this.rivalDist = this.leaderDist()
    } catch {
      /* 掉线时本地继续 */
    }
  }

  private finish(): void {
    if (this.phase === 'done') return
    this.phase = 'done'
    this.pushSample()
    void this.finalize()
  }

  private async finalize(): Promise<void> {
    if (!this.finishedSent) {
      this.finishedSent = true
      await this.pushOnline(true)
      if (this.opts.mode === 'online') {
        await new Promise((r) => setTimeout(r, 400))
        await this.pushOnline(true)
      }
    }
    const score = Math.round(this.distance)
    if (this.opts.mode === 'ghost') {
      const rival = this.opts.ghost
        ? Math.round(GhostStore.distanceAt(this.opts.ghost, this.elapsed))
        : Math.round(this.rivalDist)
      const outcome = score > rival ? 'win' : score < rival ? 'lose' : 'tie'
      this.onFinish({
        level: this.level,
        mode: 'ghost',
        score,
        rivalScore: rival,
        bestCombo: this.bestCombo,
        correct: this.correct,
        samples: this.samples,
        outcome,
      })
      return
    }

    const winnerSeat = this.winnerSeat || this.pickLocalWinner()
    const winnerDist =
      this.standings.find((s) => s.seat === winnerSeat)?.distance ??
      this.racers.find((r) => r.seat === winnerSeat)?.dist ??
      score
    const outcome = this.mySeat === winnerSeat ? 'win' : 'lose'
    this.onFinish({
      level: this.level,
      mode: 'online',
      score,
      rivalScore: Math.round(winnerDist),
      bestCombo: this.bestCombo,
      correct: this.correct,
      samples: this.samples,
      outcome,
      mySeat: this.mySeat,
      winnerSeat,
      standings: this.standings.length
        ? this.standings
        : this.racers.map((r) => ({ seat: r.seat, distance: Math.round(r.dist) })),
    })
  }

  private pickLocalWinner(): number {
    let best = this.racers[0]
    for (const r of this.racers) {
      if (!best || r.dist > best.dist || (r.dist === best.dist && r.seat < best.seat)) best = r
    }
    return best?.seat ?? this.mySeat
  }

  update(dt: number): void {
    this.bg.update(dt)
    this.particles.update(dt)
    if (this.boostT > 0) this.boostT = Math.max(0, this.boostT - dt)
    if (this.boostT <= 0) this.boostKind = null
    if (this.boostFlash > 0) this.boostFlash = Math.max(0, this.boostFlash - dt)
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt)

    this.displayDist = lerp(this.displayDist, this.distance, 1 - Math.pow(0.001, dt))
    for (const r of this.racers) {
      r.display = lerp(r.display, r.dist, 1 - Math.pow(0.001, dt))
      r.pedal += dt * (2.2 + Math.min(6, r.dist / 40))
    }
    const leader = this.leaderDist()
    this.displayRival = lerp(this.displayRival, leader, 1 - Math.pow(0.001, dt))
    const boostScroll = this.boostKind === 'rocket' ? 140 : this.boostKind === 'nitro' ? 90 : 0
    this.scroll += (40 + this.distance * 0.35 + (this.boostT > 0 ? boostScroll : 0)) * dt
    this.pedal += dt * (2.5 + this.combo * 0.4 + (this.boostT > 0 ? 3 : 0))
    this.rivalPedal += dt * (2.2 + Math.min(6, leader / 40))

    if (this.boostT > 0 && this.phase !== 'countdown' && this.phase !== 'done') {
      this.jetAcc += dt
      const interval = this.boostKind === 'rocket' ? 0.04 : 0.07
      if (this.jetAcc >= interval) {
        this.jetAcc = 0
        const power = this.boostKind === 'rocket' ? 1.2 : 0.85
        this.particles.jet(this.myBikeX() - 30, this.myBikeY() + 8, this.boostKind === 'rocket' ? 7 : 4, power)
      }
    } else {
      this.jetAcc = 0
    }

    if (this.lockT > 0) this.lockT = Math.max(0, this.lockT - dt)
    if (this.phase === 'done') return

    if (this.phase === 'countdown') {
      this.countdownLeft -= dt
      if (this.countdownLeft <= 0) this.beginPlay()
      return
    }

    this.elapsed += dt
    this.sampleAcc += dt
    if (this.sampleAcc >= 0.25) {
      this.sampleAcc = 0
      this.pushSample()
    }

    if (this.opts.mode === 'online') {
      this.pollAcc += dt
      if (this.pollAcc >= 0.25) {
        this.pollAcc = 0
        void this.pushOnline()
      }
    } else if (this.opts.ghost) {
      this.rivalDist = GhostStore.distanceAt(this.opts.ghost, this.elapsed)
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
    const L = this.raceLayout()
    const shake =
      this.shakeT > 0
        ? {
            x: (Math.random() - 0.5) * 6 * (this.shakeT / 0.35),
            y: (Math.random() - 0.5) * 4 * (this.shakeT / 0.35),
          }
        : { x: 0, y: 0 }

    ctx.save()
    ctx.translate(shake.x, shake.y)
    this.bg.draw(ctx)
    drawRoad(ctx, this.w, this.h, this.scroll, L.roadTop, L.roadBot)

    if (this.opts.mode === 'ghost') this.drawGhostRace(ctx, L)
    else this.drawOnlineRace(ctx, L)

    this.particles.draw(ctx)
    if (this.boostT > 0) this.drawSpeedLines(ctx, L)
    this.drawHudPanel(ctx, L)
    if (this.boostFlash > 0 || this.boostT > 0.4) this.drawBoostBanner(ctx, L)
    ctx.restore()

    if (this.phase === 'countdown') {
      this.drawCountdown(ctx, L)
      return
    }
    this.drawQuestion(ctx, L)
    this.drawChoices(ctx, L)
  }

  private drawGhostRace(ctx: CanvasRenderingContext2D, L: ReturnType<BikeDuelScene['raceLayout']>): void {
    const mid = L.midX
    const leadMax = L.narrow ? 56 : L.compact ? 70 : 90
    const lead = clamp((this.displayDist - this.displayRival) * 1.1, -leadMax, leadMax)
    const rivalX = mid + lead * 0.15
    const myX = mid + lead
    const rivalY = this.laneY(0, 2, L)
    const myY = this.laneY(1, 2, L)
    const tagLift = 48 * L.bikeScale + 14
    drawBike(ctx, rivalX, rivalY, this.rivalPedal, '#9b6bff', '#7c4dff', 0.85, L.bikeScale * 0.9)
    this.drawNameTag(ctx, rivalX, rivalY - tagLift, t('math.duel.rivalGhost'), false, L)
    this.drawBoostFlame(ctx, myX, myY, L.bikeScale)
    drawBike(ctx, myX, myY, this.pedal, '#4d8dff', '#e85d4c', 1, L.bikeScale)
    this.drawYouMarker(ctx, myX, myY, null, L)
  }

  private drawOnlineRace(ctx: CanvasRenderingContext2D, L: ReturnType<BikeDuelScene['raceLayout']>): void {
    const mid = L.midX
    const seats = this.racers.map((r) => r.seat)
    if (!seats.includes(this.mySeat) && this.mySeat) seats.push(this.mySeat)
    seats.sort((a, b) => a - b)
    const total = Math.max(1, seats.length)
    const leadMax = L.narrow ? 48 : L.compact ? 72 : 100
    const tagLift = 44 * L.bikeScale + 12

    // 先画别人,自己最后盖在上面
    for (const seat of seats) {
      if (seat === this.mySeat) continue
      const r = this.racers.find((x) => x.seat === seat)
      const dist = r?.display ?? 0
      const pedal = r?.pedal ?? 0
      const lead = clamp((dist - this.displayDist) * 1.1, -leadMax, leadMax)
      const x = mid + lead
      const y = this.laneY(seats.indexOf(seat), total, L)
      const style = SEAT_STYLE[(seat - 1) % SEAT_STYLE.length]
      drawBike(ctx, x, y, pedal, style.frame, style.helmet, 0.8, L.bikeScale * 0.88)
      this.drawNameTag(ctx, x, y - tagLift, t('math.duel.seatLabel', { n: seat }), false, L)
    }

    const myX = mid
    const myY = this.laneY(seats.indexOf(this.mySeat), total, L)
    const mine = SEAT_STYLE[(this.mySeat - 1) % SEAT_STYLE.length]
    this.drawBoostFlame(ctx, myX, myY, L.bikeScale)
    drawBike(ctx, myX, myY, this.pedal, mine.frame, mine.helmet, 1, L.bikeScale)
    this.drawYouMarker(ctx, myX, myY, this.mySeat, L)
  }

  private drawBoostFlame(ctx: CanvasRenderingContext2D, bikeX: number, bikeY: number, scale: number): void {
    if (this.boostT <= 0 || !this.boostKind) return
    const rocket = this.boostKind === 'rocket'
    const pulse = 0.75 + Math.sin(this.elapsed * (rocket ? 28 : 18)) * 0.25
    const len = (rocket ? 54 : 36) * scale * pulse * Math.min(1, this.boostT / 0.4)
    const h = (rocket ? 18 : 12) * scale
    const x0 = bikeX - 32 * scale
    const y0 = bikeY + 8 * scale

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    // 外焰
    const g = ctx.createLinearGradient(x0, y0, x0 - len, y0)
    g.addColorStop(0, rocket ? 'rgba(255,240,180,0.95)' : 'rgba(255,220,120,0.9)')
    g.addColorStop(0.35, rocket ? 'rgba(255,120,40,0.85)' : 'rgba(255,140,50,0.75)')
    g.addColorStop(1, 'rgba(255,40,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(x0, y0 - h * 0.35)
    ctx.lineTo(x0 - len, y0)
    ctx.lineTo(x0, y0 + h * 0.35)
    ctx.closePath()
    ctx.fill()

    // 芯焰
    const g2 = ctx.createLinearGradient(x0, y0, x0 - len * 0.65, y0)
    g2.addColorStop(0, 'rgba(255,255,255,0.95)')
    g2.addColorStop(0.5, rocket ? 'rgba(120,220,255,0.7)' : 'rgba(255,200,80,0.65)')
    g2.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g2
    ctx.beginPath()
    ctx.moveTo(x0, y0 - h * 0.18)
    ctx.lineTo(x0 - len * 0.65, y0)
    ctx.lineTo(x0, y0 + h * 0.18)
    ctx.closePath()
    ctx.fill()

    if (rocket) {
      // 小火箭筒挂在后轮旁
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = '#c0c8d8'
      ctx.fillRect(x0 - 6 * scale, y0 - 7 * scale, 14 * scale, 10 * scale)
      ctx.fillStyle = '#ff5a3a'
      ctx.beginPath()
      ctx.moveTo(x0 + 8 * scale, y0 - 7 * scale)
      ctx.lineTo(x0 + 14 * scale, y0)
      ctx.lineTo(x0 + 8 * scale, y0 + 3 * scale)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  private drawSpeedLines(ctx: CanvasRenderingContext2D, L: ReturnType<BikeDuelScene['raceLayout']>): void {
    const rocket = this.boostKind === 'rocket'
    const a = Math.min(0.55, 0.2 + this.boostT * 0.2)
    ctx.save()
    ctx.strokeStyle = rocket ? `rgba(160,220,255,${a})` : `rgba(255,210,120,${a})`
    ctx.lineWidth = rocket ? 2.5 : 1.8
    const y0 = L.roadTop + 10
    const y1 = L.roadBot - 10
    const n = rocket ? 14 : 9
    for (let i = 0; i < n; i++) {
      const y = y0 + ((y1 - y0) * (i + 0.3)) / n
      const len = 40 + ((i * 37 + Math.floor(this.scroll)) % 50)
      const x = ((this.scroll * (rocket ? 2.2 : 1.6) + i * 73) % (this.w + 80)) - 40
      ctx.beginPath()
      ctx.moveTo(this.w - x, y)
      ctx.lineTo(this.w - x - len, y + (i % 2 === 0 ? -2 : 2))
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawBoostBanner(ctx: CanvasRenderingContext2D, L: ReturnType<BikeDuelScene['raceLayout']>): void {
    if (!this.boostLabel) return
    const flash = this.boostFlash > 0 ? this.boostFlash / 0.85 : Math.min(1, this.boostT / 0.5) * 0.7
    const rocket = this.boostKind === 'rocket'
    const y = L.panelTop + L.panelH + (L.compact ? 28 : 36)
    const pop = 1 + (this.boostFlash > 0 ? this.boostFlash * 0.25 : 0)
    ctx.save()
    ctx.globalAlpha = Math.min(1, flash + 0.15)
    ctx.translate(this.w / 2, y)
    ctx.scale(pop, pop)
    ctx.font = `bold ${L.narrow ? 22 : rocket ? 30 : 26}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 5
    ctx.strokeStyle = 'rgba(20,26,40,0.75)'
    ctx.strokeText(this.boostLabel, 0, 0)
    ctx.fillStyle = rocket ? '#9ae8ff' : '#ffe08a'
    ctx.fillText(this.boostLabel, 0, 0)
    ctx.restore()
  }

  private laneY(index: number, total: number, L = this.raceLayout()): number {
    const top = L.roadTop + (L.compact ? 28 : 36)
    const bot = L.roadBot - (L.compact ? 22 : 30)
    if (total <= 1) return (top + bot) / 2
    const i = Math.max(0, index)
    return top + ((bot - top) * i) / (total - 1)
  }

  private myBikeX(): number {
    return this.raceLayout().midX
  }

  private myBikeY(): number {
    const L = this.raceLayout()
    if (this.opts.mode === 'ghost') return this.laneY(1, 2, L)
    const seats = this.racers.map((r) => r.seat).sort((a, b) => a - b)
    if (!seats.includes(this.mySeat)) seats.push(this.mySeat)
    seats.sort((a, b) => a - b)
    return this.laneY(seats.indexOf(this.mySeat), Math.max(1, seats.length), L)
  }

  private drawNameTag(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    mine: boolean,
    L = this.raceLayout(),
  ): void {
    const fontSize = L.narrow ? (mine ? 12 : 11) : mine ? 14 : 13
    ctx.font = `${mine ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`
    const padX = L.narrow ? 7 : 10
    const w = Math.max(40, ctx.measureText(label).width + padX * 2)
    const h = L.narrow ? 20 : 24
    // 防止标签画出屏幕
    const cx = clamp(x, w / 2 + 4, this.w - w / 2 - 4)
    ctx.fillStyle = mine ? 'rgba(45, 110, 255, 0.92)' : 'rgba(80, 50, 130, 0.75)'
    roundRect(ctx, cx - w / 2, y - h / 2, w, h, 10)
    ctx.fill()
    if (mine) {
      ctx.strokeStyle = 'rgba(255,220,120,0.95)'
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, cx, y + 0.5)
  }

  /** 自己:座位号 +「这是我」+ 箭头小旗 */
  private drawYouMarker(
    ctx: CanvasRenderingContext2D,
    bikeX: number,
    bikeY: number,
    seat: number | null,
    L = this.raceLayout(),
  ): void {
    const s = L.bikeScale
    const tagY = bikeY - (L.compact ? 56 : 78) * (L.narrow ? 0.85 : 1)
    const label =
      seat && seat > 0
        ? L.narrow
          ? `${seat} · ${t('math.duel.youBadge')}`
          : `${t('math.duel.seatLabel', { n: seat })} · ${t('math.duel.youBadge')}`
        : t('math.duel.youBadge')
    this.drawNameTag(ctx, bikeX, tagY, label, true, L)

    ctx.fillStyle = '#ffd24a'
    ctx.beginPath()
    ctx.moveTo(bikeX, bikeY - 54 * s)
    ctx.lineTo(bikeX - 7 * s, bikeY - 64 * s)
    ctx.lineTo(bikeX + 7 * s, bikeY - 64 * s)
    ctx.closePath()
    ctx.fill()

    // 竖屏空间紧,旗子可省略
    if (L.narrow) return
    const fx = bikeX - 34 * s
    const fy = bikeY - 36 * s
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(fx, fy + 22 * s)
    ctx.lineTo(fx, fy)
    ctx.stroke()
    ctx.fillStyle = '#ff5a5a'
    ctx.beginPath()
    ctx.moveTo(fx, fy)
    ctx.lineTo(fx + 16 * s, fy + 6 * s)
    ctx.lineTo(fx, fy + 12 * s)
    ctx.closePath()
    ctx.fill()
  }

  private drawCountdown(ctx: CanvasRenderingContext2D, L = this.raceLayout()): void {
    const n = Math.ceil(this.countdownLeft)
    const bw = L.narrow ? 120 : 160
    const bh = L.narrow ? 80 : 100
    const font = L.narrow ? 36 : 48
    ctx.fillStyle = 'rgba(20,26,40,0.55)'
    roundRect(ctx, this.w / 2 - bw / 2, this.h / 2 - bh / 2, bw, bh, 16)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${font}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(n > 0 ? String(n) : 'GO!', this.w / 2, this.h / 2)
  }

  private drawHudPanel(ctx: CanvasRenderingContext2D, L = this.raceLayout()): void {
    const urgent = this.phase !== 'countdown' && this.timeLeft <= 5
    const x = (this.w - L.panelW) / 2
    const y = L.panelTop
    ctx.fillStyle = urgent ? 'rgba(180,40,40,0.55)' : 'rgba(20,26,40,0.55)'
    roundRect(ctx, x, y, L.panelW, L.panelH, 12)
    ctx.fill()
    ctx.fillStyle = urgent ? '#ffd0d0' : '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const clock = this.phase === 'countdown' ? '…' : `${this.timeLeft.toFixed(1)}s`
    const meLabel =
      this.opts.mode === 'online' && this.mySeat
        ? `${t('math.duel.seatLabel', { n: this.mySeat })} ${Math.round(this.displayDist)}m`
        : `${t('math.duel.youBadge')} ${Math.round(this.displayDist)}m`
    const rivalLabel =
      this.opts.mode === 'online'
        ? `${t('math.duel.leader')} ${Math.round(this.displayRival)}m`
        : `${t('math.duel.rivalGhost')} ${Math.round(this.displayRival)}m`

    if (L.panelStacked) {
      ctx.font = `bold ${L.narrow ? 15 : 16}px system-ui, sans-serif`
      ctx.fillText(`⏱ ${clock}`, this.w / 2, y + L.panelH * 0.32)
      ctx.font = `bold ${L.narrow ? 12 : 13}px system-ui, sans-serif`
      ctx.fillStyle = '#ffd24a'
      const line = `${meLabel} · ${rivalLabel}`
      // 过长则缩小字号
      let size = L.narrow ? 12 : 13
      ctx.font = `bold ${size}px system-ui, sans-serif`
      while (size > 10 && ctx.measureText(line).width > L.panelW - 16) {
        size -= 1
        ctx.font = `bold ${size}px system-ui, sans-serif`
      }
      ctx.fillText(line, this.w / 2, y + L.panelH * 0.72)
    } else {
      ctx.font = 'bold 18px system-ui, sans-serif'
      ctx.fillText(`⏱ ${clock}`, this.w / 2, y + 16)
      ctx.font = 'bold 14px system-ui, sans-serif'
      ctx.fillStyle = '#ffd24a'
      ctx.fillText(meLabel, this.w / 2 - 70, y + 38)
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = '14px system-ui, sans-serif'
      ctx.fillText(`· ${rivalLabel}`, this.w / 2 + 70, y + 38)
    }
  }

  private drawQuestion(ctx: CanvasRenderingContext2D, L = this.raceLayout()): void {
    if (!this.current) return
    const y = L.qY
    ctx.fillStyle = 'rgba(20,26,40,0.88)'
    roundRect(ctx, this.w / 2 - L.qW / 2, y - L.qH / 2, L.qW, L.qH, 14)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${L.qFont}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tail = this.revealed !== null ? this.revealed : '?'
    const text = `${this.current.text} = ${tail}`
    // 窄屏防溢出
    let size = L.qFont
    while (size > 16 && ctx.measureText(text).width > L.qW - 20) {
      size -= 1
      ctx.font = `bold ${size}px system-ui, sans-serif`
    }
    ctx.fillText(text, this.w / 2, y)
  }

  private drawChoices(ctx: CanvasRenderingContext2D, L = this.raceLayout()): void {
    const font = L.narrow ? 18 : 22
    for (const c of this.choices) {
      let fill = '#3d7cff'
      if (this.revealed !== null) {
        if (c.value === this.revealed) fill = '#2ecc71'
        else if (this.lastPicked === c.value) fill = '#e74c3c'
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
      ctx.font = `bold ${font}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(c.value), c.x, c.y + 1)
    }
  }
}
