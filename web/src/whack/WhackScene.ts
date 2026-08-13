import { BALANCE } from '../config/balance'
import type { Engine, Scene } from '../core/Engine'
import { ParticleSystem } from '../entities/Particle'
import { t } from '../i18n'
import { Background } from '../render/Background'
import type { HUD } from '../ui/HUD'
import { clamp, hashHue, rand, shuffle } from '../utils/math'
import { drawMole, drawPit, drawRim, Field, Hammer, roundRect } from './draw'
import type { Mole, WhackGame, WhackLevel } from './sets'
import { WHACK } from './timing'
import { moleWord, type WhackRecord, type WhackResult } from './types'

type Phase = 'ready' | 'listening' | 'feedback'

interface Hole {
  mole: Mole
  x: number
  y: number
  r: number
  /** 当前冒头高度 0~1 */
  up: number
  /** 想去的高度,0 或 1 */
  want: number
  /** 距离下一次自主起落还有多少秒 */
  timer: number
  /** 挨打后的晕眩剩余秒数 */
  dizzy: number
  /** 打错时的红闪 */
  flash: number
  /** 眨眼和呼吸的相位,每只错开 */
  seed: number
}

/**
 * 一题 = 播一个英文词 → 在固定的洞位里找到写着对应标签的那只地鼠 → 抡锤子打它。
 *
 * 和单词射击一样打错不结束这一题:红闪 + 自动重播,让孩子改对为止。
 * 地鼠的洞位整局不变(1 号永远在左上),孩子记的是"听到 seven 去中间那排最右",
 * 每题重排会把这条空间线索毁掉,所以位置只在窗口尺寸变化时重算。
 */
export class WhackScene implements Scene {
  private bg = new Background()
  private field = new Field()
  private particles = new ParticleSystem()
  private hammer = new Hammer()
  private holes: Hole[] = []

  private queue: Mole[] = []
  private records: WhackRecord[] = []
  private current: Hole | null = null

  private phase: Phase = 'ready'
  private phaseT = 0
  private time = 0
  private spoken = false
  private listenStart = 0
  private waited = 0
  private replayTimer = 0

  private roundIndex = 0
  private misses = 0
  private combo = 0
  private bestCombo = 0
  private score = 0
  /** 打中后浮起来的英文词 */
  private banner: { en: string; label: string; x: number; y: number; t: number } | null = null

  constructor(
    private engine: Engine,
    private hud: HUD,
    readonly game: WhackGame,
    readonly level: WhackLevel,
    /** 有真人发音的词:id → mp3 地址,没列进来的走 TTS */
    private voices: ReadonlyMap<string, string>,
    private onFinish: (result: WhackResult) => void,
  ) {
    this.holes = game.moles.map((mole) => ({
      mole,
      x: 0,
      y: 0,
      r: 40,
      up: 0,
      want: 0,
      timer: rand(0.2, 1.6),
      dizzy: 0,
      flash: 0,
      seed: rand(0, Math.PI * 2),
    }))
  }

  start(): void {
    this.onResize(this.engine.width, this.engine.height)
    let q: Mole[] = []
    while (q.length < this.level.rounds) q = q.concat(shuffle(this.game.moles))
    this.queue = q.slice(0, this.level.rounds)
    this.startRound()
  }

  exit(): void {
    window.clearTimeout(this.replayTimer)
    this.engine.audio.stopVoice()
    this.particles.clear()
  }

  onResize(w: number, h: number): void {
    this.bg.resize(w, h)
    // 星空只留上面一条,下面全是草地,洞挖在草地上
    const horizon = clamp(h * 0.26, 90, 200)
    this.field.resize(w, h, horizon)

    const n = this.holes.length
    const cols = colsFor(n, w, h)
    const rows = Math.ceil(n / cols)
    const top = Math.max(WHACK.padTop, horizon + 20)
    const areaW = Math.max(200, w - 40)
    const areaH = Math.max(150, h - top - WHACK.padBottom)

    // 先按能塞下的最大尺寸定洞的半径,再按半径排间距。
    // 反过来(先均分格子)在宽屏上会把三个洞甩到屏幕两边,中间空一大片。
    const r = clamp(Math.min(areaW / (cols * 2.5), areaH / (rows * 2.15)), WHACK.holeRadiusMin, WHACK.holeRadiusMax)
    const gapX = r * 2.5
    const gapY = r * 2.15
    // 竖直方向居中,再整体下压一点点 —— 地鼠是往上冒的,洞居中的话画面重心会偏高
    const slack = Math.max(0, (areaH - (rows - 1) * gapY) / 2)
    const startY = top + Math.max(r * 0.9, slack + Math.min(r * 0.35, slack))

    this.holes.forEach((hole, i) => {
      const row = Math.floor(i / cols)
      const col = i % cols
      // 最后一行不满时居中,免得孤零零挂在左边
      const inRow = Math.min(cols, n - row * cols)
      hole.x = w / 2 + (col - (inRow - 1) / 2) * gapX
      hole.y = startY + row * gapY
      hole.r = r
    })
  }

