export interface Me {
  enabled: boolean
  loggedIn: boolean
  username: string
  /** 后端有没有配 OPENROUTER_API_KEY,决定要不要显示 AI 生成按钮 */
  openrouter: boolean
  /** 有没有配 AZURE_API_KEY —— 决定语音那栏显示几个生成按钮 */
  azure: boolean
}

/** 语音来源 */
export type TTSProvider = 'azure' | 'openrouter'

export interface ProviderInfo {
  id: TTSProvider
  name: string
  available: boolean
  voice: string
  note: string
}

export interface Category {
  id: string
  name: string
  icon: string
  order: number
}

export interface AdminWord {
  id: string
  zh: string
  tags: string[]
  /** 素材就位情况,缺的会在卡片上标出来 */
  image?: string
  audio?: string
}

export interface AdminData {
  categories: Category[]
  words: AdminWord[]
}

export interface Settings {
  imagePrompt: string
  imageModel: string
  imageSize: string
  /** 默认语音源 */
  ttsProvider: TTSProvider
  ttsModel: string
  ttsVoice: string
  /** Azure 音色,和 OpenRouter 的分开存 */
  azureVoice: string
  ttsSpeed: number
}

export interface OrModel {
  id: string
  name: string
  /** 图片模型专用:支不支持透明背景 */
  transparent?: boolean
  voices?: string[]
}

export interface ModelList {
  image: OrModel[]
  speech: OrModel[]
  /** Azure 的英语音色 */
  azure: OrModel[]
  providers: ProviderInfo[]
  warning?: string
}

export interface AccessEntry {
  t: string
  ip: string
  m: string
  p: string
  s: number
  ms: number
  ua?: string
}

export interface IpStat {
  ip: string
  /** 局域网(含回环)还是公网 —— 判断是不是外人最直接的一条 */
  private: boolean
  /** 归属地,离线库查的;内网和查不到的为空 */
  region?: string
  count: number
  errors: number
  device: string
  first: string
  last: string
  lastPath: string
}

export interface AccessSummary {
  ips: IpStat[]
  recent: AccessEntry[]
  total: number
  days: number
  keepDays: number
  dir: string
  /** 后端有没有内置归属地库 */
  geo: boolean
}

export interface GenResult {
  b64: string
  mediaType: string
  bytes: number
  cost: number
  model: string
}

export interface SaveWordReq {
  id: string
  zh: string
  tags: string[]
  imageB64?: string
  imageType?: string
  audioB64?: string
  audioType?: string
}

/** 后端 API 抛出的错误,带上后端给的中文说明 */
export class ApiError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      // 非 JSON 响应,保持 null,下面用状态码兜底
    }
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`
    throw new ApiError(msg)
  }
  return data as T
}

function json<T>(method: string, path: string, body: unknown): Promise<T> {
  return req<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const api = {
  me: () => req<Me>('/api/admin/me'),
  login: (username: string, password: string) =>
    json<{ ok: boolean; username: string }>('POST', '/api/admin/login', { username, password }),
  logout: () => json<{ ok: boolean }>('POST', '/api/admin/logout', {}),

  data: () => req<AdminData>('/api/admin/data'),
  saveCategories: (categories: Category[]) =>
    json<{ categories: Category[] }>('PUT', '/api/admin/categories', { categories }),
  saveWord: (w: SaveWordReq) => json<{ ok: boolean; id: string }>('POST', '/api/admin/save', w),
  deleteWord: (id: string) =>
    req<{ ok: boolean; filesRemoved: number }>(`/api/admin/words/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  genImage: (word: string, prompt?: string) =>
    json<GenResult>('POST', '/api/admin/generate/image', { word, prompt }),
  /** provider 不传就用设置里的默认语音源 */
  genAudio: (word: string, provider?: TTSProvider, voice?: string) =>
    json<GenResult>('POST', '/api/admin/generate/audio', { word, provider, voice }),

  settings: () => req<Settings>('/api/admin/settings'),
  saveSettings: (s: Partial<Settings>) => json<Settings>('PUT', '/api/admin/settings', s),
  models: () => req<ModelList>('/api/admin/models'),
  access: (days = 7) => req<AccessSummary>(`/api/admin/access?days=${days}`),
}
