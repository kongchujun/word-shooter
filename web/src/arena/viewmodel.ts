import * as THREE from 'three'

/**
 * 手里那把枪。挂在相机底下,所以相机怎么转它跟着怎么转,
 * 自己只负责三件小事:走路时上下晃、转身时甩一下、跳起来往下沉。
 *
 * 这三样就是"手感"的一大半 —— 枪完全钉死在屏幕上的话,跑起来像在滑冰。
 */
export class ViewModel {
  readonly root = new THREE.Group()
  private gun = new THREE.Group()
  /** 走路累计相位,用来做上下晃 */
  private phase = 0
  private swayX = 0
  private swayY = 0
  private drop = 0
  /** 后坐:开枪那一下枪往后退,再弹回来 */
  private recoil = 0
  /** 枪口火光的剩余时间 */
  private flashT = 0
  private flash!: THREE.Mesh
  /** 开镜程度 0~1,枪往屏幕中间收 */
  private ads = 0
  private adsTarget = 0
  private static readonly ADS_HOME = new THREE.Vector3(0.004, -0.105, -0.42)

  /** 枪停在屏幕右下角的基准位置 */
  private static readonly HOME = new THREE.Vector3(0.3, -0.26, -0.62)

  constructor() {
    this.build()
    // 摆在 0.6 米外看着还是太大 —— 视角越广近处放得越大,整体缩一档
    this.gun.scale.setScalar(0.62)
    this.root.add(this.gun)
    this.root.position.copy(ViewModel.HOME)
    // 稍微朝里偏一点,不然看着像举着根棍子平推
    this.root.rotation.set(0.02, -0.09, 0)
  }

  /**
   * @param speed 水平速度(m/s)
   * @param dYaw 这一帧转了多少,用来做甩枪
   */
  /** 开枪:枪往后一坐,枪口闪一下 */
  fire(kick: number): void {
    this.recoil = Math.min(1, this.recoil + kick * 8)
    this.flashT = 0.045
    this.flash.rotation.z = Math.random() * Math.PI
  }

  /** 开镜:枪收到屏幕中间,和准星对齐 */
  setAds(on: boolean): void {
    this.adsTarget = on ? 1 : 0
  }

