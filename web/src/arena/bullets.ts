import * as THREE from 'three'
import { crateBoxes, groundY } from './terrain'
import type { TargetHit } from './targets'
import { BULLET_GRAVITY, BULLET_LIFE, type Weapon } from './weapons'

const MAX_BULLETS = 60
const MAX_PUFFS = 24
/** 一次步进最多走这么远。跨得太大子弹会从箱子和人身上穿过去。 */
const STEP = 0.75

interface Bullet {
  alive: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  damage: number
  headMul: number
  color: THREE.Color
  /** 枪口位置,用来算"这一枪打了多远" */
  origin: THREE.Vector3
}

interface Puff {
  alive: boolean
  pos: THREE.Vector3
  t: number
  life: number
  size: number
  color: THREE.Color
}

const boxes = crateBoxes()

/**
 * 橡胶弹。实体子弹,不是瞬间命中的射线 ——
 * 有飞行时间、有下坠,打移动目标要提前量,这是这个玩法唯一有门槛也最耐玩的地方。
 *
 * 曳光和命中的烟各用一个 InstancedMesh 池子,不管同时飞多少发都只占两次 draw call。
 */
export class Bullets {
  readonly group = new THREE.Group()

  private items: Bullet[] = []
  private puffs: Puff[] = []
  private tracerMesh: THREE.InstancedMesh
  private puffMesh: THREE.InstancedMesh

  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private scale = new THREE.Vector3()
  private prev = new THREE.Vector3()
  private dir = new THREE.Vector3()
  private zero = new THREE.Vector3(0, 0, 0)
  private hidden = new THREE.Vector3(0, -9999, 0)
  private up = new THREE.Vector3(0, 0, 1)

