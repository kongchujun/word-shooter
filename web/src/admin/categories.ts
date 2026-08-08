import { api, ApiError, type Category } from './api'
import type { State } from './state'
import { escapeHtml, ID_RE, qs, toast, toId } from './ui'
import { MIN_WORDS_PER_LEVEL } from '../config/levels'
import { t } from '../i18n'

export function renderCategories(root: HTMLElement, state: State, refresh: () => Promise<void>): void {
  // 在本地副本上改,点保存才整表提交
  let list: Category[] = state.data.categories.map((c) => ({ ...c }))

  root.innerHTML = `
    <div class="toolbar">
      <button class="btn primary" id="add">${t('admin.cats.add')}</button>
      <div class="spacer"></div>
      <button class="btn" id="save">${t('admin.save')}</button>
    </div>
    <p class="tip">${t('admin.cats.tip', { min: MIN_WORDS_PER_LEVEL })}</p>
    <div class="cat-list" id="list"></div>`

  const listEl = qs<HTMLDivElement>(root, '#list')

  const draw = (): void => {
    if (list.length === 0) {
      listEl.innerHTML = `<p class="empty">${t('admin.cats.empty')}</p>`
      return
    }
    listEl.innerHTML = list
      .map((c, i) => {
        const count = state.data.words.filter((w) => w.tags.includes(c.id)).length
        return `
        <div class="cat-row" data-i="${i}">
          <input class="cat-icon" value="${escapeHtml(c.icon)}" placeholder="🍎" maxlength="4" title="${t('admin.cats.iconTitle')}" />
          <input class="cat-name" value="${escapeHtml(c.name)}" placeholder="Fruit" title="${t('admin.cats.nameTitle')}" />
          <input class="cat-id" value="${escapeHtml(c.id)}" placeholder="fruit" title="${t('admin.cats.idTitle')}" />
          <span class="cat-count">${t('admin.cats.count', { n: count })}</span>
          <button class="icon-btn" data-up="${i}" title="${t('admin.cats.up')}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-down="${i}" title="${t('admin.cats.down')}" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-btn danger" data-del="${i}" title="${t('admin.words.delete')}">🗑</button>
        </div>`
      })
      .join('')

    // 输入直接写回本地副本
    listEl.querySelectorAll<HTMLDivElement>('.cat-row').forEach((row) => {
      const i = Number(row.dataset.i)
      row.querySelector<HTMLInputElement>('.cat-icon')!.addEventListener('input', (e) => {
        list[i].icon = (e.target as HTMLInputElement).value
      })
      row.querySelector<HTMLInputElement>('.cat-name')!.addEventListener('input', (e) => {
        list[i].name = (e.target as HTMLInputElement).value
      })
      row.querySelector<HTMLInputElement>('.cat-id')!.addEventListener('input', (e) => {
        list[i].id = (e.target as HTMLInputElement).value
      })
    })

    listEl.querySelectorAll<HTMLElement>('[data-up]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.up)
        ;[list[i - 1], list[i]] = [list[i], list[i - 1]]
        draw()
      }),
    )
    listEl.querySelectorAll<HTMLElement>('[data-down]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.down)
        ;[list[i + 1], list[i]] = [list[i], list[i + 1]]
        draw()
      }),
    )
    listEl.querySelectorAll<HTMLElement>('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.del)
        const c = list[i]
        const used = state.data.words.filter((w) => w.tags.includes(c.id)).length
        const warn = used > 0 ? t('admin.cats.inUse', { n: used }) : ''
        if (!confirm(t('admin.cats.confirmDelete', { name: c.name || c.id, warn }))) return
        list.splice(i, 1)
        draw()
      }),
    )
  }

  qs(root, '#add').addEventListener('click', () => {
    list.push({ id: '', name: '', icon: '', order: list.length + 1 })
    draw()
    // 焦点给到新建那行的 id 框
    const rows = listEl.querySelectorAll<HTMLElement>('.cat-row')
    rows[rows.length - 1]?.querySelector<HTMLInputElement>('.cat-id')?.focus()
  })

  qs(root, '#save').addEventListener('click', async () => {
    const clean = list.map((c) => ({ ...c, id: toId(c.id || c.name) }))
    for (const c of clean) {
      if (!ID_RE.test(c.id)) {
        toast(t('admin.cats.badId', { id: c.id }), 'error')
        return
      }
    }
    const ids = clean.map((c) => c.id)
    const dup = ids.find((id, i) => ids.indexOf(id) !== i)
    if (dup) {
      toast(t('admin.cats.dupId', { id: dup }), 'error')
      return
    }
    try {
      await api.saveCategories(clean)
      toast(t('admin.cats.saved'))
      await refresh()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  })

  draw()
}
