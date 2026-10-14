// World: map generation (autumn forest), resources, fog, A* pathfinding.
import { WORLD, GRID, CELL, g2w, w2g } from '../core/engine.js';

export function genMap(seed){
  let s = seed||1;
  const rnd=()=> (s=(s*1664525+1013904223)>>>0)/4294967296;
  const trees=[], gold=[];
  // dense forest clusters, clearings at two bases
  const baseA={x:-30,z:-30}, baseB={x:30,z:30};
  for(let i=0;i<340;i++){
    const x=(rnd()*2-1)*46, z=(rnd()*2-1)*46;
    if(Math.hypot(x-baseA.x,z-baseA.z)<12||Math.hypot(x-baseB.x,z-baseB.z)<12) continue;
    if(rnd()<0.72) trees.push({x,z,amount:120+((rnd()*80)|0),phase:rnd()*6.28});
  }
  const spots=[[-14,-6],[6,14],[-4,18],[16,-10],[-20,14],[12,4]];
  for(const [sx,sz] of spots){ for(let k=0;k<2;k++) gold.push({x:sx+(rnd()*6-3),z:sz+(rnd()*6-3),amount:600}); }
  // near-base wood + gold
  for(let k=0;k<8;k++) trees.push({x:baseA.x+(rnd()*14-7),z:baseA.z+(rnd()*14-7),amount:120});
  for(let k=0;k<8;k++) trees.push({x:baseB.x+(rnd()*14-7),z:baseB.z+(rnd()*14-7),amount:120});
  gold.push({x:baseA.x+7,z:baseA.z+3,amount:800},{x:baseB.x-7,z:baseB.z-3,amount:800});
  // fog grids
  const explored=[new Uint8Array(GRID*GRID),new Uint8Array(GRID*GRID)];
  const visible=[new Uint8Array(GRID*GRID),new Uint8Array(GRID*GRID)];
  return { trees, gold, explored, visible, seed:s };
}

// blocked grid from buildings+trees density (units walk around buildings; through trees slowed not blocked)
export function buildBlocked(st,map){
  const b=new Uint8Array(GRID*GRID);
  for(const e of st.entities){ if(e.dead||e.cat!=='bld') continue;
    const r=(e.size||2)/CELL+0.6;
    const gx=w2g(e.x),gz=w2g(e.z);
    for(let x=Math.floor(gx-r);x<=gx+r;x++)for(let z=Math.floor(gz-r);z<=gz+r;z++){
      if(x<0||z<0||x>=GRID||z>=GRID)continue;
      const dx=x-gx,dz=z-gz; if(dx*dx+dz*dz<=r*r) b[z*GRID+x]=1;
    }
  }
  return b;
}

// A* on 48x48
export function findPath(sx,sz,tx,tz,blocked){
  const S={x:Math.max(0,Math.min(GRID-1,sx)),z:Math.max(0,Math.min(GRID-1,sz))};
  const T={x:Math.max(0,Math.min(GRID-1,tx)),z:Math.max(0,Math.min(GRID-1,tz))};
  if(blocked[T.z*GRID+T.x]){ // nudge target
    let ok=false;
    outer: for(let r=1;r<4;r++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
      const nx=T.x+dx,nz=T.z+dz; if(nx<0||nz<0||nx>=GRID||nz>=GRID)continue;
      if(!blocked[nz*GRID+nx]){T.x=nx;T.z=nz;ok=true;break outer;}
    }
    if(!ok) return null;
  }
  const open=[S.z*GRID+S.x], came=new Map(), g=new Map([[S.z*GRID+S.x,0]]);
  const h=(i)=>{const x=i%GRID,z=(i/GRID)|0;return Math.abs(x-T.x)+Math.abs(z-T.z);};
  const f=new Map([[S.z*GRID+S.x,h(S.z*GRID+S.x)]]);
  const inOpen=new Set(open);
  const key=(x,z)=>z*GRID+x;
  let guard=0;
  while(open.length&&guard++<3000){
    let bi=0; for(let i=1;i<open.length;i++) if((f.get(open[i])??1e9)<(f.get(open[bi])??1e9)) bi=i;
    const cur=open.splice(bi,1)[0]; inOpen.delete(cur);
    const cx=cur%GRID,cz=(cur/GRID)|0;
    if(cx===T.x&&cz===T.z){ const path=[[cx,cz]]; let c=cur; while(came.has(c)){c=came.get(c);path.push([c%GRID,(c/GRID)|0]);} return path.reverse().map(([gx,gz])=>({x:g2w(gx),z:g2w(gz)})); }
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dz)continue; const nx=cx+dx,nz=cz+dz; if(nx<0||nz<0||nx>=GRID||nz>=GRID)continue;
      const ni=key(nx,nz); if(blocked[ni])continue;
      const ng=(g.get(cur)??1e9)+(dx&&dz?1.4:1);
      if(ng<(g.get(ni)??1e9)){ came.set(ni,cur); g.set(ni,ng); f.set(ni,ng+h(ni)); if(!inOpen.has(ni)){open.push(ni);inOpen.add(ni);} }
    }
  }
  return null;
}

// fog update from unit/building sight
export function updateFog(st,map){
  map.visible[0].fill(0); map.visible[1].fill(0);
  for(const e of st.entities){
    if(e.dead) continue;
    const sight=e.sight||8, gx0=Math.max(0,((e.x-sight)/CELL+GRID/2)|0), gx1=Math.min(GRID-1,((e.x+sight)/CELL+GRID/2)|0);
    const gz0=Math.max(0,((e.z-sight)/CELL+GRID/2)|0), gz1=Math.min(GRID-1,((e.z+sight)/CELL+GRID/2)|0);
    for(let gz=gz0;gz<=gz1;gz++)for(let gx=gx0;gx<=gx1;gx++){
      const wx=g2w(gx),wz=g2w(gz);
      if((wx-e.x)**2+(wz-e.z)**2<=sight*sight){ map.visible[e.owner][gz*GRID+gx]=1; map.explored[e.owner][gz*GRID+gx]=1; }
    }
  }
}
