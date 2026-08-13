import { t } from '../i18n'
import type { ViewId } from '../shell/routes'
import { Progress } from '../systems/Progress'
import { WHACK_GAMES, type WhackGame, type WhackLevel } from './sets'
import type { WhackRecord, WhackResult } from './types'

/** 打地鼠的首页 / 选难度页 / 加载页 / 结算页。样式全部借单词那边的 .panel / .level-card / .chip。 */
export class WhackScreens {
  private root: HTMLDivElement

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'screen hidden'
    parent.appendChild(this.root)
  }

  hideAll(): void {
    this.root.classList.add('hidden')
    this.root.innerHTML = ''
  }

  /** 三套地鼠的入口页 */
  showHome(onPick: (view: ViewId) => void): void {
    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel">
        <div class="logo">🔨</div>
        <h1>${t('nav.whack')}</h1>
        <p class="muted">${t('whack.home.subtitle')}</p>
        <div class="levels">
          ${WHACK_GAMES()
            .map(
              (g) => `
            <button class="level-card" data-view="${g.view}">
              <span class="lv-emoji">${g.icon}</span>
              <span class="lv-name">${g.name}</span>
              <span class="lv-meta">${g.desc}</span>
            </button>`,
            )
            .join('')}
        </div>
      </div>
    `
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-view]')) {
      el.addEventListener('click', () => onPick(el.dataset.view as ViewId))
    }
  }

  showLoading(): void {
    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel loading">
        <div class="logo">🔨</div>
        <h1>${t('nav.whack')}</h1>
        <p class="muted">${t('game.loading.audio')}</p>
      </div>
    `
  }

  showMenu(game: WhackGame, onPick: (level: WhackLevel) => void): void {
    const cards = game.levels
      .map((lv) => {
        const p = Progress.get(lv.id)
        const best = p
          ? `<span class="best">${t('game.level.best', { score: p.best })}</span>`
          : `<span class="best dim">${t('game.level.never')}</span>`
        return `
        <button class="level-card" data-id="${lv.id}">
          <span class="lv-emoji">${lv.icon}</span>
          <span class="lv-name">${lv.name}</span>
          <span class="lv-meta">${lv.desc} · ${t('whack.level.count', { n: lv.rounds, holes: game.moles.length })}</span>
          ${best}
        </button>`
      })
      .join('')

    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel menu">
        <div class="logo">${game.icon}</div>
        <h1>${game.name}</h1>
        <p class="muted">${game.tip}</p>
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

  showResult(result: WhackResult, onRetry: () => void, onMenu: () => void): void {
    const total = result.records.length
    const clean = result.records.filter((r) => r.misses === 0).length
    const accuracy = total ? clean / total : 0
    const reactions = result.records.filter((r) => r.misses === 0 && r.reactionMs > 0).map((r) => r.reactionMs)
    const avg = reactions.length ? Math.round(reactions.reduce((a, b) => a + b, 0) / reactions.length) : 0
    const wrong = result.records.filter((r) => r.misses > 0)

    Progress.record(result.level.id, result.score, accuracy)

    const stars = accuracy >= 0.9 ? '⭐️⭐️⭐️' : accuracy >= 0.7 ? '⭐️⭐️' : accuracy >= 0.4 ? '⭐️' : '💪'
    const wrongHtml = wrong.length
      ? `<div class="wrong">
           <h3>${t('whack.result.practice')}</h3>
           <div class="wrong-list">${wrong.map(moleChip).join('')}</div>
         </div>`
      : `<p class="perfect">${t('game.result.perfect')}</p>`

    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel result">
        <div class="stars">${stars}</div>
        <h1>${t('game.result.done', { level: `${result.game.name} · ${result.level.name}` })}</h1>
        <div class="stats">
          <div><label>${t('game.result.score')}</label><b>${result.score}</b></div>
          <div><label>${t('game.result.clean')}</label><b>${clean}/${total}</b></div>
          <div><label>${t('game.result.bestCombo')}</label><b>${result.bestCombo}</b></div>
          <div><label>${t('game.result.avgTime')}</label><b>${avg ? `${(avg / 1000).toFixed(1)}s` : '—'}</b></div>
        </div>
        ${wrongHtml}
        <div class="actions">
          <button class="btn primary" data-act="retry">${t('game.result.retry')}</button>
          <button class="btn" data-act="menu">${t('game.result.menu')}</button>
        </div>
      </div>
    `
    this.root.querySelector('[data-act="retry"]')!.addEventListener('click', onRetry)
    this.root.querySelector('[data-act="menu"]')!.addEventListener('click', onMenu)
  }
}

function moleChip(r: WhackRecord): string {
  return `<div class="chip"><span class="chip-emoji">${r.mole.label}</span><b>${r.mole.en}</b><i>${t('game.result.misses', { n: r.misses })}</i></div>`
}
