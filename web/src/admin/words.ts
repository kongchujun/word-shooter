import { api, ApiError, type AdminWord, type GenResult, type TTSProvider } from './api'
import { fileToB64, isReady, type State } from './state'
import { dataURL, escapeHtml, fmtBytes, fmtCost, h, ID_RE, qs, toast, toId } from './ui'

/** 编辑面板里还没落盘的素材 */
interface Pending {
  b64: string
  mediaType: string
  bytes: number
  source: 'ai' | 'file'
}

/** 每页卡片数。太多 DOM 会卡,后台词库长大了必须分页。 */
const PAGE_SIZE = 24

export function renderWords(root: HTMLElement, state: State, refresh: () => Promise<void>): void {
  const cats = state.data.categories
  // 从 state 里恢复上次的浏览位置 —— 保存词条会整页重绘,不恢复就跳回第一页
  const view = state.words
  const sel = (v: string): string => (view.filter === v ? ' selected' : '')
  const filterOpts = cats
    .map(
      (c) =>
        `<option value="${escapeHtml(c.id)}"${sel(c.id)}>${escapeHtml(c.icon)} ${escapeHtml(c.name)}</option>`,
    )
    .join('')

  root.innerHTML = `
    <div class="toolbar">
      <button class="btn primary" id="add">+ 加词</button>
      <input id="search" class="search" placeholder="搜单词或中文…" value="${escapeHtml(view.search)}" />
      <select id="filter" class="search" style="max-width:160px">
        <option value=""${sel('')}>全部类别</option>
        <option value="__none"${sel('__none')}>未分类</option>
        ${filterOpts}
      </select>
      <div class="spacer"></div>
      <span class="stat" id="stat"></span>
    </div>
    <div class="grid" id="grid"></div>
    <div class="pager" id="pager" hidden></div>`

  const grid = qs<HTMLDivElement>(root, '#grid')
  const pager = qs<HTMLDivElement>(root, '#pager')
  const search = qs<HTMLInputElement>(root, '#search')
  const filter = qs<HTMLSelectElement>(root, '#filter')

  const filtered = (): AdminWord[] => {
    const q = view.search.trim().toLowerCase()
    const f = view.filter
    return state.data.words.filter((w) => {
      if (q && !w.id.includes(q) && !w.zh.toLowerCase().includes(q)) return false
      if (f === '__none' && w.tags.length > 0) return false
      if (f && f !== '__none' && !w.tags.includes(f)) return false
      return true
    })
  }

  const draw = (): void => {
    const list = filtered()
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
    // 删词后最后一页可能空了,往回收一页
    if (view.page > pages) view.page = pages
    if (view.page < 1) view.page = 1

    const ready = state.data.words.filter(isReady).length
    qs(root, '#stat').textContent =
      `${state.data.words.length} 个词,${ready} 个素材齐全(只有齐全的才会进游戏)`

    if (list.length === 0) {
      grid.innerHTML = `<p class="empty">${state.data.words.length === 0 ? '还没有词。点「加词」开始,或者去「批量生成」一次加一批。' : '没有匹配的词。'}</p>`
      pager.hidden = true
      pager.innerHTML = ''
      return
    }

    const slice = list.slice((view.page - 1) * PAGE_SIZE, view.page * PAGE_SIZE)
    grid.innerHTML = slice.map((w) => card(w, state)).join('')
    for (const el of grid.querySelectorAll<HTMLElement>('[data-edit]')) {
      el.addEventListener('click', () => openEditor(state, refresh, el.dataset.edit!))
    }
    for (const el of grid.querySelectorAll<HTMLElement>('[data-play]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        new Audio(el.dataset.play!).play().catch(() => toast('播放失败', 'error'))
      })
    }
    for (const el of grid.querySelectorAll<HTMLElement>('[data-del]')) {
      el.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = el.dataset.del!
        if (!confirm(`删除「${id}」?图片和音频文件也会一起删掉。`)) return
        try {
          const r = await api.deleteWord(id)
          toast(`已删除 ${id},清理了 ${r.filesRemoved} 个文件`)
          await refresh()
        } catch (err) {
          toast(String(err instanceof ApiError ? err.message : err), 'error')
        }
      })
    }

    drawPager(pager, view.page, pages, list.length, (p) => {
      view.page = p
      draw()
      // 换页滚回词条区顶部,别让人在旧滚动位置干瞪眼
      root.scrollIntoView({ block: 'start' })
    })
  }

  // 改搜索/筛选时回到第一页 —— 结果集变了,停在第 5 页多半是空的
  search.addEventListener('input', () => {
    view.search = search.value
    view.page = 1
    draw()
  })
  filter.addEventListener('change', () => {
    view.filter = filter.value
    view.page = 1
    draw()
  })
  qs(root, '#add').addEventListener('click', () => openEditor(state, refresh, null))
  draw()
}

