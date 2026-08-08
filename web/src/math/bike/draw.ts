/** 踩单车画面共用:路旁风景 + 路 + 车。双人对战也画两辆。 */

export function drawRoad(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scroll: number,
  roadTop = h * 0.38,
  roadBot = h * 0.78,
): void {
  // 远山一带的草地,房子/树站在这上面
  const groundY = roadTop + 8
  ctx.fillStyle = '#3d6b4f'
  ctx.fillRect(0, groundY - 28, w, roadBot - groundY + 40)

  drawScenery(ctx, w, groundY, scroll)

  ctx.fillStyle = '#3a4558'
  ctx.beginPath()
  ctx.moveTo(0, roadTop)
  ctx.lineTo(w, roadTop - 20)
  ctx.lineTo(w, roadBot + 30)
  ctx.lineTo(0, roadBot)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 4
  ctx.setLineDash([28, 22])
  // 车朝右骑,虚线应往左退(scroll 增大 → offset 增大 → 图案沿路径反向)
  ctx.lineDashOffset = scroll
  ctx.beginPath()
  ctx.moveTo(0, (roadTop + roadBot) / 2)
  ctx.lineTo(w, (roadTop + roadBot) / 2 - 10)
  ctx.stroke()
  ctx.setLineDash([])

  // 路边近处草
  ctx.fillStyle = '#2d6a4f'
  ctx.fillRect(0, roadBot, w, h - roadBot)
  drawForegroundBushes(ctx, w, roadBot, scroll)
}

/**
 * 路旁循环风景:树、小房子、路灯。
 * 车朝右停着"往前骑",世界往左退 —— scroll 增大时 x 减小。
 */
function drawScenery(ctx: CanvasRenderingContext2D, w: number, groundY: number, scroll: number): void {
  const spacing = 140
  const offset = (((-scroll * 0.55) % spacing) + spacing) % spacing
  const start = Math.floor((-offset - spacing) / spacing)
  const end = Math.ceil((w + spacing) / spacing)

  for (let i = start; i <= end; i++) {
    const x = i * spacing + offset
    const kind = hash(i) % 5
    const scale = 0.85 + (hash(i + 17) % 4) * 0.08
    if (kind === 0 || kind === 1) drawTree(ctx, x, groundY, scale, hash(i + 3) % 2 === 0)
    else if (kind === 2) drawHouse(ctx, x, groundY, scale, hash(i + 9) % 3)
    else if (kind === 3) drawTree(ctx, x - 18, groundY, scale * 0.9, true), drawTree(ctx, x + 22, groundY, scale * 0.75, false)
    else drawLamp(ctx, x, groundY, scale)
  }
}

