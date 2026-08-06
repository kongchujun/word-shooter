import { api, ApiError, type Category } from './api'
import type { State } from './state'
import { escapeHtml, ID_RE, qs, toast, toId } from './ui'

export function renderCategories(root: HTMLElement, state: State, refresh: () => Promise<void>): void {
  // 在本地副本上改,点保存才整表提交
  let list: Category[] = state.data.categories.map((c) => ({ ...c }))

  root.innerHTML = `
    <div class="toolbar">
      <button class="btn primary" id="add">+ 新建类别</button>
      <div class="spacer"></div>
      <button class="btn" id="save">保存</button>
    </div>
    <p class="tip">类别决定游戏里分成哪几关。一个类别至少要有 4 个素材齐全的词才会成关(不够的会并进「综合」)。</p>
    <div class="cat-list" id="list"></div>`

  const listEl = qs<HTMLDivElement>(root, '#list')

  const draw = (): void => {
    if (list.length === 0) {
      listEl.innerHTML = '<p class="empty">还没有类别。点「新建类别」加一个,比如 fruit / 水果 / 🍎</p>'
      return
    }
    listEl.innerHTML = list
      .map((c, i) => {
        const count = state.data.words.filter((w) => w.tags.includes(c.id)).length
        return `
        <div class="cat-row" data-i="${i}">
          <input class="cat-icon" value="${escapeHtml(c.icon)}" placeholder="🍎" maxlength="4" title="图标(emoji)" />
          <input class="cat-name" value="${escapeHtml(c.name)}" placeholder="水果" title="显示名" />
          <input class="cat-id" value="${escapeHtml(c.id)}" placeholder="fruit" title="id,英文小写,存进 words.json 的就是它" />
          <span class="cat-count">${count} 个词</span>
          <button class="icon-btn" data-up="${i}" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-down="${i}" title="下移" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-btn danger" data-del="${i}" title="删除">🗑</button>
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
        const warn = used > 0 ? `\n\n有 ${used} 个词属于它 —— 词不会被删,只是失去这个分类。` : ''
        if (!confirm(`删除类别「${c.name || c.id}」?${warn}`)) return
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
        toast(`类别 id「${c.id}」不合法:要用英文小写字母开头`, 'error')
        return
      }
    }
    const ids = clean.map((c) => c.id)
    const dup = ids.find((id, i) => ids.indexOf(id) !== i)
    if (dup) {
      toast(`类别 id 重复:${dup}`, 'error')
      return
    }
    try {
      await api.saveCategories(clean)
      toast('类别已保存')
      await refresh()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  })

  draw()
}
