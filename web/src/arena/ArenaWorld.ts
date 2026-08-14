import * as THREE from 'three'
import { t } from '../i18n'
import { DesktopControls, emptyInput, isCoarsePointer, TouchControls } from './controls'
import { ArenaHud } from './hud'
import { Player } from './player'
import { ARENA, buildBase, buildCrates, buildSky, buildTerrain, buildWalls, groundY, SKY } from './terrain'
import { ViewModel } from './viewmodel'
import { Bullets } from './bullets'
import type { TargetHit } from './targets'
import { ArenaSfx } from './sfx'
import { WEAPONS, type Weapon } from './weapons'
import { ArenaOnline, type ArenaTeam } from './online'
import { RemotePlayers } from './remotePlayers'

/** 手机上像素比封顶。3D 里 DPR 是最贵的一个数,2.0 和 1.5 的差别肉眼几乎看不出,帧率差一截。 */
const DPR_CAP_TOUCH = 1.5
const DPR_CAP_DESKTOP = 2

/**
 * 3D 战场。自己一块 WebGL 画布、自己一条循环,和 2D 那三个游戏完全隔开 ——
 * 它坏了不影响孩子平时玩的单词/数学/打地鼠。
 *
 * 这一版是第 0 步:只有地形、能走能看、和一屏性能读数,
 * 目的就是拿去真机(尤其是安卓微信)上看帧率撑不撑得住。
 */
export class ArenaWorld {
  private canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private hud: ArenaHud
  private player: Player
  private viewModel = new ViewModel()
  private bullets = new Bullets()
  private targets: RemotePlayers
  private online: ArenaOnline
  private sfx: ArenaSfx
  private input = emptyInput()
  private desktop: DesktopControls
  private touch: TouchControls | null = null

  /** 开火状态 */
  private weapon: Weapon = WEAPONS.smg
  private ammo: Record<'smg' | 'sniper', number> = { smg: WEAPONS.smg.mag, sniper: WEAPONS.sniper.mag }
  private cooldown = 0
  private reloadLeft = 0
  /** 单发枪要边沿检测:按住不放不能连发 */
  private firedThisPress = false
  /** 开枪后镜头往上抬的量,会自己回落 */
  private punch = 0
  private baseFov = 74

  private raf = 0
  private last = 0
  private running = false
  private dpr: number
  private readonly touchDevice = isCoarsePointer()

  /** 性能采样 */
  private frames = 0
  private elapsed = 0
  private worst = Infinity
  private sinceCheck = 0
  private downgrades = 0

  private disposers: (() => void)[] = []

