import { api, ApiError } from './api'
import type { State } from './state'
import { dataURL, escapeHtml, fmtBytes, fmtCost, ID_RE, qs, toast, toId } from './ui'

interface Row {
  id: string
  en: string
  zh: string
  status: 'pending' | 'running' | 'done' | 'error' | 'saved'
  error?: string
  img?: { b64: string; mediaType: string; bytes: number }
  aud?: { b64: string; mediaType: string; bytes: number }
  cost: number
}

/** 一次生成太多的话,全部预览都堆在浏览器内存里 */
const SOFT_LIMIT = 20

export function renderBatch(root: HTMLElement, state: State, refresh: () => Promise<void>): void {
  let rows: Row[] = []
  let running = false

  const catChecks = state.data.categories
    .map(
      (c) => `<label class="check"><input type="checkbox" value="${escapeHtml(c.id)}" /> ${escapeHtml(c.icon)} ${escapeHtml(c.name)}</label>`,
    )
    .join('')

  root.innerHTML = `
    <div class="batch-input">
      <div class="field">
        <label>单词列表 —— 每行一个,可以写成 <code>apple 苹果</code> 一起带上中文</label>
        <textarea id="words" rows="7" placeholder="apple 苹果&#10;banana 香蕉&#10;cat 猫"></textarea>
      </div>
      <div class="field">
        <label>加到哪些类别</label>
        <div class="checks">${catChecks || '<span class="muted">还没建类别,可以先去「类别」页建</span>'}</div>
      </div>
      <div class="toolbar">
        <button class="btn primary" id="start">开始生成</button>
        <button class="btn" id="save-all" disabled>全部保存</button>
        <div class="spacer"></div>
        <span class="stat" id="stat"></span>
      </div>
      ${state.me.openrouter ? '' : '<p class="tip warn">后端没配 OPENROUTER_API_KEY,批量生成用不了。</p>'}
      <p class="tip">生成的结果只在浏览器里预览,点「全部保存」才写进 assets。一次建议不超过 ${SOFT_LIMIT} 个词。</p>
    </div>
    <div class="batch-rows" id="rows"></div>`

  const rowsEl = qs<HTMLDivElement>(root, '#rows')
  const startBtn = qs<HTMLButtonElement>(root, '#start')
  const saveBtn = qs<HTMLButtonElement>(root, '#save-all')

  const drawStat = (): void => {
    const done = rows.filter((r) => r.status === 'done').length
    const saved = rows.filter((r) => r.status === 'saved').length
    const cost = rows.reduce((a, r) => a + r.cost, 0)
    qs(root, '#stat').textContent = rows.length
      ? `${done} 个待保存 / ${saved} 个已保存 / 共 ${rows.length} 个 · 花费 ${fmtCost(cost)}`
      : ''
    saveBtn.disabled = done === 0 || running
  }

  const draw = (): void => {
    rowsEl.innerHTML = rows
      .map((r, i) => {
        const badge =
          r.status === 'running'
            ? '<span class="badge run">生成中…</span>'
            : r.status === 'error'
              ? `<span class="badge err" title="${escapeHtml(r.error ?? '')}">失败</span>`
              : r.status === 'saved'
                ? '<span class="badge ok">已保存</span>'
                : r.status === 'done'
                  ? '<span class="badge">待保存</span>'
                  : '<span class="badge">排队中</span>'
        return `
        <div class="batch-row">
          <div class="b-thumb">${r.img ? `<img src="${dataURL(r.img.b64, r.img.mediaType)}" />` : '<span class="no-img">—</span>'}</div>
          <div class="b-main">
            <div><b>${escapeHtml(r.en)}</b> <span class="muted">${escapeHtml(r.zh || '')}</span> ${badge}</div>
            ${r.error ? `<div class="b-err">${escapeHtml(r.error)}</div>` : ''}
            ${r.aud ? `<audio controls src="${dataURL(r.aud.b64, r.aud.mediaType)}"></audio>` : ''}
            ${r.img ? `<span class="muted small">图 ${fmtBytes(r.img.bytes)}${r.aud ? ` · 音 ${fmtBytes(r.aud.bytes)}` : ''}</span>` : ''}
          </div>
          <div class="b-actions">
            <button class="icon-btn" data-retry="${i}" title="重新生成">↻</button>
            <button class="icon-btn danger" data-drop="${i}" title="移除">✕</button>
          </div>
        </div>`
      })
      .join('')

    rowsEl.querySelectorAll<HTMLElement>('[data-drop]').forEach((b) =>
      b.addEventListener('click', () => {
        rows.splice(Number(b.dataset.drop), 1)
        draw()
        drawStat()
      }),
    )
    rowsEl.querySelectorAll<HTMLElement>('[data-retry]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (running) return
        const r = rows[Number(b.dataset.retry)]
        running = true
        await genOne(r)
        running = false
        draw()
        drawStat()
      }),
    )
    drawStat()
  }

  const genOne = async (r: Row): Promise<void> => {
    r.status = 'running'
    r.error = undefined
    draw()
    try {
      const i = await api.genImage(r.en)
      r.img = { b64: i.b64, mediaType: i.mediaType, bytes: i.bytes }
      r.cost += i.cost
      draw()
      const a = await api.genAudio(r.en)
      r.aud = { b64: a.b64, mediaType: a.mediaType, bytes: a.bytes }
      r.cost += a.cost
      r.status = 'done'
    } catch (err) {
      r.status = 'error'
      r.error = err instanceof ApiError ? err.message : String(err)
    }
  }

  startBtn.addEventListener('click', async () => {
    const lines = qs<HTMLTextAreaElement>(root, '#words')
      .value.split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) {
      toast('先粘一列单词', 'error')
      return
    }
    if (lines.length > SOFT_LIMIT && !confirm(`一次 ${lines.length} 个词,超过建议的 ${SOFT_LIMIT} 个。继续?`)) {
      return
    }

    rows = []
    for (const line of lines) {
      const [en, ...rest] = line.split(/[\s,，\t]+/)
      const id = toId(en)
      if (!ID_RE.test(id)) {
        toast(`跳过不合法的行:${line}`, 'error')
        continue
      }
      rows.push({ id, en: id, zh: rest.join(' '), status: 'pending', cost: 0 })
    }
    draw()

    running = true
    startBtn.disabled = true
    startBtn.textContent = '生成中…'
    // 串行生成:进度看得清楚,也不会一下子把 OpenRouter 打爆
    for (const r of rows) {
      if (r.status === 'saved') continue
      await genOne(r)
      draw()
    }
    running = false
    startBtn.disabled = false
    startBtn.textContent = '开始生成'
    drawStat()
    toast('生成完毕,检查一下再点「全部保存」')
  })

  saveBtn.addEventListener('click', async () => {
    const tags = [...root.querySelectorAll<HTMLInputElement>('.checks input:checked')].map((x) => x.value)
    const todo = rows.filter((r) => r.status === 'done')
    saveBtn.disabled = true
    saveBtn.textContent = '保存中…'
    let ok = 0
    for (const r of todo) {
      try {
        await api.saveWord({
          id: r.id,
          zh: r.zh,
          tags,
          imageB64: r.img?.b64,
          imageType: r.img?.mediaType,
          audioB64: r.aud?.b64,
          audioType: r.aud?.mediaType,
        })
        r.status = 'saved'
        ok++
      } catch (err) {
        r.status = 'error'
        r.error = err instanceof ApiError ? err.message : String(err)
      }
      draw()
    }
    saveBtn.textContent = '全部保存'
    toast(`保存了 ${ok} 个词`)
    await refresh()
  })

  draw()
}
