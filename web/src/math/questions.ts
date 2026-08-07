import type { ViewId } from '../shell/routes'
import { randInt, shuffle } from '../utils/math'

export interface Question {
  /** 题面,不带等号,比如 "3 × 7"、"47 + 25" */
  text: string
  answer: number
  /** 三个选项,已经打乱 */
  choices: number[]
}

export interface QuizLevel {
  id: string
  name: string
  icon: string
  desc: string
  rounds: number
  build: () => Question[]
}

/** 数学页下面的一个计算游戏 */
export interface QuizGame {
  view: ViewId
  icon: string
  name: string
  /** 窄屏侧栏用的短名 */
  short: string
  desc: string
  levels: QuizLevel[]
}

const MULT_LEVELS: QuizLevel[] = [
  { id: 'math.mult.easy', name: '入门', icon: '🌱', desc: '1 到 5 的乘法', rounds: 12, build: () => multQuestions(1, 5, 12) },
  { id: 'math.mult.hard', name: '进阶', icon: '🔥', desc: '6 到 9 的乘法', rounds: 12, build: () => multQuestions(6, 9, 12) },
  { id: 'math.mult.all', name: '全表', icon: '🏆', desc: '整张九九乘法表', rounds: 15, build: () => multQuestions(1, 9, 15) },
]

const ADDSUB_LEVELS: QuizLevel[] = [
  { id: 'math.addsub.10', name: '入门', icon: '🌱', desc: '10 以内的加减', rounds: 12, build: () => addSubQuestions(10, 12) },
  { id: 'math.addsub.20', name: '进阶', icon: '🔥', desc: '20 以内的加减', rounds: 12, build: () => addSubQuestions(20, 12) },
  { id: 'math.addsub.100', name: '挑战', icon: '🏆', desc: '100 以内的加减', rounds: 15, build: () => addSubQuestions(100, 15) },
]

export const GAMES: QuizGame[] = [
  { view: 'math/mult', icon: '✖️', name: '九九乘法', short: '乘法', desc: '1 到 9 的乘法表', levels: MULT_LEVELS },
  { view: 'math/addsub', icon: '➕', name: '加减法', short: '加减', desc: '100 以内的加减法', levels: ADDSUB_LEVELS },
]

export function gameByView(view: ViewId): QuizGame | undefined {
  return GAMES.find((g) => g.view === view)
}

// ---------- 乘法 ----------

/** 同一关里尽量不出重复的算式,词不够就循环取 */
function multQuestions(from: number, to: number, rounds: number): Question[] {
  const pool: [number, number][] = []
  for (let a = from; a <= to; a++) {
    for (let b = from; b <= to; b++) pool.push([a, b])
  }

  let picks = shuffle(pool)
  while (picks.length < rounds) picks = picks.concat(shuffle(pool))

  // 上限给到 to 的下一档,不然 9 的邻居 (9+1)×9 会被当成越界扔掉
  const cap = to * (to + 1)
  return picks.slice(0, rounds).map(([a, b]) => {
    const answer = a * b
    // 背错行的典型错误:差一个乘数、乘错一档
    const near = [answer + a, answer - a, answer + b, answer - b, (a + 1) * b, (a - 1) * b, a * (b + 1), a * (b - 1)]
    return question(`${a} × ${b}`, answer, near, cap)
  })
}

// ---------- 加减 ----------

function addSubQuestions(max: number, rounds: number): Question[] {
  const out: Question[] = []
  const seen = new Set<string>()

  // 10 以内可选的算式本来就不多,加个上限免得凑不满时空转
  for (let guard = 0; out.length < rounds && guard < rounds * 40; guard++) {
    const q = Math.random() < 0.5 ? addition(max) : subtraction(max)
    if (seen.has(q.text)) continue
    seen.add(q.text)
    out.push(q)
  }
  while (out.length < rounds) out.push(addition(max))
  return out
}

function addition(max: number): Question {
  // 先定和再拆,这样各档大小的和出现得均匀些
  const sum = randInt(2, max)
  const a = randInt(1, sum - 1)
  return question(`${a} + ${sum - a}`, sum, nearbyDeltas(max, sum), max)
}

function subtraction(max: number): Question {
  // 被减数不小于减数,不出负数
  const a = randInt(2, max)
  const b = randInt(1, a - 1)
  return question(`${a} − ${b}`, a - b, nearbyDeltas(max, a - b), max)
}

/** 数错一两个,或者进位借位漏了一整个十 */
function nearbyDeltas(max: number, answer: number): number[] {
  const deltas = max >= 20 ? [1, -1, 2, -2, 10, -10] : [1, -1, 2, -2, 3, -3]
  return shuffle(deltas).map((d) => answer + d)
}

// ---------- 公用 ----------

function question(text: string, answer: number, near: number[], cap: number): Question {
  return { text, answer, choices: shuffle([answer, ...distractors(answer, near, cap)]) }
}

/**
 * 干扰项要贴着正确答案,不然一眼就能排除、题目就白出了。
 * 候选不够(比如 1×1 的邻居几乎都是 0 和 2)就从答案往两边一格格找。
 */
function distractors(answer: number, near: number[], cap: number): number[] {
  const out: number[] = []
  const take = (n: number): boolean => {
    if (n > 0 && n <= cap && n !== answer && !out.includes(n)) out.push(n)
    return out.length === 2
  }

  for (const n of shuffle(near)) if (take(n)) return out
  for (let d = 1; d <= cap; d++) {
    if (take(answer + d) || take(answer - d)) return out
  }
  return out
}