  constructor(host: HTMLElement, onQuit: () => void, sfx: ArenaSfx, team: ArenaTeam, lockPointer = false) {
    this.sfx = sfx
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'arena-canvas'
    host.appendChild(this.canvas)

    // 先装输入、立刻锁鼠标,再初始化 WebGL 和整张地图。
    // Pointer Lock 依赖短暂的用户激活;如果先造 2 万个三角形再申请,
    // 部分浏览器会认为点击时机已经过去。
    this.desktop = new DesktopControls(this.canvas, this.input)
    if (lockPointer && !this.touchDevice) this.desktop.lock()

    this.dpr = Math.min(window.devicePixelRatio || 1, this.touchDevice ? DPR_CAP_TOUCH : DPR_CAP_DESKTOP)
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      // 手机上抗锯齿是纯亏本买卖,省下来给帧率
      antialias: !this.touchDevice,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.setPixelRatio(this.dpr)

    this.camera = new THREE.PerspectiveCamera(74, 1, 0.1, 420)
    const spawnX = team === 'red' ? -ARENA.baseX + 6 : ARENA.baseX - 6
    this.player = new Player(new THREE.Vector3(spawnX, 0, 0))
    if (team === 'blue') this.player.yaw = Math.PI / 2
    this.online = new ArenaOnline(team, () => ({x:this.player.pos.x,y:this.player.pos.y,z:this.player.pos.z,yaw:this.player.yaw,pitch:this.player.pitch,moving:Math.hypot(this.player.vel.x,this.player.vel.z)>.2,weapon:this.weapon.id}))
    this.targets = new RemotePlayers(team,(id,head)=>this.online.hit(id,this.weapon.id,head))
    this.online.onPlayers=(players)=>this.targets.sync(players,this.online.id)
    this.online.onRespawn=(p)=>{this.player.pos.set(p.x,groundY(p.x,p.z),p.z);this.player.vel.set(0,0,0);this.hud.toast(t('arena.toast.respawn'),'good')}
    this.online.onError=()=>this.hud?.setHint(t('arena.hint.offline'))
    this.buildScene()
    this.player.applyTo(this.camera)
    // 枪挂在相机底下,相机怎么转它跟着怎么转;相机要进场景树,不然子节点不会被渲染
    this.camera.add(this.viewModel.root)
    this.scene.add(this.camera)

    this.hud = new ArenaHud(host)
    this.hud.onQuit = onQuit

    if (this.touchDevice) {
      this.touch = new TouchControls(host, this.input, {
        fire: t('arena.btn.fire'),
        jump: t('arena.btn.jump'),
        ads: t('arena.btn.ads'),
        reload: t('arena.btn.reload'),
        swap: t('arena.btn.swap'),
      })
    }
    this.syncAmmoHud()
    void this.online.start()

    // 电脑上要点一下才能锁鼠标(浏览器要求手势),锁上之前给个提示
    const click = () => {
      if (!this.touchDevice && !this.desktop.locked) this.desktop.lock()
    }
    this.canvas.addEventListener('click', click)
    this.disposers.push(() => this.canvas.removeEventListener('click', click))

    const onResize = () => {
      this.resize()
      this.updateHint()
    }
    window.addEventListener('resize', onResize)
    this.disposers.push(() => window.removeEventListener('resize', onResize))

    // 切后台就停渲染,别在孩子锁屏之后继续烧电
    const onVisible = () => {
      if (document.hidden) this.pause()
      else this.resume()
    }
    document.addEventListener('visibilitychange', onVisible)
    this.disposers.push(() => document.removeEventListener('visibilitychange', onVisible))

    this.resize()
    this.updateHint()

    // dev 下挂个调试口:控制台里 __arena.step(1/60) 能手动推进一帧,
    // __arena.player.pos 看落点。预览面板里 rAF 被浏览器停着,只能这么验。
    if (import.meta.env.DEV) (window as unknown as { __arena: ArenaWorld }).__arena = this
  }

  start(): void {
    this.resume()
  }

  /** 仅调试用:手动推进一帧 */
  step(dt = 1 / 60): void {
    this.tick(dt, false)
  }

  private tick(dt: number, jump: boolean): void {
    const yaw0 = this.player.yaw
    const pitch0 = this.player.pitch

    this.player.update(dt, this.input, jump)

    // 后坐力抬起来的镜头自己回落
    this.punch *= Math.max(0, 1 - dt * 6)
    // 相机必须赶在开枪之前摆到这一帧的朝向,并且把世界矩阵刷新出来 ——
    // 放到后面的话,每一枪都是按上一帧的朝向打出去的,甩枪时会明显打偏;
    // 枪口位置也要靠这个矩阵才算得对。
    this.player.applyTo(this.camera)
    this.camera.rotation.x += this.punch
    this.camera.updateMatrixWorld(true)

    // 换弹 / 换枪
    if (this.desktop.takeReload() || this.touch?.takeReload()) this.startReload()
    const sw = this.desktop.takeSwitch() ?? this.touch?.takeSwitch() ?? null
    if (sw === 'next') this.switchTo(this.weapon.id === 'smg' ? 'sniper' : 'smg')
    else if (sw) this.switchTo(sw)

    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt
      if (this.reloadLeft <= 0) {
        this.ammo[this.weapon.id] = this.weapon.mag
        this.syncAmmoHud()
      }
    }

