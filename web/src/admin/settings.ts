import { api, ApiError, type OrModel, type TTSProvider } from './api'
import type { State } from './state'
import { escapeHtml, qs, toast } from './ui'

export function renderSettings(root: HTMLElement, state: State, refresh: () => Promise<void>): void {
  const s = state.settings

  root.innerHTML = `
    <div class="settings">
      <h3>图片生成</h3>
      <div class="field">
        <label>模型 <span class="muted">带 ✓ 的支持透明背景 —— 强烈建议选这类,否则靶子会是带底色的方块</span></label>
        <select id="img-model"><option value="${escapeHtml(s.imageModel)}">${escapeHtml(s.imageModel)}(当前)</option></select>
      </div>
      <div class="field">
        <label>尺寸</label>
        <input id="img-size" value="${escapeHtml(s.imageSize)}" placeholder="1024x1024" />
      </div>
      <div class="field">
        <label>Prompt 模板 —— <code>{word}</code> 会被换成单词</label>
        <textarea id="img-prompt" rows="5">${escapeHtml(s.imagePrompt)}</textarea>
      </div>

      <h3>发音生成</h3>
      <div class="field">
        <label>默认语音源 <span class="muted">批量生成用这个;单个词的编辑页两个源都能随时点</span></label>
        <div class="checks" id="tts-provider">
          <label class="check radio">
            <input type="radio" name="ttsp" value="azure" ${s.ttsProvider === 'azure' ? 'checked' : ''} ${state.me.azure ? '' : 'disabled'} />
            🅰️ Azure 语音${state.me.azure ? '' : '(未配置 AZURE_API_KEY)'}
          </label>
          <label class="check radio">
            <input type="radio" name="ttsp" value="openrouter" ${s.ttsProvider === 'openrouter' ? 'checked' : ''} ${state.me.openrouter ? '' : 'disabled'} />
            🌐 OpenRouter${state.me.openrouter ? '' : '(未配置 OPENROUTER_API_KEY)'}
          </label>
        </div>
      </div>

      <div class="field" ${state.me.azure ? '' : 'hidden'}>
        <label>Azure 音色 <span class="muted">en-US-AnaNeural 是儿童音</span></label>
        <select id="azure-voice"><option value="${escapeHtml(s.azureVoice)}">${escapeHtml(s.azureVoice)}(当前)</option></select>
      </div>

      <div class="field">
        <label>OpenRouter 模型</label>
        <select id="tts-model"><option value="${escapeHtml(s.ttsModel)}">${escapeHtml(s.ttsModel)}(当前)</option></select>
      </div>
      <div class="field">
        <label>OpenRouter 音色</label>
        <select id="tts-voice"><option value="${escapeHtml(s.ttsVoice)}">${escapeHtml(s.ttsVoice)}(当前)</option></select>
      </div>
      <div class="field">
        <label>语速(给孩子听建议 0.9 左右,两个源都生效)</label>
        <input id="tts-speed" type="number" step="0.05" min="0.5" max="2" value="${s.ttsSpeed}" />
      </div>

      <div class="toolbar">
        <button class="btn primary" id="save">保存设置</button>
        <button class="btn" id="test">试生成一张(apple)</button>
        ${state.me.azure ? '<button class="btn" data-try="azure">试听 Azure</button>' : ''}
        ${state.me.openrouter ? '<button class="btn" data-try="openrouter">试听 OpenRouter</button>' : ''}
        <div class="spacer"></div>
        <span class="muted" id="models-status">正在拉模型列表…</span>
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
        ? `部分列表拉取失败:${list.warning}`
        : `图片 ${list.image.length} 个 · OpenRouter 发音 ${list.speech.length} 个 · Azure 音色 ${list.azure?.length ?? 0} 个`
    } catch (err) {
      qs(root, '#models-status').textContent = `模型列表拉取失败,可手填 id:${err instanceof ApiError ? err.message : err}`
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
      toast('设置已保存')
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
      b.textContent = '生成中…'
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
    btn.textContent = '生成中…'
    const out = qs(root, '#test-out')
    out.innerHTML = ''
    try {
      const r = await api.genImage('apple', qs<HTMLTextAreaElement>(root, '#img-prompt').value)
      out.innerHTML = `
        <div class="test-shot">
          <img src="data:${r.mediaType};base64,${r.b64}" />
          <p class="muted">${escapeHtml(r.model)} · ${(r.bytes / 1024).toFixed(0)} KB · $${r.cost.toFixed(4)}
          <br />棋盘格能透出来就说明背景是透明的</p>
        </div>`
    } catch (err) {
      out.innerHTML = `<p class="msg error">${escapeHtml(err instanceof ApiError ? err.message : String(err))}</p>`
    } finally {
      btn.disabled = false
      btn.textContent = '试生成一张(apple)'
    }
  })
}
