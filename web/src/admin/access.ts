import { api, ApiError, type AccessEntry, type AccessSummary, type IpStat } from './api'
import type { State } from './state'
import { escapeHtml, qs, toast } from './ui'

const DAY_OPTIONS = [1, 3, 7, 14, 30]

export function renderAccess(root: HTMLElement, _state: State, _refresh: () => Promise<void>): void {
  let days = 7

  root.innerHTML = `
    <div class="toolbar">
      <label class="muted">时间范围</label>
      <select id="days" class="search" style="max-width:120px">
        ${DAY_OPTIONS.map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>最近 ${d} 天</option>`).join('')}
      </select>
      <button class="btn" id="reload">刷新</button>
      <div class="spacer"></div>
      <span class="stat" id="stat">加载中…</span>
    </div>
    <div id="body"></div>`

  const body = qs<HTMLDivElement>(root, '#body')
  const daysSel = qs<HTMLSelectElement>(root, '#days')

  const load = async (): Promise<void> => {
    body.innerHTML = '<p class="empty">加载中…</p>'
    try {
      draw(await api.access(days))
    } catch (err) {
      body.innerHTML = `<p class="msg error">${escapeHtml(err instanceof ApiError ? err.message : String(err))}</p>`
    }
  }

  const draw = (d: AccessSummary): void => {
    const outside = d.ips.filter((x) => !x.private)
    qs(root, '#stat').textContent =
      `${d.total} 次请求 · ${d.ips.length} 个 IP(其中 ${outside.length} 个来自公网)· 日志保留 ${d.keepDays} 天`

    if (d.total === 0) {
      body.innerHTML = `<p class="empty">这段时间还没有访问记录。<br /><span class="muted">日志目录:${escapeHtml(d.dir)}</span></p>`
      return
    }

    body.innerHTML = `
      ${outside.length > 0 ? `<p class="tip warn">有 ${outside.length} 个公网 IP 访问过。如果这台机器只给家里用,建议只在局域网开放,或者加一层反向代理限制来源。</p>` : ''}
      <h3 class="sec">按 IP</h3>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>IP</th><th>来源</th><th>设备</th><th class="num">请求</th><th class="num">出错</th>
            <th>最近访问</th><th>最近页面</th><th>首次</th>
          </tr></thead>
          <tbody>${d.ips.map(ipRow).join('')}</tbody>
        </table>
      </div>

      <h3 class="sec">最近 ${d.recent.length} 条请求</h3>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>时间</th><th>IP</th><th>方法</th><th>路径</th><th class="num">状态</th><th class="num">耗时</th></tr></thead>
          <tbody>${d.recent.map(entryRow).join('')}</tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:14px">
        日志目录 <code>${escapeHtml(d.dir)}</code> · 图片音频和前端静态资源不记录,否则一局游戏就能刷出几十条
      </p>`
  }

  function ipRow(s: IpStat): string {
    const src = s.private
      ? '<span class="chip">局域网</span>'
      : '<span class="chip warn">公网</span>'
    return `<tr>
      <td class="mono">${escapeHtml(s.ip)}</td>
      <td>${src}</td>
      <td>${escapeHtml(s.device)}</td>
      <td class="num">${s.count}</td>
      <td class="num ${s.errors > 0 ? 'bad' : ''}">${s.errors || '—'}</td>
      <td>${escapeHtml(when(s.last))}</td>
      <td class="mono ellipsis" title="${escapeHtml(s.lastPath)}">${escapeHtml(s.lastPath)}</td>
      <td class="muted">${escapeHtml(when(s.first))}</td>
    </tr>`
  }

  function entryRow(e: AccessEntry): string {
    return `<tr>
      <td class="mono">${escapeHtml(clock(e.t))}</td>
      <td class="mono">${escapeHtml(e.ip)}</td>
      <td>${escapeHtml(e.m)}</td>
      <td class="mono ellipsis" title="${escapeHtml(e.p)}">${escapeHtml(e.p)}</td>
      <td class="num ${e.s >= 400 ? 'bad' : ''}">${e.s}</td>
      <td class="num muted">${e.ms}ms</td>
    </tr>`
  }

  daysSel.addEventListener('change', () => {
    days = Number(daysSel.value)
    void load()
  })
  qs(root, '#reload').addEventListener('click', () => {
    void load()
    toast('已刷新')
  })

  void load()
}

/** 今天的只显示时间,更早的带日期 */
function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) {
    const mins = Math.round((now.getTime() - d.getTime()) / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins} 分钟前`
    return `今天 ${hm}`
  }
  return `${d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${hm}`
}

function clock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