    // 扳机
    this.cooldown -= dt
    if (this.input.fire) {
      const canRepeat = this.weapon.auto || !this.firedThisPress
      if (canRepeat && this.cooldown <= 0 && this.reloadLeft <= 0) {
        if (this.ammo[this.weapon.id] > 0) {
          this.shoot()
          this.firedThisPress = true
        } else {
          this.sfx.empty()
          this.hud.toast(t('arena.toast.empty'), 'warn')
          this.firedThisPress = true
          this.startReload()
        }
      }
    } else {
      this.firedThisPress = false
    }

    // 开镜:视野和准星一起收
    this.viewModel.setAds(this.input.ads)
    this.hud.setAim(this.input.ads, this.weapon.id === 'sniper')
    const wantFov = this.input.ads ? this.weapon.adsFov : this.baseFov
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 12)
      this.camera.updateProjectionMatrix()
    }

    const speed = Math.hypot(this.player.vel.x, this.player.vel.z)
    this.viewModel.update(dt, speed, this.player.grounded, this.player.yaw - yaw0, this.player.pitch - pitch0)

    this.targets.update(dt)
    this.bullets.update(dt, this.targets, (hit) => this.onHit(hit))

    // 准星张开多少 = 这一枪可能偏多少,按视野换算成像素
    const px = Math.tan(this.currentSpread()) / Math.tan((this.camera.fov * Math.PI) / 360) * (window.innerHeight / 2)
    this.hud.setSpread(Math.min(60, px))

    this.renderer.render(this.scene, this.camera)
  }

  private onHit(hit: TargetHit): void {
    this.hud.hitMark(hit.head)
    if (hit.down) {
      this.sfx.down()
      this.hud.toast(t('arena.toast.down', { m: Math.round(hit.distance) }), 'good')
    } else {
      this.sfx.hit(hit.head)
    }
  }

  dispose(): void {
    this.pause()
    for (const d of this.disposers) d()
    this.desktop.dispose()
    this.touch?.dispose()
    this.online.stop()
    this.hud.dispose()
    // 枪挂在相机上,不在 scene.traverse 的清理范围里,自己放一次
    this.viewModel.dispose()
    // three 的几何体和材质不会被 GC 自动回收,得自己放
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose?.()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose?.()
    })
    this.renderer.dispose()
    this.canvas.remove()
  }

  // ---------- 场景 ----------

  private buildScene(): void {
    this.scene.background = new THREE.Color(SKY.horizon)
    // 雾的颜色必须和地平线一致,否则远处地形和天空之间会出现一条突兀的边
    this.scene.fog = new THREE.Fog(SKY.horizon, 120, 340)

    // 环境光 + 太阳,亮处合起来约 1.2 —— 再高中间调就被冲白,草地会变成土黄色。
    // 太阳给得比环境光多,地形才有明暗、看得出坡的形状。
    this.scene.add(new THREE.HemisphereLight(0xbcd9f2, 0x4a5f3a, 0.55))
    const sun = new THREE.DirectionalLight(0xfff2d6, 0.95)
    // 和天上那轮太阳同一个方向,影子的方向才对得上
    sun.position.set(-150, 210, -240)
    this.scene.add(sun)

    this.scene.add(buildTerrain())
    this.scene.add(buildCrates())
    this.scene.add(buildWalls())
    this.scene.add(buildBase('red'))
    this.scene.add(buildBase('blue'))
    this.scene.add(buildSky())
    this.scene.add(this.targets.group)
    this.scene.add(this.bullets.group)
  }

  // ---------- 开火 ----------

  private shoot(): void {
    const w = this.weapon
    this.ammo[w.id]--
    this.cooldown = w.interval

    // 散布:开镜收紧,跑动变大 —— 张开多少准星就画多开,所见即所得
    const spread = this.currentSpread()
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    if (spread > 0) {
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * spread
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
      dir.addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r)
    }

    // 从枪口出膛,不是从眼睛 —— 不然贴着箱子打会穿墙
    const muzzle = this.viewModel.muzzleWorld()
    this.bullets.spawn(muzzle, dir, w)

    this.viewModel.fire(w.kick)
    this.punch += w.punch
    this.sfx.shot(w.id)
    this.syncAmmoHud()

    if (this.ammo[w.id] <= 0) this.startReload()
  }

  private currentSpread(): number {
    const w = this.weapon
    const base = this.input.ads ? w.spreadAds : w.spreadHip
    const speed = Math.hypot(this.player.vel.x, this.player.vel.z)
    // 跑起来打不准,跳在空中更打不准
    return base * (1 + speed / 7) * (this.player.grounded ? 1 : 1.8)
  }

  private startReload(): void {
    if (this.reloadLeft > 0 || this.ammo[this.weapon.id] === this.weapon.mag) return
    this.reloadLeft = this.weapon.reload
    this.sfx.reload()
    this.hud.toast(t('arena.toast.reload'), 'warn')
    this.syncAmmoHud()
  }

  private switchTo(id: 'smg' | 'sniper'): void {
    if (this.weapon.id === id) return
    this.weapon = WEAPONS[id]
    this.reloadLeft = 0
    this.cooldown = 0.25
    this.baseFovApply()
    this.syncAmmoHud()
  }

  private baseFovApply(): void {
    // 换枪时如果正开着镜,视野要立刻跟上新枪
    const want = this.input.ads ? this.weapon.adsFov : this.baseFov
    this.camera.fov = want
    this.camera.updateProjectionMatrix()
  }

  private syncAmmoHud(): void {
    this.hud.setAmmo(this.ammo[this.weapon.id], this.weapon.mag, t(this.weapon.nameKey), this.reloadLeft > 0)
  }

  // ---------- 循环 ----------

  private resume(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    this.raf = requestAnimationFrame((t) => this.frame(t))
  }

  private pause(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  private frame(now: number): void {
    if (!this.running) return
    this.raf = requestAnimationFrame((t) => this.frame(t))

    // 切后台回来那一帧的 dt 会是好几秒,夹住,不然人会瞬移到墙里
    const dt = Math.min((now - this.last) / 1000, 0.1)
    this.last = now

    try {
      this.tick(dt, this.desktop.takeJump() || (this.touch?.takeJump() ?? false))
      this.sample(dt)
    } catch (err) {
      // 和 2D 那条循环一个道理:一帧出错不能掐断整条链
      console.error('[arena] 这一帧出错,已跳过', err)
    }
  }

  /** 性能采样 + 自动降质量。半秒刷一次 HUD,每 3 秒判一次要不要降 DPR。 */
  private sample(dt: number): void {
    this.frames++
    this.elapsed += dt
    this.sinceCheck += dt
    // 忽略切后台那种巨大的 dt,不然"最低帧"永远是 1
    if (dt > 0.0005 && dt < 0.25) this.worst = Math.min(this.worst, 1 / dt)

    if (this.elapsed < 0.5) return
    const fps = this.frames / this.elapsed
    const info = this.renderer.info.render
    this.hud.setPerf(fps, this.worst, info.calls, info.triangles, this.dpr)
    this.hud.setPos(this.player.pos.x, this.player.pos.y, this.player.pos.z)
    this.frames = 0
    this.elapsed = 0

    if (this.sinceCheck >= 3) {
      this.sinceCheck = 0
      if (fps < 45 && this.downgrades < 2 && this.dpr > 1) {
        this.downgrades++
        this.dpr = Math.max(1, this.dpr - 0.5)
        this.renderer.setPixelRatio(this.dpr)
        this.resize()
        this.hud.setHint(t('arena.hint.downgrade', { dpr: this.dpr.toFixed(2) }))
      }
      this.worst = Infinity
    }
  }

  private resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
  }

  private updateHint(): void {
    // 手机竖屏时视野只有一条缝,先提醒横过来
    if (this.touchDevice && window.innerHeight > window.innerWidth) {
      this.hud.setHint(t('arena.hint.rotate'))
      return
    }
    this.hud.setHint(this.touchDevice ? t('arena.hint.touch') : t('arena.hint.mouse'))
  }
}
