import { clamp, rand } from '../utils/math'

/** 一只地鼠画出来需要知道的全部状态,由 WhackScene 维护 */
export interface MoleView {
  x: number
  y: number
  r: number
  /** 0 = 完全缩在洞里,1 = 全身冒出来 */
  up: number
  label: string
  /** 挨打后的晕眩剩余秒数,>0 时画 X 眼和转圈的星星 */
  dizzy: number
  /** 打错时的红闪 0~1 */
  flash: number
  /** 提示光圈的强度 0~1 */
  hint: number
  /** 每只错开眨眼和呼吸的相位 */
  seed: number
  /** 场景累计时间,用来驱动眨眼 */
  time: number
}

const FONT = 'system-ui,-apple-system,"PingFang SC",sans-serif'

/**
 * 草地。星空背景是共用的,这里只在下半屏铺一层月光草坪,
 * 让洞看着是挖在地上的而不是浮在夜空里。草丛位置只在 resize 时算一次。
 */
export class Field {
  private tufts: { x: number; y: number; s: number }[] = []
  private w = 0
  private horizon = 0

  resize(w: number, h: number, horizon: number): void {
    this.w = w
    this.horizon = horizon
    const count = Math.round((w * (h - horizon)) / 9000)
    this.tufts = Array.from({ length: count }, () => {
      const y = rand(horizon + 6, h)
      // 越靠下越近,草画得越大
      const depth = (y - horizon) / Math.max(1, h - horizon)
      return { x: rand(0, w), y, s: 4 + depth * 9 }
    })
  }

  draw(ctx: CanvasRenderingContext2D, h: number): void {
    const g = ctx.createLinearGradient(0, this.horizon, 0, h)
    g.addColorStop(0, '#1b3b2a')
    g.addColorStop(0.45, '#17311f')
    g.addColorStop(1, '#102318')
    ctx.fillStyle = g
    ctx.fillRect(0, this.horizon, this.w, h - this.horizon)

    // 地平线上一道淡光,把草地和远山分开
    ctx.fillStyle = 'rgba(150,220,170,0.16)'
    ctx.fillRect(0, this.horizon, this.w, 2)

    ctx.strokeStyle = 'rgba(110,190,130,0.22)'
    ctx.lineCap = 'round'
    for (const t of this.tufts) {
      ctx.lineWidth = t.s * 0.16
      ctx.beginPath()
      ctx.moveTo(t.x, t.y)
      ctx.quadraticCurveTo(t.x - t.s * 0.3, t.y - t.s * 0.6, t.x - t.s * 0.55, t.y - t.s)
      ctx.moveTo(t.x, t.y)
      ctx.quadraticCurveTo(t.x + t.s * 0.3, t.y - t.s * 0.6, t.x + t.s * 0.5, t.y - t.s * 0.9)
      ctx.stroke()
    }
  }
}

/** 洞口本身:一个椭圆坑,地鼠从这里面升上来 */
export function drawPit(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r * 1.05)
  g.addColorStop(0, '#06100b')
  g.addColorStop(1, '#0d1c13')
  ctx.fillStyle = g
  ellipse(ctx, x, y, r * 1.02, r * 0.4)
  ctx.fill()
}

/**
 * 洞口前沿的土堆。必须在地鼠**之后**画 —— 它负责挡住地鼠的下半身,
 * 冒头的动作才像是从土里钻出来,而不是一张贴图上下平移。
 */
export function drawRim(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(x, y, r * 1.16, r * 0.5, 0, 0, Math.PI)
  ctx.closePath()
  const g = ctx.createLinearGradient(0, y, 0, y + r * 0.5)
  g.addColorStop(0, '#5a4326')
  g.addColorStop(1, '#332514')
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

/** 地鼠。坐标系原点是洞心,身体按洞的半径等比缩放 */
export function drawMole(ctx: CanvasRenderingContext2D, m: MoleView): void {
  const { x, y, r } = m
  if (m.up <= 0.001) return

  // 没冒头时整只沉在洞底,靠 clip 把地面以下的部分裁掉
  const dy = (1 - m.up) * r * 2.1
  const by = y - r * 0.62 + dy
  // 呼吸:轻微上下浮动,静止时不至于像贴图
  const breathe = Math.sin(m.time * 2.4 + m.seed) * r * 0.02 * m.up

  ctx.save()
  ctx.beginPath()
  ctx.rect(x - r * 1.6, y - r * 4.5, r * 3.2, r * 4.5 + r * 0.08)
  ctx.clip()
  ctx.translate(0, breathe)

  if (m.hint > 0) {
    const gl = ctx.createRadialGradient(x, by, r * 0.4, x, by, r * 1.9)
    gl.addColorStop(0, `rgba(255,226,120,${0.35 * m.hint})`)
    gl.addColorStop(1, 'rgba(255,226,120,0)')
    ctx.fillStyle = gl
    ctx.beginPath()
    ctx.arc(x, by, r * 1.9, 0, Math.PI * 2)
    ctx.fill()
  }

  // 耳朵
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#6b4a2c'
    ellipse(ctx, x + s * r * 0.56, by - r * 0.6, r * 0.24, r * 0.24)
    ctx.fill()
    ctx.fillStyle = '#c4867a'
    ellipse(ctx, x + s * r * 0.56, by - r * 0.6, r * 0.12, r * 0.12)
    ctx.fill()
  }

  // 身体
  const body = ctx.createLinearGradient(0, by - r, 0, by + r)
  body.addColorStop(0, '#a9764a')
  body.addColorStop(1, '#6d4a2b')
  ctx.fillStyle = body
  ellipse(ctx, x, by, r * 0.74, r * 0.86)
  ctx.fill()

  drawFace(ctx, m, x, by)
  drawLabel(ctx, m.label, x, by + r * 0.28, r)

  if (m.flash > 0) {
    ctx.fillStyle = `rgba(255,70,70,${0.5 * m.flash})`
    ellipse(ctx, x, by, r * 0.74, r * 0.86)
    ctx.fill()
  }
  if (m.dizzy > 0) drawStars(ctx, x, by - r * 1.05, r, m.time)

  ctx.restore()
}