  /** 枪口的世界坐标。子弹从这里出膛,不是从眼睛 —— 不然贴着掩体打会穿过去 */
  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.flash.updateWorldMatrix(true, false)
    return out.setFromMatrixPosition(this.flash.matrixWorld)
  }

  get adsAmount(): number {
    return this.ads
  }

  update(dt: number, speed: number, grounded: boolean, dYaw: number, dPitch: number): void {
    // 开镜过渡:太快像瞬移,太慢会让人觉得枪粘手
    this.ads += (this.adsTarget - this.ads) * Math.min(1, dt * 12)
    this.recoil *= Math.max(0, 1 - dt * 9)

    this.flashT = Math.max(0, this.flashT - dt)
    this.flash.visible = this.flashT > 0
    if (this.flash.visible) {
      // 每一帧大小抖一下,才像一团火而不是一张贴纸
      this.flash.scale.setScalar(0.8 + Math.random() * 0.5)
    }

    // 走路晃动:频率跟着速度走,幅度也是。开镜时压掉大半,不然瞄不准
    const moving = grounded && speed > 0.5
    this.phase += dt * (6 + speed * 0.9)
    const amp = moving ? Math.min(speed / 9.4, 1) * 0.014 * (1 - this.ads * 0.8) : 0
    const bobX = Math.sin(this.phase) * amp
    const bobY = Math.abs(Math.cos(this.phase)) * amp * 0.9

    // 甩枪:镜头先动,枪慢半拍再跟上
    this.swayX += (THREE.MathUtils.clamp(dYaw * 2.2, -0.06, 0.06) - this.swayX) * Math.min(1, dt * 9)
    this.swayY += (THREE.MathUtils.clamp(dPitch * 1.8, -0.05, 0.05) - this.swayY) * Math.min(1, dt * 9)
    // 腾空时枪往下沉一点,落地弹回来
    this.drop += ((grounded ? 0 : 0.05) - this.drop) * Math.min(1, dt * 6)

    // 腰射位置和开镜位置之间插值
    const home = ViewModel.HOME
    const ads = ViewModel.ADS_HOME
    this.root.position.set(
      THREE.MathUtils.lerp(home.x, ads.x, this.ads) + bobX + this.swayX,
      THREE.MathUtils.lerp(home.y, ads.y, this.ads) + bobY - this.drop,
      THREE.MathUtils.lerp(home.z, ads.z, this.ads) + this.recoil * 0.06,
    )
    const baseYaw = THREE.MathUtils.lerp(-0.09, 0, this.ads)
    this.root.rotation.set(
      0.02 + this.swayY + this.recoil * 0.12,
      baseYaw - this.swayX * 1.5,
      this.swayX * 0.8 * (1 - this.ads),
    )
  }

  /** 低模冲锋枪:几个盒子拼的,不加载任何模型文件 */
  private build(): void {
    const metal = new THREE.MeshLambertMaterial({ color: 0x525c72 })
    const dark = new THREE.MeshLambertMaterial({ color: 0x23272f })
    const grip = new THREE.MeshLambertMaterial({ color: 0x6b4a2c })
    const accent = new THREE.MeshLambertMaterial({ color: 0xe85d4c })

    const add = (
      mat: THREE.Material,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      rotX = 0,
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      m.position.set(x, y, z)
      m.rotation.x = rotX
      this.gun.add(m)
    }

    // 机匣 → 枪管 → 准星 → 弹匣 → 握把 → 枪托
    add(metal, 0.075, 0.085, 0.34, 0, 0, -0.02)
    add(dark, 0.036, 0.036, 0.3, 0, 0.012, -0.31)
    add(dark, 0.012, 0.03, 0.012, 0, 0.06, -0.42)
    add(accent, 0.05, 0.11, 0.055, 0, -0.085, 0.03)
    add(grip, 0.05, 0.11, 0.06, 0, -0.075, 0.13, 0.22)
    add(dark, 0.05, 0.06, 0.14, 0, 0.005, 0.21)

    // 枪口火光:两片交叉的亮片,只亮四十几毫秒。
    // 关键是 AdditiveBlending —— 普通半透明材质画出来是一张淡黄色的纸片,
    // 加色混合才会亮成一团光。深度写入照例关掉,免得自己挡自己。
    const flashMat = new THREE.MeshBasicMaterial({
      map: makeFlashTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    })
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), flashMat)
    this.flash.position.set(0, 0.012, -0.52)
    this.flash.visible = false
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), flashMat)
    cross.rotation.y = Math.PI / 2
    this.flash.add(cross)
    this.gun.add(this.flash)
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose?.()
      const mat = m.material as THREE.Material | undefined
      mat?.dispose?.()
    })
  }
}

/**
 * 枪口火光的贴图:中间一团白、四条尖芒,边缘渐隐。
 * 现画在 canvas 上,不加载图片文件 —— 一张 64×64 的图,配加色混合就够像了。
 * 纯色方片配加色混合只会得到一张"淡黄色的纸",光感全靠这张渐变。
 */
function makeFlashTexture(): THREE.CanvasTexture {
  const size = 64
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const ctx = cv.getContext('2d')!
  const c = size / 2

  const g = ctx.createRadialGradient(c, c, 0, c, c, c)
  g.addColorStop(0, 'rgba(255,255,240,1)')
  g.addColorStop(0.25, 'rgba(255,214,138,0.9)')
  g.addColorStop(0.6, 'rgba(255,150,60,0.35)')
  g.addColorStop(1, 'rgba(255,120,40,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  // 四条尖芒,让它有"炸开"的方向感
  ctx.strokeStyle = 'rgba(255,240,200,0.85)'
  ctx.lineCap = 'round'
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4
    ctx.lineWidth = i % 2 === 0 ? 5 : 3
    ctx.beginPath()
    ctx.moveTo(c, c)
    ctx.lineTo(c + Math.cos(a) * c * 0.95, c + Math.sin(a) * c * 0.95)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
