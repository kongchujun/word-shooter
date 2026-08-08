import { randInt, shuffle } from '../../utils/math'
import type { Question } from '../questions'

/**
 * 100 以内四则一题。乘除保证整除且积/被除数不超过 max。
 * 踩单车是限时刷题,每次现出,不预生成整卷。
 */
export function nextFourOps(max: number): Question {
  const roll = Math.random()
  if (roll < 0.3) return addition(max)
  if (roll < 0.55) return subtraction(max)
  if (roll < 0.8) return multiplication(max)
  return division(max)
}

function addition(max: number): Question {
  const sum = randInt(2, max)
  const a = randInt(1, sum - 1)
  const answer = sum
  return pack(`${a} + ${sum - a}`, answer, [answer + 1, answer - 1, answer + 2, answer - 2, a], max)
}

function subtraction(max: number): Question {
  const a = randInt(2, max)
  const b = randInt(1, a - 1)
  const answer = a - b
  return pack(`${a} − ${b}`, answer, [answer + 1, answer - 1, answer + 2, b, a - b + 10], max)
}

function multiplication(max: number): Question {
  // 积不超过 max
  const a = randInt(2, Math.min(12, Math.floor(Math.sqrt(max)) + 4))
  const bMax = Math.max(2, Math.floor(max / a))
  const b = randInt(2, Math.min(12, bMax))
  const answer = a * b
  return pack(`${a} × ${b}`, answer, [answer + a, answer - a, answer + b, (a + 1) * b, a * (b + 1)], max)
}

function division(max: number): Question {
  const divisor = randInt(2, Math.min(12, max))
  const quotient = randInt(2, Math.min(12, Math.floor(max / divisor)))
  const product = divisor * quotient
  return pack(
    `${product} ÷ ${divisor}`,
    quotient,
    [quotient + 1, quotient - 1, divisor, quotient + 2, product - divisor],
    Math.max(quotient + 5, 20),
  )
}

function pack(text: string, answer: number, near: number[], cap: number): Question {
  const wrong: number[] = []
  for (const n of shuffle(near)) {
    if (n > 0 && n <= cap && n !== answer && !wrong.includes(n)) wrong.push(n)
    if (wrong.length === 2) break
  }
  for (let d = 1; wrong.length < 2 && d <= cap; d++) {
    for (const n of [answer + d, answer - d]) {
      if (n > 0 && n <= cap && n !== answer && !wrong.includes(n)) wrong.push(n)
      if (wrong.length === 2) break
    }
  }
  return { text, answer, choices: shuffle([answer, ...wrong.slice(0, 2)]) }
}
