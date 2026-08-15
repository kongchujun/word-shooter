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
      const part = [obj.name, obj.parent?.name, obj.parent?.parent?.name].filter(Boolean).join('/')
      // 素材自带的是胡子男性脸；本项目角色改为自定义动漫头部，原头部网格必须隐藏。
      if (part.includes('head')) {
        mesh.visible = false
        return
      }
      mesh.castShadow = false
      mesh.receiveShadow = false
      // 每个实例要独立闪白,材质不能和其他人共用。
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => this.cloneMaterial(m, part))
      } else {
        mesh.material = this.cloneMaterial(mesh.material, part)
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

  private cloneMaterial(material: THREE.Material, part: string): THREE.Material {
    const clone = material.clone()
    if (clone instanceof THREE.MeshLambertMaterial || clone instanceof THREE.MeshStandardMaterial) {
      this.flashMaterials.push(clone)
      // 不再另外套一个盒子背心:直接给躯干贴图染队色,省掉每个人一个 draw call。
      if (part.includes('torso') || part.includes('arm-')) { clone.color.set(0x263b61); clone.map=null; clone.needsUpdate=true }
      if (part.includes('leg-')) { clone.color.set(0x182238); clone.map=null; clone.needsUpdate=true }
    }
    return clone
  }

  private addTeamGear(teamColor: number): void {
    const dark = new THREE.MeshLambertMaterial({ color: 0x28303b })
    const team = new THREE.MeshLambertMaterial({ color: teamColor })
    dark.emissive = new THREE.Color(0)
    team.emissive = new THREE.Color(0)
    this.flashMaterials.push(dark, team)

    this.addAnimeHead(team)

    const white = new THREE.MeshLambertMaterial({ color: 0xe8edf2 })
    const orange = new THREE.MeshLambertMaterial({ color: 0xe99a36 })
    const navy = new THREE.MeshLambertMaterial({ color: 0x263b61 })
    this.flashMaterials.push(white, orange, navy)

    // 长外套的前襟、白边、橙色领带和百褶裙是参考图最醒目的服装语言。
    const coat = new THREE.Mesh(new THREE.BoxGeometry(.68,.72,.38), navy)
    coat.position.set(0,1.08,.01)
    const lapelL = new THREE.Mesh(new THREE.BoxGeometry(.08,.5,.035), white)
    const lapelR = lapelL.clone();lapelL.position.set(-.25,1.08,.215);lapelR.position.set(.25,1.08,.215)
    lapelL.rotation.z=-.12;lapelR.rotation.z=.12
    const tie = new THREE.Mesh(new THREE.BoxGeometry(.13,.43,.055), orange)
    tie.position.set(0,1.28,.24);tie.rotation.z=.02
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(.34,.58,.43,12,1,true), navy)
    skirt.position.set(0,.68,0)
    // 裙摆白边单独一圈，远距离仍看得出不是普通裤装。
    const hem = new THREE.Mesh(new THREE.TorusGeometry(.57,.035,5,12), white)
    hem.position.set(0,.47,0);hem.rotation.x=Math.PI/2
    // 袖章是唯一大面积队色，红蓝双方仍能快速辨认。
    const armbandL=new THREE.Mesh(new THREE.BoxGeometry(.08,.18,.32),team),armbandR=armbandL.clone()
    armbandL.position.set(-.52,1.22,0);armbandR.position.set(.52,1.22,0)
    this.root.add(coat,lapelL,lapelR,tie,skirt,hem,armbandL,armbandR)

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

  private addAnimeHead(team: THREE.Material): void {
    const skin = new THREE.MeshBasicMaterial({ color: 0xffddcb })
    const hair = new THREE.MeshLambertMaterial({ color: 0xffcf82 })
    const hairShade = new THREE.MeshLambertMaterial({ color: 0xd99467 })
    const eye = new THREE.MeshBasicMaterial({ color: 0x8e3c78 })
    this.flashMaterials.push(hair, hairShade)
    const head = new THREE.Mesh(new THREE.SphereGeometry(.36,12,9),skin)
    head.position.set(0,1.78,0);head.scale.set(1,.96,.9)
    // 发帽覆盖后脑，刘海用三束倾斜的锥体形成动漫轮廓。
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.385,12,8,0,Math.PI*2,0,Math.PI*.64),hair)
    cap.position.set(0,1.86,-.05)
    const bangGeo=new THREE.ConeGeometry(.075,.3,6)
    for(const [x,r] of [[-.18,-.28],[0,-.05],[.18,.24]] as const){const b=new THREE.Mesh(bangGeo,hair);b.position.set(x,1.94,.3);b.rotation.z=r;b.rotation.x=-.08;this.root.add(b)}
    // 高马尾由发结和两节发束组成，跑动时整体随人物动画移动。
    const knot=new THREE.Mesh(new THREE.SphereGeometry(.16,8,6),hairShade);knot.position.set(0,1.9,-.35)
    const pony1=new THREE.Mesh(new THREE.ConeGeometry(.18,.72,7),hair);pony1.position.set(.08,2.17,-.48);pony1.rotation.z=-.42
    const pony2=new THREE.Mesh(new THREE.ConeGeometry(.13,.58,7),hairShade);pony2.position.set(.3,2.43,-.52);pony2.rotation.z=-.72
    const eyeGeo=new THREE.SphereGeometry(.055,8,6)
    const leftEye=new THREE.Mesh(eyeGeo,eye),rightEye=leftEye.clone();leftEye.scale.z=.25;rightEye.scale.z=.25
    leftEye.position.set(-.13,1.8,.325);rightEye.position.set(.13,1.8,.325)
    const mouth=new THREE.Mesh(new THREE.BoxGeometry(.09,.025,.02),new THREE.MeshBasicMaterial({color:0xa94c62}));mouth.position.set(0,1.66,.337)
    // 小发带沿用队色，既贴近参考图的发饰，也增强阵营识别。
    const ribbon=new THREE.Mesh(new THREE.TorusGeometry(.17,.035,5,10),team);ribbon.position.set(0,1.94,-.38);ribbon.rotation.x=Math.PI/2
    this.root.add(head,cap,knot,pony1,pony2,leftEye,rightEye,mouth,ribbon)
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
