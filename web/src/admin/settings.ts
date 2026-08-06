import { api, ApiError, type OrModel } from './api'
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
        <label>模型</label>
        <select id="tts-model"><option value="${escapeHtml(s.ttsModel)}">${escapeHtml(s.ttsModel)}(当前)</option></select>
      </div>
      <div class="field">
        <label>音色</label>
        <select id="tts-voice"><option value="${escapeHtml(s.ttsVoice)}">${escapeHtml(s.ttsVoice)}(当前)</option></select>
      </div>
      <div class="field">
        <label>语速(给孩子听建议 0.9 左右)</label>
        <input id="tts-speed" type="number" step="0.05" min="0.5" max="2" value="${s.ttsSpeed}" />
      </div>

      <div class="toolbar">
        <button class="btn primary" id="save">保存设置</button>
        <button class="btn" id="test">试生成一张(apple)</button>
        <div class="spacer"></div>
        <span class="muted" id="models-status">正在拉模型列表…</span>
      </div>
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
      qs(root, '#models-status').textContent = list.warning
        ? `部分模型列表拉取失败:${list.warning}`
        : `图片 ${list.image.length} 个 · 发音 ${list.speech.length} 个`
    } catch (err) {
      qs(root, '#models-status').textContent = `模型列表拉取失败,可手填 id:${err instanceof ApiError ? err.message : err}`
      imgModel.insertAdjacentHTML('afterend', `<input id="img-model-manual" value="${escapeHtml(s.imageModel)}" />`)
    }
  })()

  qs(root, '#save').addEventListener('click', async () => {
    try {
      const saved = await api.saveSettings({
        imageModel: imgModel.value,
        imageSize: qs<HTMLInputElement>(root, '#img-size').value.trim(),
        imagePrompt: qs<HTMLTextAreaElement>(root, '#img-prompt').value,
        ttsModel: ttsModel.value,
        ttsVoice: ttsVoice.value,
        ttsSpeed: Number(qs<HTMLInputElement>(root, '#tts-speed').value) || 0.95,
      })
      state.settings = saved
      toast('设置已保存')
      await refresh()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  })

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