function drawForegroundBushes(ctx: CanvasRenderingContext2D, w: number, roadBot: number, scroll: number): void {
  const spacing = 90
  const offset = (((-scroll * 0.9) % spacing) + spacing) % spacing
  const start = Math.floor((-offset - spacing) / spacing)
  const end = Math.ceil((w + spacing) / spacing)
  for (let i = start; i <= end; i++) {
    if (hash(i + 40) % 3 !== 0) continue
    const x = i * spacing + offset
    const y = roadBot + 10 + (hash(i) % 8)
    ctx.fillStyle = '#1f5a3d'
    ctx.beginPath()
    ctx.ellipse(x, y, 18 + (hash(i) % 10), 10, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(x + 12, y + 2, 14, 8, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  scale: number,
  round: boolean,
): void {
  ctx.save()
  ctx.translate(x, groundY)
  ctx.scale(scale, scale)
  // 树干
  ctx.fillStyle = '#6b4a2e'
  ctx.fillRect(-4, -28, 8, 28)
  // 树冠
  if (round) {
    ctx.fillStyle = '#2f8f57'
    ctx.beginPath()
    ctx.arc(0, -42, 22, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#3cb371'
    ctx.beginPath()
    ctx.arc(-10, -48, 14, 0, Math.PI * 2)
    ctx.arc(12, -50, 13, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillStyle = '#247a48'
    ctx.beginPath()
    ctx.moveTo(0, -70)
    ctx.lineTo(22, -28)
    ctx.lineTo(-22, -28)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#2f9b5a'
    ctx.beginPath()
    ctx.moveTo(0, -82)
    ctx.lineTo(16, -48)
    ctx.lineTo(-16, -48)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function drawHouse(ctx: CanvasRenderingContext2D, x: number, groundY: number, scale: number, palette: number): void {
  const walls = ['#e8d5b5', '#d4e4f0', '#f0cfc2'][palette] ?? '#e8d5b5'
  const roofs = ['#c45c4a', '#5a7bb5', '#8b5a3c'][palette] ?? '#c45c4a'
  ctx.save()
  ctx.translate(x, groundY)
  ctx.scale(scale, scale)

  ctx.fillStyle = walls
  ctx.fillRect(-28, -40, 56, 40)
  ctx.fillStyle = roofs
  ctx.beginPath()
  ctx.moveTo(-34, -40)
  ctx.lineTo(0, -68)
  ctx.lineTo(34, -40)
  ctx.closePath()
  ctx.fill()

  // 门
  ctx.fillStyle = '#6b4a2e'
  ctx.fillRect(-6, -18, 12, 18)
  // 窗
  ctx.fillStyle = '#f7e39a'
  ctx.fillRect(-22, -32, 12, 10)
  ctx.fillRect(10, -32, 12, 10)
  ctx.strokeStyle = 'rgba(80,60,40,0.35)'
  ctx.lineWidth = 1
  ctx.strokeRect(-22, -32, 12, 10)
  ctx.strokeRect(10, -32, 12, 10)

  // 烟囱
  ctx.fillStyle = '#8a6a55'
  ctx.fillRect(14, -62, 8, 16)

  ctx.restore()
}

function drawLamp(ctx: CanvasRenderingContext2D, x: number, groundY: number, scale: number): void {
  ctx.save()
  ctx.translate(x, groundY)
  ctx.scale(scale, scale)
  ctx.strokeStyle = '#cfd4dc'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, -46)
  ctx.lineTo(10, -46)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255, 220, 120, 0.85)'
  ctx.beginPath()
  ctx.arc(12, -46, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 220, 120, 0.12)'
  ctx.beginPath()
  ctx.arc(12, -46, 16, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function hash(n: number): number {
  let x = (n | 0) * 374761393 + 668265263
  x = (x ^ (x >>> 13)) * 1274126177
  return (x ^ (x >>> 16)) >>> 0
}

export function drawBike(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pedal: number,
  color = '#4d8dff',
  helmet = '#e85d4c',
  alpha = 1,
): void {
  const bob = Math.sin(pedal * 2) * 2
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y + bob)

  const spin = pedal * 3
  for (const ox of [-28, 28]) {
    ctx.strokeStyle = '#cfd8e8'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(ox, 10, 18, 0, Math.PI * 2)
    ctx.stroke()
    ctx.save()
    ctx.translate(ox, 10)
    ctx.rotate(spin)
    ctx.strokeStyle = '#8fa0bc'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-16, 0)
    ctx.lineTo(16, 0)
    ctx.moveTo(0, -16)
    ctx.lineTo(0, 16)
    ctx.stroke()
    ctx.restore()
  }

  ctx.strokeStyle = color
  ctx.lineWidth = 4
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(-28, 10)
  ctx.lineTo(0, -8)
  ctx.lineTo(28, 10)
  ctx.moveTo(0, -8)
  ctx.lineTo(0, -28)
  ctx.lineTo(18, -22)
  ctx.stroke()

  ctx.fillStyle = '#f2d2b0'
  ctx.beginPath()
  ctx.arc(2, -38, 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = helmet
  ctx.beginPath()
  ctx.arc(2, -40, 10, Math.PI, 0)
  ctx.fill()

  ctx.restore()
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
