export type ArenaTeam = 'red' | 'blue'
export interface NetPlayer { id:string; team:ArenaTeam; number:number; x:number;y:number;z:number;yaw:number;pitch:number;hp:number;dead:boolean;moving:boolean;weapon:'smg'|'sniper';shotSeq:number;shotAt:number;shotX:number;shotY:number;shotZ:number;shotDX:number;shotDY:number;shotDZ:number;shotWeapon:'smg'|'sniper' }
type LocalState = Pick<NetPlayer,'x'|'y'|'z'|'yaw'|'pitch'|'moving'|'weapon'>

export class ArenaOnline {
  id=''; private token=''; private stopped=false; private busy=false; private timer=0
  onPlayers:(players:NetPlayer[])=>void=()=>{}; onError:()=>void=()=>{}
  constructor(readonly team:ArenaTeam, private state:()=>LocalState) {}
  async start():Promise<void>{
    try { const r=await fetch('/api/arena/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team:this.team})}); if(!r.ok)throw Error('join'); const j=await r.json(); this.id=j.id;this.token=j.token;this.onPlayers(j.players);this.timer=window.setInterval(()=>void this.sync(),100) } catch {this.onError()}
  }
  hit(target:string,weapon:'smg'|'sniper',head:boolean):void { if(!this.id)return; void fetch('/api/arena/hit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:this.id,token:this.token,target,weapon,head})}) }
  shot(origin:{x:number;y:number;z:number},dir:{x:number;y:number;z:number},weapon:'smg'|'sniper'):void { if(!this.id)return;void fetch('/api/arena/shot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:this.id,token:this.token,weapon,x:origin.x,y:origin.y,z:origin.z,dx:dir.x,dy:dir.y,dz:dir.z})}) }
  stop():void { this.stopped=true;clearInterval(this.timer);if(this.id)navigator.sendBeacon('/api/arena/leave',new Blob([JSON.stringify({id:this.id,token:this.token})],{type:'application/json'})) }
  private async sync():Promise<void>{ if(this.stopped||this.busy||!this.id)return;this.busy=true;try{const r=await fetch('/api/arena/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:this.id,token:this.token,...this.state()})});if(!r.ok)throw Error();const j=await r.json();this.onPlayers(j.players)}catch{this.onError()}finally{this.busy=false}}
}
