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

  private w = 800
  private h = 600

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
    this.bg.resize(w, h)
    this.layoutChoices()
  }

  private beginPlay(): void {
    this.phase = 'play'
    this.phaseT = 0
    this.elapsed = 0
    this.timeLeft = this.level.duration
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
    this.revealed = q.answer
    this.lastPicked = value

    if (value === q.answer) {
      this.correct++
      this.combo++
      this.bestCombo = Math.max(this.bestCombo, this.combo)
      const gain = BIKE.baseMeters + Math.max(0, this.combo - 1) * BIKE.comboMeters
      this.distance += gain
      this.particles.burst(this.myBikeX(), this.myBikeY() - 20, 48, 18, 0.9)
      this.engine.audio.playSfx('hit')
    } else {
      this.combo = 0
      this.lockT = BIKE.missLock
      this.engine.audio.playSfx('miss')
    }

    this.pushSample()
    this.syncHud()
    void this.pushOnline()
    this.phase = 'feedback'
    this.phaseT = 0
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
    this.displayDist = lerp(this.displayDist, this.distance, 1 - Math.pow(0.001, dt))
    for (const r of this.racers) {
      r.display = lerp(r.display, r.dist, 1 - Math.pow(0.001, dt))
      r.pedal += dt * (2.2 + Math.min(6, r.dist / 40))
    }
    const leader = this.leaderDist()
    this.displayRival = lerp(this.displayRival, leader, 1 - Math.pow(0.001, dt))
    this.scroll += (40 + this.distance * 0.35) * dt
    this.pedal += dt * (2.5 + this.combo * 0.4)
    this.rivalPedal += dt * (2.2 + Math.min(6, leader / 40))

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
    this.bg.draw(ctx)
    drawRoad(ctx, this.w, this.h, this.scroll)

    if (this.opts.mode === 'ghost') this.drawGhostRace(ctx)
    else this.drawOnlineRace(ctx)

    this.particles.draw(ctx)
    this.drawHudPanel(ctx)
    if (this.phase === 'countdown') {
      this.drawCountdown(ctx)
      return
    }
    this.drawQuestion(ctx)
    this.drawChoices(ctx)
  }

  private drawGhostRace(ctx: CanvasRenderingContext2D): void {
    const mid = this.w * 0.28
    const lead = clamp((this.displayDist - this.displayRival) * 1.1, -90, 90)
    const rivalX = mid + lead * 0.15
    const myX = mid + lead
    const rivalY = this.h * 0.46
    const myY = this.h * 0.58
    drawBike(ctx, rivalX, rivalY, this.rivalPedal, '#9b6bff', '#7c4dff', 0.85)
    this.drawNameTag(ctx, rivalX, rivalY - 62, t('math.duel.rivalGhost'), false)
    drawBike(ctx, myX, myY, this.pedal, '#4d8dff', '#e85d4c', 1)
    this.drawYouMarker(ctx, myX, myY, null)
  }

  private drawOnlineRace(ctx: CanvasRenderingContext2D): void {
    const mid = this.w * 0.26
    const seats = this.racers.map((r) => r.seat)
    if (!seats.includes(this.mySeat) && this.mySeat) seats.push(this.mySeat)
    seats.sort((a, b) => a - b)
    const total = Math.max(1, seats.length)

    // 先画别人,自己最后盖在上面
    for (const seat of seats) {
      if (seat === this.mySeat) continue
      const r = this.racers.find((x) => x.seat === seat)
      const dist = r?.display ?? 0
      const pedal = r?.pedal ?? 0
      const lead = clamp((dist - this.displayDist) * 1.1, -100, 100)
      const x = mid + lead
      const y = this.laneY(seats.indexOf(seat), total)
      const style = SEAT_STYLE[(seat - 1) % SEAT_STYLE.length]
      drawBike(ctx, x, y, pedal, style.frame, style.helmet, 0.8)
      this.drawNameTag(ctx, x, y - 58, t('math.duel.seatLabel', { n: seat }), false)
    }

    const myLead = 0
    const myX = mid + myLead
    const myY = this.laneY(seats.indexOf(this.mySeat), total)
    const mine = SEAT_STYLE[(this.mySeat - 1) % SEAT_STYLE.length]
    drawBike(ctx, myX, myY, this.pedal, mine.frame, mine.helmet, 1)
    this.drawYouMarker(ctx, myX, myY, this.mySeat)
  }

  private laneY(index: number, total: number): number {
    const top = this.h * 0.42
    const bot = this.h * 0.62
    if (total <= 1) return (top + bot) / 2
    const i = Math.max(0, index)
    return top + ((bot - top) * i) / (total - 1)
  }

  private myBikeX(): number {
    return this.w * 0.26
  }

  private myBikeY(): number {
    if (this.opts.mode === 'ghost') return this.h * 0.58
    const seats = this.racers.map((r) => r.seat).sort((a, b) => a - b)
    if (!seats.includes(this.mySeat)) seats.push(this.mySeat)
    seats.sort((a, b) => a - b)
    return this.laneY(seats.indexOf(this.mySeat), Math.max(1, seats.length))
  }

  private drawNameTag(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    mine: boolean,
  ): void {
    ctx.font = mine ? 'bold 14px system-ui, sans-serif' : '13px system-ui, sans-serif'
    const padX = 10
    const w = Math.max(48, ctx.measureText(label).width + padX * 2)
    const h = 24
    ctx.fillStyle = mine ? 'rgba(45, 110, 255, 0.92)' : 'rgba(80, 50, 130, 0.75)'
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 10)
    ctx.fill()
    if (mine) {
      ctx.strokeStyle = 'rgba(255,220,120,0.95)'
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x, y + 0.5)
  }

  /** 自己:座位号 +「这是我」+ 箭头小旗 */
  private drawYouMarker(ctx: CanvasRenderingContext2D, bikeX: number, bikeY: number, seat: number | null): void {
    const tagY = bikeY - 78
    const label =
      seat && seat > 0
        ? `${t('math.duel.seatLabel', { n: seat })} · ${t('math.duel.youBadge')}`
        : t('math.duel.youBadge')
    this.drawNameTag(ctx, bikeX, tagY, label, true)

    ctx.fillStyle = '#ffd24a'
    ctx.beginPath()
    ctx.moveTo(bikeX, bikeY - 54)
    ctx.lineTo(bikeX - 7, bikeY - 64)
    ctx.lineTo(bikeX + 7, bikeY - 64)
    ctx.closePath()
    ctx.fill()

    const fx = bikeX - 34
    const fy = bikeY - 36
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(fx, fy + 22)
    ctx.lineTo(fx, fy)
    ctx.stroke()
    ctx.fillStyle = '#ff5a5a'
    ctx.beginPath()
    ctx.moveTo(fx, fy)
    ctx.lineTo(fx + 16, fy + 6)
    ctx.lineTo(fx, fy + 12)
    ctx.closePath()
    ctx.fill()
  }

  private drawCountdown(ctx: CanvasRenderingContext2D): void {
    const n = Math.ceil(this.countdownLeft)
    ctx.fillStyle = 'rgba(20,26,40,0.55)'
    roundRect(ctx, this.w / 2 - 80, this.h / 2 - 50, 160, 100, 16)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 48px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(n > 0 ? String(n) : 'GO!', this.w / 2, this.h / 2)
  }

  private drawHudPanel(ctx: CanvasRenderingContext2D): void {
    const urgent = this.phase !== 'countdown' && this.timeLeft <= 5
    ctx.fillStyle = urgent ? 'rgba(180,40,40,0.55)' : 'rgba(20,26,40,0.55)'
    roundRect(ctx, this.w / 2 - 140, 72, 280, 52, 12)
    ctx.fill()
    ctx.fillStyle = urgent ? '#ffd0d0' : '#fff'
    ctx.font = 'bold 18px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const clock = this.phase === 'countdown' ? '…' : `${this.timeLeft.toFixed(1)}s`
    ctx.fillText(`⏱ ${clock}`, this.w / 2, 88)
    ctx.font = 'bold 14px system-ui, sans-serif'
    ctx.fillStyle = '#ffd24a'
    if (this.opts.mode === 'online' && this.mySeat) {
      ctx.fillText(
        `${t('math.duel.seatLabel', { n: this.mySeat })} ${Math.round(this.displayDist)}m`,
        this.w / 2 - 70,
        110,
      )
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = '14px system-ui, sans-serif'
      ctx.fillText(`· ${t('math.duel.leader')} ${Math.round(this.displayRival)}m`, this.w / 2 + 70, 110)
    } else {
      ctx.fillText(`${t('math.duel.youBadge')} ${Math.round(this.displayDist)}m`, this.w / 2 - 58, 110)
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = '14px system-ui, sans-serif'
      ctx.fillText(`·  ${t('math.duel.rivalGhost')} ${Math.round(this.displayRival)}m`, this.w / 2 + 52, 110)
    }
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
      ctx.font = 'bold 22px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(c.value), c.x, c.y + 1)
    }
  }
}
