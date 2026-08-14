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

    // 双手前方的一体式橡胶弹枪。做成一个 mesh 而不是机匣/枪管/弹匣六个 mesh:
    // 八人房里每人少 5 个 draw call,手机上比那点造型细节值钱得多。
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.9), dark)
    gun.position.set(0, 1.02, -0.48)
    gun.name = 'rubber-rifle'
    this.root.add(gun)

  }
}
