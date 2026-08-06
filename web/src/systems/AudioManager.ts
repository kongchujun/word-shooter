import type { SfxName, Word } from '../types'

/**
 * 走 Web Audio(decodeAudioData 预解码 + 缓存),不用 <audio> 标签:
 * 延迟低、人声和音效能同时响、重播不会被上一次掐掉。
 * 没有 mp3 的词退回浏览器 TTS,没有音效文件就现场合成。
 */
export class AudioManager {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private voiceSource: AudioBufferSourceNode | null = null
  private ttsVoice: SpeechSynthesisVoice | null = null
  private speakToken = 0
  /** 后端报上来的音效文件,没列进来的就现场合成 */
  private sfxUrls: Partial<Record<SfxName, string>> = {}

  /** 有多少个词没有 mp3、要靠 TTS 发音 */
  ttsCount = 0

  get unlocked(): boolean {
    return this.ctx !== null
  }

  /**
   * 必须在用户手势(点击)的同步调用栈里执行,否则 iOS / Safari 全程静音。
   * 播一个 1 帧静音 buffer 是解锁的标准做法。
   */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()

    const silent = this.ctx.createBufferSource()
    silent.buffer = this.ctx.createBuffer(1, 1, 22050)
    silent.connect(this.ctx.destination)
    silent.start(0)

    // 顺手把 TTS 引擎叫醒,Safari 第一次 getVoices() 常常是空的
    if ('speechSynthesis' in window && !this.ttsVoice) {
      this.pickVoice()
      speechSynthesis.addEventListener('voiceschanged', () => this.pickVoice(), { once: true })
    }
  }

  setSfx(urls: Partial<Record<SfxName, string>> = {}): void {
    this.sfxUrls = urls
  }

  /** 进关卡前把这一关的人声和音效全解码好,开局不卡 */
  async preload(words: Word[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const urls = words.map((w) => w.audio).filter((u): u is string => !!u)
    const all = [...urls, ...Object.values(this.sfxUrls)]
    this.ttsCount = words.length - urls.length

    let done = 0
    for (const url of all) {
      await this.loadBuffer(url)
      onProgress?.(++done, all.length)
    }
  }

  /** 播一个单词的发音。onEnd 在声音结束时回调(用来起反应计时) */
  speak(word: Word, onEnd?: () => void): void {
    const token = ++this.speakToken
    const fire = () => {
      if (token === this.speakToken) onEnd?.()
    }

    this.stopVoice()
    const buf = word.audio ? this.buffers.get(word.audio) : undefined
    if (buf && this.ctx) {
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      src.connect(this.ctx.destination)
      src.onended = fire
      src.start()
      this.voiceSource = src
      return
    }

    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(word.en)
      u.lang = 'en-US'
      u.rate = 0.85
      if (this.ttsVoice) u.voice = this.ttsVoice
      u.onend = fire
      speechSynthesis.speak(u)
      // Safari 上 onend 偶尔不触发,给个兜底计时器
      setTimeout(fire, 900 + word.en.length * 90)
      return
    }

    setTimeout(fire, 600)
  }

  stopVoice(): void {
    if (this.voiceSource) {
      this.voiceSource.onended = null
      try {
        this.voiceSource.stop()
      } catch {
        // 已经停了
      }
      this.voiceSource = null
    }
    if ('speechSynthesis' in window) speechSynthesis.cancel()
  }

  playSfx(name: SfxName): void {
    if (!this.ctx) return
    const url = this.sfxUrls[name]
    const buf = url ? this.buffers.get(url) : undefined
    if (buf) {
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      src.connect(this.ctx.destination)
      src.start()
      return
    }
    this.synth(name)
  }

  private async loadBuffer(url: string): Promise<void> {
    if (this.buffers.has(url) || !this.ctx) return
    try {
      const res = await fetch(url)
      if (!res.ok) return
      this.buffers.set(url, await this.ctx.decodeAudioData(await res.arrayBuffer()))
    } catch {
      // 文件不存在或解码失败 —— 交给 TTS / 合成音效
    }
  }

  private pickVoice(): void {
    if (!('speechSynthesis' in window)) return
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
    if (!voices.length) return
    // 优先挑质量更好的美音
    this.ttsVoice =
      voices.find((v) => /Samantha|Google US English|Microsoft Aria/i.test(v.name)) ??
      voices.find((v) => v.lang === 'en-US') ??
      voices[0]
  }

  /** 没有音效文件时用振荡器现场合成,保证一开始就有反馈 */
  private synth(name: SfxName): void {
    switch (name) {
      case 'hit':
        this.tone(660, 0.09, 'triangle', 0.25, 0)
        this.tone(990, 0.14, 'triangle', 0.22, 0.07)
        break
      case 'miss':
        this.tone(200, 0.22, 'sawtooth', 0.16, 0, 110)
        break
      case 'blank':
        this.tone(1200, 0.04, 'square', 0.05, 0)
        break
      case 'levelup':
        ;[523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.2, i * 0.1))
        break
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay: number, slideTo?: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }
}