  constructor() {
    // 曳光是一根沿 z 轴的细长条,发射时按速度方向摆好、按速度拉长
    this.tracerMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 0.14, 1),
      new THREE.MeshBasicMaterial({ fog: false }),
      MAX_BULLETS,
    )
    this.tracerMesh.frustumCulled = false
    this.puffMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, fog: false }),
      MAX_PUFFS,
    )
    this.puffMesh.frustumCulled = false
    this.group.add(this.tracerMesh, this.puffMesh)

    for (let i = 0; i < MAX_BULLETS; i++) {
      this.items.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        damage: 0,
        headMul: 2,
        color: new THREE.Color(),
        origin: new THREE.Vector3(),
      })
      this.tracerMesh.setColorAt(i, new THREE.Color(0xffffff))
    }
    for (let i = 0; i < MAX_PUFFS; i++) {
      this.puffs.push({ alive: false, pos: new THREE.Vector3(), t: 0, life: 0.35, size: 0.5, color: new THREE.Color() })
      this.puffMesh.setColorAt(i, new THREE.Color(0xffffff))
    }
    this.hideAll()
  }

  /** 打一发。超出池子上限就顶掉最老的一发,不新建对象。 */
  spawn(origin: THREE.Vector3, dir: THREE.Vector3, weapon: Weapon): void {
    const b = this.items.find((x) => !x.alive) ?? this.items[0]
    b.alive = true
    b.pos.copy(origin)
    b.origin.copy(origin)
    b.vel.copy(dir).normalize().multiplyScalar(weapon.muzzle)
    b.life = BULLET_LIFE
    b.damage = weapon.damage
    b.headMul = weapon.headMul
    b.color.set(weapon.tracer)
  }

  update(dt: number, targets: { raycast(a:THREE.Vector3,b:THREE.Vector3):any; apply(bot:any,damage:number,point:THREE.Vector3,head:boolean,from:THREE.Vector3):TargetHit }, onHit: (hit: TargetHit) => void): void {
    for (const b of this.items) {
      if (!b.alive) continue
      b.life -= dt
      if (b.life <= 0) {
        b.alive = false
        continue
      }

      const speed = b.vel.length()
      const steps = Math.max(1, Math.min(8, Math.ceil((speed * dt) / STEP)))
      const sdt = dt / steps

      for (let s = 0; s < steps; s++) {
        this.prev.copy(b.pos)
        b.vel.y -= BULLET_GRAVITY * sdt
        b.pos.addScaledVector(b.vel, sdt)

        // 打到人:线段判定,别让子弹从人身上穿过去
        const hit = targets.raycast(this.prev, b.pos)
        if (hit) {
          const dmg = b.damage * (hit.head ? b.headMul : 1)
          const result = targets.apply(hit.bot, dmg, hit.point, hit.head, b.origin)
          this.puff(hit.point, hit.head ? 0.5 : 0.42, hit.head ? 0xffd76a : 0xff8f6a)
          onHit(result)
          b.alive = false
          break
        }

        // 打到箱子
        const crate = boxes.find(
          (c) =>
            Math.abs(b.pos.x - c.x) < c.half &&
            Math.abs(b.pos.z - c.z) < c.half &&
            b.pos.y < c.top &&
            b.pos.y > c.top - 2.4,
        )
        if (crate) {
          this.puff(b.pos, 0.34, 0xc9a06a)
          b.alive = false
          break
        }

        // 入土
        if (b.pos.y <= groundY(b.pos.x, b.pos.z)) {
          this.puff(b.pos, 0.4, 0x9c8055)
          b.alive = false
          break
        }

        // 出界:两端和四周的墙
        if (Math.abs(b.pos.x) > 100 || Math.abs(b.pos.z) > 100) {
          this.puff(b.pos, 0.3, 0xaab4c6)
          b.alive = false
          break
        }
      }
    }

    for (const p of this.puffs) {
      if (!p.alive) continue
      p.t += dt
      if (p.t >= p.life) p.alive = false
    }

    this.sync(dt)
  }

  dispose(): void {
    this.tracerMesh.geometry.dispose()
    ;(this.tracerMesh.material as THREE.Material).dispose()
    this.puffMesh.geometry.dispose()
    ;(this.puffMesh.material as THREE.Material).dispose()
  }

  /** 把状态写进两个实例化网格 */
  private sync(dt: number): void {
    for (let i = 0; i < this.items.length; i++) {
      const b = this.items[i]
      if (!b.alive) {
        this.m.compose(this.hidden, this.q.identity(), this.zero)
      } else {
        // 一帧走多远就拉多长,看起来才是"飞过去"而不是"一串点"
        const len = Math.max(1.2, b.vel.length() * dt * 2.2)
        this.dir.copy(b.vel).normalize()
        this.q.setFromUnitVectors(this.up, this.dir)
        this.m.compose(b.pos, this.q, this.scale.set(1, 1, len))
        this.tracerMesh.setColorAt(i, b.color)
      }
      this.tracerMesh.setMatrixAt(i, this.m)
    }
    this.tracerMesh.instanceMatrix.needsUpdate = true
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true

    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i]
      if (!p.alive) {
        this.m.compose(this.hidden, this.q.identity(), this.zero)
      } else {
        // 先撑开再缩没,不用改材质透明度(那样得每个实例一份材质)
        const k = p.t / p.life
        const r = p.size * (0.4 + k * 1.4) * (1 - k * 0.75)
        this.m.compose(p.pos, this.q.identity(), this.scale.setScalar(Math.max(0.001, r)))
        this.puffMesh.setColorAt(i, p.color)
      }
      this.puffMesh.setMatrixAt(i, this.m)
    }
    this.puffMesh.instanceMatrix.needsUpdate = true
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true
  }

  private puff(at: THREE.Vector3, size: number, color: number): void {
    const p = this.puffs.find((x) => !x.alive) ?? this.puffs[0]
    p.alive = true
    p.pos.copy(at)
    p.t = 0
    p.size = size
    p.color.set(color)
  }

  private hideAll(): void {
    this.m.compose(this.hidden, this.q.identity(), this.zero)
    for (let i = 0; i < MAX_BULLETS; i++) this.tracerMesh.setMatrixAt(i, this.m)
    for (let i = 0; i < MAX_PUFFS; i++) this.puffMesh.setMatrixAt(i, this.m)
    this.tracerMesh.instanceMatrix.needsUpdate = true
    this.puffMesh.instanceMatrix.needsUpdate = true
  }
}
