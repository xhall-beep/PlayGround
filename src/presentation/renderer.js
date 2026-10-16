// Presentation: chibi 3D (Three.js), lush forest, faction architecture, VFX, fog overlay.
import * as THREE from 'three';
import { WORLD, GRID, CELL, alive, g2w } from '../core/engine.js';
import { BUILDINGS, UNITS } from '../buildings/data.js';
import { coreFaction } from '../factions/factions.js';

const UNIT_C={human:0x3b6fe0,orc:0x9a3b1e,undead:0x8a7ab8,elf:0x2f9e5f};
const ROOF_C={human:0x1d4ed8,orc:0x40240f,undead:0x4c2a85,elf:0x065f46};
const WALL_C={human:0xdfe6f2,orc:0x8a6a4a,undead:0xd6d3d1,elf:0xe4efe0};
const FLAG_C={human:0x2b5cff,orc:0xff2b2b,undead:0xa855f7,elf:0xfbbf24};
const PROJ_C={human:0x9fc0ff,orc:0xff7a3c,undead:0xb07aff,elf:0xa8ffc8};
const CROP_C={human:0xe8c33d,orc:0xb0432a,undead:0xa855f7,elf:0x9fe6a8};
const DECAL_C={human:0x9aa7b8,orc:0x3a2415,undead:0x5b2a86,elf:0x9fd8c0};
const DECAL_RING={human:0xe2e8f0,orc:0x991b1b,undead:0x10b981,elf:0xfbbf24};

