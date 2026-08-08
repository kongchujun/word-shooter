import { api, ApiError, type AccessEntry, type AccessSummary, type IpStat } from './api'
import type { State } from './state'
import { escapeHtml, qs, toast } from './ui'
import { t } from '../i18n'

const DAY_OPTIONS = [1, 3, 7, 14, 30]

export function renderAccess(root: HTMLElement, _state: State, _refresh: () => Promise<void>): void {
  let days = 7

  root.innerHTML = `
    <div class="toolbar">
      <label class="muted">${t('admin.acc.range')}</label>
      <select id="days" class="search" style="max-width:120px">
        ${DAY_OPTIONS.map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>${t('admin.acc.lastDays', { n: d })}</option>`).join('')}
      </select>
      <button class="btn" id="reload">${t('admin.refresh')}</button>
      <div class="spacer"></div>
      <span class="stat" id="stat">${t('admin.acc.loading')}</span>
    </div>
    <div id="body"></div>`

  const body = qs<HTMLDivElement>(root, '#body')
  const daysSel = qs<HTMLSelectElement>(root, '#days')

  const load = async (): Promise<void> => {
    body.innerHTML = `<p class="empty">${t('admin.acc.loading')}</p>`
    try {
      draw(await api.access(days))
    } catch (err) {
      body.innerHTML = `<p class="msg error">${escapeHtml(err instanceof ApiError ? err.message : String(err))}</p>`
    }
  }

  const draw = (d: AccessSummary): void => {
    const outside = d.ips.filter((x) => !x.private)
    qs(root, '#stat').textContent =
      t('admin.acc.stat', { total: d.total, ips: d.ips.length, public: outside.length, keep: d.keepDays })

    if (d.total === 0) {
      body.innerHTML = `<p class="empty">${t('admin.acc.empty')}<br /><span class="muted">${t('admin.acc.dbAt', { dir: escapeHtml(d.dir) })}</span></p>`
      return
    }

    body.innerHTML = `
      ${outside.length > 0 ? `<p class="tip warn">${t('admin.acc.publicWarn', { n: outside.length })}</p>` : ''}
      <h3 class="sec">${t('admin.acc.byIP')}</h3>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>${t('admin.acc.ip')}</th><th>${t('admin.acc.source')}</th>${d.geo ? `<th>${t('admin.acc.region')}</th>` : ''}<th>${t('admin.acc.device')}</th>
            <th class="num">${t('admin.acc.count')}</th><th class="num">${t('admin.acc.errors')}</th>
            <th>${t('admin.acc.last')}</th><th>${t('admin.acc.lastPath')}</th><th>${t('admin.acc.first')}</th>
          </tr></thead>
          <tbody>${d.ips.map((s) => ipRow(s, d.geo)).join('')}</tbody>
        </table>
      </div>

      <h3 class="sec">${t('admin.acc.recent', { n: d.recent.length })}</h3>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>${t('admin.acc.time')}</th><th>${t('admin.acc.ip')}</th><th>${t('admin.acc.method')}</th><th>${t('admin.acc.path')}</th><th class="num">${t('admin.acc.status')}</th><th class="num">${t('admin.acc.ms')}</th></tr></thead>
          <tbody>${d.recent.map(entryRow).join('')}</tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:14px">
        ${t('admin.acc.footer', { dir: escapeHtml(d.dir) })}
        ${d.geo ? `<br />${t('admin.acc.geoOn')}` : `<br />${t('admin.acc.geoOff')}`}
      </p>`
  }

  function ipRow(s: IpStat, geo: boolean): string {
    const src = s.private
      ? `<span class="chip">${t('admin.acc.lan')}</span>`
      : `<span class="chip warn">${t('admin.acc.wan')}</span>`
    // 内网没有归属地可言,查不到的也留空,别拿「未知」占地方
    const region = geo ? `<td>${s.region ? escapeHtml(s.region) : '<span class="muted">—</span>'}</td>` : ''
    return `<tr>
      <td class="mono">${escapeHtml(s.ip)}</td>
      <td>${src}</td>
      ${region}
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
    toast(t('admin.refreshed'))
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
    if (mins < 1) return t('admin.acc.justNow')
    if (mins < 60) return t('admin.acc.minsAgo', { n: mins })
    return t('admin.acc.todayAt', { time: hm })
  }
  return `${d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${hm}`
}

function clock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