  /** 仅调试用:列出洞位和当前哪只是答案 */
  debugHoles(): { label: string; en: string; x: number; y: number; correct: boolean }[] {
    return this.holes.map((h) => ({
      label: h.mole.label,
      en: h.mole.en,
      x: Math.round(h.x),
      y: Math.round(h.y),
      correct: h === this.current,
    }))
  }

  /** HUD 上的 🔊,以及点屏幕下方那条提示条 */
  replayAudio(): void {
    if (!this.current || this.phase === 'feedback') return
    this.engine.audio.speak(this.wordOf(this.current.mole))
  }

  private wordOf(mole: Mole) {
    return moleWord(mole, this.voices.get(mole.id))
  }

  // ---------- 回合 ----------

  private startRound(): void {
    const mole = this.queue[this.roundIndex]
    const target = this.holes.find((h) => h.mole.id === mole.id)!

    // 开局这一批一起冒:只让正确答案先探头的话,不用听音、看谁先出来就赢了。
    // 之后干扰鼠各自起落,正确的那只一直留在外面(等它缩回去孩子就没法作答了)。
    const openWith = new Set(shuffle(this.holes.filter((h) => h !== target)).slice(0, this.level.busy))
    openWith.add(target)

    for (const h of this.holes) {
      h.want = openWith.has(h) ? 1 : 0
      h.dizzy = 0
      h.flash = 0
      h.timer = h.want > 0 ? rand(WHACK.distractorUp[0], WHACK.distractorUp[1]) : rand(0.3, 1.4)
    }

    this.current = target
    this.phase = 'ready'
    this.phaseT = 0
    this.spoken = false
    this.listenStart = 0
    this.waited = 0
    this.misses = 0
    this.banner = null
    this.hud.setRound(this.roundIndex + 1, this.level.rounds)
  }

  private nextRound(): void {
    this.roundIndex++
    if (this.roundIndex >= this.level.rounds) {
      this.engine.audio.playSfx('levelup')
      this.onFinish({
        game: this.game,
        level: this.level,
        records: this.records,
        score: this.score,
        bestCombo: this.bestCombo,
      })
      return
    }
    this.startRound()
  }

  // ---------- 输入 ----------

  onPointerMove(x: number, y: number): void {
    this.hammer.move(x, y)
  }

  onPointerDown(x: number, y: number): void {
    this.hammer.move(x, y)
    this.hammer.hit()
    if (this.phase === 'feedback' || !this.current) return

    // 下面那条提示条是个大号的"再听一遍",给手指点的
    const bar = this.promptRect()
    if (y >= bar.y) {
      this.replayAudio()
      return
    }

    const hit = this.moleAt(x, y)
    if (!hit) {
      this.engine.audio.playSfx('blank')
      return
    }
    if (hit === this.current) this.onCorrect(hit)
    else this.onWrong(hit)
  }

  /**
   * 敲到哪只。缩在洞里和正晕着的都敲不着。
   *
   * 判定范围比身体略大一圈(擦边也算,给孩子放宽),范围会跟着冒头高度往上挪。
   * 两只挨着的判定区可能叠一点点,所以取归一化距离最近的那只,而不是数组里第一个 ——
   * 不然点在下面那只头上,可能被上一行的洞抢走。
   */
  private moleAt(x: number, y: number): Hole | null {
    let best: Hole | null = null
    let bestD = 1
    for (const h of this.holes) {
      if (h.up < 0.2 || h.dizzy > 0) continue
      const dx = (x - h.x) / (h.r * 1.05)
      const dy = (y - (h.y - h.r * 0.6 * h.up)) / (h.r * 1.15)
      const d = dx * dx + dy * dy
      if (d <= bestD) {
        best = h
        bestD = d
      }
    }
    return best
  }

