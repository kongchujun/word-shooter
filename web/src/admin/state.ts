import { api, type AdminData, type Me, type ModelList, type Settings } from './api'

export interface State {
  me: Me
  data: AdminData
  settings: Settings
  /** 模型列表要联网拉,慢且可能失败,按需加载 */
  models: ModelList | null
  tab: Tab
  /**
   * 词条页的浏览状态。必须存在这里而不是 renderWords 的局部变量 ——
   * 保存词条后会整页重绘,局部变量会连人带页跳回第一页,搜索和筛选也一起清掉。
   */
  words: WordsView
}

export interface WordsView {
  page: number
  search: string
  /** 类别 id;'' = 全部,'__none' = 未分类 */
  filter: string
}

export type Tab = 'words' | 'categories' | 'batch' | 'settings'

export async function loadState(me: Me): Promise<State> {
  const [data, settings] = await Promise.all([api.data(), api.settings()])
  return {
    me,
    data,
    settings,
    models: null,
    tab: 'words',
    words: { page: 1, search: '', filter: '' },
  }
}

/** 类别 id → 显示名,给不出名字就退回 id */
export function catName(state: State, id: string): string {
  const c = state.data.categories.find((x) => x.id === id)
  return c?.name || id
}

export function catIcon(state: State, id: string): string {
  return state.data.categories.find((x) => x.id === id)?.icon || '🏷'
}

/** 一个词素材齐不齐 —— 只有图和音都在,游戏里才会出现 */
export function isReady(w: { image?: string; audio?: string }): boolean {
  return !!w.image && !!w.audio
}

/** 把 File 读成不带 data: 前缀的 base64 */
export function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error('读文件失败'))
    fr.onload = () => {
      const s = String(fr.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    fr.readAsDataURL(file)
  })
}
