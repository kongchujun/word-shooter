/** 打地鼠的手感参数集中在这里,调节奏只改这个文件 */
export const WHACK = {
  /** 洞的半径按格子算,再夹在这个区间 */
  holeRadiusMin: 34,
  holeRadiusMax: 82,
  /** 顶部给 HUD 留白,底部给提示条留白(条高 84 + 边距) */
  padTop: 96,
  padBottom: 118,

  /** 冒头 / 缩回的速度(每秒走完多少个身位) */
  riseSpeed: 5.5,
  duckSpeed: 4.5,

  /** 开局到播音之间的停顿 */
  speakDelay: 0.35,
  /** 打错后隔多久自动重播一遍 */
  replayDelay: 0.5,
  /** 打中后停留多久进下一题 */
  feedbackDuration: 1.2,
  /** 挨打后晕多久(晕着的地鼠不参与自主起落) */
  dizzyDuration: 0.9,

  /** 干扰地鼠冒出来待多久 / 缩回去歇多久(乘难度的 speed) */
  distractorUp: [1.1, 2.2] as const,
  distractorDown: [0.5, 1.8] as const,

  /** 迟迟没打对时,过这么久开始给正确地鼠加提示光圈 */
  hintAfter: 7,

  particleCount: 26,
} as const
