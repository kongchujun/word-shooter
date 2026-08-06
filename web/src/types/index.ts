/** 一个单词条目。image/audio 由后端扫描 assets 目录生成,缺失时前端用占位图和 TTS 顶上。 */
export interface Word {
  id: string
  en: string
  zh: string
  tags: string[]
  image?: string
  audio?: string
  /** 没有图片文件时用来画占位靶子 */
  emoji?: string
}

/** 后台管理页配的词类别,决定游戏分成哪几关、关卡叫什么 */
export interface Category {
  id: string
  name: string
  icon: string
  order: number
}

export interface Manifest {
  words: Word[]
  categories?: Category[]
  /** 后端扫到的音效文件,只列真实存在的;缺的前端会合成 */
  sfx?: Partial<Record<SfxName, string>>
  generatedAt?: string
}

export type SfxName = 'hit' | 'miss' | 'blank' | 'levelup'

export interface LevelDef {
  id: string
  name: string
  /** 选关卡片上的图标 */
  icon: string
  words: Word[]
  /** 同屏靶子数(含 1 个正确答案) */
  targetCount: number
  /** 本关出多少个词 */
  rounds: number
  /** 漂浮速度倍率 */
  speed: number
}

export interface RoundRecord {
  word: Word
  /** 这一轮打错了几次 */
  misses: number
  /** 从语音播完到打中的毫秒数 */
  reactionMs: number
}

export interface LevelResult {
  level: LevelDef
  records: RoundRecord[]
  score: number
  bestCombo: number
}

/** 靶子贴图:真图解码成 ImageBitmap,占位图是现画的 canvas */
export type Sprite = ImageBitmap | HTMLCanvasElement
