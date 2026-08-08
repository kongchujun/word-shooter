import { t } from '../../i18n'
import { shuffle } from '../../utils/math'

export interface BalanceLevel {
  id: string
  name: string
  icon: string
  desc: string
  rounds: number
  min: number
  max: number
  /** 本关每只怪胸口的目标重量 */
  build: () => number[]
}

/** 每关最多 5 只,别拖太长 */
export function BALANCE_LEVELS(): BalanceLevel[] {
  return [
    { id: 'math.balance.easy', name: t('math.diff.easy'), icon: '🌱', desc: t('math.desc.balance.easy'), rounds: 5, min: 2, max: 4, build: () => targets(2, 4, 5) },
    { id: 'math.balance.mid', name: t('math.diff.hard'), icon: '🔥', desc: t('math.desc.balance.mid'), rounds: 5, min: 2, max: 7, build: () => targets(2, 7, 5) },
    { id: 'math.balance.hard', name: t('math.diff.challenge'), icon: '🏆', desc: t('math.desc.balance.hard'), rounds: 5, min: 2, max: 10, build: () => targets(2, 10, 5) },
  ]
}

/** 尽量打散,同一关里少连着出同一个数 */
function targets(min: number, max: number, rounds: number): number[] {
  const pool: number[] = []
  for (let n = min; n <= max; n++) pool.push(n)
  let picks = shuffle(pool)
  while (picks.length < rounds) picks = picks.concat(shuffle(pool))
  return picks.slice(0, rounds)
}
