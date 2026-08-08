import { Progress } from '../systems/Progress'
import { GhostStore } from '../systems/GhostStore'
import { playFireworks } from '../ui/Fireworks'
import type { BalanceResult } from './balance/BalanceScene'
import type { BikeLevel } from './bike/levels'
import type { BikeDuelResult } from './bikeDuel/BikeDuelScene'
import {
  BIKE_RACE_CAPACITY,
  createRoom,
  joinRoom,
  listOpenRooms,
  syncRoom,
  type BikeOpenRoom,
  type BikeSession,
} from './bikeDuel/online'
import { MATH } from './quizTiming'
import type { LevelInfo, MathGame } from './questions'
import type { QuizRecord, QuizResult } from './types'
import { t } from '../i18n'

/** 计算游戏的选难度页和结算页。样式全部借单词那边的 .panel / .stats / .chip。 */
export class MathScreens {
  private root: HTMLDivElement
  private lobbyTimer: number | null = null
  private stopFx: (() => void) | null = null

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'screen hidden'
    parent.appendChild(this.root)
  }

  hideAll(): void {
    this.stopLobby()
    this.clearFx()
    this.root.classList.add('hidden')
    this.root.innerHTML = ''
  }

  private clearFx(): void {
    this.stopFx?.()
    this.stopFx = null
  }

  private stopLobby(): void {
    if (this.lobbyTimer !== null) {
      window.clearInterval(this.lobbyTimer)
      this.lobbyTimer = null
    }
  }

  showMenu(game: MathGame, onPick: (level: LevelInfo) => void): void {
    const unit =
      game.kind === 'balance'
        ? t('math.unit.monster')
        : game.kind === 'bike'
          ? t('math.unit.second')
          : t('math.unit.question')
    const tip =
      game.kind === 'quiz'
        ? t('math.level.quiz', { sec: MATH.questionTime, tip: game.tip })
        : game.kind === 'bike'
          ? t('math.level.bike', { sec: game.levels[0]?.rounds ?? 30, tip: game.tip })
          : game.tip

    const cards = game.levels
      .map((lv) => {
        const p = Progress.get(lv.id)
        const ghost =
          game.kind === 'bike' && 'max' in lv
            ? GhostStore.getForMax((lv as BikeLevel).max)
            : undefined
        const best = ghost
          ? `<span class="best">${t('math.bike.recordBest', { score: ghost.score })}</span>`
          : p
            ? `<span class="best">${t('game.level.best', { score: p.best })}</span>`
            : `<span class="best dim">${game.kind === 'bike' ? t('math.bike.recordEmpty') : t('game.level.never')}</span>`
        return `
        <button class="level-card" data-id="${lv.id}">
          <span class="lv-emoji">${lv.icon}</span>
          <span class="lv-name">${lv.name}</span>
          <span class="lv-meta">${lv.desc} · ${t('math.level.count', { n: lv.rounds, unit })}</span>
          ${best}
        </button>`
      })
      .join('')

    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel menu">
        <div class="logo">${game.icon}</div>
        <h1>${game.name}</h1>
        <p class="muted">${tip}</p>
        <div class="levels">${cards}</div>
      </div>
    `
    for (const el of this.root.querySelectorAll<HTMLElement>('.level-card')) {
      el.addEventListener('click', () => {
        const lv = game.levels.find((l) => l.id === el.dataset.id)
        if (lv) onPick(lv)
      })
    }
  }

  /** 多人踩单车入口:公开房一键进 / 私密房对房间号,最多 5 人 */
  showBikeOnlineLobby(
    level: BikeLevel,
    handlers: {
      onStart: (session: BikeSession, startAt: number) => void
    },
  ): void {
    this.stopLobby()
    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel menu bike-lobby">
        <div class="logo">🏁</div>
        <h1>${t('math.game.bikeDuel')}</h1>
        <p class="muted">${t('math.duel.lobbyHint')}</p>
        <div class="lobby-block">
          <div class="lobby-create-row" data-el="gate">
            <button class="btn primary" data-act="create-public" title="${t('math.duel.createPublicHint')}">${t('math.duel.createPublic')}</button>
            <button class="btn" data-act="create-private" title="${t('math.duel.createPrivateHint')}">${t('math.duel.createPrivate')}</button>
          </div>
          <p class="lobby-hint muted" data-el="gate-hint">${t('math.duel.createPublicHint')}</p>
          <div class="lobby-open" data-el="gate-open">
            <div class="lobby-open-title">${t('math.duel.openRooms')}</div>
            <div class="lobby-open-list" data-el="open-list"></div>
          </div>
          <div class="lobby-or" data-el="gate-or">${t('math.duel.joinByCode')}</div>
          <div class="lobby-join" data-el="gate-join">
            <input class="lobby-input" data-el="code" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="${t('math.duel.codePlaceholder')}" autocomplete="off" />
            <button class="btn" data-act="join">${t('math.duel.joinRoom')}</button>
          </div>
          <p class="lobby-status muted" data-el="status"></p>
          <div class="lobby-room hidden" data-el="room">
            <div class="lobby-code" data-el="code-show"></div>
            <p class="lobby-seat muted" data-el="my-seat"></p>
            <p class="lobby-ready-line" data-el="ready-line"></p>
            <div class="lobby-players" data-el="players"></div>
            <button class="btn primary" data-act="ready">${t('math.duel.ready')}</button>
          </div>
        </div>
      </div>
    `

    const statusEl = this.root.querySelector<HTMLElement>('[data-el="status"]')!
    const roomEl = this.root.querySelector<HTMLElement>('[data-el="room"]')!
    const codeShow = this.root.querySelector<HTMLElement>('[data-el="code-show"]')!
    const mySeatEl = this.root.querySelector<HTMLElement>('[data-el="my-seat"]')!
    const readyLineEl = this.root.querySelector<HTMLElement>('[data-el="ready-line"]')!
    const playersEl = this.root.querySelector<HTMLElement>('[data-el="players"]')!
    const openListEl = this.root.querySelector<HTMLElement>('[data-el="open-list"]')!
    const codeInput = this.root.querySelector<HTMLInputElement>('[data-el="code"]')!
    const readyBtn = this.root.querySelector<HTMLButtonElement>('[data-act="ready"]')!
    const gateEls = this.root.querySelectorAll<HTMLElement>('[data-el^="gate"]')

    let session: BikeSession | null = null
    let ready = false
    let starting = false
    let joining = false

    const setStatus = (msg: string) => {
      statusEl.textContent = msg
    }

    const hideGate = () => {
      gateEls.forEach((el) => el.classList.add('hidden'))
    }

    const renderPlayers = (
      players: { seat: number; ready: boolean; you: boolean }[],
      readyCount: number,
      playerCount: number,
    ) => {
      readyLineEl.textContent = t('math.duel.readyCount', {
        ready: readyCount,
        total: playerCount,
        cap: BIKE_RACE_CAPACITY,
      })
      const slots = Array.from({ length: BIKE_RACE_CAPACITY }, (_, i) => {
        const seat = i + 1
        const p = players.find((x) => x.seat === seat)
        if (!p) {
          return `<div class="lobby-slot empty"><b>${seat}</b><span>${t('math.duel.seatEmpty')}</span></div>`
        }
        const tag = p.you ? t('math.duel.youBadge') : t('math.duel.seatLabel', { n: seat })
        const st = p.ready ? t('math.duel.seatReady') : t('math.duel.seatWait')
        return `<div class="lobby-slot${p.you ? ' me' : ''}${p.ready ? ' ready' : ''}"><b>${seat}</b><span>${tag}</span><i>${st}</i></div>`
      })
      playersEl.innerHTML = slots.join('')
    }

    const enterRoom = (s: BikeSession) => {
      session = s
      hideGate()
      roomEl.classList.remove('hidden')
      if (s.public) {
        codeShow.textContent = t('math.duel.publicRoom')
        codeShow.classList.add('is-public')
        setStatus(t('math.duel.waitingPublic'))
      } else {
        codeShow.textContent = s.code
        codeShow.classList.remove('is-public')
        setStatus(t('math.duel.waitingPeer'))
      }
      mySeatEl.textContent = t('math.duel.yourSeat', { n: s.seat })
      renderPlayers([{ seat: s.seat, ready: false, you: true }], 0, 1)
      this.stopLobby()
      this.lobbyTimer = window.setInterval(() => void tick(), 400)
      void tick()
    }

    const tick = async () => {
      if (!session || starting) return
      try {
        const st = await syncRoom(session, {
          ready,
          distance: 0,
          correct: 0,
          finished: false,
        })
        renderPlayers(st.players, st.readyCount, st.playerCount)
        if (st.playerCount < 2) {
          setStatus(t('math.duel.needTwo'))
        } else if (st.readyCount < st.playerCount) {
          setStatus(t('math.duel.waitAllReady', { ready: st.readyCount, total: st.playerCount }))
        } else {
          setStatus(t('math.duel.waitBothReady'))
        }
        if (st.status === 'racing' && st.startAt > 0) {
          starting = true
          this.stopLobby()
          setStatus(t('math.duel.starting'))
          handlers.onStart(session, st.startAt)
        }
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err))
      }
    }

    const renderOpenList = (rooms: BikeOpenRoom[]) => {
      if (!rooms.length) {
        openListEl.innerHTML = `<p class="lobby-open-empty muted">${t('math.duel.openEmpty')}</p>`
        return
      }
      openListEl.innerHTML = rooms
        .map(
          (r) => `
        <button type="button" class="lobby-open-item" data-act="open-join" data-code="${r.code}">
          <span class="lobby-open-name">${t('math.duel.publicRoom')}</span>
          <span class="lobby-open-meta">${t('math.duel.openPlayers', { n: r.playerCount, cap: r.capacity })}</span>
          <span class="lobby-open-go">${t('math.duel.openJoin')}</span>
        </button>`,
        )
        .join('')
      openListEl.querySelectorAll<HTMLButtonElement>('[data-act="open-join"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          void (async () => {
            if (joining || session) return
            joining = true
            setStatus(t('math.duel.joining'))
            try {
              enterRoom(await joinRoom(btn.dataset.code || ''))
            } catch (err) {
              setStatus(err instanceof Error ? err.message : String(err))
              joining = false
              void refreshOpen()
            }
          })()
        })
      })
    }

    const refreshOpen = async () => {
      if (session) return
      try {
        renderOpenList(await listOpenRooms())
      } catch {
        /* 列表失败不挡开房 */
      }
    }

    const doCreate = (isPublic: boolean) => {
      void (async () => {
        if (joining || session) return
        joining = true
        setStatus(t('math.duel.creating'))
        try {
          enterRoom(await createRoom(level.max, isPublic))
        } catch (err) {
          setStatus(err instanceof Error ? err.message : String(err))
          joining = false
        }
      })()
    }

    this.root.querySelector('[data-act="create-public"]')!.addEventListener('click', () => doCreate(true))
    this.root.querySelector('[data-act="create-private"]')!.addEventListener('click', () => doCreate(false))

    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4)
    })

    this.root.querySelector('[data-act="join"]')!.addEventListener('click', () => {
      void (async () => {
        if (joining || session) return
        const code = codeInput.value.trim()
        if (code.length !== 4) {
          setStatus(t('math.duel.codeNeeded'))
          return
        }
        joining = true
        setStatus(t('math.duel.joining'))
        try {
          enterRoom(await joinRoom(code))
        } catch (err) {
          setStatus(err instanceof Error ? err.message : String(err))
          joining = false
        }
      })()
    })

    readyBtn.addEventListener('click', () => {
      ready = true
      readyBtn.disabled = true
      readyBtn.textContent = t('math.duel.readyDone')
      setStatus(t('math.duel.waitBothReady'))
      void tick()
    })

    void refreshOpen()
    this.lobbyTimer = window.setInterval(() => void refreshOpen(), 1500)
  }

  showQuizResult(result: QuizResult, onRetry: () => void, onMenu: () => void): void {
    const total = result.records.length
    const right = result.records.filter((r) => r.picked === r.answer)
    const accuracy = total ? right.length / total : 0
    const avg = right.length ? Math.round(right.reduce((a, r) => a + r.ms, 0) / right.length) : 0
    const wrong = result.records.filter((r) => r.picked !== r.answer)

    Progress.record(result.level.id, result.score, accuracy)

    const stars = accuracy >= 0.9 ? '⭐️⭐️⭐️' : accuracy >= 0.7 ? '⭐️⭐️' : accuracy >= 0.4 ? '⭐️' : '💪'
    const wrongHtml = wrong.length
      ? `<div class="wrong">
           <h3>${t('math.result.practiceQuiz')}</h3>
           <div class="wrong-list">${wrong.map(eqChip).join('')}</div>
         </div>`
      : `<p class="perfect">${t('math.result.allRight')}</p>`

    this.renderResult(result.level.name, stars, [
      [t('math.result.score'), String(result.score)],
      [t('math.result.right'), `${right.length}/${total}`],
      [t('math.result.bestCombo'), String(result.bestCombo)],
      [t('math.result.avgTime'), avg ? `${(avg / 1000).toFixed(1)}s` : '—'],
    ], wrongHtml, onRetry, onMenu)
  }

  showBalanceResult(result: BalanceResult, onRetry: () => void, onMenu: () => void): void {
    const total = result.records.length
    const efficient = result.records.filter((r) => r.pieces <= r.optimal)
    const ratio = total ? efficient.length / total : 1
    const avg = total ? Math.round(result.records.reduce((a, r) => a + r.ms, 0) / total) : 0
    const waste = result.records.filter((r) => r.pieces > r.optimal)

    Progress.record(result.level.id, result.score, ratio)

    const stars = ratio >= 0.9 ? '⭐️⭐️⭐️' : ratio >= 0.7 ? '⭐️⭐️' : ratio >= 0.4 ? '⭐️' : '💪'
    const wasteHtml = waste.length
      ? `<div class="wrong">
           <h3>${t('math.result.practiceBalance')}</h3>
           <div class="wrong-list">${waste.map(balChip).join('')}</div>
         </div>`
      : `<p class="perfect">${t('math.result.allEfficient')}</p>`

    this.renderResult(result.level.name, stars, [
      [t('math.result.score'), String(result.score)],
      [t('math.result.efficient'), `${efficient.length}/${total}`],
      [t('math.result.bestCombo'), String(result.bestCombo)],
      [t('math.result.avgTime'), avg ? `${(avg / 1000).toFixed(1)}s` : '—'],
    ], wasteHtml, onRetry, onMenu)
  }

  showBikeDuelResult(result: BikeDuelResult, onRetry: () => void, onMenu: () => void): void {
    const accuracy = result.rivalScore > 0 ? Math.min(1, result.score / result.rivalScore) : result.correct > 0 ? 1 : 0
    Progress.record(result.level.id, result.score, accuracy)
    GhostStore.recordIfBest(GhostStore.keyForMax(result.level.max), result.score, result.samples)

    const vsGhost = result.mode === 'ghost'
    const tone = result.outcome
    const badge = vsGhost
      ? tone === 'win'
        ? t('math.bike.resultWinBadge')
        : tone === 'lose'
          ? t('math.bike.resultLoseBadge')
          : t('math.bike.resultTieBadge')
      : tone === 'win'
        ? t('math.duel.resultWinBadge')
        : t('math.duel.resultLoseBadge')
    const title = vsGhost
      ? tone === 'win'
        ? t('math.bike.resultWinTitle')
        : tone === 'lose'
          ? t('math.bike.resultLoseTitle')
          : t('math.bike.resultTieTitle')
      : tone === 'win'
        ? t('math.duel.resultWinTitle')
        : t('math.duel.resultLoseTitle')
    const headline = vsGhost
      ? tone === 'win'
        ? t('math.bike.win')
        : tone === 'lose'
          ? t('math.bike.lose')
          : t('math.bike.tie')
      : tone === 'win'
        ? t('math.duel.win')
        : result.winnerSeat
          ? t('math.duel.loseWinner', { n: result.winnerSeat })
          : t('math.duel.lose')
    const retryLabel = tone === 'lose' ? t('math.duel.retryLose') : t('math.result.retry')
    const celebrate = !vsGhost && tone === 'win'
    const myLabel =
      !vsGhost && result.mySeat
        ? t('math.duel.seatLabel', { n: result.mySeat })
        : t('math.duel.you')
    const rivalLabel = vsGhost
      ? t('math.duel.rivalGhost')
      : result.winnerSeat
        ? t('math.duel.winnerSeat', { n: result.winnerSeat })
        : t('math.duel.leader')

    const standingsHtml =
      !vsGhost && result.standings?.length
        ? `<div class="lobby-players result-standings">${result.standings
            .slice()
            .sort((a, b) => b.distance - a.distance || a.seat - b.seat)
            .map(
              (s, i) =>
                `<div class="lobby-slot${s.seat === result.mySeat ? ' me' : ''}${s.seat === result.winnerSeat ? ' ready' : ''}"><b>${i + 1}</b><span>${t('math.duel.seatLabel', { n: s.seat })}</span><i>${s.distance} m</i></div>`,
            )
            .join('')}</div>`
        : ''

    this.clearFx()
    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      ${
        celebrate
          ? `<div class="duel-celebrate" aria-hidden="true">
               <div class="duel-rays"></div>
               <div class="duel-sparkles">
                 ${Array.from({ length: 18 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}
               </div>
             </div>`
          : ''
      }
      <div class="panel result duel-result ${tone}${celebrate ? ' celebrate' : ''}${!vsGhost && tone === 'win' ? ' online-win' : ''}">
        ${celebrate ? `<div class="duel-trophy" aria-hidden="true">🏆</div>` : ''}
        ${
          !vsGhost && tone === 'lose' && result.winnerSeat
            ? `<div class="duel-winner-num">${t('math.duel.winnerBig', { n: result.winnerSeat })}</div>`
            : ''
        }
        <div class="duel-badge">${badge}</div>
        <h1>${title}</h1>
        <p class="duel-sub muted">${result.level.name}</p>
        <div class="stats">
          <div><label>${myLabel}</label><b>${result.score} m</b></div>
          <div><label>${rivalLabel}</label><b>${result.rivalScore} m</b></div>
          <div><label>${t('math.result.bestCombo')}</label><b>${result.bestCombo}</b></div>
          <div><label>${t('math.duel.correctCount')}</label><b>${result.correct}</b></div>
        </div>
        ${standingsHtml}
        <p class="duel-headline">${headline}</p>
        ${celebrate ? `<p class="duel-cheer">${t('math.duel.winCheer')}</p>` : ''}
        <div class="actions">
          <button class="btn primary" data-act="retry">${retryLabel}</button>
          <button class="btn" data-act="menu">${t('math.result.menu')}</button>
        </div>
      </div>
    `
    this.root.querySelector('[data-act="retry"]')!.addEventListener('click', onRetry)
    this.root.querySelector('[data-act="menu"]')!.addEventListener('click', onMenu)

    if (celebrate) this.stopFx = playFireworks(this.root, 6500)
  }

  private renderResult(
    title: string,
    stars: string,
    stats: [string, string][],
    bodyHtml: string,
    onRetry: () => void,
    onMenu: () => void,
  ): void {
    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel result">
        <div class="stars">${stars}</div>
        <h1>${title} 完成</h1>
        <div class="stats">
          ${stats.map(([label, v]) => `<div><label>${label}</label><b>${v}</b></div>`).join('')}
        </div>
        ${bodyHtml}
        <div class="actions">
          <button class="btn primary" data-act="retry">${t('math.result.retry')}</button>
          <button class="btn" data-act="menu">${t('math.result.menu')}</button>
        </div>
      </div>
    `
    this.root.querySelector('[data-act="retry"]')!.addEventListener('click', onRetry)
    this.root.querySelector('[data-act="menu"]')!.addEventListener('click', onMenu)
  }
}

function eqChip(r: QuizRecord): string {
  const tail = r.picked === null ? t('math.result.timeout') : t('math.result.picked', { n: r.picked })
  return `<div class="chip eq"><b>${r.text} = ${r.answer}</b><i>${tail}</i></div>`
}

function balChip(r: { target: number; pieces: number; optimal: number }): string {
  return `<div class="chip eq"><b>${t('math.result.target', { n: r.target })}</b><i>${t('math.result.balanceChip', { pieces: r.pieces, optimal: r.optimal })}</i></div>`
}
