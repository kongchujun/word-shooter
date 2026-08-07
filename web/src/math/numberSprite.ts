const SIZE = 160
/** 靶子最大半径是 108,按 2 倍分辨率画够清晰了 */
const SCALE = 2

const cache = new Map<string, HTMLCanvasElement>()

/**
 * 把一个数字画成圆形靶面。Target 只认 drawImage 能画的东西,
 * 所以这里现场渲染一张离屏 canvas 当精灵用。
 */
export function numberSprite(value: number, hue: number): HTMLCanvasElement {
  const key = `${value}|${hue}`
  const hit = cache.get(key)
  if (hit) return hit

  const cv = document.createElement('canvas')
  cv.width = SIZE * SCALE
  cv.height = SIZE * SCALE
  const ctx = cv.getContext('2d')!
  ctx.scale(SCALE, SCALE)

  const c = SIZE / 2
  const r = c - 6

  const g = ctx.createLinearGradient(0, 0, 0, SIZE)
  g.addColorStop(0, `hsl(${hue} 70% 62%)`)
  g.addColorStop(1, `hsl(${hue} 62% 38%)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(c, c, r, 0, Math.PI * 2)
  ctx.fill()

  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.stroke()

  // 上半部一层高光,让球看着是立体的
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.beginPath()
  ctx.ellipse(c, c - r * 0.38, r * 0.66, r * 0.34, 0, 0, Math.PI * 2)
  ctx.fill()

  const text = String(value)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  // 两位数缩一档,免得撑出圆外
  ctx.font = `bold ${text.length > 2 ? 52 : text.length > 1 ? 64 : 78}px system-ui,-apple-system,"PingFang SC",sans-serif`
  ctx.lineWidth = 8
  ctx.strokeStyle = 'rgba(8,12,30,0.7)'
  ctx.strokeText(text, c, c + 2)
  ctx.fillStyle = '#fff'
  ctx.fillText(text, c, c + 2)

  cache.set(key, cv)
  return cv
}
