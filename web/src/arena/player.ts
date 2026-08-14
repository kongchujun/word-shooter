import * as THREE from 'three'
import type { InputState } from './controls'
import { ARENA, crateBoxes, groundY } from './terrain'

/** 手感参数,调走路跳跃只改这里 */
export const PLAYER = {
  /** 眼睛离脚的高度 */
  eye: 1.62,
  /** 身体半径,用来跟箱子和墙做推开 */
  radius: 0.45,
  walk: 6.2,
  sprint: 9.4,
  /** 速度趋近目标的快慢。太大像贴图瞬移,太小像在冰上 */
  accel: 16,
  /** 空中还剩多少操控力,给一点点,不然跳起来就完全失控 */
  airControl: 0.35,
  gravity: 25,
  jump: 8.4,
  /** 抬头低头的上限,别让人翻过去 */
  maxPitch: 1.48,
  /** 站上箱子的容差:脚离箱顶这么近就算踩上去了 */
  stepUp: 0.45,
} as const

const boxes = crateBoxes()

/**
 * 第一人称角色。一个胶囊在高度场上跑,没有物理引擎:
 * 落地 = 采样 groundY,箱子 = 轴对齐盒子推开,就这两件事。
 */
export class Player {
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  /** 朝 +x 方向(从红方基地望向中间那座山) */
  yaw = -Math.PI / 2
  pitch = 0
  grounded = true

  private forward = new THREE.Vector3()
  private right = new THREE.Vector3()
  private want = new THREE.Vector3()

  constructor(spawn: THREE.Vector3) {
    this.pos.copy(spawn)
    this.pos.y = groundY(spawn.x, spawn.z)
  }

  /** 相机放在眼睛的位置 */
  applyTo(camera: THREE.Camera): void {
    camera.position.set(this.pos.x, this.pos.y + PLAYER.eye, this.pos.z)
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
  }

  update(dt: number, input: InputState, jump: boolean): void {
    this.yaw += input.lookYaw
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookPitch, -PLAYER.maxPitch, PLAYER.maxPitch)
    input.lookYaw = 0
    input.lookPitch = 0

    // 朝向:yaw=0 时看向 -z,和 three 的相机约定一致
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))

    this.want.set(0, 0, 0).addScaledVector(this.forward, input.moveZ).addScaledVector(this.right, input.moveX)
    if (this.want.lengthSq() > 1) this.want.normalize()
    const speed = input.sprint ? PLAYER.sprint : PLAYER.walk
    this.want.multiplyScalar(speed)

    // 水平速度趋近目标;空中操控力打折
    const k = 1 - Math.exp(-PLAYER.accel * (this.grounded ? 1 : PLAYER.airControl) * dt)
    this.vel.x += (this.want.x - this.vel.x) * k
    this.vel.z += (this.want.z - this.vel.z) * k

    if (jump && this.grounded) {
      this.vel.y = PLAYER.jump
      this.grounded = false
    }
    this.vel.y -= PLAYER.gravity * dt

    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt
    this.pos.y += this.vel.y * dt

    this.resolveCrates()
    this.clampToArena()

    const floor = this.floorAt(this.pos.x, this.pos.z)
    if (this.pos.y <= floor) {
      this.pos.y = floor
      this.vel.y = 0
      this.grounded = true
    } else {
      this.grounded = false
    }
  }

  /** 脚下能站的高度:地形,或者踩在箱子顶上 */
  private floorAt(x: number, z: number): number {
    let h = groundY(x, z)
    for (const b of boxes) {
      if (Math.abs(x - b.x) > b.half + PLAYER.radius) continue
      if (Math.abs(z - b.z) > b.half + PLAYER.radius) continue
      // 只有从上方够得着才算站上去,不然会卡在箱子腰上
      if (this.pos.y >= b.top - PLAYER.stepUp && b.top > h) h = b.top
    }
    return h
  }

  /** 人在箱子侧面时,按穿透浅的那一轴推出去 */
  private resolveCrates(): void {
    for (const b of boxes) {
      if (this.pos.y >= b.top - PLAYER.stepUp) continue
      const r = b.half + PLAYER.radius
      const dx = this.pos.x - b.x
      const dz = this.pos.z - b.z
      if (Math.abs(dx) >= r || Math.abs(dz) >= r) continue
      if (r - Math.abs(dx) < r - Math.abs(dz)) {
        this.pos.x = b.x + Math.sign(dx || 1) * r
        this.vel.x = 0
      } else {
        this.pos.z = b.z + Math.sign(dz || 1) * r
        this.vel.z = 0
      }
    }
  }

  private clampToArena(): void {
    const lim = ARENA.size / 2 - 1.2
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim)
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim)
  }
}
