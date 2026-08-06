import type { Word } from '../types'

/**
 * 后端还没起、或 assets 目录还是空的时候用这套内置词库,
 * 靶子用 emoji 画、发音走浏览器 TTS,保证游戏本身随时能玩。
 * 一旦 assets/images/apple.webp + assets/audio/apple.mp3 就位,
 * 后端 manifest 会覆盖同名词条,自动换成真图真人声。
 */
export const FALLBACK_WORDS: Word[] = [
  { id: 'apple', en: 'apple', zh: '苹果', emoji: '🍎', tags: ['fruit'] },
  { id: 'banana', en: 'banana', zh: '香蕉', emoji: '🍌', tags: ['fruit'] },
  { id: 'orange', en: 'orange', zh: '橙子', emoji: '🍊', tags: ['fruit'] },
  { id: 'grape', en: 'grape', zh: '葡萄', emoji: '🍇', tags: ['fruit'] },
  { id: 'strawberry', en: 'strawberry', zh: '草莓', emoji: '🍓', tags: ['fruit'] },
  { id: 'watermelon', en: 'watermelon', zh: '西瓜', emoji: '🍉', tags: ['fruit'] },

  { id: 'cat', en: 'cat', zh: '猫', emoji: '🐱', tags: ['animal'] },
  { id: 'dog', en: 'dog', zh: '狗', emoji: '🐶', tags: ['animal'] },
  { id: 'pig', en: 'pig', zh: '猪', emoji: '🐷', tags: ['animal'] },
  { id: 'tiger', en: 'tiger', zh: '老虎', emoji: '🐯', tags: ['animal'] },
  { id: 'rabbit', en: 'rabbit', zh: '兔子', emoji: '🐰', tags: ['animal'] },
  { id: 'elephant', en: 'elephant', zh: '大象', emoji: '🐘', tags: ['animal'] },

  { id: 'book', en: 'book', zh: '书', emoji: '📕', tags: ['school'] },
  { id: 'pencil', en: 'pencil', zh: '铅笔', emoji: '✏️', tags: ['school'] },
  { id: 'ruler', en: 'ruler', zh: '尺子', emoji: '📏', tags: ['school'] },
  { id: 'bag', en: 'bag', zh: '书包', emoji: '🎒', tags: ['school'] },
  { id: 'scissors', en: 'scissors', zh: '剪刀', emoji: '✂️', tags: ['school'] },
  { id: 'clock', en: 'clock', zh: '钟表', emoji: '🕐', tags: ['school'] },

  { id: 'bread', en: 'bread', zh: '面包', emoji: '🍞', tags: ['food'] },
  { id: 'cake', en: 'cake', zh: '蛋糕', emoji: '🍰', tags: ['food'] },
  { id: 'egg', en: 'egg', zh: '鸡蛋', emoji: '🥚', tags: ['food'] },
  { id: 'milk', en: 'milk', zh: '牛奶', emoji: '🥛', tags: ['food'] },
  { id: 'rice', en: 'rice', zh: '米饭', emoji: '🍚', tags: ['food'] },
  { id: 'pizza', en: 'pizza', zh: '披萨', emoji: '🍕', tags: ['food'] },
]
