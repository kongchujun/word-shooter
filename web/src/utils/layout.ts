import { BALANCE } from '../config/balance'
import { clamp, rand } from './math'

export interface Slot {
  x: number
  y: number
  r: number
}

/**
 * 网格分格 + 小幅抖动,保证靶子不重叠。
 * top / bottom 是要空出来的上下留白:顶上给 HUD,底下给题干之类的东西。
 */
export function gridSlots(n: number, w: number, h: number, top: number, bottom: number): Slot[] {
  if (n <= 0) return []

  const areaH = Math.max(120, h - top - bottom)
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * w) / areaH)) || 1))
  const rows = Math.ceil(n / cols)
  const cellW = w / cols
  const cellH = areaH / rows
  const r = clamp(Math.min(cellW, cellH) * 0.34, BALANCE.targetRadiusMin, BALANCE.targetRadiusMax)

  const slots: Slot[] = []
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const inRow = Math.min(cols, n - row * cols)
    const offset = (w - inRow * cellW) / 2
    const jx = rand(-cellW * 0.08, cellW * 0.08)
    const jy = rand(-cellH * 0.1, cellH * 0.1)
    slots.push({
      x: clamp(offset + (col + 0.5) * cellW + jx, r + 8, w - r - 8),
      y: clamp(top + (row + 0.5) * cellH + jy, top + r * 0.6, h - bottom - r * 0.6),
      r,
    })
  }
  return slots
}
