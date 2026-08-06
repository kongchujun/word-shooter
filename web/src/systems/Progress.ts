const KEY = 'word-shooter.progress.v1'

export interface LevelProgress {
  best: number
  plays: number
  /** 最近一次的一次命中率 0~1 */
  accuracy: number
}

type Store = Record<string, LevelProgress>

/** 先存 localStorage。以后要做家长看的统计报表,再把这层换成后端接口。 */
export const Progress = {
  all(): Store {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store
    } catch {
      return {}
    }
  },

  get(levelId: string): LevelProgress | undefined {
    return this.all()[levelId]
  },

  record(levelId: string, score: number, accuracy: number): void {
    const store = this.all()
    const prev = store[levelId]
    store[levelId] = {
      best: Math.max(prev?.best ?? 0, score),
      plays: (prev?.plays ?? 0) + 1,
      accuracy,
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(store))
    } catch {
      // 隐私模式下写不了,忽略
    }
  },
}
