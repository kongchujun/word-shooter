/**
 * 枪声。全部现场合成,不加载任何音频文件 ——
 * 一发枪响就是"一段噪声 + 一记低频砰",几行振荡器就够,比下 mp3 划算得多。
 *
 * AudioContext 必须在用户手势里建(点"进入战场"那一下),否则 iOS 全程静音;
 * 这条坑和 AudioManager 里那套是同一个,见它的注释。
 */
export class ArenaSfx {
  private ctx: AudioContext | null = null
  /** 一段白噪声,反复拿来当枪口爆音和入土的沙沙声 */
  private noise: AudioBuffer | null = null

  /** 必须在点击的同步调用栈里调 */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume().catch(() => {})
      return
    }
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.ctx = new Ctor()
    this.noise = makeNoise(this.ctx)
  }

  resume(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
  }

  /** 开枪:冲锋枪脆、狙击枪闷而长 */
  shot(kind: 'smg' | 'sniper'): void {
    const ctx = this.ctx
    if (!ctx || !this.noise) return
    const t = ctx.currentTime
    const heavy = kind === 'sniper'

    // 爆音:一段带通噪声,衰减极快
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = heavy ? 900 : 1800
    bp.Q.value = 0.7
    const g = ctx.createGain()
    g.gain.setValueAtTime(heavy ? 0.5 : 0.28, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + (heavy ? 0.32 : 0.12))
    src.connect(bp).connect(g).connect(ctx.destination)
    src.start(t)
    src.stop(t + 0.4)

    // 低频那一记"砰",没有它听着像放屁
    const osc = ctx.createOscillator()
    const og = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(heavy ? 150 : 220, t)
    osc.frequency.exponentialRampToValueAtTime(heavy ? 45 : 70, t + 0.16)
    og.gain.setValueAtTime(heavy ? 0.55 : 0.3, t)
    og.gain.exponentialRampToValueAtTime(0.0001, t + (heavy ? 0.3 : 0.14))
    osc.connect(og).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.35)
  }

  /** 打中人:一声清脆的提示,和打在土里明显区分开 */
  hit(head: boolean): void {
    this.tone(head ? 1320 : 880, 0.09, 'square', 0.16)
    if (head) this.tone(1760, 0.09, 'square', 0.12, 0.05)
  }

  /** 把人打倒 */
  down(): void {
    ;[660, 880, 1170].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.18, i * 0.07))
  }

  /** 换弹的两声咔哒 */
  reload(): void {
    this.tone(320, 0.05, 'square', 0.1)
    this.tone(240, 0.07, 'square', 0.12, 0.22)
  }

  /** 空仓:干敲一下 */
  empty(): void {
    this.tone(180, 0.04, 'square', 0.08)
  }

  dispose(): void {
    void this.ctx?.close().catch(() => {})
    this.ctx = null
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.4)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) {
    // 越往后越轻,这样直接播整段也像一次爆音的尾巴
    data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  }
  return buf
}
