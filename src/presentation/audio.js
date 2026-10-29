// Tiny synth audio: select/chop/coin/hit/win.
let ctx=null, enabled=true;
export function setSound(v){ enabled=(v==='on'); }
function ac(){ if(!ctx) ctx=new (window.AudioContext||window.webkitAudioContext)(); if(ctx.state==='suspended')ctx.resume(); return ctx; }
function tone(f,d=0.12,type='sine',g=0.15){
  if(!enabled) return; try{
    const c=ac(),o=c.createOscillator(),gn=c.createGain();
    o.type=type;o.frequency.value=f;gn.gain.value=g;
    gn.gain.exponentialRampToValueAtTime(0.001,c.currentTime+d);
    o.connect(gn);gn.connect(c.destination);o.start();o.stop(c.currentTime+d);
  }catch{}
}
export const sfx={
  select(){tone(660,0.07);}, move(){tone(440,0.08,'triangle');}, chop(){tone(220,0.06,'square',0.08);},
  coin(){tone(990,0.1,'sine');setTimeout(()=>tone(1320,0.12),70);}, build(){tone(330,0.15,'triangle');},
  hit(){tone(150,0.08,'sawtooth',0.1);}, bell(){[196,262,392].forEach((f,i)=>setTimeout(()=>tone(f,0.5,'sine',0.09),i*180));}, win(){[523,659,784,1046].forEach((f,i)=>setTimeout(()=>tone(f,0.2),i*140));},
  lose(){[400,300,220,150].forEach((f,i)=>setTimeout(()=>tone(f,0.25,'sawtooth'),i*160));},
};
