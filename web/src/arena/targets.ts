import * as THREE from 'three'
import { groundY } from './terrain'
import { ArenaCharacter } from './characters'

/** 靶子机器人。第一期用它代替真人:会来回走,能被打倒,三秒后站起来。 */
export interface TargetHit {
  /** 打的是头还是身子 */
  head: boolean
  /** 命中点,用来喷烟 */
  point: THREE.Vector3
  /** 这一枪之后是不是倒了 */
  down: boolean
  /** 打中的地方离枪口多远,结算里那个"最远的一枪" */
  distance: number
}

const MAX_HP = 100
const DOWN_TIME = 3
/**
 * 身子和头的判定球,比模型稍大一点点,擦边也算中。
 * 两个球尽量不重叠 —— 重叠的那一段到底算头还是算身子,全看子弹从哪个方向来,
 * 玩家会觉得"我明明爆头了却只掉一点血"。
 */
const BODY_R = 0.55
const BODY_Y = 0.9
const HEAD_R = 0.34
const HEAD_Y = 1.78

class Bot {
  readonly group = new THREE.Group()
  hp = MAX_HP
  downFor = 0
  /** 在 from → to 之间来回走 */
  private t = Math.random()
  private dir = 1
  private flash = 0
  private body: THREE.Mesh
  private head: THREE.Mesh
  private mat: THREE.MeshLambertMaterial
  private character: ArenaCharacter | null = null
  private moving = true

  constructor(
    readonly from: THREE.Vector3,
    readonly to: THREE.Vector3,
    color: number,
    /** 走一趟要几秒 */
    private period: number,
  ) {
    this.mat = new THREE.MeshLambertMaterial({ color })
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 4, 8), this.mat)
    this.body.position.y = 0.95
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), this.mat)
    this.head.position.y = 1.75
    this.group.add(this.body, this.head)
    this.place()
    void ArenaCharacter.create(color).then((character) => {
      this.character = character
      this.body.visible = false
      this.head.visible = false
      this.group.add(character.root)
    }).catch((err) => {
      // 外部模型损坏/网络断开时继续用胶囊占位,游戏不能因此进不了场。
      console.warn('[arena] 人物模型加载失败,继续用占位体', err)
    })
  }

  /** 身子中心和头心的世界坐标,给命中判定用 */
  bodyCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.group.position).setY(this.group.position.y + BODY_Y)
  }

  headCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.group.position).setY(this.group.position.y + HEAD_Y)
  }

  update(dt: number): void {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3)
      this.mat.emissive.setScalar(this.flash * 0.6)
      this.character?.setFlash(this.flash)
    }

    if (this.downFor > 0) {
      this.downFor -= dt
      if (this.downFor <= 0) this.revive()
      this.character?.update(dt, false, true)
      return
    }

    this.t += (dt / this.period) * this.dir
    if (this.t >= 1) {
      this.t = 1
      this.dir = -1
    } else if (this.t <= 0) {
      this.t = 0
      this.dir = 1
    }
    this.place()
    this.character?.update(dt, this.moving, false)
  }

  hit(damage: number, point: THREE.Vector3, head: boolean, from: THREE.Vector3): TargetHit {
    this.flash = 1
    this.hp -= damage
    const down = this.hp <= 0
    if (down) this.knockDown()
    return { head, point: point.clone(), down, distance: from.distanceTo(point) }
  }

  get alive(): boolean {
    return this.downFor <= 0
  }

  private knockDown(): void {
    this.downFor = DOWN_TIME
    this.hp = 0
    // GLB 有专门的倒地动画;素材还没到时,胶囊占位才用旋转兜底。
    if (this.character) this.character.knockDown()
    else {
      this.group.rotation.x = -Math.PI / 2.2
      this.group.position.y -= 0.35
    }
  }

  private revive(): void {
    this.hp = MAX_HP
    this.group.rotation.x = 0
    this.character?.revive()
    this.place()
  }

  private place(): void {
    const x = THREE.MathUtils.lerp(this.from.x, this.to.x, this.t)
    const z = THREE.MathUtils.lerp(this.from.z, this.to.z, this.t)
    this.group.position.set(x, groundY(x, z), z)
    // 面朝走的方向,不然像螃蟹
    this.group.rotation.y = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z) * this.dir
    this.moving = this.from.distanceToSquared(this.to) > 0.01
  }
}

/** 场上所有靶子。命中判定用线段到球心的最近距离,不会因为子弹跨步太大而穿过去。 */
export class Targets {
  readonly group = new THREE.Group()
  private bots: Bot[] = []
  private tmpA = new THREE.Vector3()
  private tmpB = new THREE.Vector3()
  private tmpC = new THREE.Vector3()

  constructor() {
    const spots: [number, number, number, number, number, number, number][] = [
      // fromX, fromZ, toX, toZ, 颜色, 周期
      // 出生点附近留一只,让玩家一进来就看得清人物造型、也方便试枪。
      [-64, -10, -64, 10, 0x4d8dff, 6, 0],
      [16, 26, 40, 26, 0x4d8dff, 7, 0],
      [46, -30, 46, -6, 0x4d8dff, 5, 0],
      [8, -6, 8, 6, 0x4d8dff, 4, 0],
      [-44, 30, -30, 44, 0xe85d4c, 8, 0],
    ]
    for (const [fx, fz, tx, tz, color, period] of spots) {
      const bot = new Bot(new THREE.Vector3(fx, 0, fz), new THREE.Vector3(tx, 0, tz), color, period)
      this.bots.push(bot)
      this.group.add(bot.group)
    }
  }

  update(dt: number): void {
    for (const b of this.bots) b.update(dt)
  }

  /**
   * 一小段子弹轨迹有没有打到人。
   * 先算线段到判定球心的最近距离 —— 直接判端点在不在球里的话,
   * 子弹一帧飞 1.5 米,人只有 0.6 米宽,会直接穿过去。
   */
  raycast(a: THREE.Vector3, b: THREE.Vector3): { bot: Bot; head: boolean; point: THREE.Vector3 } | null {
    let best: { bot: Bot; head: boolean; point: THREE.Vector3; t: number } | null = null

    for (const bot of this.bots) {
      if (!bot.alive) continue
      // 头先判:两个球万一还是蹭上了,也按"打到头就算头"算,
      // 不然从下往上打会先撞进身子那个球,爆头判成擦身。
      for (const head of [true, false]) {
        const c = head ? bot.headCenter(this.tmpA) : bot.bodyCenter(this.tmpA)
        const r = head ? HEAD_R : BODY_R
        const ab = this.tmpB.copy(b).sub(a)
        const len2 = ab.lengthSq() || 1e-6
        const t = THREE.MathUtils.clamp(this.tmpC.copy(c).sub(a).dot(ab) / len2, 0, 1)
        const closest = this.tmpC.copy(a).addScaledVector(ab, t)
        if (closest.distanceToSquared(c) > r * r) continue
        // 同一只身上头优先;不同的靶子之间才比谁更靠前
        if (!best || (best.bot !== bot && t < best.t)) best = { bot, head, point: closest.clone(), t }
        if (head) break
      }
    }
    return best ? { bot: best.bot, head: best.head, point: best.point } : null
  }

  /** 打中了:扣血、闪一下、血空就躺下 */
  apply(bot: Bot, damage: number, point: THREE.Vector3, head: boolean, from: THREE.Vector3): TargetHit {
    return bot.hit(damage, point, head, from)
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose?.()
      const mat = m.material as THREE.Material | undefined
      mat?.dispose?.()
    })
  }
}

export type { Bot }
