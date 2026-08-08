import { api, ApiError, type TTSProvider } from './api'
import type { State } from './state'
import { dataURL, escapeHtml, fmtBytes, fmtCost, ID_RE, qs, toast, toId } from './ui'
import { t } from '../i18n'

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
        <label>${t('admin.batch.words')}</label>
        <textarea id="words" rows="7" placeholder="${escapeHtml(t('admin.batch.placeholder'))}"></textarea>
      </div>
      <div class="field">
        <label>${t('admin.batch.cats')}</label>
        <div class="checks">${catChecks || `<span class="muted">${t('admin.batch.catsEmpty')}</span>`}</div>
      </div>
      <div class="field">
        <label>${t('admin.batch.ttsSource')}</label>
        <div class="checks" id="tts-provider">
          <label class="check radio">
            <input type="radio" name="btts" value="" checked /> ${t('admin.batch.follow', { name: state.settings.ttsProvider === 'azure' ? 'Azure' : 'OpenRouter' })}
          </label>
          ${state.me.azure ? '<label class="check radio"><input type="radio" name="btts" value="azure" /> 🅰️ Azure</label>' : ''}
          ${state.me.openrouter ? '<label class="check radio"><input type="radio" name="btts" value="openrouter" /> 🌐 OpenRouter</label>' : ''}
        </div>
      </div>
      <div class="toolbar">
        <button class="btn primary" id="start">${t('admin.batch.start')}</button>
        <button class="btn" id="save-all" disabled>${t('admin.batch.saveAll')}</button>
        <div class="spacer"></div>
        <span class="stat" id="stat"></span>
      </div>
      ${state.me.openrouter ? '' : `<p class="tip warn">${t('admin.batch.noKey')}</p>`}
      <p class="tip">${t('admin.batch.tip', { limit: SOFT_LIMIT })}</p>
    </div>
    <div class="batch-rows" id="rows"></div>`

  const rowsEl = qs<HTMLDivElement>(root, '#rows')
  const startBtn = qs<HTMLButtonElement>(root, '#start')
  const saveBtn = qs<HTMLButtonElement>(root, '#save-all')

  /** 空串 = 跟随设置里的默认语音源 */
  const pickedProvider = (): TTSProvider | undefined =>
    (root.querySelector<HTMLInputElement>('input[name="btts"]:checked')?.value || undefined) as
      | TTSProvider
      | undefined

  const drawStat = (): void => {
    const done = rows.filter((r) => r.status === 'done').length
    const saved = rows.filter((r) => r.status === 'saved').length
    const cost = rows.reduce((a, r) => a + r.cost, 0)
    qs(root, '#stat').textContent = rows.length
      ? t('admin.batch.stat', { done, saved, total: rows.length, cost: fmtCost(cost) })
      : ''
    saveBtn.disabled = done === 0 || running
  }

  const draw = (): void => {
    rowsEl.innerHTML = rows
      .map((r, i) => {
        const badge =
          r.status === 'running'
            ? `<span class="badge run">${t('admin.batch.stRunning')}</span>`
            : r.status === 'error'
              ? `<span class="badge err" title="${escapeHtml(r.error ?? '')}">${t('admin.batch.stError')}</span>`
              : r.status === 'saved'
                ? `<span class="badge ok">${t('admin.batch.stSaved')}</span>`
                : r.status === 'done'
                  ? `<span class="badge">${t('admin.batch.stDone')}</span>`
                  : `<span class="badge">${t('admin.batch.stPending')}</span>`
        return `
        <div class="batch-row">
          <div class="b-thumb">${r.img ? `<img src="${dataURL(r.img.b64, r.img.mediaType)}" />` : '<span class="no-img">—</span>'}</div>
          <div class="b-main">
            <div><b>${escapeHtml(r.en)}</b> <span class="muted">${escapeHtml(r.zh || '')}</span> ${badge}</div>
            ${r.error ? `<div class="b-err">${escapeHtml(r.error)}</div>` : ''}
            ${r.aud ? `<audio controls src="${dataURL(r.aud.b64, r.aud.mediaType)}"></audio>` : ''}
            ${r.img ? `<span class="muted small">${t('admin.batch.sizes', { img: fmtBytes(r.img.bytes), audio: r.aud ? t('admin.batch.audioSize', { size: fmtBytes(r.aud.bytes) }) : '' })}</span>` : ''}
          </div>
          <div class="b-actions">
            <button class="icon-btn" data-retry="${i}" title="${t('admin.batch.retry')}">↻</button>
            <button class="icon-btn danger" data-drop="${i}" title="${t('admin.batch.drop')}">✕</button>
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
      const a = await api.genAudio(r.en, pickedProvider())
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
      toast(t('admin.batch.needWords'), 'error')
      return
    }
    if (lines.length > SOFT_LIMIT && !confirm(t('admin.batch.overLimit', { n: lines.length, limit: SOFT_LIMIT }))) {
      return
    }

    rows = []
    for (const line of lines) {
      const [en, ...rest] = line.split(/[\s,，\t]+/)
      const id = toId(en)
      if (!ID_RE.test(id)) {
        toast(t('admin.batch.skipBad', { line }), 'error')
        continue
      }
      rows.push({ id, en: id, zh: rest.join(' '), status: 'pending', cost: 0 })
    }
    draw()

    running = true
    startBtn.disabled = true
    startBtn.textContent = t('admin.batch.stRunning')
    // 串行生成:进度看得清楚,也不会一下子把 OpenRouter 打爆
    for (const r of rows) {
      if (r.status === 'saved') continue
      await genOne(r)
      draw()
    }
    running = false
    startBtn.disabled = false
    startBtn.textContent = t('admin.batch.start')
    drawStat()
    toast(t('admin.batch.done'))
  })

  saveBtn.addEventListener('click', async () => {
    const tags = [...root.querySelectorAll<HTMLInputElement>('.checks input:checked')].map((x) => x.value)
    const todo = rows.filter((r) => r.status === 'done')
    saveBtn.disabled = true
    saveBtn.textContent = t('admin.saving')
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
    saveBtn.textContent = t('admin.batch.saveAll')
    toast(t('admin.batch.savedN', { n: ok }))
    await refresh()
  })

  draw()
}
