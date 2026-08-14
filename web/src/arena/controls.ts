/**
 * 输入。两套驱动写同一份 InputState:
 * 电脑走指针锁定 + 键盘,手机走虚拟摇杆 + 右半屏拖动。
 *
 * 这个游戏不走 Engine 那条输入链 —— 指针锁定之后鼠标没有屏幕坐标、只有位移量,
 * 触屏又要同时按住摇杆和开火(多指),和现有三个游戏的 (x, y) 模型完全不同。
 */
export interface InputState {
  /** -1 左 / +1 右 */
  moveX: number
  /** -1 后 / +1 前 */
  moveZ: number
  sprint: boolean
  /** 本帧累计的视角增量(弧度),读完要清零 */
  lookYaw: number
  lookPitch: number
  /** 扳机按住不放。单发枪自己做边沿检测 */
  fire: boolean
  /** 开镜 */
  ads: boolean
}

export function emptyInput(): InputState {
  return { moveX: 0, moveZ: 0, sprint: false, lookYaw: 0, lookPitch: 0, fire: false, ads: false }
}

/** 触屏设备(手机、平板)。笔记本带触摸屏时两套驱动会同时挂着,互不干扰。 */
export function isCoarsePointer(): boolean {
  // 微信 / 部分安卓 WebView 会把 pointer 媒体查询报成 fine,但 maxTouchPoints 是真的。
  // 三路任意一路认出触屏就挂手机控制,避免按钮画出来却没有 TouchControls 驱动。
  return (
    window.matchMedia?.('(any-pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0 ||
    'ontouchstart' in window
  )
}

const LOOK_MOUSE = 0.0022
const LOOK_TOUCH = 0.0032

/** 键盘 + 鼠标。指针锁定要在用户手势里申请,所以由外面点击时调 lock()。 */
export class DesktopControls {
  private keys = new Set<string>()
  private jumpQueued = false
  private disposers: (() => void)[] = []
  /** 只有战场在台上时才吃鼠标,菜单里晃鼠标不该把镜头转跑 */
  enabled = true
  /** 攒下的换弹/换枪请求,由世界那边每帧取走 */
  private reloadQueued = false
  private switchQueued: 'smg' | 'sniper' | 'next' | null = null

  constructor(
    private canvas: HTMLCanvasElement,
    private state: InputState,
  ) {
    const mouseDown = (e: MouseEvent) => {
      if (!this.enabled) return
      if (e.button === 0) {
        // Esc 之后第一次左键只负责重新抓住鼠标,不能顺便走火。
        if (!this.locked) {
          this.lock()
          return
        }
        this.state.fire = true
      }
      if (e.button === 2) {
        e.preventDefault()
        this.state.ads = true
      }
    }
    const mouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.state.fire = false
      if (e.button === 2) this.state.ads = false
    }
    // 右键要用来开镜,得挡掉系统菜单。
    // 监听 document 的捕获阶段,不能只挂 canvas:准星/HUD 是一层透明 DOM,
    // 右键落在它上面时事件根本到不了 canvas,浏览器菜单就会漏出来。
    const menu = (e: Event) => {
      if (!this.enabled) return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const wheel = () => {
      this.switchQueued = 'next'
    }
    document.addEventListener('mousedown', mouseDown)
    document.addEventListener('mouseup', mouseUp)
    // window 是事件路径最外层,捕获阶段会早于 document / HUD / canvas。
    // stopImmediatePropagation 也挡住浏览器壳或别的模块后来注册的菜单处理器。
    window.addEventListener('contextmenu', menu, { capture: true })
    this.canvas.addEventListener('wheel', wheel, { passive: true })
    this.disposers.push(
      () => document.removeEventListener('mousedown', mouseDown),
      () => document.removeEventListener('mouseup', mouseUp),
      () => window.removeEventListener('contextmenu', menu, { capture: true }),
      () => this.canvas.removeEventListener('wheel', wheel),
    )

    const down = (e: KeyboardEvent) => {
      // 锁定状态下空格会滚页面
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
      this.keys.add(e.code)
      if (e.code === 'Space') this.jumpQueued = true
      if (e.code === 'KeyR') this.reloadQueued = true
      if (e.code === 'Digit1') this.switchQueued = 'smg'
      if (e.code === 'Digit2') this.switchQueued = 'sniper'
      this.apply()
    }
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code)
      this.apply()
    }
    // 标准 FPS 行为:锁定时 movementX/Y 转镜头;Esc 解锁后系统鼠标恢复。
    const move = (e: MouseEvent) => {
      // FPS 模式只在锁定时转镜头。Esc 解锁后鼠标是拿来点界面的,
      // 不能一边移动系统鼠标一边偷偷带着镜头转。
      if (!this.enabled || !this.locked) return
      this.state.lookYaw -= e.movementX * LOOK_MOUSE
      this.state.lookPitch -= e.movementY * LOOK_MOUSE
    }
    // 松开锁定(按 Esc)时把按键状态清掉,不然会一直往前走
    const lockChange = () => {
      const locked = document.pointerLockElement === this.canvas
      this.canvas.classList.toggle('locked', locked)
      if (!locked) {
        this.keys.clear()
        this.state.fire = false
        this.state.ads = false
        this.apply()
      }
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    document.addEventListener('mousemove', move)
    document.addEventListener('pointerlockchange', lockChange)
    this.disposers.push(
      () => window.removeEventListener('keydown', down),
      () => window.removeEventListener('keyup', up),
      () => document.removeEventListener('mousemove', move),
      () => document.removeEventListener('pointerlockchange', lockChange),
    )
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas
  }

  lock(): void {
    // Safari 会返回 undefined 而不是 promise
    void Promise.resolve(this.canvas.requestPointerLock()).catch(() => {})
  }

  takeJump(): boolean {
    const j = this.jumpQueued
    this.jumpQueued = false
    return j
  }

  takeReload(): boolean {
    const r = this.reloadQueued
    this.reloadQueued = false
    return r
  }

  takeSwitch(): 'smg' | 'sniper' | 'next' | null {
    const s = this.switchQueued
    this.switchQueued = null
    return s
  }

  dispose(): void {
    for (const d of this.disposers) d()
    if (this.locked) document.exitPointerLock()
  }

  private apply(): void {
    const k = this.keys
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    const z = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    this.state.moveX = x
    this.state.moveZ = z
    this.state.sprint = k.has('ShiftLeft') || k.has('ShiftRight')
  }
}

