import * as THREE from 'three'
import { ArenaCharacter } from './characters'
import type { NetPlayer } from './online'
import type { TargetHit } from './targets'

const BODY_R=.55, BODY_Y=.9, HEAD_R=.34, HEAD_Y=1.78
class RemoteAvatar {
  readonly group=new THREE.Group(); target=new THREE.Vector3(); yaw=0; state:NetPlayer; character:ArenaCharacter|null=null
  private hpFill:THREE.Mesh; private bar:THREE.Group
  constructor(p:NetPlayer){
    this.state=p;this.group.position.set(p.x,p.y,p.z);this.target.copy(this.group.position)
    const bar=new THREE.Group();this.bar=bar;bar.position.y=2.62;bar.renderOrder=20
    const back=new THREE.Mesh(new THREE.PlaneGeometry(1.05,.13),new THREE.MeshBasicMaterial({color:0x241d25,depthTest:false,depthWrite:false}))
    this.hpFill=new THREE.Mesh(new THREE.PlaneGeometry(1,.085),new THREE.MeshBasicMaterial({color:0xff5f5f,depthTest:false,depthWrite:false}))
    back.renderOrder=20;this.hpFill.renderOrder=21
    this.hpFill.position.z=.006;bar.add(back,this.hpFill);this.group.add(bar)
    const badge=makeNumberBadge(p.number,p.team);badge.position.y=2.95;this.group.add(badge)
    void ArenaCharacter.create(p.team==='red'?0xe85d4c:0x4d8dff,p.number-1).then(c=>{this.character=c;c.setWeapon(p.weapon);this.group.add(c.root)})
  }
  update(dt:number,cameraYaw:number){this.group.position.lerp(this.target,Math.min(1,dt*12));this.group.rotation.y+=(this.yaw-this.group.rotation.y)*Math.min(1,dt*12);this.group.visible=!this.state.dead;this.bar.rotation.y=cameraYaw-this.group.rotation.y;this.character?.setWeapon(this.state.weapon);this.character?.update(dt,this.state.moving,this.state.dead);const hp=Math.max(.001,this.state.hp/100);this.hpFill.scale.x=hp;this.hpFill.position.x=-(1-hp)/2}
}

function makeNumberBadge(number:number,team:'red'|'blue'):THREE.Sprite{
  const cv=document.createElement('canvas');cv.width=128;cv.height=128
  const ctx=cv.getContext('2d')!;ctx.fillStyle=team==='red'?'#c7473b':'#3978d2';ctx.beginPath();ctx.arc(64,64,48,0,Math.PI*2);ctx.fill()
  ctx.lineWidth=7;ctx.strokeStyle='white';ctx.stroke();ctx.fillStyle='white';ctx.font='bold 58px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(number),64,67)
  const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,depthWrite:false}));sprite.scale.set(.52,.52,.52);sprite.renderOrder=30;return sprite
}
export class RemotePlayers {
  readonly group=new THREE.Group(); private avatars=new Map<string,RemoteAvatar>(); private a=new THREE.Vector3();private b=new THREE.Vector3();private c=new THREE.Vector3()
  constructor(private ownTeam:string,private hit:(id:string,head:boolean)=>void){}
  sync(players:NetPlayer[],ownId:string){const seen=new Set<string>();for(const p of players){if(p.id===ownId||p.team===this.ownTeam)continue;seen.add(p.id);let a=this.avatars.get(p.id);if(!a){a=new RemoteAvatar(p);this.avatars.set(p.id,a);this.group.add(a.group)}a.state=p;a.target.set(p.x,p.y,p.z);a.yaw=p.yaw}for(const[id,a]of this.avatars)if(!seen.has(id)){this.group.remove(a.group);this.avatars.delete(id)}}
  update(dt:number,cameraYaw:number){for(const a of this.avatars.values())a.update(dt,cameraYaw)}
  raycast(from:THREE.Vector3,to:THREE.Vector3):{bot:RemoteAvatar;head:boolean;point:THREE.Vector3}|null{let best:{bot:RemoteAvatar;head:boolean;point:THREE.Vector3;t:number}|null=null;for(const av of this.avatars.values()){if(av.state.dead)continue;for(const head of[true,false]){this.a.copy(av.group.position);this.a.y+=head?HEAD_Y:BODY_Y;const r=head?HEAD_R:BODY_R;this.b.copy(to).sub(from);const t=THREE.MathUtils.clamp(this.c.copy(this.a).sub(from).dot(this.b)/(this.b.lengthSq()||1e-6),0,1);const point=this.c.copy(from).addScaledVector(this.b,t);if(point.distanceToSquared(this.a)>r*r)continue;if(!best||t<best.t)best={bot:av,head,point:point.clone(),t};if(head)break}}return best&&{bot:best.bot,head:best.head,point:best.point}}
  apply(bot:RemoteAvatar,_damage:number,point:THREE.Vector3,head:boolean,from:THREE.Vector3):TargetHit{this.hit(bot.state.id,head);return{head,point:point.clone(),down:false,distance:from.distanceTo(point)}}
}