export class Renderer{
  constructor(container){
    this.container=container;
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x0e1a12);
    this.scene.fog=new THREE.Fog(0x0e1a12,70,160);
    const asp=container.clientWidth/Math.max(1,container.clientHeight);
    this.camera=new THREE.PerspectiveCamera(46,asp,0.1,400);
    this.target=new THREE.Vector3(0,0,0); this.dist=62; this.yaw=0.78; this.pitch=0.96;
    this.renderer=new THREE.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(Math.min(2,devicePixelRatio||1));
    this.renderer.shadowMap.enabled=true; this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.meshes=new Map(); this.resMeshes=[]; this.treeIM=null;
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
    this.scene.add(new THREE.HemisphereLight(0xfff0d2,0x4a7a2a,1.15));
    const sun=new THREE.DirectionalLight(0xfff2c4,2.15);
    sun.position.set(30,48,18); sun.castShadow=true;
    sun.shadow.mapSize.set(1024,1024); sun.shadow.camera.left=-60;sun.shadow.camera.right=60;sun.shadow.camera.top=60;sun.shadow.camera.bottom=-60;
    this.scene.add(sun);
    // Saturation-preserving tone curve: crushes nothing, lifts mid-tones into candy.
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.18;
  }
  ground(){
    const geo=new THREE.PlaneGeometry(WORLD,WORLD,GRID,GRID);
    geo.rotateX(-Math.PI/2);
    const pos=geo.attributes.position, colors=[];
    // Lush forest floor: emerald grass, light meadow, deep moss shade.
    const c1=new THREE.Color(0x58b368),c2=new THREE.Color(0x8fd694),c3=new THREE.Color(0x2d6a4f);
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
    const m=new THREE.Mesh(geo,mat); m.receiveShadow=true; this.scene.add(m);
    // fog shroud plane
    const fg=new THREE.PlaneGeometry(WORLD,WORLD); fg.rotateX(-Math.PI/2);
    this.fogMat=new THREE.MeshBasicMaterial({map:this.fogTex,transparent:true,opacity:0.92,depthWrite:false});
    this.fogMesh=new THREE.Mesh(fg,this.fogMat); this.fogMesh.position.y=0.6; this.scene.add(this.fogMesh);
  }
  // Fixed-camera distance + FOV by aspect. Vertical FOV widens on tall phones so
  // the whole clearing stays reachable by thumb without moving the camera.
  camDistFor(aspect){ return aspect<0.75?42:(aspect<1.2?38:30); }
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
    if(this.treeIM){ for(const im of this.treeIM.meshes){ this.scene.remove(im); im.geometry.dispose(); } this.treeIM=null; }
    for(const d of this.decals||[]){ this.scene.remove(d); } this.decals=[];
    // Trees: three InstancedMesh layers (trunk/top/tip) = 3 draw calls for the
    // whole forest instead of ~1000. Instance colors carry the leaf palette.
    const n=map.trees.length;
    const trunkIM=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35,0.5,1.6,6),new THREE.MeshStandardMaterial({color:0x6b4423,roughness:1}),n);
    const leafMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.85,flatShading:true});
    const topIM=new THREE.InstancedMesh(new THREE.ConeGeometry(1.4,2.6,7),leafMat,n);
    const tipIM=new THREE.InstancedMesh(new THREE.ConeGeometry(0.85,1.5,7),leafMat,n);
    const leafC=[0x1e7a34,0x2c9a44,0x3fb65a,0x14713c].map(c=>new THREE.Color(c));
    trunkIM.castShadow=topIM.castShadow=tipIM.castShadow=true;
    const insts=map.trees.map((t,i)=>{
      const s=0.9+(i%5)*0.12;
      if(n) { topIM.setColorAt(i,leafC[i%4]); tipIM.setColorAt(i,leafC[(i+1)%4]); }
      return {node:t,s,i};
    });
    if(topIM.instanceColor) topIM.instanceColor.needsUpdate=true;
    if(tipIM.instanceColor) tipIM.instanceColor.needsUpdate=true;
    this.scene.add(trunkIM,topIM,tipIM);
    this.treeIM={meshes:[trunkIM,topIM,tipIM],trunk:trunkIM,top:topIM,tip:tipIM,insts,xf:new THREE.Matrix4(),q:new THREE.Quaternion(),v:new THREE.Vector3(),sc:new THREE.Vector3()};
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
  addBaseDecal(x,z,faction){
    const F=coreFaction(faction);
    this.decals=this.decals||[];
    const disc=new THREE.Mesh(new THREE.CircleGeometry(9,40),
      new THREE.MeshStandardMaterial({color:DECAL_C[F],roughness:1,transparent:true,opacity:0.55}));
    disc.rotation.x=-Math.PI/2; disc.position.set(x,0.05,z); this.scene.add(disc); this.decals.push(disc);
    const rim=new THREE.Mesh(new THREE.RingGeometry(9,10,40),
      new THREE.MeshBasicMaterial({color:DECAL_RING[F],transparent:true,opacity:0.8,side:THREE.DoubleSide}));
    rim.rotation.x=-Math.PI/2; rim.position.set(x,0.06,z); this.scene.add(rim); this.decals.push(rim);
    const put=(m,px,pz)=>{ m.position.x+=px; m.position.z+=pz; this.scene.add(m); this.decals.push(m); return m; };
    if(F==='human'){ const m=new THREE.MeshStandardMaterial({color:0x8d99ac,roughness:1});
      for(let i=0;i<4;i++){ const a=i/4*Math.PI*2+0.4, s=new THREE.Mesh(new THREE.BoxGeometry(1.4,0.2,1.4),m);
        s.position.set(x,0.1,z); put(s,Math.cos(a)*6.5,Math.sin(a)*6.5); }
    } else if(F==='orc'){ const wood=new THREE.MeshStandardMaterial({color:0x4a2c14,roughness:1});
      const tipM=new THREE.MeshStandardMaterial({color:0x991b1b,roughness:0.7});
      for(let i=0;i<3;i++){ const a=i/3*Math.PI*2+0.9, pg=new THREE.Group();
        const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.4,3.2,6),wood); pole.position.y=1.6; pole.castShadow=true; pg.add(pole);
        const tip=new THREE.Mesh(new THREE.ConeGeometry(0.45,1.0,6),tipM); tip.position.y=3.7; pg.add(tip);
        pg.position.set(x,0,z); put(pg,Math.cos(a)*7,Math.sin(a)*7); }
    } else if(F==='undead'){ const stone=new THREE.MeshStandardMaterial({color:0x8f8a96,roughness:1});
      const glow=new THREE.MeshBasicMaterial({color:0x10b981});
      for(let i=0;i<4;i++){ const a=i/4*Math.PI*2+0.2, pg=new THREE.Group();
        const sl=new THREE.Mesh(new THREE.BoxGeometry(0.9,1.4,0.25),stone); sl.position.y=0.7; sl.castShadow=true; pg.add(sl);
        const w=new THREE.Mesh(new THREE.SphereGeometry(0.18,6,6),glow); w.position.y=1.7; pg.add(w);
        pg.position.set(x,0,z); put(pg,Math.cos(a)*6.5,Math.sin(a)*6.5); }
    } else { const moon=new THREE.MeshStandardMaterial({color:0xdfeee8,roughness:0.4,emissive:0x1a3a2a});
      const gold=new THREE.MeshStandardMaterial({color:0xfbbf24,roughness:0.4,metalness:0.5});
      for(let i=0;i<4;i++){ const a=i/4*Math.PI*2+0.7, pg=new THREE.Group();
        const s=new THREE.Mesh(new THREE.SphereGeometry(0.55,8,8),moon); s.position.y=0.55; s.castShadow=true; pg.add(s);
        const g=new THREE.Mesh(new THREE.SphereGeometry(0.2,6,6),gold); g.position.y=1.25; pg.add(g);
        pg.position.set(x,0,z); put(pg,Math.cos(a)*6.5,Math.sin(a)*6.5); }
    }
  }
  bldMesh(type,owner,faction){
    const F=coreFaction(faction);
    const g=new THREE.Group();
    const wall=new THREE.MeshStandardMaterial({color:WALL_C[F],roughness:0.9});
    const roofM=new THREE.MeshStandardMaterial({color:type==='townhall'?(F==='human'?0x8b2f2f:ROOF_C[F]):ROOF_C[F],roughness:0.8});
    let w=2.4,h=1.8;
    if(type==='townhall'){w=3.4;h=2.6;}
    if(type==='farm'){ const f=new THREE.Mesh(new THREE.BoxGeometry(2.6,0.3,2.6),new THREE.MeshStandardMaterial({color:0x4a7a3a})); f.position.y=0.15; g.add(f);
      for(let i=0;i<3;i++){const r=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.25,0.3),new THREE.MeshStandardMaterial({color:CROP_C[F]})); r.position.set(0,0.4,-0.7+i*0.7); g.add(r);}
      const hut=new THREE.Mesh(new THREE.BoxGeometry(1.2,1,1.2),wall); hut.position.set(0,0.8,1.2); hut.castShadow=true; g.add(hut);
      const cap=new THREE.Mesh(new THREE.ConeGeometry(1.0,0.8,4),roofM); cap.position.set(0,1.7,1.2); cap.rotation.y=Math.PI/4; g.add(cap); return g; }
    if(type==='tower'){ const t=new THREE.Mesh(new THREE.CylinderGeometry(0.8,1.1,4.4,8),wall); t.position.y=2.2; t.castShadow=true; g.add(t);
      const top=new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.2,0.8,8),roofM); top.position.y=4.6; top.castShadow=true; g.add(top);
      if(F==='orc'){ const sp=new THREE.Mesh(new THREE.ConeGeometry(0.5,1.4,6),new THREE.MeshStandardMaterial({color:0x991b1b})); sp.position.y=5.6; g.add(sp); }
      if(F==='undead'){ const sk=new THREE.Mesh(new THREE.SphereGeometry(0.4,8,8),new THREE.MeshStandardMaterial({color:0xd6d3d1})); sk.position.y=5.4; g.add(sk); }
      return g; }
    const box=new THREE.Mesh(new THREE.BoxGeometry(w,h,w),wall); box.position.y=h/2; box.castShadow=true; g.add(box);
    const roof=new THREE.Mesh(new THREE.ConeGeometry(w*0.85,1.4,4),roofM); roof.position.y=h+0.7; roof.rotation.y=Math.PI/4; roof.castShadow=true; g.add(roof);
    if(type==='townhall'){ const tw=new THREE.Mesh(new THREE.BoxGeometry(0.8,3.4,0.8),wall); tw.position.set(w/2,1.7,0); tw.castShadow=true; g.add(tw);
      const fl=new THREE.Mesh(new THREE.PlaneGeometry(1.1,0.7),new THREE.MeshBasicMaterial({color:FLAG_C[F],side:THREE.DoubleSide})); fl.position.set(w/2+0.7,3.1,0); g.add(fl); this.flag=fl; }
    if(type==='barracks'){
      if(F==='orc'){ for(let i=-1;i<=1;i++){ const sp=new THREE.Mesh(new THREE.ConeGeometry(0.28,1.5,5),new THREE.MeshStandardMaterial({color:0x2b1a0c})); sp.position.set(i*0.9,h+1.6,0); g.add(sp); } }
      else if(F==='undead'){ for(const sx of [-1,1]){ const post=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,1.8,5),new THREE.MeshStandardMaterial({color:0xd6d3d1})); post.position.set(sx*(w/2+0.4),0.9,0); g.add(post); } }
      else if(F==='elf'){ const orb=new THREE.Mesh(new THREE.SphereGeometry(0.35,8,8),new THREE.MeshStandardMaterial({color:0xfbbf24,emissive:0x554400})); orb.position.set(0,h+1.7,0); g.add(orb); }
      else { const sw=new THREE.Mesh(new THREE.BoxGeometry(0.15,1.4,0.15),new THREE.MeshStandardMaterial({color:0x888888})); sw.position.set(0.8,1.6,1.3); g.add(sw); }
    }
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
        const ef=e.f||(e.owner===0?st.playerFaction:st.aiFaction);
        const g=e.cat==='unit'?this.chibi(UNIT_C[coreFaction(ef)]??0x3b6fe0):this.bldMesh(e.type,e.owner,ef);
        // weapon props
        if(e.cat==='unit'&&e.type!=='peasant'){ const w=new THREE.Mesh(new THREE.BoxGeometry(0.12,1.1,0.12),new THREE.MeshStandardMaterial({color:0x888888})); w.position.set(0.7,1.2,0.2); w.rotation.z=0.4; g.add(w); }
        if(e.cat==='unit'&&e.type==='peasant'){ const ax=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.9,0.1),new THREE.MeshStandardMaterial({color:0x6b4423})); ax.position.set(0.7,1.1,0); g.add(ax); }
        // hp bar
        const hb=document.createElement('canvas'); hb.width=32; hb.height=4;
        const tex=new THREE.CanvasTexture(hb);
        const bar=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false})); bar.scale.set(1.8,0.25,1); bar.position.y=e.cat==='unit'?2.9:5.2; g.add(bar);
        // selection ring
        const ring=new THREE.Mesh(new THREE.RingGeometry(0.9,1.1,24),new THREE.MeshBasicMaterial({color:e.owner===0?0x4dff7a:0xff4d4d,transparent:true,opacity:0.9,side:THREE.DoubleSide}));
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
    // resources visibility + fog (trees are instanced; gold stays per-mesh)
    const showFog=st.fog;
    if(this.treeIM){
      const {trunk,top,tip,insts,xf,q,v,sc}=this.treeIM;
      for(const it of insts){
        const r=it.node, i=it.i;
        let vis=r.amount>0;
        if(vis&&showFog){ const gx=Math.max(0,Math.min(GRID-1,Math.floor(r.x/CELL+GRID/2))),gz=Math.max(0,Math.min(GRID-1,Math.floor(r.z/CELL+GRID/2)));
          vis=map.explored[0][gz*GRID+gx]===1; }
        if(vis){ const bob=Math.sin(time*1.5+r.x)*0.08; sc.set(it.s,it.s,it.s);
          xf.compose(v.set(r.x,0.8*it.s+bob,r.z),q,sc); trunk.setMatrixAt(i,xf);
          xf.compose(v.set(r.x,2.6*it.s+bob,r.z),q,sc); top.setMatrixAt(i,xf);
          xf.compose(v.set(r.x,4.0*it.s+bob,r.z),q,sc); tip.setMatrixAt(i,xf);
        } else { sc.set(0,0,0); xf.compose(v.set(0,-10,0),q,sc);
          trunk.setMatrixAt(i,xf); top.setMatrixAt(i,xf); tip.setMatrixAt(i,xf); }
      }
      trunk.instanceMatrix.needsUpdate=true; top.instanceMatrix.needsUpdate=true; tip.instanceMatrix.needsUpdate=true;
    }
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
    if(!rec){ const m=new THREE.Mesh(new THREE.SphereGeometry(0.22,8,8),new THREE.MeshBasicMaterial({color:PROJ_C[coreFaction(e.f)]??0xffe08a})); this.scene.add(m); rec={g:m}; this.meshes.set('p'+e.id,rec); }
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
