import * as THREE from 'three'

/**
 * 地图尺寸和地形参数。改地形只改这个文件 ——
 * groundY() 既用来生成网格,也用来做落地和子弹入土判定,
 * 两边共用一个函数,永远不会对不上。
 */
export const ARENA = {
  /** 正方形边长(米) */
  size: 200,
  /** 中间那座山的高度和胖瘦 */
  hillHeight: 18,
  hillSpread: 26,
  /** 两个基地的中心 x(z=0),各自离边界 15 米 */
  baseX: 85,
  baseRadius: 12,
  /** 网格分段数:96×96 ≈ 1.8 万个三角形,手机上够用了 */
  segments: 96,
} as const

/**
 * 地面高度。中间一座钟形山,四周两条正弦叠出缓坡起伏 ——
 * 完全平的地面在 3D 里看着像块玻璃,人也没有"跑上跑下"的手感。
 */
export function groundY(x: number, z: number): number {
  const d2 = x * x + z * z
  const hill = ARENA.hillHeight * Math.exp(-d2 / (2 * ARENA.hillSpread * ARENA.hillSpread))
  const roll = Math.sin(x * 0.045) * 0.8 + Math.cos(z * 0.037) * 0.9
  // 基地那一圈压平,免得出生点在坡上站不住
  const flat = Math.min(1, Math.min(Math.abs(x - ARENA.baseX), Math.abs(x + ARENA.baseX)) / ARENA.baseRadius)
  return hill + roll * flat
}

/** 地面法线,给贴地的假影子和之后的跳弹用。数值微分就够,不必解析求导。 */
export function groundNormal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.5
  const dx = groundY(x + e, z) - groundY(x - e, z)
  const dz = groundY(x, z + e) - groundY(x, z - e)
  return out.set(-dx, 2 * e, -dz).normalize()
}

/**
 * 地形网格。顶点色按坡度和高度调:平地是草、陡坡露土、山顶泛白,
 * 全程不加载任何贴图 —— 这套纸模风既省带宽也不需要美术资源。
 */
export function buildTerrain(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(ARENA.size, ARENA.size, ARENA.segments, ARENA.segments)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, groundY(pos.getX(i), pos.getZ(i)))
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()

  const colors = new Float32Array(pos.count * 3)
  // 白天的草地要比夜里亮不少,不然阳光下看着像块霉布
  const grass = new THREE.Color(0x5d9247)
  const dirt = new THREE.Color(0x8a6a3c)
  const peak = new THREE.Color(0xb2b79c)
  const c = new THREE.Color()
  const normal = geo.attributes.normal

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    // normal.y = 1 是水平,越小越陡
    const steep = THREE.MathUtils.clamp((1 - normal.getY(i)) * 6, 0, 1)
    const high = THREE.MathUtils.clamp((y - 8) / 10, 0, 1)
    c.copy(grass).lerp(dirt, steep).lerp(peak, high * 0.55)
    // 每个顶点抖一点亮度,平面上才有细节
    const n = 0.92 + ((Math.sin(pos.getX(i) * 1.7) + Math.cos(pos.getZ(i) * 2.3)) * 0.5 + 0.5) * 0.16
    colors[i * 3] = c.r * n
    colors[i * 3 + 1] = c.g * n
    colors[i * 3 + 2] = c.b * n
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.matrixAutoUpdate = false
  return mesh
}

/** 掩体箱的落点。手摆的,不是随机 —— 随机出来的掩体永远不好用。 */
const CRATES: [number, number][] = [
  [-46, -30], [-40, 26], [-28, -8], [-22, 44], [-58, 8],
  [46, 30], [40, -26], [28, 8], [22, -44], [58, -8],
  [0, -52], [0, 52], [-14, -34], [14, 34],
]

/** 掩体:一个 InstancedMesh 画完十几个箱子,只占一次 draw call */
export function buildCrates(): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(2.4, 2.4, 2.4)
  const mat = new THREE.MeshLambertMaterial({ color: 0x7a5a33 })
  const mesh = new THREE.InstancedMesh(geo, mat, CRATES.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3(1, 1, 1)

  CRATES.forEach(([x, z], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 37 % 90) * (Math.PI / 180))
    m.compose(new THREE.Vector3(x, groundY(x, z) + 1.2, z), q, s)
    mesh.setMatrixAt(i, m)
  })
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

/** 箱子的碰撞盒(轴对齐近似,旋转忽略 —— 差那几度玩家感觉不出来) */
export function crateBoxes(): { x: number; z: number; half: number; top: number }[] {
  return CRATES.map(([x, z]) => ({ x, z, half: 1.7, top: groundY(x, z) + 2.4 }))
}