  private onCorrect(h: Hole): void {
    window.clearTimeout(this.replayTimer)
    this.engine.audio.stopVoice()
    this.engine.audio.playSfx('hit')

    h.dizzy = WHACK.dizzyDuration
    h.flash = 0
    for (const o of this.holes) if (o !== h) o.want = 0
    this.particles.burst(h.x, h.y - h.r * 0.6, hashHue(h.mole.id), WHACK.particleCount)

    const reactionMs = this.listenStart ? performance.now() - this.listenStart : 0
    const speedBonus =
      this.misses === 0
        ? Math.round(BALANCE.speedBonusMax * clamp(1 - reactionMs / BALANCE.speedBonusWindowMs, 0, 1))
        : 0

    // 打错过的这一题不算进连击,连击 = 连续几题一次命中
    this.combo = this.misses === 0 ? this.combo + 1 : 0
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    this.score += BALANCE.baseScore + this.combo * BALANCE.comboBonus + speedBonus
    this.records.push({ mole: h.mole, misses: this.misses, reactionMs })

    // 浮在地鼠头顶上方,别压住刚打中的那只
    this.banner = { en: h.mole.en, label: h.mole.label, x: h.x, y: h.y - h.r * 1.9, t: 0 }
    this.hud.setScore(this.score)
    this.hud.setCombo(this.combo)
    this.phase = 'feedback'
    this.phaseT = 0
  }

  private onWrong(h: Hole): void {
    this.engine.audio.playSfx('miss')
    h.flash = 1
    h.dizzy = WHACK.dizzyDuration * 0.7
    h.want = 0
    h.timer = rand(1.2, 2.4)

    this.misses++
    this.combo = 0
    this.score = Math.max(0, this.score - BALANCE.missPenalty)
    this.hud.setScore(this.score)
    this.hud.setCombo(0)

    // 打错自动重播一遍,不用他自己去点喇叭
    window.clearTimeout(this.replayTimer)
    this.replayTimer = window.setTimeout(() => this.replayAudio(), WHACK.replayDelay * 1000)
  }

  // ---------- 循环 ----------

  update(dt: number): void {
    this.time += dt
    this.bg.update(dt)
    this.hammer.update(dt)
    this.particles.update(dt)
    if (this.banner) this.banner.t += dt

    for (const h of this.holes) {
      const speed = h.want > h.up ? WHACK.riseSpeed : WHACK.duckSpeed
      h.up = clamp(h.up + Math.sign(h.want - h.up) * speed * dt, 0, 1)
      h.dizzy = Math.max(0, h.dizzy - dt)
      h.flash = Math.max(0, h.flash - dt * 2.5)
    }
    if (this.phase !== 'feedback') this.tickDistractors(dt)

    this.phaseT += dt
    if (this.phase === 'ready') {
      if (!this.spoken && this.phaseT >= WHACK.speakDelay) {
        this.spoken = true
        const target = this.current!
        this.engine.audio.speak(this.wordOf(target.mole), () => {
          // 语音播完才开始计反应时间
          if (this.current === target && this.phase === 'ready') {
            this.phase = 'listening'
            this.phaseT = 0
            this.listenStart = performance.now()
          }
        })
      }
    } else if (this.phase === 'listening') {
      this.waited += dt
    } else if (this.phase === 'feedback') {
      // 晕头转向地站一会儿再缩回去,让孩子看清打中的是哪只
      if (this.phaseT >= 0.6 && this.current) this.current.want = 0
      if (this.phaseT >= WHACK.feedbackDuration) this.nextRound()
    }
  }