function drawPager(
  el: HTMLElement,
  page: number,
  pages: number,
  total: number,
  go: (p: number) => void,
): void {
  if (pages <= 1) {
    el.hidden = true
    el.innerHTML = ''
    return
  }
  el.hidden = false

  // 页码窗口:当前页前后各两页,两端用 …
  const nums: (number | '…')[] = []
  const push = (n: number | '…'): void => {
    if (nums[nums.length - 1] !== n) nums.push(n)
  }
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) push(i)
    else if (nums[nums.length - 1] !== '…') push('…')
  }

  el.innerHTML = `
    <button class="btn" data-p="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
    <div class="pager-nums">
      ${nums
        .map((n) =>
          n === '…'
            ? `<span class="pager-gap">…</span>`
            : `<button class="pager-num ${n === page ? 'active' : ''}" data-p="${n}">${n}</button>`,
        )
        .join('')}
    </div>
    <button class="btn" data-p="next" ${page >= pages ? 'disabled' : ''}>下一页</button>
    <span class="pager-meta">第 ${page} / ${pages} 页 · 本页筛选 ${total} 个</span>`

  el.querySelector('[data-p="prev"]')?.addEventListener('click', () => go(page - 1))
  el.querySelector('[data-p="next"]')?.addEventListener('click', () => go(page + 1))
  for (const b of el.querySelectorAll<HTMLElement>('.pager-num')) {
    b.addEventListener('click', () => go(Number(b.dataset.p)))
  }
}

function card(w: AdminWord, state: State): string {
  const thumb = w.image
    ? `<img src="${escapeHtml(w.image)}" alt="${escapeHtml(w.id)}" loading="lazy" />`
    : `<span class="no-img">缺图片</span>`
  const tags = w.tags.length
    ? w.tags
        .map((t) => {
          const c = state.data.categories.find((x) => x.id === t)
          return `<span class="chip">${escapeHtml(c?.icon ?? '🏷')} ${escapeHtml(c?.name ?? t)}</span>`
        })
        .join('')
    : `<span class="chip warn">未分类</span>`

  return `
    <div class="card ${isReady(w) ? '' : 'incomplete'}">
      <div class="thumb" data-edit="${escapeHtml(w.id)}">${thumb}</div>
      <div class="card-body">
        <div class="card-title">
          <b>${escapeHtml(w.id)}</b>
          <span>${escapeHtml(w.zh || '—')}</span>
        </div>
        <div class="chips">${tags}</div>
      </div>
      <div class="card-actions">
        ${w.audio ? `<button class="icon-btn" data-play="${escapeHtml(w.audio)}" title="试听">▶</button>` : `<span class="icon-btn muted" title="缺音频">🔇</span>`}
        <button class="icon-btn" data-edit="${escapeHtml(w.id)}" title="编辑">✎</button>
        <button class="icon-btn danger" data-del="${escapeHtml(w.id)}" title="删除">🗑</button>
      </div>
    </div>`
}

// ---------- 编辑面板 ----------

