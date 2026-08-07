import type { QuizLevel } from './questions'

export interface QuizRecord {
  /** 题面,比如 "3 × 7" */
  text: string
  answer: number
  /** 玩家点的那个数,超时没点是 null */
  picked: number | null
  /** 这题花了多少毫秒,超时就是满时长 */
  ms: number
}

export interface QuizResult {
  level: QuizLevel
  records: QuizRecord[]
  score: number
  bestCombo: number
}
