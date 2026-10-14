// Touch-first input: tap select/order, drag pan, pinch zoom, long-press build menu.
export function bindInput(view, renderer, game){
  const el=renderer.renderer.domElement;
  let down=null, moved=0, pinch=0, longT=null, longFired=false;
  const touches=new Map();
  el.style.touchAction='none';
  el.addEventListener('pointerdown',e=>{ try{el.setPointerCapture(e.pointerId);}catch{} touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(touches.size===2){ const p=[...touches.values()]; pinch=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y); }
    down={x:e.clientX,y:e.clientY,t:performance.now()}; moved=0; longFired=false;
    longT=setTimeout(()=>{ longFired=true; game.onLongPress(); },550);
  });
  el.addEventListener('pointermove',e=>{
    if(!touches.has(e.pointerId))return;
    const prev=touches.get(e.pointerId); touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(touches.size===2){ const p=[...touches.values()]; const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
      renderer.dist=Math.max(25,Math.min(110,renderer.dist-(d-pinch)*0.25)); pinch=d; moved=99; return; }
    if(down){ const dx=e.clientX-prev.x,dy=e.clientY-prev.y; moved+=Math.abs(dx)+Math.abs(dy);
      if(moved>14){ clearTimeout(longT); // pan
        const s=renderer.dist/500;
        const yaw=renderer.yaw;
        renderer.target.x-= (dx*Math.cos(yaw))*s*2; renderer.target.z-= (-dy*0.6+dx*0)*s*2+ (dy*Math.sin(yaw))*0+s*0;
        renderer.target.x=Math.max(-48,Math.min(48,renderer.target.x)); renderer.target.z=Math.max(-48,Math.min(48,renderer.target.z));
      }
    }
  });
  const up=e=>{
    touches.delete(e.pointerId); clearTimeout(longT);
    if(longFired) return;
    if(!down)return;
    const dt=performance.now()-down.t;
    if(moved<14&&dt<400){ game.onTap(e); }
    down=null;
  };
  el.addEventListener('pointerup',up); el.addEventListener('pointercancel',up);
  // wheel zoom (desktop)
  el.addEventListener('wheel',e=>{ renderer.dist=Math.max(25,Math.min(110,renderer.dist+e.deltaY*0.05)); e.preventDefault(); },{passive:false});
}