export function openEditor(state: State, refresh: () => Promise<void>, id: string | null): void {
  const existing = id ? state.data.words.find((w) => w.id === id) : undefined
  let img: Pending | null = null
  let aud: Pending | null = null
  let spent = 0

  const cats = state.data.categories
  const checks = cats
    .map(
      (c) => `<label class="check">
        <input type="checkbox" value="${escapeHtml(c.id)}" ${existing?.tags.includes(c.id) ? 'checked' : ''} />
        ${escapeHtml(c.icon)} ${escapeHtml(c.name)}
      </label>`,
    )
    .join('')

  const overlay = h('div', { class: 'overlay' })
  overlay.innerHTML = `
    <div class="drawer">
      <div class="drawer-head">
        <h2>${existing ? `编辑 ${escapeHtml(existing.id)}` : '加一个词'}</h2>
        <button class="icon-btn" id="close">✕</button>
      </div>
      <div class="drawer-body">
        <div class="field">
          <label>英文单词${existing ? '(建好后不能改,要改就删掉重建)' : ''}</label>
          <input id="en" value="${escapeHtml(existing?.id ?? '')}" ${existing ? 'disabled' : ''} placeholder="apple / ice-cream" />
        </div>
        <div class="field">
          <label>中文释义</label>
          <input id="zh" value="${escapeHtml(existing?.zh ?? '')}" placeholder="苹果" />
        </div>
        <div class="field">
          <label>类别${cats.length === 0 ? '(还没建类别,去「类别」页新建)' : ''}</label>
          <div class="checks">${checks || '<span class="muted">—</span>'}</div>
        </div>

        <div class="asset-row">
          <div class="asset">
            <label>图片</label>
            <div class="asset-preview" id="img-preview"></div>
            <div class="asset-btns">
              ${state.me.openrouter ? '<button class="btn" id="gen-img">✨ AI 生成</button>' : ''}
              <button class="btn" id="pick-img">选文件</button>
              <input type="file" id="file-img" accept="image/*" hidden />
            </div>
          </div>
          <div class="asset">
            <label>发音</label>
            <div class="asset-preview" id="aud-preview"></div>
            <div class="asset-btns">
              ${state.me.azure ? '<button class="btn" data-gen-aud="azure" title="微软神经网络语音">✨ Azure</button>' : ''}
              ${state.me.openrouter ? '<button class="btn" data-gen-aud="openrouter" title="OpenRouter TTS">✨ OpenRouter</button>' : ''}
              <button class="btn" id="pick-aud">选文件</button>
              <input type="file" id="file-aud" accept="audio/*" hidden />
            </div>
            <p class="muted small" id="aud-src"></p>
          </div>
        </div>
        <p class="cost" id="cost"></p>
      </div>
      <div class="drawer-foot">
        <span class="muted" id="hint"></span>
        <div class="spacer"></div>
        <button class="btn" id="cancel">取消</button>
        <button class="btn primary" id="save">保存</button>
      </div>
    </div>`
  document.body.appendChild(overlay)

  const en = qs<HTMLInputElement>(overlay, '#en')
  const zh = qs<HTMLInputElement>(overlay, '#zh')
  const close = (): void => overlay.remove()

  const drawImg = (): void => {
    const box = qs(overlay, '#img-preview')
    const src = img ? dataURL(img.b64, img.mediaType) : existing?.image
    box.innerHTML = src
      ? `<img src="${escapeHtml(src)}" />${img ? `<span class="badge">新 · ${fmtBytes(img.bytes)}</span>` : ''}`
      : '<span class="no-img">还没有图片</span>'
  }
  const drawAud = (): void => {
    const box = qs(overlay, '#aud-preview')
    const src = aud ? dataURL(aud.b64, aud.mediaType) : existing?.audio
    box.innerHTML = src
      ? `<audio controls src="${escapeHtml(src)}"></audio>${aud ? `<span class="badge">新 · ${fmtBytes(aud.bytes)}</span>` : ''}`
      : '<span class="no-img">还没有发音</span>'
  }
  const drawCost = (): void => {
    qs(overlay, '#cost').textContent = spent > 0 ? `本次生成花费 ${fmtCost(spent)}` : ''
  }
  drawImg()
  drawAud()

  const wordFor = (): string => en.value.trim() || existing?.id || ''

  const gen = async (
    kind: 'img' | 'aud',
    btn: HTMLButtonElement,
    provider?: TTSProvider,
  ): Promise<void> => {
    const word = wordFor()
    if (!word) {
      toast('先填英文单词', 'error')
      return
    }
    const label = btn.textContent
    btn.disabled = true
    // 图片模型动辄几十秒,不报秒数看着像卡死了
    const startedAt = Date.now()
    btn.textContent = '生成中 0s'
    const ticker = window.setInterval(() => {
      btn.textContent = `生成中 ${Math.round((Date.now() - startedAt) / 1000)}s`
    }, 1000)
    try {
      const r: GenResult =
        kind === 'img' ? await api.genImage(word) : await api.genAudio(word, provider)
      const p: Pending = { b64: r.b64, mediaType: r.mediaType, bytes: r.bytes, source: 'ai' }
      if (kind === 'img') {
        img = p
        drawImg()
        if (r.bytes > 400 * 1024) {
          toast(`图片有 ${fmtBytes(r.bytes)},偏大 —— 可以在设置里换个模型或调小尺寸`, 'error')
        }
      } else {
        aud = p
        drawAud()
        // 两个源可以来回试,标出当前听的是哪个生成的
        qs(overlay, '#aud-src').textContent = `当前:${r.model}`
      }
      spent += r.cost
      drawCost()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    } finally {
      window.clearInterval(ticker)
      btn.disabled = false
      btn.textContent = label
    }
  }

  overlay.querySelector('#gen-img')?.addEventListener('click', (e) =>
    gen('img', e.currentTarget as HTMLButtonElement),
  )
  // 每个语音源一个按钮,点哪个走哪个,不改默认设置
  for (const b of overlay.querySelectorAll<HTMLButtonElement>('[data-gen-aud]')) {
    b.addEventListener('click', () => gen('aud', b, b.dataset.genAud as TTSProvider))
  }

  const wireFile = (btnSel: string, inputSel: string, kind: 'img' | 'aud'): void => {
    const input = qs<HTMLInputElement>(overlay, inputSel)
    qs(overlay, btnSel).addEventListener('click', () => input.click())
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return
      if (file.size > 5 * 1024 * 1024) {
        toast('文件超过 5MB', 'error')
        return
      }
      const p: Pending = {
        b64: await fileToB64(file),
        mediaType: file.type || (kind === 'img' ? 'image/webp' : 'audio/mpeg'),
        bytes: file.size,
        source: 'file',
      }
      if (kind === 'img') {
        img = p
        drawImg()
      } else {
        aud = p
        drawAud()
      }
    })
  }
  wireFile('#pick-img', '#file-img', 'img')
  wireFile('#pick-aud', '#file-aud', 'aud')

  qs(overlay, '#close').addEventListener('click', close)
  qs(overlay, '#cancel').addEventListener('click', close)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })

  qs(overlay, '#save').addEventListener('click', async () => {
    const id2 = existing?.id ?? toId(en.value)
    if (!ID_RE.test(id2)) {
      toast('单词只能用小写字母、数字和连字符,且以字母开头(词组写成 ice-cream)', 'error')
      return
    }
    const tags = [...overlay.querySelectorAll<HTMLInputElement>('.checks input:checked')].map((x) => x.value)
    const btn = qs<HTMLButtonElement>(overlay, '#save')
    btn.disabled = true
    btn.textContent = '保存中…'
    try {
      await api.saveWord({
        id: id2,
        zh: zh.value.trim(),
        tags,
        imageB64: img?.b64,
        imageType: img?.mediaType,
        audioB64: aud?.b64,
        audioType: aud?.mediaType,
      })
      toast(`已保存 ${id2}`)
      close()
      await refresh()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
      btn.disabled = false
      btn.textContent = '保存'
    }
  })

  if (!existing) en.focus()
}
