import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const MODEL_URL = '/arena/kenney-blocky/character.glb'

interface CharacterSource {
  scene: THREE.Group
  clips: THREE.AnimationClip[]
}

let sourcePromise: Promise<CharacterSource> | null = null

function source(): Promise<CharacterSource> {
  if (!sourcePromise) {
    sourcePromise = new Promise((resolve, reject) => {
      new GLTFLoader().load(
        MODEL_URL,
        (gltf) => resolve({ scene: gltf.scene, clips: gltf.animations }),
        undefined,
        reject,
      )
    })
  }
  return sourcePromise
}

/**
 * Kenney Blocky Characters 的一个实例。
 * 原模型没有骨骼蒙皮,每条胳膊/腿本身就是动画节点,所以普通 clone 就能安全复用;
 * 五个人只下载一份 GLB、共用几何体和贴图,每人只多一份很小的节点树和 mixer。
 */
export class ArenaCharacter {
  readonly root: THREE.Group
  private mixer: THREE.AnimationMixer
  private actions = new Map<string, THREE.AnimationAction>()
  private current = ''
  private flashMaterials: (THREE.MeshLambertMaterial | THREE.MeshStandardMaterial)[] = []
  private smg = new THREE.Group()
  private sniper = new THREE.Group()

  private constructor(source: CharacterSource, teamColor: number) {
    this.root = source.scene.clone(true)
    this.root.name = 'arena-character'
    // Kenney 模型约 2 米高;稍微缩一点,和现有 1.8 米判定体一致。
    this.root.scale.setScalar(0.9)
    // 资源正面朝 +Z,本游戏人物前方是 -Z。
    this.root.rotation.y = Math.PI

    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = false
      mesh.receiveShadow = false
      // 每个实例要独立闪白,材质不能和其他人共用。
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => this.cloneMaterial(m, obj.name, teamColor))
      } else {
        mesh.material = this.cloneMaterial(mesh.material, obj.name, teamColor)
      }
    })

    this.addTeamGear(teamColor)
    this.mixer = new THREE.AnimationMixer(this.root)
    for (const clip of source.clips) this.actions.set(clip.name, this.mixer.clipAction(clip))
    this.play('walk', 0)
  }

  static async create(teamColor: number): Promise<ArenaCharacter> {
    return new ArenaCharacter(await source(), teamColor)
  }

  update(dt: number, moving: boolean, down: boolean): void {
    this.mixer.update(dt)
    if (down) return
    this.play(moving ? 'walk' : 'holding-both')
  }

  knockDown(): void {
    this.play('die', 0.08, true)
  }

  revive(): void {
    this.play('walk', 0.08)
  }

  setFlash(k: number): void {
    for (const mat of this.flashMaterials) mat.emissive.setScalar(k * 0.75)
  }

  setWeapon(id: 'smg' | 'sniper'): void {
    this.smg.visible = id === 'smg'
    this.sniper.visible = id === 'sniper'
  }

  private play(name: string, fade = 0.15, once = false): void {
    if (this.current === name) return
    const next = this.actions.get(name)
    if (!next) return
    const prev = this.actions.get(this.current)
    prev?.fadeOut(fade)
    next.reset().fadeIn(fade)
    if (once) {
      next.setLoop(THREE.LoopOnce, 1)
      next.clampWhenFinished = true
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity)
      next.clampWhenFinished = false
    }
    next.play()
    this.current = name
  }

  private cloneMaterial(material: THREE.Material, part: string, teamColor: number): THREE.Material {
    const clone = material.clone()
    if (clone instanceof THREE.MeshLambertMaterial || clone instanceof THREE.MeshStandardMaterial) {
      this.flashMaterials.push(clone)
      // 不再另外套一个盒子背心:直接给躯干贴图染队色,省掉每个人一个 draw call。
      if (part === 'torso') clone.color.lerp(new THREE.Color(teamColor), 0.72)
    }
    return clone
  }

  private addTeamGear(teamColor: number): void {
    const dark = new THREE.MeshLambertMaterial({ color: 0x28303b })
    const team = new THREE.MeshLambertMaterial({ color: teamColor })
    dark.emissive = new THREE.Color(0)
    team.emissive = new THREE.Color(0)
    this.flashMaterials.push(dark, team)

    // 薄薄一层防护背心,不是原先把整个人包住的方盒。
    // 躯干材质本身也有队色,这层负责让 50 米外仍能分清红蓝。
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.42), team)
    vest.position.set(0, 0.82, -0.01)
    vest.name = 'team-vest'
    this.root.add(vest)

    // 模型原始正面是 +Z，枪也必须放在 +Z；旧版写成 -Z，实际跑到了人物背后。
    this.smg = this.buildGun('smg', dark, team)
    this.sniper = this.buildGun('sniper', dark, team)
    // 不让枪管和玩家视线完全重合：略微斜跨胸前，正面也能看见完整枪身。
    this.smg.position.set(0.12, 1.45, 0.58)
    this.sniper.position.set(0.12, 1.47, 0.7)
    this.smg.scale.setScalar(1.12)
    this.sniper.scale.setScalar(1.12)
    this.smg.rotation.set(-0.08, 0.38, -0.03)
    this.sniper.rotation.set(-0.06, 0.32, -0.02)
    this.root.add(this.smg, this.sniper)
    this.setWeapon('smg')
  }

  private buildGun(id: 'smg' | 'sniper', dark: THREE.Material, team: THREE.Material): THREE.Group {
    const g = new THREE.Group()
    g.name = `rubber-${id}`
    // 枪身沿 Z 轴伸出，造型保持低多边形，但轮廓必须一眼可辨。
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(id === 'smg' ? 0.22 : 0.2, 0.22, id === 'smg' ? 0.58 : 0.72), dark)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, id === 'smg' ? 0.46 : 0.92, 8), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.z = id === 'smg' ? 0.48 : 0.78
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 8), team)
    muzzle.rotation.x = Math.PI / 2
    muzzle.position.z = id === 'smg' ? 0.74 : 1.27
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.4), dark)
    stock.position.set(0, -0.02, -0.42)
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.15, id === 'smg' ? 0.38 : 0.24, 0.2), team)
    magazine.position.set(0, -0.25, 0.02)
    magazine.rotation.x = id === 'smg' ? -0.18 : 0
    const sight = new THREE.Mesh(
      id === 'sniper' ? new THREE.CylinderGeometry(0.105, 0.105, 0.42, 10) : new THREE.BoxGeometry(0.1, 0.1, 0.18),
      dark,
    )
    if (id === 'sniper') sight.rotation.x = Math.PI / 2
    sight.position.set(0, 0.19, id === 'sniper' ? 0.08 : 0.12)
    // 两只手明确扣在护木和握把上；即使素材动画不理想，也不会像枪悬空。
    const gloveMat = new THREE.MeshLambertMaterial({ color: 0xd2a078 })
    this.flashMaterials.push(gloveMat)
    const rearHand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.2), gloveMat)
    rearHand.position.set(-0.14, -0.02, -0.08)
    const frontHand = rearHand.clone()
    frontHand.material = gloveMat
    frontHand.position.set(0.14, -0.04, id === 'smg' ? 0.34 : 0.48)
    g.add(receiver, barrel, muzzle, stock, magazine, sight, rearHand, frontHand)
    return g
  }
}
