import { t, type MessageKey } from '../i18n'
import type { ViewId } from '../shell/routes'

/**
 * 一只地鼠 = 一个要听辨的词。
 * 数组顺序就是洞的顺序,整局固定不变 —— 孩子记的是"7 号洞在中间那排最右"这种空间位置,
 * 每题重新洗牌会把这条线索毁掉。
 */
export interface Mole {
  /** 稳定 id,拿来当进度 key 和音频文件名 */
  id: string
  /** 英文读音/拼写,这是要学的东西 */
  en: string
  /** 画在地鼠肚子上的短标签,跟界面语言走(中文"周一",英文"Mon")*/
  label: string
}

export interface WhackLevel {
  id: string
  name: string
  icon: string
  desc: string
  /** 本关出多少题 */
  rounds: number
  /** 干扰地鼠最多同时冒几只 */
  busy: number
  /** 干扰地鼠的起落节奏倍率,越大越快 */
  speed: number
}

export interface WhackGame {
  view: ViewId
  icon: string
  name: string
  /** 窄屏侧栏用的短名 */
  short: string
  desc: string
  /** 选难度页下面那句提示 */
  tip: string
  moles: Mole[]
  levels: WhackLevel[]
}

const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'] as const

const WEEKDAYS = [
  ['monday', 'Monday', 'whack.wd.mon'],
  ['tuesday', 'Tuesday', 'whack.wd.tue'],
  ['wednesday', 'Wednesday', 'whack.wd.wed'],
  ['thursday', 'Thursday', 'whack.wd.thu'],
  ['friday', 'Friday', 'whack.wd.fri'],
  ['saturday', 'Saturday', 'whack.wd.sat'],
  ['sunday', 'Sunday', 'whack.wd.sun'],
] as const satisfies readonly (readonly [string, string, MessageKey])[]

const MONTHS = [
  ['january', 'January', 'whack.mo.1'],
  ['february', 'February', 'whack.mo.2'],
  ['march', 'March', 'whack.mo.3'],
  ['april', 'April', 'whack.mo.4'],
  ['may', 'May', 'whack.mo.5'],
  ['june', 'June', 'whack.mo.6'],
  ['july', 'July', 'whack.mo.7'],
  ['august', 'August', 'whack.mo.8'],
  ['september', 'September', 'whack.mo.9'],
  ['october', 'October', 'whack.mo.10'],
  ['november', 'November', 'whack.mo.11'],
  ['december', 'December', 'whack.mo.12'],
] as const satisfies readonly (readonly [string, string, MessageKey])[]

/** 数字地鼠身上就写阿拉伯数字,不用翻译 */
function numberMoles(): Mole[] {
  return NUMBERS.map((en, i) => ({ id: en, en, label: String(i + 1) }))
}

function labeledMoles(rows: readonly (readonly [string, string, MessageKey])[]): Mole[] {
  return rows.map(([id, en, key]) => ({ id, en, label: t(key) }))
}

/**
 * 三档难度只改节奏和题量,洞的数量和位置一律不动。
 * prefix 进 Progress 的 key,别改动已有的,不然孩子的最高分就断档了。
 */
function levels(prefix: string): WhackLevel[] {
  return [
    { id: `whack.${prefix}.slow`, name: t('whack.diff.slow'), icon: '🌱', desc: t('whack.diff.slow.desc'), rounds: 10, busy: 2, speed: 0.7 },
    { id: `whack.${prefix}.normal`, name: t('whack.diff.normal'), icon: '🔥', desc: t('whack.diff.normal.desc'), rounds: 12, busy: 3, speed: 1 },
    { id: `whack.${prefix}.fast`, name: t('whack.diff.fast'), icon: '⚡', desc: t('whack.diff.fast.desc'), rounds: 15, busy: 4, speed: 1.5 },
  ]
}

/**
 * 三套地鼠。做成函数而不是常量:标签要等 i18n 就绪后再取,
 * 常量会在模块加载那一刻把当时的语言定死。
 */
export function WHACK_GAMES(): WhackGame[] {
  return [
    {
      view: 'whack/number',
      icon: '🔢',
      name: t('whack.game.number'),
      short: t('whack.game.number.short'),
      desc: t('whack.game.number.desc'),
      tip: t('whack.tip'),
      moles: numberMoles(),
      levels: levels('number'),
    },
    {
      view: 'whack/weekday',
      icon: '📅',
      name: t('whack.game.weekday'),
      short: t('whack.game.weekday.short'),
      desc: t('whack.game.weekday.desc'),
      tip: t('whack.tip'),
      moles: labeledMoles(WEEKDAYS),
      levels: levels('weekday'),
    },
    {
      view: 'whack/month',
      icon: '🗓️',
      name: t('whack.game.month'),
      short: t('whack.game.month.short'),
      desc: t('whack.game.month.desc'),
      tip: t('whack.tip'),
      moles: labeledMoles(MONTHS),
      levels: levels('month'),
    },
  ]
}

export function whackGameByView(view: ViewId): WhackGame | undefined {
  return WHACK_GAMES().find((g) => g.view === view)
}
