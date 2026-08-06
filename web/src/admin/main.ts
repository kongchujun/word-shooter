import './style.css'
import { api, ApiError, type Me } from './api'
import { renderBatch } from './batch'
import { renderCategories } from './categories'
import { renderSettings } from './settings'
import { loadState, type State, type Tab } from './state'
import { escapeHtml, qs } from './ui'
import { renderWords } from './words'

const app = document.getElementById('app') as HTMLDivElement

const TABS: { id: Tab; label: string }[] = [
  { id: 'words', label: '词条' },
  { id: 'categories', label: '类别' },
  { id: 'batch', label: '批量生成' },
  { id: 'settings', label: '设置' },
]

async function boot(): Promise<void> {
  let me: Me
  try {
    me = await api.me()
  } catch (err) {
    renderFatal(err)
    return
  }

  if (!me.enabled) {
    renderDisabled()
    return
  }
  if (!me.loggedIn) {
    renderLogin()
    return
  }

  try {
    renderDashboard(await loadState(me))
  } catch (err) {
    renderFatal(err)
  }
}

function renderFatal(err: unknown): void {
  const msg = err instanceof ApiError ? err.message : String(err)
  app.innerHTML = `
    <div class="login-wrap"><div class="login">
      <div class="logo">🔌</div>
      <h1>出错了</h1>
      <p class="msg error">${escapeHtml(msg)}</p>
      <p class="hint">确认 Go 后端在跑:<code>cd ~/projects/word-shooter && ./build/word-shooter</code></p>
    </div></div>`
}

function renderDisabled(): void {
  app.innerHTML = `
    <div class="login-wrap"><div class="login">
      <div class="logo">🔒</div>
      <h1>后台未启用</h1>
      <p class="hint">
        在二进制同目录的 <code>.env</code> 里补上这两行,然后重启后端:
        <br /><br /><code>admin=你的用户名</code><br /><code>password=你的密码</code>
      </p>
    </div></div>`
}

function renderLogin(): void {
  app.innerHTML = `
    <div class="login-wrap">
      <form class="login" id="login-form">
        <div class="logo">🎯</div>
        <h1>词库管理</h1>
        <div class="field">
          <label for="u">用户名</label>
          <input id="u" name="username" autocomplete="username" autofocus />
        </div>
        <div class="field">
          <label for="p">密码</label>
          <input id="p" name="password" type="password" autocomplete="current-password" />
        </div>
        <button class="btn primary block" type="submit">登录</button>
        <p class="msg" id="login-msg"></p>
        <p class="hint">账号密码取自后端 <code>.env</code> 里的 <code>admin</code> 和 <code>password</code>。</p>
      </form>
    </div>`

  const form = qs<HTMLFormElement>(app, '#login-form')
  const msg = qs<HTMLParagraphElement>(app, '#login-msg')
  const btn = qs<HTMLButtonElement>(form, 'button')

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const data = new FormData(form)
    btn.disabled = true
    msg.className = 'msg'
    msg.textContent = '登录中…'
    try {
      await api.login(String(data.get('username') ?? ''), String(data.get('password') ?? ''))
      await boot()
    } catch (err) {
      msg.className = 'msg error'
      msg.textContent = err instanceof ApiError ? err.message : String(err)
      btn.disabled = false
    }
  })
}

function renderDashboard(state: State): void {
  app.innerHTML = `
    <div class="topbar">
      <h1>🎯 词库管理</h1>
      <nav class="tabs" id="tabs">
        ${TABS.map((t) => `<button data-tab="${t.id}">${t.label}</button>`).join('')}
      </nav>
      <div class="spacer"></div>
      <a href="/" target="_blank">打开游戏 ↗</a>
      <span class="muted">${escapeHtml(state.me.username)}</span>
      <button class="btn" id="logout">退出</button>
    </div>
    <main id="main"></main>`

  const main = qs<HTMLElement>(app, '#main')

  // 重新拉数据并重绘当前页,保存后调用
  const refresh = async (): Promise<void> => {
    state.data = await api.data()
    state.settings = await api.settings()
    show(state.tab)
  }

  const show = (tab: Tab): void => {
    state.tab = tab
    for (const b of app.querySelectorAll<HTMLButtonElement>('#tabs button')) {
      b.classList.toggle('active', b.dataset.tab === tab)
    }
    main.innerHTML = ''
    switch (tab) {
      case 'words':
        renderWords(main, state, refresh)
        break
      case 'categories':
        renderCategories(main, state, refresh)
        break
      case 'batch':
        renderBatch(main, state, refresh)
        break
      case 'settings':
        renderSettings(main, state, refresh)
        break
    }
  }

  for (const b of app.querySelectorAll<HTMLButtonElement>('#tabs button')) {
    b.addEventListener('click', () => show(b.dataset.tab as Tab))
  }
  qs(app, '#logout').addEventListener('click', async () => {
    await api.logout()
    await boot()
  })

  show('words')
}

void boot()
