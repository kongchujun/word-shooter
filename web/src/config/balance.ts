/** 手感参数集中在这里,调游戏难度只改这个文件 */
export const BALANCE = {
  /** 命中判定半径 / 视觉半径。给孩子放宽一点,擦边也算中 */
  hitRadiusScale: 1.15,

  /** 靶子半径按屏幕短边算,再夹在这个区间里 */
  targetRadiusMin: 38,
  targetRadiusMax: 108,

  /** 入场飞入时长(秒) */
  enterDuration: 0.5,
  /** 全部就位后隔多久播语音 */
  speakDelay: 0.3,
  /** 打中后停留多久进入下一轮 */
  feedbackDuration: 1.1,
  /** 打错后多久自动重播语音 */
  replayDelay: 0.45,

  /** 漂浮:绕着落位点做利萨如运动 */
  floatRadiusX: 16,
  floatRadiusY: 12,
  floatSpeed: 0.55,

  baseScore: 100,
  comboBonus: 25,
  missPenalty: 30,
  /** 反应快有额外加分:2 秒内打中按比例给,最多这么多 */
  speedBonusMax: 60,
  speedBonusWindowMs: 2000,

  particleCount: 28,
} as const
