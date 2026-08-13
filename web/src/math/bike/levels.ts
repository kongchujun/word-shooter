import { t } from '../../i18n'
import type { Question } from '../questions'
import { nextFourOps } from './questions'

export interface BikeLevel {
  id: string
  name: string
  icon: string
  desc: string
  /** 菜单上显示用,这里表示秒数 */
  rounds: number
  /** 运算结果/操作数上限 */
  max: number
  /** 整局时长(秒) */
  duration: number
  next: () => Question
}

export const BIKE_DURATION = 30

/** 答对一次前进多少米;连击再加一点 */
export const BIKE = {
  baseMeters: 12,
  comboMeters: 3,
  /** 点错后短暂锁操作,防连点 */
  missLock: 0.35,
  /** 反馈闪一下再出下一题 */
  feedback: 0.28,
  /** 两次答对间隔 ≤ 此秒数,算「答得飞快」 */
  fastGap: 1.15,
  /** 再短一点 + 连击够高 → 火箭档 */
  rocketGap: 0.9,
  rocketCombo: 4,
  /** 加速特效持续时间 */
  boostHold: 1.35,
  rocketHold: 1.7,
  /** 触发加速时额外冲刺米数 */
  boostBonus: 6,
  rocketBonus: 14,
} as const

export function BIKE_LEVELS(): BikeLevel[] {
  return [
    {
      id: 'math.bike.20',
      name: t('math.diff.easy'),
      icon: '🌱',
      desc: t('math.desc.bike.20'),
      rounds: BIKE_DURATION,
      max: 20,
      duration: BIKE_DURATION,
      next: () => nextFourOps(20),
    },
    {
      id: 'math.bike.50',
      name: t('math.diff.hard'),
      icon: '🔥',
      desc: t('math.desc.bike.50'),
      rounds: BIKE_DURATION,
      max: 50,
      duration: BIKE_DURATION,
      next: () => nextFourOps(50),
    },
    {
      id: 'math.bike.100',
      name: t('math.diff.challenge'),
      icon: '🏆',
      desc: t('math.desc.bike.100'),
      rounds: BIKE_DURATION,
      max: 100,
      duration: BIKE_DURATION,
      next: () => nextFourOps(100),
    },
  ]
}
