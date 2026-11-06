// Touch-first input for phones: tap to select/order, drag to pan, pinch to zoom.
// Mission/tutorial mode locks the camera (fixed framing) and widens the tap
// window so a fat thumb on a small screen still lands reliably.
export function bindInput(view, renderer, game){
  const el=renderer.renderer.domElement;
  let down=null, moved=0, pinch=0, longT=null, longFired=false;
  const touches=new Map();
  el.style.touchAction='none';
  const isLocked=()=>game.isCameraLocked&&game.isCameraLocked();
  el.addEventListener('pointerdown',e=>{ try{el.setPointerCapture(e.pointerId);}catch{} touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(touches.size===1){
      down={x:e.clientX,y:e.clientY,t:performance.now()}; moved=0; longFired=false;
      longT=setTimeout(()=>{ longFired=true; game.onLongPress(); },550);
    } else {
      clearTimeout(longT); longT=null; down=null; moved=99; longFired=false;
      if(touches.size===2){ const p=[...touches.values()]; pinch=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y); }
    }
  });
  el.addEventListener('pointermove',e=>{
    if(!touches.has(e.pointerId))return;
    const prev=touches.get(e.pointerId); touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(touches.size===2){
      if(isLocked()) return;
      const p=[...touches.values()]; const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
      renderer.dist=Math.max(25,Math.min(110,renderer.dist-(d-pinch)*0.25)); pinch=d; moved=99; return;
    }
    if(down){ const dx=e.clientX-prev.x,dy=e.clientY-prev.y; moved+=Math.abs(dx)+Math.abs(dy);
      if(moved>18){ clearTimeout(longT); // pan
        if(isLocked()) return;
        const s=renderer.dist/500;
        const yaw=renderer.yaw;
        renderer.target.x=Math.max(-48,Math.min(48,renderer.target.x-(dx*Math.cos(yaw))*s*2));
        renderer.target.z=Math.max(-48,Math.min(48,renderer.target.z+(dy*Math.sin(yaw))*s*2));
      }
    }
  });
  const up=e=>{
    const cancelled=e.type==='pointercancel';
    touches.delete(e.pointerId); clearTimeout(longT); longT=null;
    if(cancelled){ touches.clear(); down=null; moved=99; longFired=false; pinch=0; return; }
    // A multi-touch gesture must never turn into a tap when one finger lifts.
    if(touches.size){ down=null; moved=99; longFired=false; return; }
    if(longFired){ down=null; return; }
    if(!down)return;
    const dt=performance.now()-down.t;
    // Generous tap window: any touch under 22px of travel counts, 600ms max.
    if(moved<22&&dt<600){ game.onTap(e); }
    down=null; pinch=0;
  };
  el.addEventListener('pointerup',up); el.addEventListener('pointercancel',up);
  // wheel zoom (desktop only; ignored while the camera is locked)
  el.addEventListener('wheel',e=>{ if(isLocked())return; renderer.dist=Math.max(25,Math.min(110,renderer.dist+e.deltaY*0.05)); e.preventDefault(); },{passive:false});
}
