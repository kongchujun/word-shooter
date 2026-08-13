import type { Word } from '../types'
import type { Mole, WhackGame, WhackLevel } from './sets'

export interface WhackRecord {
  mole: Mole
  /** 这一题打错了几只 */
  misses: number
  /** 从语音播完到打中的毫秒数 */
  reactionMs: number
}

export interface WhackResult {
  game: WhackGame
  level: WhackLevel
  records: WhackRecord[]
  score: number
  bestCombo: number
}

/**
 * 把地鼠转成 AudioManager 认的 Word。
 *
 * audio 来自词库里同名的词条(见 loadVoices);没有就不填,
 * speak 会自动退回浏览器 TTS。家长哪天在后台把 one…nine 生成出来,
 * 游戏这边不用改代码就换成真人发音。
 */
export function moleWord(m: Mole, audio?: string): Word {
  return { id: m.id, en: m.en, zh: m.label, tags: [], audio }
}
