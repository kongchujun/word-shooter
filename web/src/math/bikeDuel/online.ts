/** 多人踩单车在线房间 — 短轮询,最多 5 人。 */

export const BIKE_RACE_CAPACITY = 5

export interface BikeSession {
  code: string
  max: number
  playerId: string
  token: string
  seat: number
  host: boolean
}

export interface BikePlayerView {
  seat: number
  ready: boolean
  distance: number
  correct: number
  finished: boolean
  you: boolean
}

export interface BikeSyncState {
  code: string
  max: number
  status: 'waiting' | 'racing' | 'done' | string
  startAt: number
  countdown: number
  capacity: number
  playerCount: number
  readyCount: number
  you: BikePlayerView
  players: BikePlayerView[]
  winnerSeat: number
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export function createRoom(max: number): Promise<BikeSession> {
  return post<BikeSession>('/api/bike/rooms', { max })
}

export function joinRoom(code: string): Promise<BikeSession> {
  return post<BikeSession>(`/api/bike/rooms/${encodeURIComponent(code.trim())}/join`)
}

export function syncRoom(
  session: BikeSession,
  patch: { ready?: boolean; distance?: number; correct?: number; finished?: boolean },
): Promise<BikeSyncState> {
  return post<BikeSyncState>(`/api/bike/rooms/${encodeURIComponent(session.code)}/sync`, {
    playerId: session.playerId,
    token: session.token,
    ready: !!patch.ready,
    distance: patch.distance ?? 0,
    correct: patch.correct ?? 0,
    finished: !!patch.finished,
  })
}
