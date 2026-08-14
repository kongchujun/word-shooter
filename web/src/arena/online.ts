export type ArenaTeam = 'red' | 'blue'
export interface NetPlayer { id:string; team:ArenaTeam; x:number;y:number;z:number;yaw:number;pitch:number;hp:number;dead:boolean;moving:boolean;weapon:'smg'|'sniper' }

export class ArenaOnline {
  id=''; private token=''; private stopped=false; private busy=false; private timer=0
  onPlayers:(players:NetPlayer[])=>void=()=>{}; onError:()=>void=()=>{}
  constructor(readonly team:ArenaTeam, private state:()=>Omit<NetPlayer,'id'|'team'|'hp'|'dead'>) {}
  async start():Promise<void>{
    try { const r=await fetch('/api/arena/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team:this.team})}); if(!r.ok)throw Error('join'); const j=await r.json(); this.id=j.id;this.token=j.token;this.onPlayers(j.players);this.timer=window.setInterval(()=>void this.sync(),100) } catch {this.onError()}
  }
  hit(target:string,weapon:'smg'|'sniper',head:boolean):void { if(!this.id)return; void fetch('/api/arena/hit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:this.id,token:this.token,target,weapon,head})}) }
  stop():void { this.stopped=true;clearInterval(this.timer);if(this.id)navigator.sendBeacon('/api/arena/leave',new Blob([JSON.stringify({id:this.id,token:this.token})],{type:'application/json'})) }
  private async sync():Promise<void>{ if(this.stopped||this.busy||!this.id)return;this.busy=true;try{const r=await fetch('/api/arena/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:this.id,token:this.token,...this.state()})});if(!r.ok)throw Error();const j=await r.json();this.onPlayers(j.players)}catch{this.onError()}finally{this.busy=false}}
}