/**
 * 基地:一块队伍色的台子 + 一个半透明护盾罩。
 * 护盾罩现在只是个视觉地标,挡子弹的逻辑等第二期联机时再接。
 */
export function buildBase(team: 'red' | 'blue'): THREE.Group {
  const color = team === 'red' ? 0xe85d4c : 0x4d8dff
  const x = team === 'red' ? -ARENA.baseX : ARENA.baseX
  const g = new THREE.Group()

  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA.baseRadius, ARENA.baseRadius, 0.4, 24),
    new THREE.MeshLambertMaterial({ color }),
  )
  pad.position.set(x, groundY(x, 0) + 0.2, 0)
  g.add(pad)

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(ARENA.baseRadius, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  )
  dome.position.set(x, groundY(x, 0), 0)
  g.add(dome)

  // 旗杆,远处一眼能认出哪边是自己家
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 9, 6),
    new THREE.MeshLambertMaterial({ color: 0xbfc7d8 }),
  )
  pole.position.set(x, groundY(x, 0) + 4.5, 0)
  g.add(pole)
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 1.8),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  )
  flag.position.set(x + 1.5, groundY(x, 0) + 8, 0)
  g.add(flag)

  g.matrixAutoUpdate = false
  g.updateMatrix()
  return g
}

/** 边界墙:四面矮墙,掉不出去。孩子不会因为手滑掉下地图而挫败。 */
export function buildWalls(): THREE.Group {
  const g = new THREE.Group()
  const half = ARENA.size / 2
  const mat = new THREE.MeshLambertMaterial({ color: 0x2b3550, transparent: true, opacity: 0.75 })
  const long = new THREE.BoxGeometry(ARENA.size, 6, 0.6)

  for (const [rot, x, z] of [
    [0, 0, -half],
    [0, 0, half],
    [Math.PI / 2, -half, 0],
    [Math.PI / 2, half, 0],
  ] as const) {
    const w = new THREE.Mesh(long, mat)
    w.rotation.y = rot
    w.position.set(x, groundY(x, z) + 3, z)
    w.updateMatrix()
    w.matrixAutoUpdate = false
    g.add(w)
  }
  return g
}

/** 天空的颜色,雾也要用同一套,不然远处会出现一条突兀的边 */
export const SKY = {
  zenith: 0x3d84d6,
  horizon: 0xc9e2f4,
  sun: 0xfff6d8,
} as const

/**
 * 白天的天穹:一个从头顶蓝到地平线发白的渐变球,加一轮太阳和几朵云。
 *
 * 渐变做在顶点色里,不写 shader —— 24×14 段的球足够平滑,
 * 而且 MeshBasicMaterial 不参与光照计算,基本不花钱。
 */
export function buildSky(): THREE.Group {
  const g = new THREE.Group()

  const geo = new THREE.SphereGeometry(400, 24, 14)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const zenith = new THREE.Color(SKY.zenith)
  const horizon = new THREE.Color(SKY.horizon)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    // 地平线附近变化最快,所以对高度取个幂,别让渐变糊成一片
    const k = Math.pow(THREE.MathUtils.clamp(pos.getY(i) / 400, 0, 1), 0.45)
    c.copy(horizon).lerp(zenith, k)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const dome = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  )
  // 天穹永远不该被裁掉,也不参与深度排序
  dome.renderOrder = -1
  g.add(dome)

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(12, 16, 12),
    new THREE.MeshBasicMaterial({ color: SKY.sun, fog: false }),
  )
  sun.position.set(-150, 210, -240)
  g.add(sun)

  g.add(buildClouds())
  return g
}

/** 云:压扁的球,一个 InstancedMesh 画完,只占一次 draw call */
function buildClouds(): THREE.InstancedMesh {
  // 放高一点:压得低的云会被山挡住一半,看着像山顶积雪
  const spots: [number, number, number, number][] = [
    [-150, 205, -80, 32],
    [90, 230, -170, 40],
    [200, 195, 60, 28],
    [-60, 245, 190, 36],
    [140, 215, 180, 24],
    [-210, 220, 70, 30],
  ]
  const mesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 10, 7),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false }),
    spots.length,
  )
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  spots.forEach(([x, y, z, r], i) => {
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r, r * 0.32, r * 0.7))
    mesh.setMatrixAt(i, m)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.renderOrder = -1
  return mesh
}
