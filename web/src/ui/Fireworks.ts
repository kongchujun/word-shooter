/**
 * 轻量烟花:挂在结算页上,几秒后自己收场。
 * 不用外部库,iPad 上也能跑。
 */

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  hue: number
  size: number
}

interface Rocket {
  x: number
  y: number
  vy: number
  targetY: number
  hue: number
  trail: { x: number; y: number }[]
}

export function playFireworks(host: HTMLElement, durationMs = 5200): () => void {
  const canvas = document.createElement('canvas')
  canvas.className = 'fireworks-layer'
  canvas.setAttribute('aria-hidden', 'true')
  host.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return () => {}
  }

  let w = 0
  let h = 0
  let running = true
  let last = performance.now()
  let elapsed = 0
  let spawnAcc = 0
  const rockets: Rocket[] = []
  const sparks: Spark[] = []

  const resize = (): void => {
    const r = host.getBoundingClientRect()
    w = Math.max(1, Math.floor(r.width))
    h = Math.max(1, Math.floor(r.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()
  window.addEventListener('resize', resize)

  const burst = (x: number, y: number, hue: number): void => {
    const n = 42 + Math.floor(Math.random() * 24)
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.2
      const sp = 2.2 + Math.random() * 4.5
      sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.7 + Math.random() * 0.7,
        hue: hue + (Math.random() * 40 - 20),
        size: 1.5 + Math.random() * 2.2,
      })
    }
    // 再撒一圈亮点
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 1 + Math.random() * 2
      sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1,
        life: 0,
        max: 1 + Math.random(),
        hue: 45 + Math.random() * 20,
        size: 2 + Math.random() * 2,
      })
    }
  }

  const launch = (): void => {
    rockets.push({
      x: w * (0.12 + Math.random() * 0.76),
      y: h + 10,
      vy: -(7.5 + Math.random() * 3.5),
      targetY: h * (0.18 + Math.random() * 0.32),
      hue: Math.floor(Math.random() * 360),
      trail: [],
    })
  }

  // 开场连放几发
  for (let i = 0; i < 4; i++) window.setTimeout(launch, i * 180)

  const frame = (now: number): void => {
    if (!running) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    elapsed += dt
    spawnAcc += dt

    if (elapsed < durationMs / 1000 && spawnAcc > 0.28) {
      spawnAcc = 0
      launch()
      if (Math.random() < 0.45) launch()
    }

    ctx.clearRect(0, 0, w, h)

    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i]
      r.y += r.vy * 60 * dt
      r.vy += 0.06
      r.trail.push({ x: r.x, y: r.y })
      if (r.trail.length > 8) r.trail.shift()
      for (let t = 0; t < r.trail.length; t++) {
        const p = r.trail[t]
        ctx.fillStyle = `hsla(${r.hue},90%,70%,${t / r.trail.length})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(r.x, r.y, 2.5, 0, Math.PI * 2)
      ctx.fill()
      if (r.y <= r.targetY || r.vy >= 0) {
        burst(r.x, r.y, r.hue)
        rockets.splice(i, 1)
      }
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]
      s.life += dt
      s.x += s.vx * 60 * dt
      s.y += s.vy * 60 * dt
      s.vy += 0.08
      s.vx *= 0.99
      const u = 1 - s.life / s.max
      if (u <= 0) {
        sparks.splice(i, 1)
        continue
      }
      ctx.globalAlpha = Math.min(1, u * 1.4)
      ctx.fillStyle = `hsl(${s.hue},95%,${55 + u * 30}%)`
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.size * u, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    if (elapsed > durationMs / 1000 && rockets.length === 0 && sparks.length === 0) {
      stop()
      return
    }
    requestAnimationFrame(frame)
  }

  const stop = (): void => {
    if (!running) return
    running = false
    window.removeEventListener('resize', resize)
    canvas.remove()
  }

  requestAnimationFrame(frame)
  return stop
}
