/**
 * 两把枪。射程差异不是设出来的,是初速 + 重力自己算出来的结果:
 * 冲锋枪初速慢,四十来米外就得抬枪;狙击枪初速快、弹道平,能打到对面基地门口。
 *
 * 调手感只改这个文件。
 */
export interface Weapon {
  id: 'smg' | 'sniper'
  /** i18n key */
  nameKey: 'arena.gun.smg' | 'arena.gun.sniper'
  /** 初速 m/s */
  muzzle: number
  /** 两发之间至少隔多久(秒) */
  interval: number
  /** 按住不放会不会连发 */
  auto: boolean
  damage: number
  /** 打头的倍数 */
  headMul: number
  mag: number
  reload: number
  /** 腰射 / 开镜的散布半角(弧度) */
  spreadHip: number
  spreadAds: number
  /** 后坐力:枪往后坐多少、镜头往上抬多少(弧度) */
  kick: number
  punch: number
  /** 开镜时的视野,越小越"拉近" */
  adsFov: number
  /** 曳光颜色 */
  tracer: number
}

export const WEAPONS: Record<'smg' | 'sniper', Weapon> = {
  smg: {
    id: 'smg',
    nameKey: 'arena.gun.smg',
    muzzle: 90,
    interval: 0.1,
    auto: true,
    damage: 12,
    headMul: 2,
    mag: 30,
    reload: 1.7,
    spreadHip: 0.061, // 3.5°
    spreadAds: 0.021, // 1.2°
    kick: 0.045,
    punch: 0.012,
    adsFov: 58,
    tracer: 0xffd76a,
  },
  sniper: {
    id: 'sniper',
    nameKey: 'arena.gun.sniper',
    muzzle: 220,
    interval: 1.25,
    auto: false,
    damage: 55,
    headMul: 2,
    mag: 5,
    reload: 2.4,
    spreadHip: 0.07, // 4°
    spreadAds: 0.0026, // 0.15°
    kick: 0.14,
    punch: 0.05,
    adsFov: 30,
    tracer: 0xff9d5c,
  },
}

/** 子弹的重力。比真实重力夸张,下坠才看得见、才学得会抬枪。 */
export const BULLET_GRAVITY = 15
/** 飞这么久还没打到东西就算了 */
export const BULLET_LIFE = 3.5