function drawFace(ctx: CanvasRenderingContext2D, m: MoleView, x: number, by: number): void {
  const r = m.r
  const ey = by - r * 0.5

  if (m.dizzy > 0) {
    // 晕了:眼睛画成 ×
    ctx.strokeStyle = '#2a1a0e'
    ctx.lineWidth = r * 0.07
    ctx.lineCap = 'round'
    for (const s of [-1, 1]) {
      const cx = x + s * r * 0.26
      const k = r * 0.1
      ctx.beginPath()
      ctx.moveTo(cx - k, ey - k)
      ctx.lineTo(cx + k, ey + k)
      ctx.moveTo(cx + k, ey - k)
      ctx.lineTo(cx - k, ey + k)
      ctx.stroke()
    }
  } else {
    // 每 3 秒左右眨一次,各只错开
    const blink = Math.sin(m.time * 1.7 + m.seed * 3) > 0.965 ? 0.12 : 1
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#fff'
      ellipse(ctx, x + s * r * 0.26, ey, r * 0.12, r * 0.12 * blink)
      ctx.fill()
      ctx.fillStyle = '#1d1108'
      ellipse(ctx, x + s * r * 0.26, ey, r * 0.062, r * 0.062 * blink)
      ctx.fill()
    }
  }

  // 鼻子 + 胡须
  ctx.fillStyle = '#d98a8a'
  ellipse(ctx, x, by - r * 0.26, r * 0.11, r * 0.085)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,240,225,0.5)'
  ctx.lineWidth = Math.max(1, r * 0.022)
  for (const s of [-1, 1]) {
    for (const k of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(x + s * r * 0.12, by - r * 0.24)
      ctx.lineTo(x + s * r * 0.62, by - r * 0.24 + k * r * 0.12)
      ctx.stroke()
    }
  }
}

/** 肚子上的号码牌。标签长短差很多("9" / "周三" / "12月"),字号按宽度自适应 */
function drawLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, r: number): void {
  ctx.fillStyle = '#f6e6c8'
  ellipse(ctx, x, y, r * 0.58, r * 0.44)
  ctx.fill()
  ctx.strokeStyle = 'rgba(90,60,30,0.35)'
  ctx.lineWidth = Math.max(1, r * 0.03)
  ctx.stroke()

  // 留出椭圆两侧的余量:"12月" / "Wed" 这种三个字的标签最宽
  const maxW = r * 0.88
  let size = r * 0.52
  ctx.font = `bold ${size}px ${FONT}`
  const w = ctx.measureText(label).width
  if (w > maxW) {
    size *= maxW / w
    ctx.font = `bold ${size}px ${FONT}`
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#4a2f13'
  ctx.fillText(label, x, y + size * 0.04)
}

/** 挨打之后头顶转圈的星星 */
function drawStars(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, time: number): void {
  ctx.save()
  ctx.fillStyle = '#ffd76a'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${r * 0.3}px ${FONT}`
  for (let i = 0; i < 3; i++) {
    const a = time * 5 + (i * Math.PI * 2) / 3
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(a)
    ctx.fillText('✦', x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.18)
  }
  ctx.restore()
}

/** 柄的倾角:平时往右上方斜着举,砸下去的那一帧几乎竖直 */
const REST_ANGLE = 0.62
const HIT_ANGLE = 0.12

/**
 * 跟着指针走的锤子,点一下抡一次。
 * 触屏上指针只在按下时才有位置,所以第一次点之前不画。
 */
export class Hammer {
  x = -999
  y = -999
  private swing = 0
  private visible = false

  move(x: number, y: number): void {
    this.x = x
    this.y = y
    this.visible = true
  }

  hit(): void {
    this.swing = 1
  }

  update(dt: number): void {
    this.swing = clamp(this.swing - dt * 3.4, 0, 1)
  }

  /** scale 跟着洞的大小走,大屏上别显得像个玩具 */
  draw(ctx: CanvasRenderingContext2D, scale = 1): void {
    if (!this.visible) return
    // 支点就是指针,锤面(锤头的下沿)始终压在指针上 —— 所见即所打。
    // 锤头朝下、柄往右上方伸,和判定点错开会直接变成"明明对准了却打不着"。
    const k = Math.sin(this.swing * Math.PI)
    const angle = REST_ANGLE + (HIT_ANGLE - REST_ANGLE) * k

    ctx.save()
    ctx.translate(this.x, this.y)
    ctx.rotate(angle)
    ctx.scale(scale, scale)
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 10

    // 木柄:从锤头上沿往上伸出去
    ctx.fillStyle = '#a97440'
    roundRect(ctx, -5, -96, 10, 74, 5)
    ctx.fill()
    // 锤头:下沿落在 y=0,也就是指针那一点
    ctx.shadowBlur = 0
    const g = ctx.createLinearGradient(-30, -30, 30, 0)
    g.addColorStop(0, '#e0e6f2')
    g.addColorStop(0.5, '#98a4bd')
    g.addColorStop(1, '#5f6b85')
    ctx.fillStyle = g
    roundRect(ctx, -30, -30, 60, 27, 7)
    ctx.fill()
    ctx.strokeStyle = 'rgba(20,26,44,0.55)'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
  }
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
}

/** 自己描圆角矩形:微信的老内核不一定有 ctx.roundRect */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
