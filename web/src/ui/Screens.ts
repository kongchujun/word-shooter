import { Progress } from '../systems/Progress'
import type { LevelDef, LevelResult, Word } from '../types'

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

  showLoading(text = '正在加载素材…'): void {
    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel loading">
        <div class="logo">🎯</div>
        <h1>单词射击</h1>
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
            const best = p ? `<span class="best">最高 ${p.best}</span>` : '<span class="best dim">还没玩过</span>'
            return `
          <button class="level-card" data-id="${lv.id}">
            <span class="lv-emoji">${lv.icon}</span>
            <span class="lv-name">${lv.name}</span>
            <span class="lv-meta">${lv.rounds} 个词 · 同屏 ${lv.targetCount} 个靶</span>
            ${best}
          </button>`
          })
          .join('')
      : `<p class="note">词还不够成关 —— 同一个类别至少要有 <strong>3</strong> 个词(图+音都齐)。去 <a href="/admin">后台</a> 再加几个,刷新就能玩。</p>`

    this.root.innerHTML = `
      <div class="panel menu">
        <div class="logo">🎯</div>
        <h1>单词射击</h1>
        <p class="muted">听到单词,瞄准对应的图片开枪</p>
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
           <h3>这几个词还要再练练</h3>
           <div class="wrong-list">${wrong.map((r) => wordChip(r.word, `错 ${r.misses} 次`)).join('')}</div>
         </div>`
      : `<p class="perfect">全部一次命中,太棒了!🎉</p>`

    this.root.classList.remove('hidden')
    this.root.innerHTML = `
      <div class="panel result">
        <div class="stars">${stars}</div>
        <h1>${result.level.name} 完成</h1>
        <div class="stats">
          <div><label>得分</label><b>${result.score}</b></div>
          <div><label>一次命中</label><b>${clean}/${total}</b></div>
          <div><label>最佳连击</label><b>${result.bestCombo}</b></div>
          <div><label>平均反应</label><b>${avg ? `${(avg / 1000).toFixed(1)}s` : '—'}</b></div>
        </div>
        ${wrongHtml}
        <div class="actions">
          <button class="btn primary" data-act="retry">再来一次</button>
          <button class="btn" data-act="menu">选关</button>
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
