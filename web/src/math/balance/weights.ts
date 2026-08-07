/** 托盘里的勇士战力。用 1/2/5 能凑出 2–10 的任意目标。 */
export const WEIGHT_VALUES = [1, 2, 5] as const
export type WeightValue = (typeof WEIGHT_VALUES)[number]

/** 每种勇士起始给多少个。10 全用 1 也就 10 个,再多一点容错。 */
export const TRAY_STOCK: Record<WeightValue, number> = { 1: 12, 2: 6, 5: 4 }

/**
 * 用 1/2/5 凑出 n 的最少人数(贪心:能用 5 就用 5)。
 * 效率奖励拿这个当参照。
 */
export function minPieces(n: number): number {
  let left = n
  let count = 0
  for (const v of [5, 2, 1] as const) {
    const k = Math.floor(left / v)
    count += k
    left -= k * v
  }
  return count
}

export const BALANCE_GAME = {
  baseScore: 100,
  /** 用到最优人数时的额外分 */
  efficiencyBonus: 50,
  comboBonus: 25,
  /** 合成 → 飞砍 → 倒下,整段时长 */
  attackDuration: 1.35,
  /** 天平倾斜角度上限(弧度) */
  maxTilt: 0.28,
} as const