/**
 * 触屏:左半屏落指即生成摇杆,右半屏拖动转视角,右下角一个跳跃键。
 * 每根手指按 pointerId 记账 —— 少了这一步,摁着摇杆就没法同时转视角。
 */
export class TouchControls {
  private root: HTMLElement
  private stickBase: HTMLElement
  private stickKnob: HTMLElement
  private jumpQueued = false
  /** 摇杆那根手指 */
  private moveId = -1
  private moveOrigin = { x: 0, y: 0 }
  /** 转视角那根手指 */
  private lookId = -1
  private lookLast = { x: 0, y: 0 }
  private disposers: (() => void)[] = []
  private reloadQueued = false
  private switchQueued: 'smg' | 'sniper' | 'next' | null = null

  constructor(
    host: HTMLElement,
    private state: InputState,
    /** 按钮上的字。这个文件不引 i18n,免得把文案和输入逻辑绑死 */
    labels: { fire: string; jump: string; ads: string; reload: string; swap: string },
  ) {
    this.root = document.createElement('div')
    this.root.className = 'arena-touch'
    this.root.innerHTML = `
      <div class="arena-stick" data-el="stick"><i data-el="knob"></i></div>
      <button class="arena-btn arena-fire" data-el="fire" type="button">${labels.fire}</button>
      <button class="arena-btn arena-jump" data-el="jump" type="button">${labels.jump}</button>
      <button class="arena-btn arena-ads" data-el="ads" type="button">${labels.ads}</button>
      <button class="arena-btn arena-reload" data-el="reload" type="button">${labels.reload}</button>
      <button class="arena-btn arena-swap" data-el="swap" type="button">${labels.swap}</button>
    `
    host.appendChild(this.root)
    this.stickBase = this.root.querySelector('[data-el="stick"]')!
    this.stickKnob = this.root.querySelector('[data-el="knob"]')!

    const tap = (name: string, fn: () => void): HTMLButtonElement => {
      const el = this.root.querySelector<HTMLButtonElement>(`[data-el="${name}"]`)!
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        fn()
      })
      return el
    }

    tap('jump', () => {
      this.jumpQueued = true
    })
    tap('reload', () => {
      this.reloadQueued = true
    })
    tap('swap', () => {
      this.switchQueued = 'next'
    })
    // 开镜在手机上做成开关:按住不放会白占一根手指
    const adsBtn: HTMLButtonElement = tap('ads', () => {
      this.state.ads = !this.state.ads
      adsBtn.classList.toggle('on', this.state.ads)
    })
    // 扳机要能按住连发,所以按下/抬起分开处理
    const fireBtn = this.root.querySelector<HTMLButtonElement>('[data-el="fire"]')!
    fireBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.state.fire = true
      try {
        fireBtn.setPointerCapture(e.pointerId)
      } catch {
        /* 老内核可能不支持 */
      }
    })
    const release = () => {
      this.state.fire = false
    }
    fireBtn.addEventListener('pointerup', release)
    fireBtn.addEventListener('pointercancel', release)

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      // 落在按钮上的手指归按钮管,别拿去转视角
      if ((e.target as HTMLElement)?.closest?.('.arena-btn')) return
      // 左半屏管走,右半屏管看
      if (e.clientX < window.innerWidth * 0.45 && this.moveId < 0) {
        this.moveId = e.pointerId
        this.moveOrigin = { x: e.clientX, y: e.clientY }
        this.showStick(e.clientX, e.clientY)
      } else if (this.lookId < 0) {
        this.lookId = e.pointerId
        this.lookLast = { x: e.clientX, y: e.clientY }
      }
    }

    const move = (e: PointerEvent) => {
      if (e.pointerId === this.moveId) {
        const dx = e.clientX - this.moveOrigin.x
        const dy = e.clientY - this.moveOrigin.y
        const max = 52
        const len = Math.hypot(dx, dy) || 1
        const k = Math.min(1, len / max)
        this.state.moveX = (dx / len) * k
        this.state.moveZ = (-dy / len) * k
        // 推到底就是疾跑,不用再加一个键
        this.state.sprint = k > 0.92
        this.stickKnob.style.transform = `translate(${(dx / len) * k * max}px, ${(dy / len) * k * max}px)`
      } else if (e.pointerId === this.lookId) {
        this.state.lookYaw -= (e.clientX - this.lookLast.x) * LOOK_TOUCH
        this.state.lookPitch -= (e.clientY - this.lookLast.y) * LOOK_TOUCH
        this.lookLast = { x: e.clientX, y: e.clientY }
      }
    }

    const up = (e: PointerEvent) => {
      if (e.pointerId === this.moveId) {
        this.moveId = -1
        this.state.moveX = 0
        this.state.moveZ = 0
        this.state.sprint = false
        this.hideStick()
      } else if (e.pointerId === this.lookId) {
        this.lookId = -1
      }
    }

    // 挂 window 而不是 canvas:手指滑出画布边界也不能丢事件
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    this.disposers.push(
      () => window.removeEventListener('pointerdown', down),
      () => window.removeEventListener('pointermove', move),
      () => window.removeEventListener('pointerup', up),
      () => window.removeEventListener('pointercancel', up),
    )
  }

  takeJump(): boolean {
    const j = this.jumpQueued
    this.jumpQueued = false
    return j
  }

  takeReload(): boolean {
    const r = this.reloadQueued
    this.reloadQueued = false
    return r
  }

  takeSwitch(): 'smg' | 'sniper' | 'next' | null {
    const s = this.switchQueued
    this.switchQueued = null
    return s
  }

  dispose(): void {
    for (const d of this.disposers) d()
    this.root.remove()
  }

  private showStick(x: number, y: number): void {
    this.stickBase.style.left = `${x}px`
    this.stickBase.style.top = `${y}px`
    this.stickBase.classList.add('on')
  }

  private hideStick(): void {
    this.stickBase.classList.remove('on')
    this.stickKnob.style.transform = ''
  }
}
