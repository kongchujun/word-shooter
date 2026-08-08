/** 一条时间线上的采样:开局后经过的秒数 → 当时距离 */
export interface GhostSample {
  t: number
  dist: number
}

export interface GhostRun {
  /** 比如 bike.20 / bike.50 / bike.100 */
  key: string
  score: number
  samples: GhostSample[]
  recordedAt: number
}

const KEY = 'word-shooter.ghost.v1'

type Store = Record<string, GhostRun>

/** 踩单车「最强纪录」时间线,给双人对战的幽灵车用。 */
export const GhostStore = {
  keyForMax(max: number): string {
    return `bike.${max}`
  },

  get(key: string): GhostRun | undefined {
    return all()[key]
  },

  getForMax(max: number): GhostRun | undefined {
    return this.get(this.keyForMax(max))
  },

  /** 只有刷新纪录才覆盖时间线 */
  recordIfBest(key: string, score: number, samples: GhostSample[]): boolean {
    if (samples.length < 2 || score <= 0) return false
    const store = all()
    const prev = store[key]
    if (prev && score < prev.score) return false
    store[key] = {
      key,
      score,
      samples: compress(samples),
      recordedAt: Date.now(),
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(store))
    } catch {
      // 隐私模式写不了
    }
    return true
  },

  /** 按开局经过时间读幽灵距离 */
  distanceAt(run: GhostRun, elapsed: number): number {
    const s = run.samples
    if (!s.length) return 0
    if (elapsed <= s[0].t) return s[0].dist
    const last = s[s.length - 1]
    if (elapsed >= last.t) return last.dist
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]
      const b = s[i]
      if (elapsed <= b.t) {
        const u = (elapsed - a.t) / Math.max(1e-6, b.t - a.t)
        return a.dist + (b.dist - a.dist) * u
      }
    }
    return last.dist
  },
}

function all(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store
  } catch {
    return {}
  }
}

/** 最多留约 2 秒一个点,避免 localStorage 膨胀 */
function compress(samples: GhostSample[]): GhostSample[] {
  if (samples.length <= 20) return samples
  const out: GhostSample[] = [samples[0]]
  const step = Math.ceil(samples.length / 18)
  for (let i = step; i < samples.length - 1; i += step) out.push(samples[i])
  out.push(samples[samples.length - 1])
  return out
}
