import { Progress } from '../systems/Progress'
import type { BalanceResult } from './balance/BalanceScene'
import { MATH } from './quizTiming'
import type { LevelInfo, MathGame } from './questions'
import type { QuizRecord, QuizResult } from './types'
import { t } from '../i18n'

/** 计算游戏的选难度页和结算页。样式全部借单词那边的 .panel / .stats / .chip。 */
export class MathScreens {
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

  showMenu(game: MathGame, onPick: (level: LevelInfo) => void): void {
    const unit = game.kind === 'balance' ? t('math.unit.monster') : t('math.unit.question')
    const tip =
      game.kind === 'quiz'
        ? t('math.level.quiz', { sec: MATH.questionTime, tip: game.tip })
        : game.tip

    const cards = game.levels
      .map((lv) => {
        const p = Progress.get(lv.id)
        const best = p ? `<span class="best">${t('game.level.best', { score: p.best })}</span>` : `<span class="best dim">${t('game.level.never')}</span>`
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
