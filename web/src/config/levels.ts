import type { Category, LevelDef, Word } from '../types'

// 后台没给名字/图标时的兜底对照表(手写 words.json 或内置占位词库都会走这里)
const TAG_NAMES: Record<string, string> = {
  fruit: '水果',
  animal: '动物',
  school: '文具',
  food: '食物',
  body: '身体',
  color: '颜色',
  number: '数字',
  family: '家人',
  clothes: '衣物',
  vehicle: '交通',
  other: '综合',
}

const TAG_ICONS: Record<string, string> = {
  fruit: '🍎',
  animal: '🐘',
  school: '🎒',
  food: '🍕',
  body: '👋',
  color: '🎨',
  number: '🔢',
  family: '👨‍👩‍👧',
  clothes: '👕',
  vehicle: '🚗',
  other: '📦',
}

/** 一关至少要这么多词(1 个正确答案 + 至少 2 个干扰项) */
const MIN_WORDS_PER_LEVEL = 3

/**
 * 按 tag 把词库切成关卡,越往后同屏靶子越多、飘得越快。
 * 词库变了关卡自动跟着变 —— 加词只需要往 assets 里丢文件。
 *
 * categories 来自后端 manifest(后台管理页配的),决定关卡的显示名、图标和顺序;
 * 没配的 tag 退回上面的内置对照表,再没有就直接用 tag 本身。
 */
export function buildLevels(words: Word[], categories: Category[] = []): LevelDef[] {
  const catById = new Map(categories.map((c) => [c.id, c]))
  const orderOf = (tag: string): number => {
    const i = categories.findIndex((c) => c.id === tag)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  const nameOf = (tag: string): string => catById.get(tag)?.name || TAG_NAMES[tag] || tag
  const iconOf = (tag: string): string =>
    catById.get(tag)?.icon || TAG_ICONS[tag] || '🎯'

  const groups = new Map<string, Word[]>()
  for (const w of words) {
    const tag = w.tags[0] ?? 'other'
    const list = groups.get(tag)
    if (list) list.push(w)
    else groups.set(tag, [w])
  }

  // 词太少的分类合并进「综合」,不单独成关
  const leftovers: Word[] = []
  const kept: [string, Word[]][] = []
  for (const [tag, list] of groups) {
    if (list.length >= MIN_WORDS_PER_LEVEL) kept.push([tag, list])
    else leftovers.push(...list)
  }
  if (leftovers.length >= MIN_WORDS_PER_LEVEL) kept.push(['other', leftovers])

  // 关卡顺序跟着后台配的类别顺序走,没配的排后面
  kept.sort((a, b) => orderOf(a[0]) - orderOf(b[0]))

  const levels: LevelDef[] = kept.map(([tag, list], i) => ({
    id: tag,
    name: nameOf(tag),
    icon: iconOf(tag),
    words: list,
    targetCount: Math.min(3 + Math.floor(i / 2), list.length, 6),
    rounds: Math.min(10, list.length),
    speed: 1 + i * 0.18,
  }))

  // 全部词混在一起的挑战关,压轴
  if (words.length >= 8) {
    levels.push({
      id: 'mixed',
      name: '混合挑战',
      icon: '🌈',
      words,
      targetCount: Math.min(6, words.length),
      rounds: 12,
      speed: 1.7,
    })
  }

  return levels
}
