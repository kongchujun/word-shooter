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
export const BALANCE_LEVELS: BalanceLevel[] = [
  { id: 'math.balance.easy', name: '入门', icon: '🌱', desc: '2 到 4 的重量', rounds: 5, min: 2, max: 4, build: () => targets(2, 4, 5) },
  { id: 'math.balance.mid', name: '进阶', icon: '🔥', desc: '2 到 7 的重量', rounds: 5, min: 2, max: 7, build: () => targets(2, 7, 5) },
  { id: 'math.balance.hard', name: '挑战', icon: '🏆', desc: '2 到 10 的重量', rounds: 5, min: 2, max: 10, build: () => targets(2, 10, 5) },
]

/** 尽量打散,同一关里少连着出同一个数 */
function targets(min: number, max: number, rounds: number): number[] {
  const pool: number[] = []
  for (let n = min; n <= max; n++) pool.push(n)
  let picks = shuffle(pool)
  while (picks.length < rounds) picks = picks.concat(shuffle(pool))
  return picks.slice(0, rounds)
}
