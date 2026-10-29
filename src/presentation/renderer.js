// Presentation: chibi 3D (Three.js), autumn forest, VFX, fog overlay, minimap hooks.
import * as THREE from 'three';
import { WORLD, GRID, CELL, alive, g2w } from '../core/engine.js';
import { BUILDINGS, UNITS } from '../buildings/data.js';

export class Renderer{
  constructor(container){
    this.container=container;
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x1c130c);
    this.scene.fog=new THREE.Fog(0x1c130c,70,160);
    const asp=container.clientWidth/Math.max(1,container.clientHeight);
    this.camera=new THREE.PerspectiveCamera(46,asp,0.1,400);
    this.target=new THREE.Vector3(0,0,0); this.dist=56; this.yaw=0.78; this.pitch=0.96;
    this.renderer=new THREE.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(Math.min(2,devicePixelRatio||1));
    this.renderer.shadowMap.enabled=true; this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.meshes=new Map(); this.resMeshes=[];
    this.hits=[]; this.rings=[];
    this.fogCanvas=document.createElement('canvas'); this.fogCanvas.width=this.fogCanvas.height=GRID;
    this.fogTex=new THREE.CanvasTexture(this.fogCanvas);
    this.fogMat=null; this.fogMesh=null;
    this.lights();
    this.ground();
    this.resize(); addEventListener('resize',()=>this.resize());
  }
  lights(){
    // High-saturation chibi key: warm sun, cool sky bounce, punchy fill.
    this.hemi=new THREE.HemisphereLight(0xfff0d2,0x4a7a2a,1.15);
    this.scene.add(this.hemi);
    const sun=new THREE.DirectionalLight(0xfff2c4,2.15);
    sun.position.set(30,48,18); sun.castShadow=true;
    sun.shadow.mapSize.set(1024,1024); sun.shadow.camera.left=-60;sun.shadow.camera.right=60;sun.shadow.camera.top=60;sun.shadow.camera.bottom=-60;
    this.scene.add(sun); this.sun=sun;
    // Saturation-preserving tone curve: crushes nothing, lifts mid-tones into candy.
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.18;
  }
  ground(){
    const geo=new THREE.PlaneGeometry(WORLD,WORLD,GRID,GRID);
    geo.rotateX(-Math.PI/2);
    const pos=geo.attributes.position, colors=[];
    // Saturated autumn palette: emerald grass, amber leaf litter, deep moss shade.
    const c1=new THREE.Color(0x7fc23a),c2=new THREE.Color(0xffa62b),c3=new THREE.Color(0x46a02c);
    for(let i=0;i<pos.count;i++){
      const x=pos.getX(i),z=pos.getZ(i);
      const n=Math.sin(x*0.35)*Math.cos(z*0.3)+Math.sin(x*0.12+z*0.2);
      const c=(n>0.6?c2:(n<-0.4?c3:c1)).clone();
      c.offsetHSL(0,0.18,0.02); // extra chroma, still readable
      colors.push(c.r,c.g,c.b);
      pos.setY(i,Math.sin(x*0.15)*Math.cos(z*0.15)*0.25);
    }
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
    const m=new THREE.Mesh(geo,mat); m.receiveShadow=true; this.scene.add(m); this.groundMat=mat;
    // fog shroud plane
    const fg=new THREE.PlaneGeometry(WORLD,WORLD); fg.rotateX(-Math.PI/2);
    this.fogMat=new THREE.MeshBasicMaterial({map:this.fogTex,transparent:true,opacity:0.92,depthWrite:false});
    this.fogMesh=new THREE.Mesh(fg,this.fogMat); this.fogMesh.position.y=0.6; this.scene.add(this.fogMesh);
  }
  // Season Wheel: the Second Bell turns autumn to winter (palette only; sim owns effects).
  setSeason(season){
    this.season=season;
    const w=season==='winter';
    this.scene.background.set(w?0x141c26:0x1c130c);
    this.scene.fog.color.set(w?0x141c26:0x1c130c);
    if(this.hemi){ this.hemi.color.set(w?0xcfe4ff:0xfff0d2); this.hemi.groundColor.set(w?0x2a3a4a:0x4a7a2a); this.hemi.intensity=w?0.95:1.15; }
    if(this.sun){ this.sun.color.set(w?0xdfeaff:0xfff2c4); this.sun.intensity=w?1.7:2.15; }
    if(this.groundMat) this.groundMat.color.set(w?0xbfd0dd:0xffffff);
    if(this.leafMats) for(const m of this.leafMats) m.color.set(w?0x3f5a4a:m.userData.base);
  }
  // Fixed-camera distance + FOV by aspect. Vertical FOV widens on tall phones so
  // the whole clearing stays reachable by thumb without moving the camera.
  camDistFor(aspect){ return aspect<0.75?39:(aspect<1.2?35:28); }
  fovFor(aspect){ return aspect<0.75?60:(aspect<1.2?50:46); }
  resize(){
    const w=this.container.clientWidth,h=this.container.clientHeight;
    this.camera.aspect=w/h;
    this.camera.fov=this.fovFor(this.camera.aspect);
    this.camera.updateProjectionMatrix(); this.renderer.setSize(w,h);
    if(this.fixed&&this.fixedTarget){ this.fixedTarget.dist=this.camDistFor(this.camera.aspect); }
  }
  // Fixed-camera mode: tutorial locks framing so a thumb never wanders off-map.
  setFixedCamera(on,x=0,z=0,dist=52){
    this.fixed=on; this.fixedTarget={x,z,dist};
    if(on){ this.target.set(x,0,z); this.dist=dist; }
  }
  isFixed(){ return !!this.fixed; }
  buildStatic(map){
    // clear old
    for(const m of this.resMeshes){this.scene.remove(m.g); } this.resMeshes=[];
    const treeTrunk=new THREE.CylinderGeometry(0.35,0.5,1.6,6);
    const treeTop=new THREE.ConeGeometry(1.4,2.6,7);
    const trunkMat=new THREE.MeshStandardMaterial({color:0x8a5a2b,roughness:1});
    const leafMats=[0xff7a1a,0xffb02e,0xff5e1f,0x7fd94a].map(c=>new THREE.MeshStandardMaterial({color:c,roughness:0.85,flatShading:true}));
    leafMats.forEach(m=>m.userData.base=m.color.getHex()); this.leafMats=leafMats;
    map.trees.forEach((t,i)=>{
      const g=new THREE.Group();
      const trunk=new THREE.Mesh(treeTrunk,trunkMat); trunk.position.y=0.8; trunk.castShadow=true; g.add(trunk);
      const top=new THREE.Mesh(treeTop,leafMats[i%4]); top.position.y=2.6; top.castShadow=true; g.add(top);
      g.position.set(t.x,0,t.z); const s=0.9+(i%5)*0.12; g.scale.setScalar(s);
      this.scene.add(g); this.resMeshes.push({g,node:t,kind:'tree'});
    });
    const rockGeo=new THREE.DodecahedronGeometry(1.1,0);
    const goldMat=new THREE.MeshStandardMaterial({color:0xf5c542,roughness:0.35,metalness:0.6,emissive:0x442200});
    map.gold.forEach(n=>{
      const g=new THREE.Group();
      const r=new THREE.Mesh(rockGeo,goldMat); r.position.y=0.8; r.castShadow=true; g.add(r);
      const base=new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.7,0.5,8),new THREE.MeshStandardMaterial({color:0x6b6b6b})); base.position.y=0.25; g.add(base);
      g.position.set(n.x,0,n.z); this.scene.add(g); this.resMeshes.push({g,node:n,kind:'gold'});
    });
  }
  chibi(color){
    const g=new THREE.Group();
    const mat=new THREE.MeshStandardMaterial({color,roughness:0.6});
    const skin=new THREE.MeshStandardMaterial({color:0xffd9b3,roughness:0.7});
    const body=new THREE.Mesh(new THREE.CapsuleGeometry(0.55,0.6,4,10),mat); body.position.y=0.9; body.castShadow=true; g.add(body);
    const head=new THREE.Mesh(new THREE.SphereGeometry(0.62,14,12),skin); head.position.y=2.0; head.scale.set(1.15,1,1.15); head.castShadow=true; g.add(head);
    const eyeM=new THREE.MeshBasicMaterial({color:0x222222});
    for(const s of [-1,1]){ const e=new THREE.Mesh(new THREE.SphereGeometry(0.09,6,6),eyeM); e.position.set(s*0.25,2.05,0.52); g.add(e); }
    return g;
  }
  treantMesh(){
    const g=new THREE.Group();
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.75,2.2,6),new THREE.MeshStandardMaterial({color:0x5a3d1e,roughness:1}));
    trunk.position.y=1.1; trunk.castShadow=true; g.add(trunk);
    const canopy=new THREE.Mesh(new THREE.ConeGeometry(1.5,2.2,7),new THREE.MeshStandardMaterial({color:0x2f6b2f,roughness:0.9,flatShading:true}));
    canopy.position.y=2.8; canopy.castShadow=true; g.add(canopy);
    for(const s of [-1,1]){ const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.18,1.3,5),new THREE.MeshStandardMaterial({color:0x5a3d1e,roughness:1})); arm.position.set(s*0.85,1.7,0); arm.rotation.z=s*0.9; g.add(arm); }
    return g;
  }
  bldMesh(type,owner){
    const g=new THREE.Group();
    const baseC=owner===0?0x4a6fa5:0xa54a4a;
    const wall=new THREE.MeshStandardMaterial({color:owner===0?0xd9c39a:0xc9a49a,roughness:0.9});
    const roofM=new THREE.MeshStandardMaterial({color:type==='townhall'?0x8b2f2f:baseC,roughness:0.8});
    let w=2.4,h=1.8;
    if(type==='townhall'){w=3.4;h=2.6;}
    if(type==='farm'){ const f=new THREE.Mesh(new THREE.BoxGeometry(2.6,0.3,2.6),new THREE.MeshStandardMaterial({color:0x7fb069})); f.position.y=0.15; g.add(f);
      for(let i=0;i<3;i++){const r=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.25,0.3),new THREE.MeshStandardMaterial({color:0xe8c33d})); r.position.set(0,0.4,-0.7+i*0.7); g.add(r);} 
      const hut=new THREE.Mesh(new THREE.BoxGeometry(1.2,1,1.2),wall); hut.position.set(0,0.8,1.2); g.add(hut); return g; }
    if(type==='tower'){ const t=new THREE.Mesh(new THREE.CylinderGeometry(0.8,1.1,4.4,8),wall); t.position.y=2.2; t.castShadow=true; g.add(t);
      const top=new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.2,0.8,8),roofM); top.position.y=4.6; g.add(top); return g; }
    const box=new THREE.Mesh(new THREE.BoxGeometry(w,h,w),wall); box.position.y=h/2; box.castShadow=true; g.add(box);
    const roof=new THREE.Mesh(new THREE.ConeGeometry(w*0.85,1.4,4),roofM); roof.position.y=h+0.7; roof.rotation.y=Math.PI/4; roof.castShadow=true; g.add(roof);
    if(type==='townhall'){ const tw=new THREE.Mesh(new THREE.BoxGeometry(0.8,3.4,0.8),wall); tw.position.set(w/2,1.7,0); g.add(tw);
      const fl=new THREE.Mesh(new THREE.PlaneGeometry(1.1,0.7),new THREE.MeshBasicMaterial({color:owner===0?0x2b5cff:0xff2b2b,side:THREE.DoubleSide})); fl.position.set(w/2+0.7,3.1,0); g.add(fl); this.flag=fl; }
    if(type==='barracks'){ const sw=new THREE.Mesh(new THREE.BoxGeometry(0.15,1.4,0.15),new THREE.MeshStandardMaterial({color:0x888888})); sw.position.set(0.8,1.6,1.3); g.add(sw); }
    return g;
  }
  sync(st,map,sel,time){
    // entities
    const seen=new Set();
    for(const e of st.entities){
      if(e.cat==='proj'){ this.syncProj(e); seen.add('p'+e.id); continue; }
      if(e.dead&&e.cat==='unit'&&e.deathT<=0) continue;
      seen.add(e.id);
      let rec=this.meshes.get(e.id);
      if(!rec){
        let g;
        if(e.cat==='unit'){
          if(e.type==='treant') g=this.treantMesh();
          else if(e.type==='hero'){
            g=new THREE.Group();
            const inner=this.chibi(e.owner===0?0x3b6fe0:0xe03b3b); inner.scale.setScalar(1.3); g.add(inner);
            const crown=new THREE.Mesh(new THREE.ConeGeometry(0.32,0.5,6),new THREE.MeshStandardMaterial({color:0xffd54a,metalness:0.6,roughness:0.3,emissive:0x553300})); crown.position.y=2.7; g.add(crown);
            const cape=new THREE.Mesh(new THREE.PlaneGeometry(0.9,1.4),new THREE.MeshStandardMaterial({color:e.owner===0?0x1e3a8a:0x7a1f1f,side:THREE.DoubleSide})); cape.position.set(0,1.5,-0.45); g.add(cape);
          } else g=this.chibi(e.owner===0?0x3b6fe0:e.owner===2?0x6b4f2a:0xe03b3b);
        } else g=this.bldMesh(e.type,e.owner);
        // weapon props
        if(e.cat==='unit'&&e.type!=='peasant'&&e.type!=='treant'){ const hero=e.type==='hero'; const w=new THREE.Mesh(new THREE.BoxGeometry(hero?0.16:0.12,hero?1.5:1.1,hero?0.16:0.12),new THREE.MeshStandardMaterial({color:0x888888})); w.position.set(hero?0.9:0.7,hero?1.6:1.2,0.2); w.rotation.z=0.4; g.add(w); }
        if(e.cat==='unit'&&e.type==='peasant'){ const ax=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.9,0.1),new THREE.MeshStandardMaterial({color:0x6b4423})); ax.position.set(0.7,1.1,0); g.add(ax); }
        // hp bar
        const hb=document.createElement('canvas'); hb.width=32; hb.height=4;
        const tex=new THREE.CanvasTexture(hb);
        const bar=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false})); bar.scale.set(1.8,0.25,1); bar.position.y=e.cat==='unit'?(e.type==='treant'?4.4:e.type==='hero'?3.7:2.9):5.2; g.add(bar);
        // selection ring
        const ring=new THREE.Mesh(new THREE.RingGeometry(0.9,1.1,24),new THREE.MeshBasicMaterial({color:e.owner===0?0x4dff7a:e.owner===2?0xffa53b:0xff4d4d,transparent:true,opacity:0.9,side:THREE.DoubleSide}));
        ring.rotation.x=-Math.PI/2; ring.position.y=0.1; ring.visible=false; g.add(ring);
        this.scene.add(g); rec={g,bar,hb,tex,ring}; this.meshes.set(e.id,rec);
      }
      const BobY=e.cat==='unit'?Math.abs(Math.sin(time*6+e.id))*0.12:0;
      rec.g.position.set(e.x,BobY,e.z);
      if(e.face) rec.g.rotation.y=Math.atan2(e.face.x-e.x,e.face.z-e.z);
      if(e.flash>0) rec.g.scale.setScalar(1+e.flash*0.6); else rec.g.scale.setScalar(e.cat==='bld'&&!e.done?0.4+e.prog*0.6:1);
      if(e.cat==='bld'&&!e.done) rec.g.rotation.y+=0.002;
      // hp bar
      const pct=Math.max(0,e.hp/e.maxHp);
      const ctx=rec.hb.getContext('2d'); ctx.clearRect(0,0,32,4); ctx.fillStyle='#300'; ctx.fillRect(0,0,32,4); ctx.fillStyle=pct>0.5?'#4dff7a':pct>0.25?'#ffcf4d':'#ff4d4d'; ctx.fillRect(0,0,32*pct,4); rec.tex.needsUpdate=true;
      rec.bar.visible=pct<0.999;
      rec.ring.visible=sel.has(e.id);
      if(e.dead) rec.g.rotation.x=-0.6;
    }
    for(const [id,rec] of [...this.meshes]){ if(!seen.has(id)){ this.scene.remove(rec.g); this.meshes.delete(id);} }
    // resources visibility + fog
    const showFog=st.fog;
    for(const r of this.resMeshes){
      if(r.node.amount<=0){r.g.visible=false;continue;}
      r.g.visible=true;
      if(showFog){ const gx=Math.max(0,Math.min(GRID-1,Math.floor(r.node.x/CELL+GRID/2))),gz=Math.max(0,Math.min(GRID-1,Math.floor(r.node.z/CELL+GRID/2)));
        r.g.visible=map.explored[0][gz*GRID+gx]===1; }
      r.g.position.y=Math.sin(time*1.5+r.node.x)*0.08;
    }
    // fog texture for player 0
    if(showFog){
      const d=this.fogCanvas.getContext('2d'); const img=d.createImageData(GRID,GRID);
      for(let i=0;i<GRID*GRID;i++){ const ex=map.explored[0][i],vi=map.visible[0][i];
        img.data[i*4]=0;img.data[i*4+1]=0;img.data[i*4+2]=0; img.data[i*4+3]=!ex?255:(vi?0:150); }
      d.putImageData(img,0,0); this.fogTex.needsUpdate=true; this.fogMesh.visible=true;
    } else this.fogMesh.visible=false;
    // hits
    for(const h of this.hits){ h.t-=0.016; h.m.scale.setScalar(h.m.scale.x+0.12); h.m.material.opacity=Math.max(0,h.t*2); if(h.t<=0){this.scene.remove(h.m);}}
    this.hits=this.hits.filter(h=>h.t>0);
    this.syncCoachMark(time);
    // camera
    if(this.fixed&&this.fixedTarget){ this.target.set(this.fixedTarget.x,0,this.fixedTarget.z); this.dist=this.fixedTarget.dist; }
    const cx=this.target.x+Math.sin(this.yaw)*Math.cos(this.pitch)*this.dist;
    const cz=this.target.z+Math.cos(this.yaw)*Math.cos(this.pitch)*this.dist;
    const cy=Math.sin(this.pitch)*this.dist;
    this.camera.position.set(cx,cy,cz); this.camera.lookAt(this.target.x,0,this.target.z);
    this.renderer.render(this.scene,this.camera);
  }
  // ---- tutorial coach mark: pulsing ground ring + bobbing arrow ----
  setCoachMark(target){ this.coach=target||null; if(!this.coach){ if(this.coachMesh){this.scene.remove(this.coachMesh.group); this.coachMesh=null;} return; }
    if(this.coachMesh) return;
    const group=new THREE.Group();
    const ring=new THREE.Mesh(new THREE.RingGeometry(1.5,2.0,32),
      new THREE.MeshBasicMaterial({color:0xffe14d,transparent:true,opacity:0.95,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2; ring.position.y=0.12; group.add(ring);
    const cone=new THREE.Mesh(new THREE.ConeGeometry(0.55,1.0,12),
      new THREE.MeshBasicMaterial({color:0xffd21f}));
    cone.position.y=5.0; cone.rotation.x=Math.PI; group.add(cone);
    this.scene.add(group); this.coachMesh={group,ring,cone};
  }
  syncCoachMark(time){
    if(!this.coachMesh||!this.coach) return;
    const {x,z,radius=1.6,height=4.2}=this.coach;
    const g=this.coachMesh.group;
    g.position.set(x,0,z);
    const pulse=1+Math.sin(time*4)*0.12;
    this.coachMesh.ring.scale.setScalar(pulse);
    this.coachMesh.ring.material.opacity=0.6+Math.sin(time*4)*0.3;
    this.coachMesh.cone.position.y=height+Math.sin(time*4)*0.28;
    this.coachMesh.cone.scale.setScalar(radius/1.6);
  }
  syncProj(e){
    let rec=this.meshes.get('p'+e.id);
    if(!rec){ const m=new THREE.Mesh(new THREE.SphereGeometry(0.22,8,8),new THREE.MeshBasicMaterial({color:0xffe08a})); this.scene.add(m); rec={g:m}; this.meshes.set('p'+e.id,rec); }
    rec.g.position.set(e.x,1.6,e.z);
  }
  hit(x,z){
    const m=new THREE.Mesh(new THREE.SphereGeometry(0.5,10,10),new THREE.MeshBasicMaterial({color:0xffdd88,transparent:true,opacity:0.9}));
    m.position.set(x,1.2,z); this.scene.add(m); this.hits.push({m,t:0.4});
  }
  screenOf(x,y,z){
    const v=new THREE.Vector3(x,y,z).project(this.camera);
    const r=this.renderer.domElement.getBoundingClientRect();
    return {x:r.left+(v.x+1)/2*r.width, y:r.top+(1-v.y)/2*r.height};
  }
  pick(rayX,rayY){    const r=new THREE.Raycaster(); const ndc=new THREE.Vector2(rayX,rayY);
    r.setFromCamera(ndc,this.camera);
    const pl=new THREE.Plane(new THREE.Vector3(0,1,0),0);
    const pt=new THREE.Vector3(); r.ray.intersectPlane(pl,pt); return pt;
  }
}
