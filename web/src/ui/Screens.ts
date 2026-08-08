import { Progress } from '../systems/Progress'
import type { LevelDef, LevelResult, Word } from '../types'
import { t } from '../i18n'

/** 加载页 / 选关页 / 结算页。都是 DOM,只有战斗画面走 canvas。 */
export class Screens {
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

  showLoading(text = t('game.loading.assets')): void {
    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel loading">
        <div class="logo">🎯</div>
        <h1>${t('game.title')}</h1>
        <p class="muted" data-el="text">${text}</p>
        <div class="bar"><i data-el="bar" style="width:0%"></i></div>
      </div>
    `
  }

  setProgress(done: number, total: number, text?: string): void {
    const bar = this.root.querySelector<HTMLElement>('[data-el="bar"]')
    if (bar) bar.style.width = `${total ? Math.round((done / total) * 100) : 100}%`
    const t = this.root.querySelector<HTMLElement>('[data-el="text"]')
    if (t && text) t.textContent = text
  }

  showMenu(levels: LevelDef[], note: string, onPick: (level: LevelDef) => void): void {
    this.root.classList.remove('hidden')
    const cards = levels.length
      ? levels
          .map((lv) => {
            const p = Progress.get(lv.id)
            const best = p ? `<span class="best">${t('game.level.best', { score: p.best })}</span>` : `<span class="best dim">${t('game.level.never')}</span>`
            return `
          <button class="level-card" data-id="${lv.id}">
            <span class="lv-emoji">${lv.icon}</span>
            <span class="lv-name">${lv.name}</span>
            <span class="lv-meta">${t('game.level.meta', { rounds: lv.rounds, targets: lv.targetCount })}</span>
            ${best}
          </button>`
          })
          .join('')
      : `<p class="note">${t('game.level.none')}</p>`

    this.root.innerHTML = `
      <div class="panel menu">
        <div class="logo">🎯</div>
        <h1>${t('game.title')}</h1>
        <p class="muted">${t('game.subtitle')}</p>
        <div class="levels">${cards}</div>
        <p class="note">${note}</p>
      </div>
    `
    for (const el of this.root.querySelectorAll<HTMLElement>('.level-card')) {
      el.addEventListener('click', () => {
        const lv = levels.find((l) => l.id === el.dataset.id)
        if (lv) onPick(lv)
      })
    }
  }

  showResult(result: LevelResult, onRetry: () => void, onMenu: () => void): void {
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
           <h3>${t('game.result.practice')}</h3>
           <div class="wrong-list">${wrong.map((r) => wordChip(r.word, t('game.result.misses', { n: r.misses }))).join('')}</div>
         </div>`
      : `<p class="perfect">${t('game.result.perfect')}</p>`

    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel result">
        <div class="stars">${stars}</div>
        <h1>${t('game.result.done', { level: result.level.name })}</h1>
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

function wordChip(w: Word, tail: string): string {
  const thumb = w.image
    ? `<img src="${w.image}" alt="${w.en}" />`
    : `<span class="chip-emoji">${w.emoji ?? '📘'}</span>`
  return `<div class="chip">${thumb}<b>${w.en}</b><span>${w.zh}</span><i>${tail}</i></div>`
}
