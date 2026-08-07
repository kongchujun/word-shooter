import { Progress } from '../systems/Progress'
import { MATH } from './balance'
import type { QuizGame, QuizLevel } from './questions'
import type { QuizRecord, QuizResult } from './types'

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

  showMenu(game: QuizGame, onPick: (level: QuizLevel) => void): void {
    const cards = game.levels
      .map((lv) => {
        const p = Progress.get(lv.id)
        const best = p ? `<span class="best">最高 ${p.best}</span>` : '<span class="best dim">还没玩过</span>'
        return `
        <button class="level-card" data-id="${lv.id}">
          <span class="lv-emoji">${lv.icon}</span>
          <span class="lv-name">${lv.name}</span>
          <span class="lv-meta">${lv.desc} · ${lv.rounds} 题</span>
          ${best}
        </button>`
      })
      .join('')

    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel menu">
        <div class="logo">${game.icon}</div>
        <h1>${game.name}</h1>
        <p class="muted">每题 ${MATH.questionTime} 秒,打掉正确答案。越快分越高</p>
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

  showResult(result: QuizResult, onRetry: () => void, onMenu: () => void): void {
    const total = result.records.length
    const right = result.records.filter((r) => r.picked === r.answer)
    const accuracy = total ? right.length / total : 0
    const avg = right.length ? Math.round(right.reduce((a, r) => a + r.ms, 0) / right.length) : 0
    const wrong = result.records.filter((r) => r.picked !== r.answer)

    Progress.record(result.level.id, result.score, accuracy)

    const stars = accuracy >= 0.9 ? '⭐️⭐️⭐️' : accuracy >= 0.7 ? '⭐️⭐️' : accuracy >= 0.4 ? '⭐️' : '💪'
    const wrongHtml = wrong.length
      ? `<div class="wrong">
           <h3>这几道还要再练练</h3>
           <div class="wrong-list">${wrong.map(eqChip).join('')}</div>
         </div>`
      : '<p class="perfect">全对,而且一道没超时!🎉</p>'

    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel result">
        <div class="stars">${stars}</div>
        <h1>${result.level.name} 完成</h1>
        <div class="stats">
          <div><label>得分</label><b>${result.score}</b></div>
          <div><label>正确率</label><b>${right.length}/${total}</b></div>
          <div><label>最佳连击</label><b>${result.bestCombo}</b></div>
          <div><label>平均用时</label><b>${avg ? `${(avg / 1000).toFixed(1)}s` : '—'}</b></div>
        </div>
        ${wrongHtml}
        <div class="actions">
          <button class="btn primary" data-act="retry">再来一次</button>
          <button class="btn" data-act="menu">换难度</button>
        </div>
      </div>
    `
    this.root.querySelector('[data-act="retry"]')!.addEventListener('click', onRetry)
    this.root.querySelector('[data-act="menu"]')!.addEventListener('click', onMenu)
  }
}

function eqChip(r: QuizRecord): string {
  const tail = r.picked === null ? '超时' : `点了 ${r.picked}`
  return `<div class="chip eq"><b>${r.text} = ${r.answer}</b><i>${tail}</i></div>`
}
