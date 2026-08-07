import type { ViewId } from '../shell/routes'
import { BALANCE_LEVELS, type BalanceLevel } from './balance/levels'
import { randInt, shuffle } from '../utils/math'

export interface Question {
  /** 题面,不带等号,比如 "3 × 7"、"47 + 25" */
  text: string
  answer: number
  /** 三个选项,已经打乱 */
  choices: number[]
}

/** 难度卡上共用的字段 */
export interface LevelInfo {
  id: string
  name: string
  icon: string
  desc: string
  rounds: number
}

export interface QuizLevel extends LevelInfo {
  build: () => Question[]
}

interface GameBase {
  view: ViewId
  icon: string
  name: string
  /** 窄屏侧栏用的短名 */
  short: string
  desc: string
  /** 选难度页下面那句提示 */
  tip: string
}

export interface QuizGame extends GameBase {
  kind: 'quiz'
  levels: QuizLevel[]
}

export interface BalanceGame extends GameBase {
  kind: 'balance'
  levels: BalanceLevel[]
}

export type MathGame = QuizGame | BalanceGame

const MULT_LEVELS: QuizLevel[] = [
  { id: 'math.mult.easy', name: '入门', icon: '🌱', desc: '1 到 5 的乘除', rounds: 12, build: () => multDivQuestions(1, 5, 12) },
  { id: 'math.mult.hard', name: '进阶', icon: '🔥', desc: '6 到 9 的乘除', rounds: 12, build: () => multDivQuestions(6, 9, 12) },
  { id: 'math.mult.all', name: '全表', icon: '🏆', desc: '整张九九表的乘除', rounds: 15, build: () => multDivQuestions(1, 9, 15) },
]

const ADDSUB_LEVELS: QuizLevel[] = [
  { id: 'math.addsub.10', name: '入门', icon: '🌱', desc: '10 以内的加减', rounds: 12, build: () => addSubQuestions(10, 12) },
  { id: 'math.addsub.20', name: '进阶', icon: '🔥', desc: '20 以内的加减', rounds: 12, build: () => addSubQuestions(20, 12) },
  { id: 'math.addsub.100', name: '挑战', icon: '🏆', desc: '100 以内的加减', rounds: 15, build: () => addSubQuestions(100, 15) },
]

export const GAMES: MathGame[] = [
  {
    kind: 'quiz',
    view: 'math/mult',
    icon: '✖️',
    name: '九九乘除',
    short: '乘除',
    desc: '1 到 9 的乘法和除法',
    tip: '打掉正确答案,越快分越高',
    levels: MULT_LEVELS,
  },
  {
    kind: 'quiz',
    view: 'math/addsub',
    icon: '➕',
    name: '加减法',
    short: '加减',
    desc: '100 以内的加减法',
    tip: '打掉正确答案,越快分越高',
    levels: ADDSUB_LEVELS,
  },
  {
    kind: 'balance',
    view: 'math/balance',
    icon: '⚖️',
    name: '天平打怪',
    short: '天平',
    desc: '拖勇士凑平怪物',
    tip: '拖持剑勇士到左边,凑平就合成大英雄砍倒怪物',
    levels: BALANCE_LEVELS,
  },
]

export function gameByView(view: ViewId): MathGame | undefined {
  return GAMES.find((g) => g.view === view)
}

// ---------- 乘除(九九表) ----------

/**
 * 乘法和除法大约各一半,都从同一张九九表出题。
 * 除法用「积 ÷ 一个因数 = 另一个因数」,保证整除、答案仍在表内。
 */
function multDivQuestions(from: number, to: number, rounds: number): Question[] {
  const pool: [number, number][] = []
  for (let a = from; a <= to; a++) {
    for (let b = from; b <= to; b++) pool.push([a, b])
  }

  let picks = shuffle(pool)
  while (picks.length < rounds) picks = picks.concat(shuffle(pool))

  const seen = new Set<string>()
  const out: Question[] = []
  // 乘积上限给到 to 的下一档,不然邻居干扰项会被扔掉
  const productCap = to * (to + 1)

  for (const [a, b] of picks) {
    if (out.length >= rounds) break
    // 约一半出除法;入门里 ÷1 太水,优先用较大的那个当除数
    const wantDiv = Math.random() < 0.5
    const q = wantDiv ? divQuestion(a, b, to) : mulQuestion(a, b, productCap)
    if (seen.has(q.text)) continue
    seen.add(q.text)
    out.push(q)
  }

  // 去重后不够就补乘法
  for (const [a, b] of shuffle(pool)) {
    if (out.length >= rounds) break
    const q = mulQuestion(a, b, productCap)
    if (seen.has(q.text)) continue
    seen.add(q.text)
    out.push(q)
  }
  return out
}

function mulQuestion(a: number, b: number, cap: number): Question {
  const answer = a * b
  // 背错行的典型错误:差一个乘数、乘错一档
  const near = [answer + a, answer - a, answer + b, answer - b, (a + 1) * b, (a - 1) * b, a * (b + 1), a * (b - 1)]
  return question(`${a} × ${b}`, answer, near, cap)
}

function divQuestion(a: number, b: number, factorCap: number): Question {
  // 被除数 = 积,除数挑 a/b 里较大的,少出 ÷1
  let divisor = a
  let quotient = b
  if (b > a || (b === a && Math.random() < 0.5)) {
    divisor = b
    quotient = a
  }
  if (divisor === 1 && quotient > 1 && Math.random() < 0.7) {
    divisor = quotient
    quotient = 1
  }
  const product = a * b
  // 商的典型错法:除反了、差一档、当成减法
  const near = [
    quotient + 1,
    quotient - 1,
    quotient + 2,
    divisor,
    divisor + 1,
    divisor - 1,
    product - divisor,
    Math.max(1, quotient * 2 - divisor),
  ]
  return question(`${product} ÷ ${divisor}`, quotient, near, factorCap)
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
