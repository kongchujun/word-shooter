import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'

const MODEL_URL = '/arena/meshy/aurora-walk.glb'
interface CharacterSource { scene: THREE.Group; clips: THREE.AnimationClip[] }
let sourcePromise: Promise<CharacterSource> | null = null

function source(): Promise<CharacterSource> {
  if (!sourcePromise) sourcePromise = new Promise((resolve,reject)=>{
    new GLTFLoader().load(MODEL_URL,gltf=>resolve({scene:gltf.scene,clips:gltf.animations}),undefined,reject)
  })
  return sourcePromise
}

/** Meshy 蒙皮人物实例。模型经过减面、量化和 1024 WebP 贴图压缩，适合移动网页。 */
export class ArenaCharacter {
  readonly root = new THREE.Group()
  private model: THREE.Group
  private mixer: THREE.AnimationMixer
  private walk: THREE.AnimationAction | null = null
  private flashMaterials: THREE.MeshStandardMaterial[] = []
  private smg = new THREE.Group()
  private sniper = new THREE.Group()

  private constructor(src: CharacterSource, teamColor: number) {
    this.model = clone(src.scene) as THREE.Group
    this.model.name = 'meshy-aurora-character'
    // Mesh 节点看似是厘米尺寸，但 Armature 自带 100× 变换；场景根节点保持 1 才是约 2 米。
    this.model.scale.setScalar(1)
    this.model.rotation.y = Math.PI
    this.model.traverse(obj=>{
      const mesh=obj as THREE.Mesh
      if(!mesh.isMesh)return
      mesh.castShadow=false;mesh.receiveShadow=false
      if(Array.isArray(mesh.material)) mesh.material=mesh.material.map(mat=>this.cloneMaterial(mat))
      else mesh.material=this.cloneMaterial(mesh.material)
    })
    this.root.add(this.model)
    this.mixer=new THREE.AnimationMixer(this.model)
    const clip=src.clips[0]
    if(clip){this.walk=this.mixer.clipAction(clip);this.walk.play()}
    this.addTeamAndWeapons(teamColor)
  }

  static async create(teamColor:number):Promise<ArenaCharacter>{return new ArenaCharacter(await source(),teamColor)}
  update(dt:number,moving:boolean,down:boolean):void{if(this.walk)this.walk.paused=!moving||down;this.mixer.update(dt)}
  knockDown():void{this.model.rotation.z=-Math.PI/2;this.model.position.y=.3}
  revive():void{this.model.rotation.z=0;this.model.position.y=0}
  setFlash(k:number):void{for(const mat of this.flashMaterials)mat.emissive.setScalar(k*.65)}
  setWeapon(id:'smg'|'sniper'):void{this.smg.visible=id==='smg';this.sniper.visible=id==='sniper'}

  private cloneMaterial(mat:THREE.Material):THREE.Material{
    const copy=mat.clone()
    if(copy instanceof THREE.MeshStandardMaterial)this.flashMaterials.push(copy)
    return copy
  }

  private addTeamAndWeapons(teamColor:number):void{
    const dark=new THREE.MeshLambertMaterial({color:0x202731}),team=new THREE.MeshLambertMaterial({color:teamColor})
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.42,.035,6,18),new THREE.MeshBasicMaterial({color:teamColor}))
    ring.rotation.x=Math.PI/2;ring.position.y=.04;this.root.add(ring)
    const badge=new THREE.Mesh(new THREE.BoxGeometry(.24,.12,.035),team);badge.position.set(-.25,1.38,-.32);this.root.add(badge)
    this.smg=this.buildGun('smg',dark,team);this.sniper=this.buildGun('sniper',dark,team)
    this.smg.position.set(.12,1.18,-.55);this.sniper.position.set(.12,1.2,-.7)
    this.smg.rotation.set(-.08,Math.PI-.34,-.03);this.sniper.rotation.set(-.06,Math.PI-.3,-.02)
    this.root.add(this.smg,this.sniper);this.setWeapon('smg')
  }

  private buildGun(id:'smg'|'sniper',dark:THREE.Material,team:THREE.Material):THREE.Group{
    const g=new THREE.Group(),long=id==='sniper'
    const body=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,long?.72:.52),dark)
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.045,.052,long?.88:.42,8),dark);barrel.rotation.x=Math.PI/2;barrel.position.z=long?.75:.43
    const muzzle=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.14,8),team);muzzle.rotation.x=Math.PI/2;muzzle.position.z=long?1.24:.7
    const stock=new THREE.Mesh(new THREE.BoxGeometry(.28,.24,.36),dark);stock.position.z=-.4
    const mag=new THREE.Mesh(new THREE.BoxGeometry(.14,long?.23:.34,.18),team);mag.position.set(0,-.23,0)
    const sight=new THREE.Mesh(long?new THREE.CylinderGeometry(.095,.095,.4,8):new THREE.BoxGeometry(.1,.09,.17),dark);if(long)sight.rotation.x=Math.PI/2;sight.position.set(0,.18,.08)
    g.add(body,barrel,muzzle,stock,mag,sight);return g
  }
}
