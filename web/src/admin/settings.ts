import { api, ApiError, type OrModel, type TTSProvider } from './api'
import type { State } from './state'
import { escapeHtml, qs, toast } from './ui'
import { t } from '../i18n'

export function renderSettings(root: HTMLElement, state: State, refresh: () => Promise<void>): void {
  const s = state.settings

  root.innerHTML = `
    <div class="settings">
      <h3>${t('admin.set.imageSection')}</h3>
      <div class="field">
        <label>${t('admin.set.model')} <span class="muted">${t('admin.set.modelHint')}</span></label>
        <select id="img-model"><option value="${escapeHtml(s.imageModel)}">${escapeHtml(s.imageModel)}${t('admin.set.current')}</option></select>
      </div>
      <div class="field">
        <label>${t('admin.set.size')}</label>
        <input id="img-size" value="${escapeHtml(s.imageSize)}" placeholder="1024x1024" />
      </div>
      <div class="field">
        <label>${t('admin.set.prompt')}</label>
        <textarea id="img-prompt" rows="5">${escapeHtml(s.imagePrompt)}</textarea>
      </div>

      <h3>${t('admin.set.ttsSection')}</h3>
      <div class="field">
        <label>${t('admin.set.defaultProvider')} <span class="muted">${t('admin.set.defaultProviderHint')}</span></label>
        <div class="checks" id="tts-provider">
          <label class="check radio">
            <input type="radio" name="ttsp" value="azure" ${s.ttsProvider === 'azure' ? 'checked' : ''} ${state.me.azure ? '' : 'disabled'} />
            🅰️ Azure${state.me.azure ? '' : t('admin.set.azureNoKey')}
          </label>
          <label class="check radio">
            <input type="radio" name="ttsp" value="openrouter" ${s.ttsProvider === 'openrouter' ? 'checked' : ''} ${state.me.openrouter ? '' : 'disabled'} />
            🌐 OpenRouter${state.me.openrouter ? '' : t('admin.set.orNoKey')}
          </label>
        </div>
      </div>

      <div class="field" ${state.me.azure ? '' : 'hidden'}>
        <label>${t('admin.set.azureVoice')} <span class="muted">${t('admin.set.azureVoiceHint')}</span></label>
        <select id="azure-voice"><option value="${escapeHtml(s.azureVoice)}">${escapeHtml(s.azureVoice)}${t('admin.set.current')}</option></select>
      </div>

      <div class="field">
        <label>${t('admin.set.orModel')}</label>
        <select id="tts-model"><option value="${escapeHtml(s.ttsModel)}">${escapeHtml(s.ttsModel)}${t('admin.set.current')}</option></select>
      </div>
      <div class="field">
        <label>${t('admin.set.orVoice')}</label>
        <select id="tts-voice"><option value="${escapeHtml(s.ttsVoice)}">${escapeHtml(s.ttsVoice)}${t('admin.set.current')}</option></select>
      </div>
      <div class="field">
        <label>${t('admin.set.speed')}</label>
        <input id="tts-speed" type="number" step="0.05" min="0.5" max="2" value="${s.ttsSpeed}" />
      </div>

      <div class="toolbar">
        <button class="btn primary" id="save">${t('admin.set.save')}</button>
        <button class="btn" id="test">${t('admin.set.testImage')}</button>
        ${state.me.azure ? `<button class="btn" data-try="azure">${t('admin.set.tryAzure')}</button>` : ''}
        ${state.me.openrouter ? `<button class="btn" data-try="openrouter">${t('admin.set.tryOr')}</button>` : ''}
        <div class="spacer"></div>
        <span class="muted" id="models-status">${t('admin.set.loadingModels')}</span>
      </div>
      <div id="try-out"></div>
      <div id="test-out"></div>
    </div>`

  const imgModel = qs<HTMLSelectElement>(root, '#img-model')
  const ttsModel = qs<HTMLSelectElement>(root, '#tts-model')
  const ttsVoice = qs<HTMLSelectElement>(root, '#tts-voice')

  const fillVoices = (model: string, models: OrModel[]): void => {
    const voices = models.find((m) => m.id === model)?.voices ?? []
    if (voices.length === 0) {
      ttsVoice.innerHTML = `<option value="${escapeHtml(s.ttsVoice)}">${escapeHtml(s.ttsVoice)}</option>`
      return
    }
    ttsVoice.innerHTML = voices
      .map((v) => `<option value="${escapeHtml(v)}" ${v === s.ttsVoice ? 'selected' : ''}>${escapeHtml(v)}</option>`)
      .join('')
  }

  // 模型列表要联网,慢,异步填充
  void (async () => {
    try {
      const list = state.models ?? (await api.models())
      state.models = list
      imgModel.innerHTML = list.image
        .map(
          (m) =>
            `<option value="${escapeHtml(m.id)}" ${m.id === s.imageModel ? 'selected' : ''}>${m.transparent ? '✓ ' : '　'}${escapeHtml(m.id)}</option>`,
        )
        .join('')
      ttsModel.innerHTML = list.speech
        .map(
          (m) =>
            `<option value="${escapeHtml(m.id)}" ${m.id === s.ttsModel ? 'selected' : ''}>${escapeHtml(m.id)}</option>`,
        )
        .join('')
      fillVoices(ttsModel.value, list.speech)
      ttsModel.addEventListener('change', () => fillVoices(ttsModel.value, list.speech))

      const azureVoice = root.querySelector<HTMLSelectElement>('#azure-voice')
      if (azureVoice && list.azure?.length) {
        azureVoice.innerHTML = list.azure
          .map(
            (m) =>
              `<option value="${escapeHtml(m.id)}" ${m.id === s.azureVoice ? 'selected' : ''}>${escapeHtml(m.name)}</option>`,
          )
          .join('')
      }

      qs(root, '#models-status').textContent = list.warning
        ? t('admin.set.modelWarn', { err: list.warning })
        : t('admin.set.modelStat', { image: list.image.length, speech: list.speech.length, azure: list.azure?.length ?? 0 })
    } catch (err) {
      qs(root, '#models-status').textContent = t('admin.set.modelFail', { err: String(err instanceof ApiError ? err.message : err) })
      imgModel.insertAdjacentHTML('afterend', `<input id="img-model-manual" value="${escapeHtml(s.imageModel)}" />`)
    }
  })()

  qs(root, '#save').addEventListener('click', async () => {
    try {
      const picked = root.querySelector<HTMLInputElement>('input[name="ttsp"]:checked')
      const saved = await api.saveSettings({
        imageModel: imgModel.value,
        imageSize: qs<HTMLInputElement>(root, '#img-size').value.trim(),
        imagePrompt: qs<HTMLTextAreaElement>(root, '#img-prompt').value,
        ttsProvider: (picked?.value as TTSProvider) ?? s.ttsProvider,
        ttsModel: ttsModel.value,
        ttsVoice: ttsVoice.value,
        azureVoice: root.querySelector<HTMLSelectElement>('#azure-voice')?.value ?? s.azureVoice,
        ttsSpeed: Number(qs<HTMLInputElement>(root, '#tts-speed').value) || 0.95,
      })
      state.settings = saved
      toast(t('admin.set.saved'))
      await refresh()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  })

  // 试听:用下拉框里当前选的音色,不必先保存设置,方便来回对比
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-try]')) {
    b.addEventListener('click', async () => {
      const provider = b.dataset.try as TTSProvider
      const voice =
        provider === 'azure'
          ? root.querySelector<HTMLSelectElement>('#azure-voice')?.value
          : ttsVoice.value
      const label = b.textContent
      b.disabled = true
      b.textContent = t('admin.batch.stRunning')
      const out = qs(root, '#try-out')
      try {
        const r = await api.genAudio('apple', provider, voice)
        out.insertAdjacentHTML(
          'afterbegin',
          `<div class="try-row">
             <audio controls autoplay src="data:${r.mediaType};base64,${r.b64}"></audio>
             <span class="muted">${escapeHtml(r.model)} · ${(r.bytes / 1024).toFixed(1)} KB</span>
           </div>`,
        )
      } catch (err) {
        toast(err instanceof ApiError ? err.message : String(err), 'error')
      } finally {
        b.disabled = false
        b.textContent = label
      }
    })
  }

  qs(root, '#test').addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement
    btn.disabled = true
    btn.textContent = t('admin.batch.stRunning')
    const out = qs(root, '#test-out')
    out.innerHTML = ''
    try {
      const r = await api.genImage('apple', qs<HTMLTextAreaElement>(root, '#img-prompt').value)
      out.innerHTML = `
        <div class="test-shot">
          <img src="data:${r.mediaType};base64,${r.b64}" />
          <p class="muted">${escapeHtml(r.model)} · ${(r.bytes / 1024).toFixed(0)} KB · $${r.cost.toFixed(4)}
          <br />${t('admin.set.shotHint')}</p>
        </div>`
    } catch (err) {
      out.innerHTML = `<p class="msg error">${escapeHtml(err instanceof ApiError ? err.message : String(err))}</p>`
    } finally {
      btn.disabled = false
      btn.textContent = t('admin.set.testImage')
    }
  })
}
