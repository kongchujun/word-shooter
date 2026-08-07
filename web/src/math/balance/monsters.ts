/**
 * 怪物立绘:优先加载 public 下的 SVG,失败就用离屏 canvas 现画一只。
 * 胸口数字由场景叠画,这里只管身体。
 */

const HUES = [12, 148, 212, 272, 38]
const cache = new Map<number, HTMLCanvasElement>()
const images: (HTMLImageElement | null)[] = []
let loadStarted = false

/** 进关前调一次,把 SVG 预热到缓存(失败也无所谓,会回退到手绘) */
export function preloadMonsters(): void {
  if (loadStarted) return
  loadStarted = true
  for (let i = 0; i < 5; i++) {
    const img = new Image()
    img.src = `/math/monsters/m${i + 1}.svg`
    img.onload = () => {
      images[i] = img
      // SVG 迟到时把手绘兜底踢掉,下一帧用真图
      cache.delete(i)
    }
    img.onerror = () => {
      images[i] = null
    }
  }
}

/** 返回一张可画的怪物 canvas。同一 index 复用。 */
export function monsterSprite(index: number): HTMLCanvasElement {
  const i = ((index % HUES.length) + HUES.length) % HUES.length
  const hit = cache.get(i)
  if (hit) return hit

  const size = 160
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const img = images[i]
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, 0, 0, size, size)
    cache.set(i, c)
  } else {
    drawFallback(ctx, size, HUES[i])
    // 手绘不进长期缓存:等 SVG 到了还能换
  }
  return c
}

/** 换关时清掉缓存 */
export function clearMonsterCache(): void {
  cache.clear()
}

function drawFallback(ctx: CanvasRenderingContext2D, size: number, hue: number): void {
  const cx = size / 2
  const cy = size / 2 + 6

  const body = ctx.createRadialGradient(cx - 18, cy - 24, 8, cx, cy, 70)
  body.addColorStop(0, `hsl(${hue} 85% 68%)`)
  body.addColorStop(1, `hsl(${hue} 70% 42%)`)
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.ellipse(cx, cy, 58, 52, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = `hsl(${hue} 75% 48%)`
  ctx.beginPath()
  ctx.moveTo(cx - 42, cy - 28)
  ctx.lineTo(cx - 58, cy - 62)
  ctx.lineTo(cx - 18, cy - 40)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx + 42, cy - 28)
  ctx.lineTo(cx + 58, cy - 62)
  ctx.lineTo(cx + 18, cy - 40)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.ellipse(cx - 18, cy - 8, 14, 16, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + 18, cy - 8, 14, 16, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1a1a2e'
  ctx.beginPath()
  ctx.arc(cx - 16, cy - 6, 6, 0, Math.PI * 2)
  ctx.arc(cx + 20, cy - 6, 6, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#1a1a2e'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(cx, cy + 14, 16, 0.15 * Math.PI, 0.85 * Math.PI)
  ctx.stroke()

  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.beginPath()
  ctx.arc(cx, cy + 28, 22, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = `hsl(${hue} 60% 35%)`
  ctx.lineWidth = 3
  ctx.stroke()
}
