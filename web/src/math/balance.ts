export const MATH = {
  /** 每题的作答时间(秒),从靶子落位后开始算 */
  questionTime: 10,
  /** 靶子飞进来的时间,不计入答题时间 */
  enterDuration: 0.5,
  /** 亮答案的停顿 */
  feedbackDuration: 0.9,
  /** 剩余时间少于这个数就把倒计时条转红 */
  urgentAt: 1.5,

  baseScore: 100,
  comboBonus: 25,
  /** 秒答拿满,拖到超时归零 */
  speedBonusMax: 100,

  particleCount: 26,
} as const