  /** 干扰地鼠各自起落。同屏冒头的只数由难度的 busy 卡着,不然满屏都是头 */
  private tickDistractors(dt: number): void {
    let upCount = 0
    for (const h of this.holes) if (h !== this.current && h.want > 0) upCount++

    for (const h of this.holes) {
      if (h === this.current || h.dizzy > 0) continue
      h.timer -= dt * this.level.speed
      if (h.timer > 0) continue
      if (h.want > 0) {
        h.want = 0
        h.timer = rand(WHACK.distractorDown[0], WHACK.distractorDown[1])
      } else if (upCount < this.level.busy) {
        h.want = 1
        upCount++
        h.timer = rand(WHACK.distractorUp[0], WHACK.distractorUp[1])
      } else {
        // 位置满了,过一会儿再来碰运气
        h.timer = rand(0.2, 0.7)
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const h = this.engine.height
    this.bg.draw(ctx)
    this.field.draw(ctx, h)

    // 洞坑 → 地鼠 → 前沿土堆,顺序不能换:土堆负责挡住地鼠下半身
    // 靠后的洞先画,前排才会压住后排
    for (const hole of this.holes) drawPit(ctx, hole.x, hole.y, hole.r)
    for (const hole of this.holes) {
      drawMole(ctx, {
        x: hole.x,
        y: hole.y,
        r: hole.r,
        up: hole.up,
        label: hole.mole.label,
        dizzy: hole.dizzy,
        flash: hole.flash,
        hint: hole === this.current ? this.hintLevel() : 0,
        seed: hole.seed,
        time: this.time,
      })
      drawRim(ctx, hole.x, hole.y, hole.r)
    }

    this.particles.draw(ctx)
    this.drawPrompt(ctx)
    this.drawBanner(ctx)
    this.hammer.draw(ctx, clamp((this.holes[0]?.r ?? 60) / 58, 0.85, 1.7))
  }

  /** 半天没打对就给正确的那只加一圈呼吸光,别让孩子卡死在一题上 */
  private hintLevel(): number {
    if (this.phase !== 'listening') return 0
    const k = clamp((this.waited - WHACK.hintAfter) / 1.5, 0, 1)
    return k * (0.65 + 0.35 * Math.sin(this.time * 4))
  }

  private promptRect(): { x: number; y: number; w: number; h: number } {
    const w = this.engine.width
    const boxW = Math.min(420, w - 32)
    const boxH = 84
    return { x: (w - boxW) / 2, y: this.engine.height - boxH - 18, w: boxW, h: boxH }
  }

  /** 屏幕下方的提示条:没答出来时是个大喇叭,点一下重听;答对了亮出这个词 */
  private drawPrompt(ctx: CanvasRenderingContext2D): void {
    const done = this.phase === 'feedback' && this.banner
    const box = this.promptRect()

    ctx.save()
    ctx.fillStyle = 'rgba(8,16,12,0.82)'
    roundRect(ctx, box.x, box.y, box.w, box.h, 18)
    ctx.fill()
    ctx.strokeStyle = done ? 'rgba(255,215,106,0.5)' : 'rgba(255,255,255,0.14)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const cx = box.x + box.w / 2
    if (done && this.banner) {
      ctx.font = 'bold 30px system-ui,-apple-system,"PingFang SC",sans-serif'
      ctx.fillStyle = '#fff'
      ctx.fillText(this.banner.en, cx, box.y + 32)
      ctx.font = 'bold 20px system-ui,-apple-system,"PingFang SC",sans-serif'
      ctx.fillStyle = '#ffd76a'
      ctx.fillText(this.banner.label, cx, box.y + 62)
    } else {
      ctx.font = '30px system-ui,-apple-system,"PingFang SC",sans-serif'
      ctx.fillStyle = '#fff'
      ctx.fillText('🔊', cx - 58, box.y + 40)
      ctx.font = 'bold 20px system-ui,-apple-system,"PingFang SC",sans-serif'
      ctx.fillStyle = '#cfe6d6'
      ctx.fillText(t('whack.prompt.replay'), cx + 24, box.y + 32)
      ctx.font = '14px system-ui,-apple-system,"PingFang SC",sans-serif'
      ctx.fillStyle = '#8fb39c'
      ctx.fillText(t('whack.prompt.hint'), cx + 24, box.y + 58)
    }
    ctx.restore()
  }

  /** 打中的那只头顶浮起来的英文词 */
  private drawBanner(ctx: CanvasRenderingContext2D): void {
    const b = this.banner
    if (!b) return
    const p = clamp(b.t / WHACK.feedbackDuration, 0, 1)
    const y = Math.max(120, b.y - p * 40)
    const x = clamp(b.x, 120, this.engine.width - 120)

    ctx.save()
    ctx.globalAlpha = 1 - Math.max(0, (p - 0.7) / 0.3)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.font = 'bold 50px system-ui,-apple-system,"PingFang SC",sans-serif'
    ctx.lineWidth = 9
    ctx.strokeStyle = 'rgba(6,16,10,0.85)'
    ctx.strokeText(b.en, x, y)
    ctx.fillStyle = '#fff'
    ctx.fillText(b.en, x, y)
    ctx.restore()
  }
}

/**
 * 每行几个洞。竖屏少放一列,不然手机上洞挤成一条缝。
 * 只跟数量和屏幕比例有关 —— 同一块屏幕上算出来的结果整局都一样。
 */
function colsFor(n: number, w: number, h: number): number {
  if (n <= 4) return n
  const portrait = h >= w
  if (n <= 6) return 3
  if (n === 7) return portrait ? 3 : 4
  if (n <= 9) return 3
  return portrait ? 3 : 4
}
