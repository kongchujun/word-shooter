import type { SfxName, Word } from '../types'

/**
 * 走 Web Audio(decodeAudioData 预解码 + 缓存)而不是 <audio> 标签:
 * 延迟低、人声和音效能同时响、重播不会被上一次掐掉。
 * 代价是要自己处理 iOS 的音频会话档位,见 claimPlaybackSession。
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
  /** iOS 17 以下的兜底:循环播一段静音 <audio> 把会话顶到 playback 档 */
  private silentEl: HTMLAudioElement | null = null

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
      // 必须赶在建 AudioContext 之前,否则会话档位已经定死了
      this.claimPlaybackSession()
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
    }
    this.resume()

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

  /**
   * iOS 默认把 Web Audio 归到 ambient 档,侧边静音开关一拨就整个哑掉
   * (<audio> 标签走的 playback 档则不受影响,所以微信里点开视频有声音、游戏没声音)。
   * iOS 17+ 能直接声明档位;更老的版本只能靠循环播静音 <audio> 骗系统升档。
   */
  private claimPlaybackSession(): void {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session) {
      try {
        session.type = 'playback'
        return
      } catch {
        // 浏览器不认这个值,落到下面的兜底
      }
    }

    // 只有 iOS 有这个毛病。别的平台白播一条静音轨,只会让标签页一直亮着"正在播放"
    if (!isIOS()) return

    if (!this.silentEl) {
      this.silentEl = new Audio(silentWavUrl())
      this.silentEl.loop = true
    }
    // 没解锁成功也无所谓,顶多是回到静音开关生效的状态
    void this.silentEl.play().catch(() => {})
  }

  /**
   * 息屏、切到微信别的页面再回来,iOS 会把 context 挂起
   * (还有个 iOS 独有的 interrupted 状态,只判 suspended 会漏)。
   * 挂在指针事件上,保证恢复动作始终发生在用户手势里。
   */
  resume(): void {
    if (!this.ctx) return
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
    if (this.silentEl?.paused) void this.silentEl.play().catch(() => {})
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
      this.buffers.set(url, await decode(this.ctx, await res.arrayBuffer()))
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

/** iPad 从 iOS 13 起在 UA 里自称 Mac,得靠触摸点数才认得出来 */
function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** 微信安卓的 X5 内核有些版本只认回调式 decodeAudioData,promise 式会返回 undefined */
function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  const p = ctx.decodeAudioData(data)
  if (p) return p
  return new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject))
}

/** 一段 1 秒的静音 wav。只用来触发 iOS 升会话档位,不出声 */
function silentWavUrl(): string {
  const rate = 8000
  const samples = rate
  const buf = new ArrayBuffer(44 + samples * 2)
  const v = new DataView(buf)
  const tag = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  tag(0, 'RIFF')
  v.setUint32(4, 36 + samples * 2, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // 单声道
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  tag(36, 'data')
  v.setUint32(40, samples * 2, true)
  // 采样区默认就是 0,不用填
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}
