import { FALLBACK_WORDS } from '../config/fallbackWords'
import type { Manifest, Sprite, Word } from '../types'
import { hashHue } from '../utils/math'

/** 占位靶子的绘制尺寸,足够 retina 上放大也不糊 */
const PLACEHOLDER_SIZE = 256

export class AssetLoader {
  private sprites = new Map<string, Sprite>()
  /** 有多少个词是拿占位图顶上的,菜单里提示一下 */
  placeholderCount = 0

  /**
   * 优先用后端扫描出来的词库;后端没起或返回空就退回内置 emoji 词库,
   * 保证前端单独 npm run dev 也能直接玩。
   */
  async loadManifest(): Promise<Manifest> {
    try {
      const res = await fetch('/api/words/manifest', { cache: 'no-cache' })
      if (res.ok) {
        const data = (await res.json()) as Manifest
        if (data.words?.length) return data
      }
    } catch {
      // 后端没起,走回退
    }
    console.info('[assets] 未取到后端词库,使用内置占位词库')
    return { words: FALLBACK_WORDS }
  }

  /** 逐个解码图片,失败的词自动换成占位图,不让一张坏图卡住整局 */
  async preloadImages(words: Word[], onProgress?: (done: number, total: number) => void): Promise<void> {
    this.placeholderCount = 0
    let done = 0
    for (const w of words) {
      let sprite: Sprite | null = null
      if (w.image) {
        sprite = await this.decodeImage(w.image)
        if (!sprite) console.warn(`[assets] 图片加载失败,用占位图代替: ${w.image}`)
      }
      if (!sprite) {
        sprite = makePlaceholder(w)
        this.placeholderCount++
      }
      this.sprites.set(w.id, sprite)
      onProgress?.(++done, words.length)
    }
  }

  get(wordId: string): Sprite | undefined {
    return this.sprites.get(wordId)
  }

  private async decodeImage(url: string): Promise<Sprite | null> {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      // createImageBitmap 提前解码,避免第一次 drawImage 掉帧
      const bmp = await createImageBitmap(await res.blob())
      // 默认的图片模型只出不透明 jpeg,直接画上去就是飘在夜空里的方块。
      // 四角不透明就当成有底色,裁成圆形靶子。
      if (!hasTransparentCorners(bmp)) {
        const circle = cropToCircle(bmp)
        bmp.close()
        return circle
      }
      return bmp
    } catch {
      return null
    }
  }
}

/** 圆形裁切后的画布尺寸。靶子最大直径约 216 CSS px,512 在 retina 上也够清晰。 */
const CIRCLE_SIZE = 512

/** 采样四角的 alpha 判断有没有抠过背景。全不透明就认为是带底色的图。 */
function hasTransparentCorners(bmp: ImageBitmap): boolean {
  const cv = document.createElement('canvas')
  cv.width = bmp.width
  cv.height = bmp.height
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return true
  ctx.drawImage(bmp, 0, 0)
  const corners: [number, number][] = [
    [0, 0],
    [bmp.width - 1, 0],
    [0, bmp.height - 1],
    [bmp.width - 1, bmp.height - 1],
  ]
  try {
    return corners.some(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] < 250)
  } catch {
    // 跨域图片会污染画布,读不了就当它是透明的,保持原样
    return true
  }
}

/** 居中裁成圆形,边上描一圈亮边,和内置占位靶子的样子保持一致 */
function cropToCircle(bmp: ImageBitmap): HTMLCanvasElement {
  const size = CIRCLE_SIZE
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const ctx = cv.getContext('2d')!
  const c = size / 2

  ctx.save()
  ctx.beginPath()
  ctx.arc(c, c, c - 4, 0, Math.PI * 2)
  ctx.clip()

  // 按短边等比铺满圆,不拉伸
  const scale = size / Math.min(bmp.width, bmp.height)
  const w = bmp.width * scale
  const h = bmp.height * scale
  ctx.drawImage(bmp, c - w / 2, c - h / 2, w, h)
  ctx.restore()

  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(c, c, c - 4, 0, Math.PI * 2)
  ctx.stroke()

  return cv
}

/** 用 emoji(没有就用首字母)画一个彩色圆形靶子 */
function makePlaceholder(word: Word): HTMLCanvasElement {
  const size = PLACEHOLDER_SIZE
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const ctx = cv.getContext('2d')!
  const hue = hashHue(word.id)
  const c = size / 2

  const grad = ctx.createRadialGradient(c, c * 0.7, size * 0.05, c, c, c)
  grad.addColorStop(0, `hsl(${hue} 85% 72%)`)
  grad.addColorStop(1, `hsl(${hue} 70% 44%)`)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(c, c, c - 6, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = `hsl(${hue} 90% 85%)`
  ctx.lineWidth = 6
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (word.emoji) {
    ctx.font = `${Math.round(size * 0.52)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
    ctx.fillText(word.emoji, c, c + size * 0.02)
  } else {
    ctx.font = `bold ${Math.round(size * 0.44)}px system-ui,sans-serif`
    ctx.fillStyle = '#fff'
    ctx.fillText(word.en.charAt(0).toUpperCase(), c, c)
  }
  return cv
}
