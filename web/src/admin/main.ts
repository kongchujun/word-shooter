import './style.css'
import { api, ApiError, type Me } from './api'
import { renderAccess } from './access'
import { renderBatch } from './batch'
import { renderCategories } from './categories'
import { renderSettings } from './settings'
import { loadState, type State, type Tab } from './state'
import { escapeHtml, qs } from './ui'
import { renderWords } from './words'
import { applyDocumentLang, getLocale, LOCALES, setLocale, t } from '../i18n'

const app = document.getElementById('app') as HTMLDivElement

const TABS = (): { id: Tab; label: string }[] => [
  { id: 'words', label: t('admin.tab.words') },
  { id: 'categories', label: t('admin.tab.categories') },
  { id: 'batch', label: t('admin.tab.batch') },
  { id: 'settings', label: t('admin.tab.settings') },
  { id: 'access', label: t('admin.tab.access') },
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
      <h1>${t('admin.fatal.title')}</h1>
      <p class="msg error">${escapeHtml(msg)}</p>
      <p class="hint">${t('admin.fatal.hint')}</p>
    </div></div>`
}

function renderDisabled(): void {
  app.innerHTML = `
    <div class="login-wrap"><div class="login">
      <div class="logo">🔒</div>
      <h1>${t('admin.disabled.title')}</h1>
      <p class="hint">
        ${t('admin.disabled.hint')}
        <br /><br /><code>admin=…</code><br /><code>password=…</code>
      </p>
    </div></div>`
}

function renderLogin(): void {
  app.innerHTML = `
    <div class="login-wrap">
      <form class="login" id="login-form">
        <div class="logo">🎯</div>
        <h1>${t('admin.title')}</h1>
        <div class="field">
          <label for="u">${t('admin.login.username')}</label>
          <input id="u" name="username" autocomplete="username" autofocus />
        </div>
        <div class="field">
          <label for="p">${t('admin.login.password')}</label>
          <input id="p" name="password" type="password" autocomplete="current-password" />
        </div>
        <button class="btn primary block" type="submit">${t('admin.login')}</button>
        <p class="msg" id="login-msg"></p>
        <p class="hint">${t('admin.login.hint')}</p>
        <div class="lang-switch center">
          ${LOCALES.map(
            (l) => `<button type="button" class="lang-btn${l.id === getLocale() ? ' active' : ''}" data-locale="${l.id}">${l.name}</button>`,
          ).join('')}
        </div>
      </form>
    </div>`

  const form = qs<HTMLFormElement>(app, '#login-form')
  const msg = qs<HTMLParagraphElement>(app, '#login-msg')
  const btn = qs<HTMLButtonElement>(form, 'button')

  for (const el of app.querySelectorAll<HTMLElement>('[data-locale]')) {
    el.addEventListener('click', () => setLocale(el.dataset.locale as never))
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const data = new FormData(form)
    btn.disabled = true
    msg.className = 'msg'
    msg.textContent = t('admin.login.loading')
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
      <h1>🎯 ${t('admin.title')}</h1>
      <nav class="tabs" id="tabs">
        ${TABS().map((tab) => `<button data-tab="${tab.id}">${tab.label}</button>`).join('')}
      </nav>
      <div class="spacer"></div>
      <div class="lang-switch">
        ${LOCALES.map(
          (l) => `<button class="lang-btn${l.id === getLocale() ? ' active' : ''}" data-locale="${l.id}">${l.name}</button>`,
        ).join('')}
      </div>
      <a href="/" target="_blank">${t('admin.openGame')}</a>
      <span class="muted">${escapeHtml(state.me.username)}</span>
      <button class="btn" id="logout">${t('admin.logout')}</button>
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
      case 'access':
        renderAccess(main, state, refresh)
        break
    }
  }

  for (const b of app.querySelectorAll<HTMLButtonElement>('#tabs button')) {
    b.addEventListener('click', () => show(b.dataset.tab as Tab))
  }
  for (const el of app.querySelectorAll<HTMLElement>('[data-locale]')) {
    el.addEventListener('click', () => setLocale(el.dataset.locale as never))
  }
  qs(app, '#logout').addEventListener('click', async () => {
    await api.logout()
    await boot()
  })

  show('words')
}

applyDocumentLang()
void boot()
