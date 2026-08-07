import type { WeightValue } from './weights'

const cache = new Map<string, HTMLCanvasElement>()

/**
 * 持剑勇士。胸口白牌 + 大数字是主视觉,
 * 头/剑/腿只做点缀,别抢数字的戏。
 */
export function warriorSprite(value: WeightValue, big = false): HTMLCanvasElement {
  const key = `v6-${value}-${big ? 'hero' : 'n'}`
  const hit = cache.get(key)
  if (hit) return hit

  const size = big ? 168 : 104
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  drawWarrior(c.getContext('2d')!, size, value, big)
  cache.set(key, c)
  return c
}

function drawWarrior(ctx: CanvasRenderingContext2D, size: number, value: WeightValue, big: boolean): void {
  const s = size / 104
  ctx.save()
  ctx.scale(s, s)

  const hues: Record<WeightValue, number> = { 1: 210, 2: 145, 5: 38 }
  const hue = big ? 48 : hues[value]
  const cx = 52
  // 胸口牌往上挪,别落在肚子/脚附近
  const chestY = 48

  // 剑(右侧斜插,不挡胸口)
  ctx.save()
  ctx.translate(80, 30)
  ctx.rotate(-0.55)
  ctx.fillStyle = '#d7e0f0'
  ctx.fillRect(-4, -34, 8, 54)
  ctx.fillStyle = '#9aa8c0'
  ctx.beginPath()
  ctx.moveTo(-4, -34)
  ctx.lineTo(0, -44)
  ctx.lineTo(4, -34)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#8b5a2b'
  ctx.fillRect(-11, 16, 22, 6)
  ctx.fillStyle = '#e8c76a'
  ctx.beginPath()
  ctx.arc(0, 26, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // 腿(缩短,给胸口腾位置)
  ctx.strokeStyle = `hsl(${hue} 45% 28%)`
  ctx.lineWidth = 7
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - 12, 78)
  ctx.lineTo(cx - 16, 96)
  ctx.moveTo(cx + 12, 78)
  ctx.lineTo(cx + 16, 96)
  ctx.stroke()
  ctx.fillStyle = '#2c2118'
  ctx.beginPath()
  ctx.ellipse(cx - 16, 98, 10, 5, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + 16, 98, 10, 5, 0, 0, Math.PI * 2)
  ctx.fill()

  // 盔甲躯干
  const body = ctx.createLinearGradient(cx - 28, 28, cx + 28, 80)
  body.addColorStop(0, `hsl(${hue} 75% 58%)`)
  body.addColorStop(1, `hsl(${hue} 65% 34%)`)
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.roundRect(cx - 28, 28, 56, 52, 12)
  ctx.fill()

  // 肩甲
  ctx.fillStyle = `hsl(${hue} 55% 44%)`
  ctx.beginPath()
  ctx.ellipse(cx - 28, 36, 11, 8, -0.2, 0, Math.PI * 2)
  ctx.ellipse(cx + 28, 36, 11, 8, 0.2, 0, Math.PI * 2)
  ctx.fill()

  // 头
  ctx.fillStyle = '#f2d2b0'
  ctx.beginPath()
  ctx.arc(cx, 20, 13, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = `hsl(${hue} 60% 38%)`
  ctx.beginPath()
  ctx.arc(cx, 18, 14, Math.PI, 0)
  ctx.lineTo(cx + 14, 24)
  ctx.lineTo(cx - 14, 24)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = big ? '#e85d4c' : `hsl(${hue} 80% 55%)`
  ctx.beginPath()
  ctx.moveTo(cx, 2)
  ctx.quadraticCurveTo(cx + 11, 10, cx, 18)
  ctx.quadraticCurveTo(cx - 11, 10, cx, 2)
  ctx.fill()
  ctx.fillStyle = '#1a1a2e'
  ctx.beginPath()
  ctx.arc(cx - 5, 22, 2.2, 0, Math.PI * 2)
  ctx.arc(cx + 5, 22, 2.2, 0, Math.PI * 2)
  ctx.fill()

  // 胸口白牌
  const badgeR = 26
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(cx, chestY, badgeR, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = `hsl(${hue} 55% 26%)`
  ctx.lineWidth = 4
  ctx.stroke()

  ctx.fillStyle = '#1a1a2e'
  ctx.font = 'bold 44px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(value), cx, chestY + 1)

  ctx.restore()
}
