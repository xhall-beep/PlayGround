import * as THREE from '../vendor/three.module.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const ui = {
  hud: $('hud'), healthBar: $('healthBar'), healthValue: $('healthValue'), scoreValue: $('scoreValue'), waveValue: $('waveValue'),
  ammoValue: $('ammoValue'), ammoPips: $('ammoPips'), reloadHint: $('reloadHint'), statusText: $('statusText'),
  crosshair: $('crosshair'), hitmarker: $('hitmarker'), banner: $('banner'), vignette: $('vignette'), toast: $('toast'),
  radar: $('radar'), menu: $('menu'), pause: $('pause'), gameover: $('gameover'),
  startBtn: $('startBtn'), resumeBtn: $('resumeBtn'), restartBtn: $('restartBtn'),
  menuTiltBtn: $('menuTiltBtn'), pauseTiltBtn: $('pauseTiltBtn'), tiltBtn: $('tiltBtn'), tiltStatus: $('tiltStatus'),
  fireBtn: $('fireBtn'), jumpBtn: $('jumpBtn'), reloadBtn: $('reloadBtn'),
  stickZone: $('stickZone'), stickKnob: $('stickKnob'), lookHint: $('lookHint'),
  pauseScore: $('pauseScore'), pauseWave: $('pauseWave'), finalScore: $('finalScore'), finalWave: $('finalWave'),
  overMessage: $('overMessage')
};

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || window.innerWidth <= 820;
if (isTouch) document.body.classList.add('touch');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04060d);
scene.fog = new THREE.FogExp2(0x04060d, 0.017);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(175, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x01030a) },
      horizonColor: { value: new THREE.Color(0x0a2638) },
      glowColor: { value: new THREE.Color(0x123d52) }
    },
    vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 glowColor; varying vec3 vPos; void main() { float h = normalize(vPos).y; float band = smoothstep(-0.05, 0.35, h); vec3 c = mix(horizonColor, topColor, band); c += glowColor * pow(max(0.0, 1.0 - abs(h + 0.02) * 4.0), 3.0) * 0.5; gl_FragColor = vec4(c, 1.0); }'
  })
);
scene.add(sky);

const planet = new THREE.Mesh(
  new THREE.SphereGeometry(10, 32, 24),
  new THREE.MeshBasicMaterial({ color: 0x1b3d5c, fog: false })
);
planet.position.set(-62, 46, -110);
scene.add(planet);
const planetGlow = new THREE.Mesh(
  new THREE.SphereGeometry(10.8, 32, 24),
  new THREE.MeshBasicMaterial({ color: 0x3f9fc4, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false, depthWrite: false })
);
planetGlow.position.copy(planet.position);
scene.add(planetGlow);
const planetRing = new THREE.Mesh(
  new THREE.TorusGeometry(16, 0.32, 8, 80),
  new THREE.MeshBasicMaterial({ color: 0x4aa8c8, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, fog: false, depthWrite: false })
);
planetRing.position.copy(planet.position);
planetRing.rotation.set(1.15, 0.35, 0.5);
scene.add(planetRing);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 240);
camera.rotation.order = 'YXZ';
scene.add(camera);

const clock = new THREE.Clock();
const colliders = [];
const worldMeshes = [];
const enemies = [];
const enemyShots = [];
const bursts = [];
const tracers = [];
const flashes = [];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;

function makeTexture(size, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

const floorTex = makeTexture(512, (ctx, s) => {
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '#0a1220'); g.addColorStop(0.5, '#060b14'); g.addColorStop(1, '#0a1422');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(70, 243, 255, 0.16)'; ctx.lineWidth = 2;
  for (let i = 0; i <= s; i += s / 8) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(70, 243, 255, 0.05)'; ctx.lineWidth = 1;
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rand(-30, 30), y + rand(-30, 30)); ctx.stroke();
  }
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1);
  }
}, 8, 8);

const wallTex = makeTexture(512, (ctx, s) => {
  ctx.fillStyle = '#0d1726'; ctx.fillRect(0, 0, s, s);
  const cols = 4, rows = 8, w = s / cols, h = s / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = 20 + Math.floor(Math.random() * 14);
      ctx.fillStyle = `rgb(${v}, ${v + 5}, ${v + 12})`;
      ctx.fillRect(x * w + 2, y * h + 2, w - 4, h - 4);
      ctx.strokeStyle = 'rgba(70, 243, 255, 0.09)'; ctx.lineWidth = 1;
      ctx.strokeRect(x * w + 2, y * h + 2, w - 4, h - 4);
      if (Math.random() > 0.7) {
        ctx.fillStyle = 'rgba(70, 243, 255, 0.10)';
        ctx.fillRect(x * w + 8, y * h + 8, w - 16, 3);
      }
    }
  }
}, 6, 2);

const glowTex = makeTexture(128, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(160,250,255,0.85)');
  g.addColorStop(0.6, 'rgba(70,243,255,0.22)');
  g.addColorStop(1, 'rgba(70,243,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
});

function holoTexture(title, subtitle, accent) {
  return makeTexture(512, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.strokeRect(14, 14, s - 28, s - 28);
    ctx.strokeStyle = 'rgba(70,243,255,0.35)'; ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.moveTo(20, 30 + i * 12); ctx.lineTo(20 + Math.random() * 60, 30 + i * 12); ctx.stroke(); }
    ctx.fillStyle = accent; ctx.font = 'bold 72px Arial'; ctx.textAlign = 'center';
    ctx.fillText(title, s / 2, 210);
    ctx.fillStyle = 'rgba(223,249,255,0.75)'; ctx.font = '28px Arial';
    ctx.fillText(subtitle, s / 2, 270);
    ctx.fillStyle = 'rgba(70,243,255,0.5)'; ctx.font = '18px monospace';
    ctx.fillText('/// ' + 'SECTOR-7'.padEnd(18, ' ') + '///', s / 2, 330);
    ctx.fillText('THREAT LEVEL: ESCALATING', s / 2, 366);
  });
}

function addCollider(x, z, w, d) {
  colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}

function addBox(x, y, z, w, h, d, material, collider = false, shadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  scene.add(mesh); worldMeshes.push(mesh);
  if (collider) addCollider(x, z, w, d);
  return mesh;
}

const mat = {
  wall: new THREE.MeshStandardMaterial({ map: wallTex, color: 0xd6ecf8, metalness: 0.78, roughness: 0.34, emissive: 0x0c2c38, emissiveIntensity: 0.35 }),
  wallDark: new THREE.MeshStandardMaterial({ color: 0x0a1220, metalness: 0.9, roughness: 0.42 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x14202f, metalness: 0.78, roughness: 0.34 }),
  crateTrim: new THREE.MeshStandardMaterial({ color: 0x0a1a24, emissive: 0x1d7f95, emissiveIntensity: 1.1, metalness: 0.5, roughness: 0.35 }),
  neonCyan: new THREE.MeshBasicMaterial({ color: 0x46f3ff }),
  neonMagenta: new THREE.MeshBasicMaterial({ color: 0xff2fd0 }),
  neonAmber: new THREE.MeshBasicMaterial({ color: 0xffb545 })
};

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(64, 64),
  new THREE.MeshStandardMaterial({ map: floorTex, color: 0xe4f6ff, metalness: 0.68, roughness: 0.42, emissive: 0x0a3a44, emissiveMap: floorTex, emissiveIntensity: 0.42 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor); worldMeshes.push(floor);

const decalTex = makeTexture(512, (ctx, s) => {
  ctx.clearRect(0, 0, s, s);
  const c = s / 2;
  ctx.strokeStyle = 'rgba(70, 243, 255, 0.9)';
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(c, c, 225, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(70, 243, 255, 0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(c, c, 195, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([18, 14]);
  ctx.beginPath(); ctx.arc(c, c, 165, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(70, 243, 255, 0.55)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * 205, c + Math.sin(a) * 205);
    ctx.lineTo(c + Math.cos(a) * 222, c + Math.sin(a) * 222);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 181, 69, 0.95)';
  ctx.lineWidth = 12;
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -118); ctx.lineTo(-28, -152); ctx.lineTo(28, -152);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(70, 243, 255, 0.95)';
  ctx.font = 'bold 34px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('SECTOR 7', c, c + 8);
  ctx.fillStyle = 'rgba(255, 47, 208, 0.9)';
  ctx.font = '13px monospace';
  ctx.fillText('VANGUARD // DROP ZONE', c, c + 30);
});
const decal = new THREE.Mesh(
  new THREE.PlaneGeometry(9, 9),
  new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, opacity: 0.85, depthWrite: false })
);
decal.rotation.x = -Math.PI / 2;
decal.position.set(0, 0.022, 11);
scene.add(decal); worldMeshes.push(decal);

for (const [x, z, w, h, d] of [[-14, 16, 2, 2, 2], [14, 17, 2, 2.5, 2], [-22, 20, 3, 1.5, 3], [22, 21, 3, 2, 3], [-18, 25, 2.4, 1.8, 2.4], [18, 26, 2.4, 1.8, 2.4]]) {
  addBox(x, h / 2, z, w, h, d, mat.crate, true);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.06, d * 1.02), mat.crateTrim);
  trim.position.set(x, h + 0.03, z); scene.add(trim); worldMeshes.push(trim);
}


for (const [x, z] of [[-7, 18.5], [7, 19.5]]) {
  const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.1, 8), mat.wallDark);
  bollard.position.set(x, 0.55, z); bollard.castShadow = true; scene.add(bollard); worldMeshes.push(bollard);
  addCollider(x, z, 0.5, 0.5);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 8), mat.neonCyan);
  cap.position.set(x, 1.12, z); scene.add(cap); worldMeshes.push(cap);
}

addBox(0, 5, -32, 64, 10, 1.2, mat.wall);
addBox(0, 5, 32, 64, 10, 1.2, mat.wall);
addBox(-32, 5, 0, 1.2, 10, 64, mat.wall);
addBox(32, 5, 0, 1.2, 10, 64, mat.wall);

for (const [x, z, w, h, d] of [
  [-8, -6, 3, 2.2, 3], [7, -9, 2.2, 3, 2.2], [0, 6, 4, 1.2, 2],
  [-12, 8, 2, 2.6, 2], [12, 4, 2, 2, 2], [-4, -14, 2, 1.6, 2],
  [9, 13, 2.4, 2, 2.4], [-17, -2, 2, 4, 2], [17, -4, 2, 4, 2],
  [-20, 14, 2.4, 1.8, 2.4], [20, 15, 2.4, 2.4, 2.4], [-22, -14, 2.6, 3.2, 2.6],
  [22, -15, 2.6, 2.8, 2.6], [0, -22, 5, 1.1, 2], [0, 22, 5, 1.1, 2]
]) {
  addBox(x, h / 2, z, w, h, d, mat.crate, true);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.06, d * 1.02), mat.crateTrim);
  trim.position.set(x, h + 0.03, z); scene.add(trim); worldMeshes.push(trim);
}

for (const [x, z] of [[-24, -24], [24, -24], [-24, 24], [24, 24]]) {
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 10, 8), mat.wallDark);
  pillar.position.set(x, 5, z); pillar.castShadow = true; pillar.receiveShadow = true;
  scene.add(pillar); worldMeshes.push(pillar);
  addCollider(x, z, 2.4, 2.4);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.045, 6, 20), i === 1 ? mat.neonMagenta : mat.neonCyan);
    ring.rotation.x = Math.PI / 2; ring.position.set(x, 2 + i * 2.6, z);
    scene.add(ring); worldMeshes.push(ring);
  }
}

for (let i = -30; i <= 30; i += 6) {
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.6), mat.neonCyan);
  strip.position.set(-31.25, 6.5, i); scene.add(strip); worldMeshes.push(strip);
  const strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.6), mat.neonMagenta);
  strip2.position.set(31.25, 6.5, i); scene.add(strip2); worldMeshes.push(strip2);
}

for (const [x, z, rot, title, sub, accent] of [
  [-10, -31.3, 0, 'SECTOR 7', 'NEON DEFENSE GRID', '#46f3ff'],
  [11, -31.3, 0, 'VANGUARD', 'AUTHORIZED PERSONNEL', '#ff2fd0'],
  [31.3, -8, -Math.PI / 2, 'THREAT', 'ESCALATION PROTOCOL', '#ffb545'],
  [-31.3, 9, Math.PI / 2, 'SIGNAL', 'UPLINK STABLE', '#46f3ff']
]) {
  const billboard = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 3.6),
    new THREE.MeshBasicMaterial({ map: holoTexture(title, sub, accent), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  billboard.position.set(x, 5.2, z); billboard.rotation.y = rot;
  scene.add(billboard); worldMeshes.push(billboard);
}

for (const r of [7, 13, 26]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 96), r === 13 ? mat.neonMagenta : mat.neonCyan);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.03;
  scene.add(ring); worldMeshes.push(ring);
}

const holoCore = new THREE.Group();
const holoShell = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.5, 1),
  new THREE.MeshBasicMaterial({ color: 0x46f3ff, wireframe: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
);
const holoInner = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.7, 0),
  new THREE.MeshBasicMaterial({ color: 0xff2fd0, wireframe: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
);
holoCore.add(holoShell, holoInner);
holoCore.position.set(0, 5.4, 0);
scene.add(holoCore);
const holoLight = new THREE.PointLight(0x46f3ff, 18, 22, 2);
holoLight.position.set(0, 5.4, 0); scene.add(holoLight);

const starsGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(900 * 3);
for (let i = 0; i < 900; i++) {
  const r = rand(70, 140), theta = rand(0, Math.PI * 2), phi = rand(0.08, Math.PI / 2);
  starPos[i * 3] = Math.cos(theta) * Math.sin(phi) * r;
  starPos[i * 3 + 1] = Math.cos(phi) * r + 4;
  starPos[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * r;
}
starsGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xbfe9ff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.75, fog: false, depthWrite: false }));
scene.add(stars);

const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(360 * 3);
for (let i = 0; i < 360; i++) {
  dustPos[i * 3] = rand(-30, 30); dustPos[i * 3 + 1] = rand(0.3, 9); dustPos[i * 3 + 2] = rand(-30, 30);
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x9fe8ff, size: 0.06, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(dust);

const hemi = new THREE.HemisphereLight(0x3f8fb0, 0x0a1220, 1.2);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xbfe6ff, 2.6);
key.position.set(16, 26, 14);
key.castShadow = true;
key.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
key.shadow.camera.left = -36; key.shadow.camera.right = 36;
key.shadow.camera.top = 36; key.shadow.camera.bottom = -36;
key.shadow.camera.near = 1; key.shadow.camera.far = 80;
key.shadow.bias = -0.0004;
scene.add(key);
const cyanLight = new THREE.PointLight(0x46f3ff, 34, 34, 2);
cyanLight.position.set(-16, 6, -12); scene.add(cyanLight);
const magentaLight = new THREE.PointLight(0xff2fd0, 28, 30, 2);
magentaLight.position.set(16, 5, 10); scene.add(magentaLight);
const amberLight = new THREE.PointLight(0xffb545, 16, 24, 2);
amberLight.position.set(0, 4, 26); scene.add(amberLight);
const fillLight = new THREE.PointLight(0x7fb6e8, 60, 70, 2);
fillLight.position.set(0, 14, 0); scene.add(fillLight);

const flashlight = new THREE.SpotLight(0xcdeeff, 34, 55, Math.PI / 5.2, 0.55, 1.4);
flashlight.position.set(0.12, -0.04, 0.1);
flashlight.target.position.set(0, -0.02, -1);
camera.add(flashlight, flashlight.target);
const viewLight = new THREE.PointLight(0xa8e8ff, 3.2, 3.4, 2);
viewLight.position.set(0.22, 0.06, 0.12);
camera.add(viewLight);

function buildWeapon() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b3748, metalness: 0.86, roughness: 0.32 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x121a25, metalness: 0.7, roughness: 0.48 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0a0f16, metalness: 0.25, roughness: 0.85 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x2bd8ff, emissiveIntensity: 3.6, metalness: 0.4, roughness: 0.3 });
  const magenta = new THREE.MeshStandardMaterial({ color: 0x2a0a24, emissive: 0xff2fd0, emissiveIntensity: 3.2, metalness: 0.4, roughness: 0.3 });

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.17, 0.52), metal);
  receiver.position.set(0, 0, -0.02); g.add(receiver);

  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.46), panel);
  upper.position.set(0, 0.11, -0.06); g.add(upper);
  for (let i = 0; i < 5; i++) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.035), panel);
    rail.position.set(0, 0.145, -0.26 + i * 0.085); g.add(rail);
  }

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.62, 14), panel);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.015, -0.6); g.add(barrel);

  const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.32), metal);
  shroud.position.set(0, 0.015, -0.43); g.add(shroud);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.038), rubber);
      vent.position.set(side * 0.052, 0.015, -0.32 - i * 0.07); g.add(vent);
    }
  }

  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.04, 0.13, 10), panel);
  brake.rotation.x = Math.PI / 2; brake.position.set(0, 0.015, -0.94); g.add(brake);
  const brakeRing = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 16), accent);
  brakeRing.position.set(0, 0.015, -1.0); g.add(brakeRing);

  const sightBase = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.14), panel);
  sightBase.position.set(0, 0.19, -0.08); g.add(sightBase);
  const sightRing = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.007, 6, 18), accent);
  sightRing.position.set(0, 0.235, -0.08); g.add(sightRing);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 16), new THREE.MeshBasicMaterial({ color: 0x46f3ff, transparent: true, opacity: 0.85 }));
  lens.position.set(0, 0.235, -0.082); g.add(lens);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.22, 0.1), rubber);
  grip.position.set(0, -0.17, 0.08); grip.rotation.x = 0.26; g.add(grip);
  const gripCap = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.03, 0.11), metal);
  gripCap.position.set(0, -0.28, 0.115); gripCap.rotation.x = 0.26; g.add(gripCap);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.13), panel);
  mag.position.set(0, -0.18, -0.13); mag.rotation.x = -0.1; g.add(mag);
  const magGlow = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.018, 0.135), accent);
  magGlow.position.set(0, -0.29, -0.12); g.add(magGlow);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.16), panel);
  stock.position.set(0, -0.01, 0.28); g.add(stock);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.11, 0.045), rubber);
  pad.position.set(0, -0.01, 0.37); g.add(pad);

  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.3), accent);
  strip.position.set(0.078, 0.035, -0.06); g.add(strip);
  const strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.024, 0.2), magenta);
  strip2.position.set(-0.078, 0.03, -0.1); g.add(strip2);
  const underGlow = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.014, 0.3), accent);
  underGlow.position.set(0, -0.075, -0.4); g.add(underGlow);

  const charging = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.06), magenta);
  charging.position.set(0.082, 0.01, 0.08); g.add(charging);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.015, -1.02); g.add(muzzle);

  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x9ff6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  flashSprite.scale.set(0.55, 0.55, 0.55); flashSprite.position.copy(muzzle.position); flashSprite.visible = false; g.add(flashSprite);

  const flashLight = new THREE.PointLight(0x9ff6ff, 0, 7, 2);
  flashLight.position.copy(muzzle.position); g.add(flashLight);

  g.scale.setScalar(0.8);
  g.position.set(0.3, -0.28, -0.8);
  g.rotation.set(0.03, 0.16, 0.02);
  return { group: g, muzzle, flashSprite, flashLight, base: g.position.clone(), baseRot: g.rotation.clone() };
}

const weapon = buildWeapon();
camera.add(weapon.group);
weapon.group.visible = false;

function updateWeaponLayout() {
  const aspect = window.innerWidth / window.innerHeight;
  const portrait = aspect < 0.85;
  weapon.base.set(portrait ? 0.13 : 0.3, portrait ? -0.24 : -0.28, portrait ? -0.68 : -0.8);
  weapon.group.position.copy(weapon.base);
  weapon.group.scale.setScalar(portrait ? 0.66 : 0.8);
}
updateWeaponLayout();

const player = {
  pos: new THREE.Vector3(0, 0, 18),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: -0.02,
  height: 1.7,
  radius: 0.42,
  health: 100, maxHealth: 100,
  onGround: true,
  bob: 0, bobPhase: 0,
  ammo: 30, maxAmmo: 30,
  reloading: false, reloadTimer: 0, reloadDuration: 1.35,
  fireCooldown: 0, fireRate: 0.105,
  recoil: 0, kick: 0, spread: 0,
  lastDamage: -10, shake: 0,
  sprinting: false, moving: false
};

const state = { mode: 'menu', score: 0, wave: 0, spawnQueue: 0, spawnTimer: 0, waveTimer: 0, time: 0, tilt: false };

const keys = new Set();
const touch = { moveX: 0, moveZ: 0, firing: false, lookId: null, lastX: 0, lastY: 0, joyId: null };
let pointerLocked = false;
let audio = null;

function ensureAudio() {
  if (audio) { if (audio.state === 'suspended') audio.resume().catch(() => {}); return; }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio = new Ctx();
  } catch { audio = null; }
}

function tone(freq, dur, type = 'sine', gain = 0.05, slide = 0) {
  if (!audio) return;
  try {
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(audio.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  } catch {}
}

function noise(dur, gain = 0.06, cutoff = 1800) {
  if (!audio) return;
  try {
    const len = Math.floor(audio.sampleRate * dur);
    const buffer = audio.createBuffer(1, len, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = audio.createBufferSource(); src.buffer = buffer;
    const filter = audio.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = cutoff;
    const g = audio.createGain(); g.gain.value = gain;
    src.connect(filter).connect(g).connect(audio.destination);
    src.start();
  } catch {}
}

const sfx = {
  shoot() { noise(0.09, 0.05, 2600); tone(120, 0.08, 'square', 0.025, -70); },
  hit() { tone(880, 0.07, 'triangle', 0.045, 500); },
  headshot() { tone(1320, 0.12, 'triangle', 0.05, 700); tone(660, 0.1, 'sine', 0.03); },
  kill() { tone(90, 0.35, 'sawtooth', 0.05, -50); noise(0.3, 0.06, 900); },
  hurt() { tone(70, 0.2, 'sawtooth', 0.06, -30); },
  reload() { tone(420, 0.05, 'square', 0.025); setTimeout(() => tone(300, 0.05, 'square', 0.025), 420); setTimeout(() => tone(560, 0.06, 'square', 0.03), 900); },
  wave() { tone(330, 0.4, 'sine', 0.035); setTimeout(() => tone(440, 0.5, 'sine', 0.03), 120); },
  empty() { tone(180, 0.05, 'square', 0.02); },
  ui() { tone(620, 0.06, 'sine', 0.025, 120); }
};

function makeEnemy(x, z, wave) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a293d, metalness: 0.9, roughness: 0.3, emissive: 0x0a2230, emissiveIntensity: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x05090f, metalness: 0.7, roughness: 0.5 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3355 });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2fd0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.56, 1), bodyMat);
  core.position.y = 1.72; core.castShadow = true; group.add(core);

  const shell = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.055, 6, 24), ringMat);
  shell.position.y = 1.72; shell.rotation.x = Math.PI / 2.4; group.add(shell);

  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 14), eyeMat);
  eye.position.set(0, 1.76, -0.5); group.add(eye);

  const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff3355, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  eyeGlow.scale.set(0.95, 0.95, 0.95);
  eyeGlow.position.set(0, 1.76, -0.54);
  group.add(eyeGlow);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.16), darkMat);
  brow.position.set(0, 1.93, -0.4); group.add(brow);

  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.5), bodyMat);
    arm.position.set(s * 0.62, 1.66, -0.06); arm.rotation.y = s * 0.25; group.add(arm);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 6), darkMat);
    claw.position.set(s * 0.7, 1.66, -0.32); claw.rotation.x = -Math.PI / 2; group.add(claw);
  }

  const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.18, 10), darkMat);
  thruster.position.y = 1.08; group.add(thruster);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), new THREE.MeshBasicMaterial({ color: 0x46f3ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = Math.PI / 2; glow.position.y = 1.0; group.add(glow);

  const hp = 34 + wave * 12;
  const enemy = {
    group, core, shell, eye, eyeMat, glow, ringMat,
    hp, maxHp: hp, speed: 2.1 + Math.min(1.4, wave * 0.12),
    attackTimer: rand(0.8, 2.0), bob: rand(0, Math.PI * 2), phase: rand(0, Math.PI * 2),
    dead: false, hitFlash: 0, spawnT: 0, charge: 0, radius: 0.6
  };
  group.position.set(x, 0, z);
  group.scale.setScalar(0.01);
  group.traverse((o) => { o.userData.enemy = enemy; });
  scene.add(group);
  enemies.push(enemy);

  spawnBurst(new THREE.Vector3(x, 1.7, z), 0x46f3ff, 18, 4.5, 0.1);
  return enemy;
}

function removeEnemy(enemy) {
  scene.remove(enemy.group);
  enemy.group.traverse((o) => {
    if (o.isMesh) { o.geometry.dispose(); if (o.material.dispose) o.material.dispose(); }
  });
  const i = enemies.indexOf(enemy);
  if (i >= 0) enemies.splice(i, 1);
}

function spawnBurst(pos, color, count, speed, size) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z;
    const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.35, 1) * speed);
    velocities[i * 3] = v.x; velocities[i * 3 + 1] = v.y; velocities[i * 3 + 2] = v.z;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, material);
  scene.add(points);
  bursts.push({ points, velocities, life: 0.75, maxLife: 0.75, gravity: 5 });
}

function spawnTracer(from, to, color = 0x8ff8ff) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = new THREE.Line(geo, material);
  scene.add(line);
  tracers.push({ line, life: 0.09, maxLife: 0.09 });
}

function spawnEnemyShot(pos, dir, wave) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  mesh.position.copy(pos);
  scene.add(mesh);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a2f, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  sprite.scale.set(0.7, 0.7, 0.7); mesh.add(sprite);
  enemyShots.push({ mesh, vel: dir.clone().multiplyScalar(13 + Math.min(4, wave * 0.4)), life: 5, damage: 7 + wave * 0.7 });
}

function resolveCircle(pos, radius) {
  for (const c of colliders) {
    const nx = clamp(pos.x, c.minX, c.maxX);
    const nz = clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2), push = radius - d;
        pos.x += (dx / d) * push; pos.z += (dz / d) * push;
      } else {
        const left = pos.x - c.minX, right = c.maxX - pos.x, back = pos.z - c.minZ, front = c.maxZ - pos.z;
        const m = Math.min(left, right, back, front);
        if (m === left) pos.x = c.minX - radius;
        else if (m === right) pos.x = c.maxX + radius;
        else if (m === back) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      }
    }
  }
  pos.x = clamp(pos.x, -30.5 + radius, 30.5 - radius);
  pos.z = clamp(pos.z, -30.5 + radius, 30.5 - radius);
}

function enemySpawnPoint() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const a = rand(0, Math.PI * 2), r = rand(16, 27);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - player.pos.x, z - player.pos.z) < 12) continue;
    let blocked = false;
    for (const c of colliders) {
      if (x > c.minX - 1 && x < c.maxX + 1 && z > c.minZ - 1 && z < c.maxZ + 1) { blocked = true; break; }
    }
    if (!blocked) return { x, z };
  }
  return { x: rand(-20, 20), z: -24 };
}

const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function fire() {
  if (state.mode !== 'playing' || player.reloading || player.fireCooldown > 0) return;
  if (player.ammo <= 0) { sfx.empty(); player.fireCooldown = 0.2; return; }
  player.ammo--;
  player.fireCooldown = player.fireRate;
  player.recoil = Math.min(1, player.recoil + 0.55);
  player.kick = 1;
  player.spread = Math.min(1, player.spread + 0.35);
  player.pitch = clamp(player.pitch + 0.011, -1.35, 1.35);
  player.yaw += rand(-0.0035, 0.0035);
  player.shake = Math.min(0.5, player.shake + 0.08);

  const origin = new THREE.Vector3();
  weapon.muzzle.getWorldPosition(origin);
  const spread = player.spread * 0.02 + (player.moving ? 0.006 : 0);
  const dir = new THREE.Vector3(rand(-spread, spread), rand(-spread, spread), -1).normalize();
  dir.applyQuaternion(camera.quaternion);

  raycaster.set(camera.position, dir);
  raycaster.camera = camera;
  raycaster.far = 120;
  const targets = [...enemies.map((e) => e.group), ...worldMeshes];
  const hits = raycaster.intersectObjects(targets, true);
  let end = camera.position.clone().add(dir.clone().multiplyScalar(80));
  if (hits.length) {
    const hit = hits[0];
    end = hit.point.clone();
    let enemy = hit.object.userData.enemy;
    let o = hit.object;
    while (!enemy && o.parent) { o = o.parent; enemy = o.userData.enemy; }
    if (enemy && !enemy.dead) {
      const head = hit.point.y > 2.0;
      const dmg = head ? 42 : 21;
      damageEnemy(enemy, dmg, head, hit.point);
    } else {
      spawnBurst(hit.point, 0x46f3ff, 7, 2.6, 0.06);
    }
  }
  spawnTracer(origin, end);
  sfx.shoot();
  weapon.flashSprite.visible = true;
  weapon.flashSprite.material.rotation = rand(0, Math.PI * 2);
  weapon.flashSprite.scale.setScalar(rand(0.42, 0.62));
  weapon.flashLight.intensity = 12;
  flashes.push({ life: 0.05, maxLife: 0.05 });
  updateAmmoUI();
}

function damageEnemy(enemy, amount, head, point) {
  if (enemy.dead) return;
  enemy.hp -= amount;
  enemy.hitFlash = 0.16;
  spawnBurst(point, head ? 0xffb545 : 0xff2fd0, head ? 14 : 8, 3.2, 0.07);
  if (enemy.hp <= 0) {
    enemy.dead = true;
    const pos = enemy.group.position.clone(); pos.y = 1.7;
    spawnBurst(pos, 0xff7a2f, 34, 7, 0.12);
    spawnBurst(pos, 0x46f3ff, 20, 5, 0.09);
    removeEnemy(enemy);
    const gain = (head ? 150 : 100) + state.wave * 10;
    state.score += gain;
    updateScoreUI();
    sfx.kill();
    showToast(`+${gain}${head ? '  HEADSHOT' : ''}`);
    hitmarker();
  } else {
    sfx.hit();
    if (head) sfx.headshot();
    hitmarker();
  }
}

function hitmarker() {
  ui.hitmarker.classList.remove('pop');
  void ui.hitmarker.offsetWidth;
  ui.hitmarker.classList.add('pop');
}

let toastTimer = 0;
function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  toastTimer = 1.6;
}

let bannerTimer = 0;
function showBanner(kicker, main) {
  ui.banner.querySelector('.banner-kicker').textContent = kicker;
  ui.banner.querySelector('.banner-main').textContent = main;
  ui.banner.classList.add('show');
  bannerTimer = 2.2;
}

function updateScoreUI() {
  ui.scoreValue.textContent = state.score.toLocaleString();
  ui.waveValue.textContent = String(state.wave);
}

function updateAmmoUI() {
  ui.ammoValue.textContent = String(player.ammo);
  const pips = ui.ammoPips.children;
  for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('empty', i >= player.ammo);
}

function updateHealthUI() {
  const pct = clamp(player.health / player.maxHealth, 0, 1);
  ui.healthBar.style.width = `${pct * 100}%`;
  ui.healthBar.classList.toggle('low', pct < 0.35);
  ui.healthValue.textContent = String(Math.max(0, Math.ceil(player.health)));
}

function startReload() {
  if (player.reloading || player.ammo === player.maxAmmo || state.mode !== 'playing') return;
  player.reloading = true;
  player.reloadTimer = player.reloadDuration;
  ui.reloadHint.classList.add('show');
  sfx.reload();
}

function takeDamage(amount) {
  if (state.mode !== 'playing') return;
  player.health -= amount;
  player.lastDamage = state.time;
  player.shake = Math.min(1, player.shake + 0.45);
  ui.vignette.style.opacity = String(Math.min(0.9, 0.35 + amount / 30));
  sfx.hurt();
  updateHealthUI();
  if (player.health <= 0) gameOver();
}

function gameOver() {
  if (state.mode === 'over') return;
  state.mode = 'over';
  player.health = 0;
  updateHealthUI();
  document.exitPointerLock?.();
  ui.finalScore.textContent = state.score.toLocaleString();
  ui.finalWave.textContent = String(Math.max(0, state.wave - 1));
  ui.overMessage.textContent = state.score > 1500 ? 'Impressive run. The grid remembers your name.' : 'The swarm broke through. Recalibrate and try again.';
  ui.gameover.classList.remove('hidden');
  ui.hud.style.opacity = '0.35';
}

function beginWave() {
  state.wave++;
  const total = Math.min(12, 2 + state.wave * 2);
  const initial = state.wave === 1 ? 3 : 2;
  state.spawnQueue = Math.max(0, total - initial);
  state.spawnTimer = 0.28;
  state.waveTimer = 0;

  const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const offsets = [[0, 11], [-3.5, 10], [3.5, 10], [-7, 8], [7, 8]];
  for (let i = 0; i < initial; i++) {
    const [side, dist] = offsets[i % offsets.length];
    const p = player.pos.clone().addScaledVector(forward, dist).addScaledVector(right, side);
    resolveCircle(p, 0.7);
    makeEnemy(p.x, p.z, state.wave);
  }

  updateScoreUI();
  showBanner('INCOMING', `WAVE ${state.wave}`);
  sfx.wave();
}

function resetGame() {
  for (const e of [...enemies]) removeEnemy(e);
  for (const s of enemyShots) { scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
  enemyShots.length = 0;
  for (const b of bursts) { scene.remove(b.points); b.points.geometry.dispose(); b.points.material.dispose(); }
  bursts.length = 0;
  for (const t of tracers) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); }
  tracers.length = 0;
  player.pos.set(0, 0, 20);
  player.vel.set(0, 0, 0);
  player.yaw = 0; player.pitch = -0.02;
  player.health = player.maxHealth;
  player.ammo = player.maxAmmo;
  player.reloading = false; player.reloadTimer = 0;
  player.fireCooldown = 0; player.recoil = 0; player.kick = 0; player.spread = 0; player.shake = 0;
  player.onGround = true; player.lastDamage = -10;
  state.score = 0; state.wave = 0; state.spawnQueue = 0; state.waveTimer = 0;
  ui.vignette.style.opacity = '0';
  ui.hud.style.opacity = '1';
  updateHealthUI(); updateAmmoUI(); updateScoreUI();
  ui.reloadHint.classList.remove('show');
  state.mode = 'playing';
  ui.menu.classList.add('hidden');
  ui.pause.classList.add('hidden');
  ui.gameover.classList.add('hidden');
  weapon.group.visible = true;
  beginWave();
  requestLock();
}

function startGame() {
  ensureAudio();
  resetGame();
}

function requestLock() {
  if (isTouch) return;
  try {
    const result = canvas.requestPointerLock?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {}
}

function togglePause(force) {
  if (state.mode === 'playing') {
    state.mode = 'paused';
    ui.pauseScore.textContent = state.score.toLocaleString();
    ui.pauseWave.textContent = String(state.wave);
    ui.pause.classList.remove('hidden');
    document.exitPointerLock?.();
  } else if (state.mode === 'paused' && force !== true) {
    state.mode = 'playing';
    ui.pause.classList.add('hidden');
    requestLock();
  }
}

function updatePlayer(dt) {
  const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  let mx = touch.moveX, mz = touch.moveZ;
  if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  const mag = Math.hypot(mx, mz);
  if (mag > 1) { mx /= mag; mz /= mag; }
  player.moving = Math.hypot(mx, mz) > 0.08;
  player.sprinting = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && player.moving && player.onGround;

  const speed = player.sprinting ? 9.2 : 6.1;
  const desired = new THREE.Vector3().addScaledVector(right, mx * speed).addScaledVector(forward, mz * speed);
  const accel = player.onGround ? 34 : 9;
  player.vel.x += (desired.x - player.vel.x) * Math.min(1, accel * dt);
  player.vel.z += (desired.z - player.vel.z) * Math.min(1, accel * dt);

  player.vel.y -= 24 * dt;
  if ((keys.has('Space') || touch.jump) && player.onGround) {
    player.vel.y = 7.6; player.onGround = false;
  }
  touch.jump = false;

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= 0) { player.pos.y = 0; player.vel.y = 0; player.onGround = true; }
  resolveCircle(player.pos, player.radius);

  const hspeed = Math.hypot(player.vel.x, player.vel.z);
  if (player.onGround && hspeed > 0.4) {
    player.bobPhase += dt * (player.sprinting ? 12 : 8.5);
    player.bob = Math.sin(player.bobPhase) * (player.sprinting ? 0.045 : 0.028);
  } else {
    player.bob *= 1 - Math.min(1, dt * 8);
  }

  if (player.fireCooldown > 0) player.fireCooldown -= dt;
  if (player.reloading) {
    player.reloadTimer -= dt;
    if (player.reloadTimer <= 0) {
      player.reloading = false;
      player.ammo = player.maxAmmo;
      ui.reloadHint.classList.remove('show');
      updateAmmoUI();
    }
  }
  if (player.recoil > 0) player.recoil = Math.max(0, player.recoil - dt * 3.4);
  if (player.kick > 0) player.kick = Math.max(0, player.kick - dt * 7);
  if (player.spread > 0) player.spread = Math.max(0, player.spread - dt * 2.2);
  if (player.shake > 0) player.shake = Math.max(0, player.shake - dt * 3.5);

  if (state.time - player.lastDamage > 5 && player.health < player.maxHealth) {
    player.health = Math.min(player.maxHealth, player.health + dt * 11);
    updateHealthUI();
  }

  camera.position.set(player.pos.x, player.pos.y + player.height + player.bob, player.pos.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  if (player.shake > 0) {
    camera.position.x += rand(-1, 1) * player.shake * 0.035;
    camera.position.y += rand(-1, 1) * player.shake * 0.03;
    camera.rotation.z = rand(-1, 1) * player.shake * 0.012;
  } else {
    camera.rotation.z *= 0.85;
  }

  const bobX = Math.sin(player.bobPhase * 0.5) * 0.006 * (player.moving ? 1 : 0);
  const bobY = Math.abs(Math.cos(player.bobPhase * 0.5)) * 0.006 * (player.moving ? 1 : 0);
  const reloadDip = player.reloading ? Math.sin((1 - player.reloadTimer / player.reloadDuration) * Math.PI) * 0.12 : 0;
  weapon.group.position.set(weapon.base.x + bobX, weapon.base.y - bobY - reloadDip, weapon.base.z + player.kick * 0.09);
  weapon.group.rotation.set(weapon.baseRot.x - player.kick * 0.22 + reloadDip * 0.8, weapon.baseRot.y + bobX * 0.6, weapon.baseRot.z + bobX * 0.4);

  ui.crosshair.style.transform = `translate(-50%, -50%) scale(${1 + player.spread * 0.55 + (player.moving ? 0.12 : 0)})`;
  ui.reloadHint.classList.toggle('show', player.reloading);

  if (touch.firing || (pointerLocked && keys.has('Mouse0'))) fire();
}

function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.spawnT < 1) {
      e.spawnT = Math.min(1, e.spawnT + dt * 3.2);
      const s = 1 - Math.pow(1 - e.spawnT, 3);
      e.group.scale.setScalar(s);
    }
    const dx = player.pos.x - e.group.position.x;
    const dz = player.pos.z - e.group.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist, nz = dz / dist;

    let strafe = Math.sin(state.time * 0.9 + e.phase) * 0.65;
    let desiredX = nx, desiredZ = nz;
    if (dist < 8) { desiredX = -nx * 0.35 - nz * strafe; desiredZ = -nz * 0.35 + nx * strafe; }
    else if (dist < 14) { desiredX = -nz * strafe; desiredZ = nx * strafe; }

    for (const other of enemies) {
      if (other === e) continue;
      const ox = e.group.position.x - other.group.position.x;
      const oz = e.group.position.z - other.group.position.z;
      const od = Math.hypot(ox, oz);
      if (od > 0.001 && od < 2.4) {
        desiredX += (ox / od) * (2.4 - od) * 0.8;
        desiredZ += (oz / od) * (2.4 - od) * 0.8;
      }
    }

    const dm = Math.hypot(desiredX, desiredZ) || 1;
    e.group.position.x += (desiredX / dm) * e.speed * dt;
    e.group.position.z += (desiredZ / dm) * e.speed * dt;
    resolveCircle(e.group.position, e.radius);

    e.group.rotation.y = Math.atan2(-nx, -nz);
    e.bob += dt * 2.4;
    const hover = 1 + Math.sin(e.bob) * 0.09;
    e.core.position.y = 1.72 * hover;
    e.shell.position.y = 1.72 * hover;
    e.eye.position.y = 1.76 * hover;
    e.shell.rotation.z += dt * 1.6;
    e.shell.rotation.x = Math.PI / 2.4 + Math.sin(state.time + e.phase) * 0.18;
    e.eye.scale.setScalar(1 + Math.sin(state.time * 8 + e.phase) * 0.08 + e.charge * 0.8);

    if (e.hitFlash > 0) {
      e.hitFlash -= dt;
      e.core.material.emissive.setHex(0xff2fd0);
      e.core.material.emissiveIntensity = e.hitFlash * 14;
    } else {
      e.core.material.emissive.setHex(0x0a2230);
      e.core.material.emissiveIntensity = 0.6;
    }

    e.attackTimer -= dt;
    if (e.attackTimer <= 0 && dist < 24 && e.spawnT > 0.6) {
      e.attackTimer = rand(1.5, 2.6);
      e.charge = 0.5;
      const from = new THREE.Vector3(e.group.position.x, 1.76 * hover, e.group.position.z);
      const aim = new THREE.Vector3(player.pos.x, player.pos.y + 1.3, player.pos.z);
      const dir = aim.sub(from).normalize();
      dir.x += rand(-0.035, 0.035); dir.y += rand(-0.02, 0.02); dir.z += rand(-0.035, 0.035);
      dir.normalize();
      spawnEnemyShot(from, dir, state.wave);
      tone(240, 0.12, 'sawtooth', 0.02, 120);
    }
    if (e.charge > 0) e.charge = Math.max(0, e.charge - dt * 2.2);
  }
}

function updateEnemyShots(dt) {
  for (let i = enemyShots.length - 1; i >= 0; i--) {
    const s = enemyShots[i];
    s.life -= dt;
    s.mesh.position.addScaledVector(s.vel, dt);
    const d = s.mesh.position.distanceTo(tmpV.set(player.pos.x, player.pos.y + 1.1, player.pos.z));
    let remove = s.life <= 0;
    if (d < 0.62) {
      takeDamage(s.damage);
      spawnBurst(s.mesh.position, 0xff7a2f, 10, 3, 0.07);
      remove = true;
    } else if (s.mesh.position.y < 0.08 || Math.abs(s.mesh.position.x) > 31 || Math.abs(s.mesh.position.z) > 31) {
      spawnBurst(s.mesh.position, 0xff7a2f, 5, 2, 0.05);
      remove = true;
    }
    if (remove) {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose(); s.mesh.material.dispose();
      enemyShots.splice(i, 1);
    }
  }
}

function updateEffects(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.life -= dt;
    const pos = b.points.geometry.attributes.position;
    for (let j = 0; j < pos.count; j++) {
      b.velocities[j * 3 + 1] -= b.gravity * dt;
      pos.setXYZ(j, pos.getX(j) + b.velocities[j * 3] * dt, pos.getY(j) + b.velocities[j * 3 + 1] * dt, pos.getZ(j) + b.velocities[j * 3 + 2] * dt);
    }
    pos.needsUpdate = true;
    b.points.material.opacity = Math.max(0, b.life / b.maxLife);
    if (b.life <= 0) {
      scene.remove(b.points);
      b.points.geometry.dispose(); b.points.material.dispose();
      bursts.splice(i, 1);
    }
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / t.maxLife) * 0.9;
    if (t.life <= 0) {
      scene.remove(t.line);
      t.line.geometry.dispose(); t.line.material.dispose();
      tracers.splice(i, 1);
    }
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].life -= dt;
    if (flashes[i].life <= 0) flashes.splice(i, 1);
  }
  if (weapon.flashSprite.visible) {
    weapon.flashSprite.material.opacity -= dt * 20;
    weapon.flashLight.intensity = Math.max(0, weapon.flashLight.intensity - dt * 240);
    if (weapon.flashSprite.material.opacity <= 0) {
      weapon.flashSprite.visible = false;
      weapon.flashSprite.material.opacity = 0.95;
    }
  }
}

function updateWave(dt) {
  if (state.mode !== 'playing') return;
  if (state.spawnQueue > 0) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      state.spawnTimer = 0.38;
      state.spawnQueue--;
      const p = enemySpawnPoint();
      makeEnemy(p.x, p.z, state.wave);
    }
  } else if (enemies.length === 0) {
    state.waveTimer += dt;
    if (state.waveTimer > 2.2) {
      state.waveTimer = 0;
      showToast(`WAVE ${state.wave} CLEARED`);
      beginWave();
    }
  }
}

function drawRadar() {
  const ctx = ui.radar.getContext('2d');
  const s = ui.radar.width, c = s / 2;
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(70, 243, 255, 0.22)'; ctx.lineWidth = 1;
  for (const r of [0.34, 0.67, 0.98]) {
    ctx.beginPath(); ctx.arc(c, c, c * r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(c, 0); ctx.lineTo(c, s); ctx.moveTo(0, c); ctx.lineTo(s, c); ctx.stroke();
  ctx.strokeStyle = 'rgba(70, 243, 255, 0.5)';
  ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c, c - c * 0.9); ctx.stroke();

  const scale = c / 30;
  for (const e of enemies) {
    const dx = (e.group.position.x - player.pos.x) * scale;
    const dz = (e.group.position.z - player.pos.z) * scale;
    const r = Math.hypot(dx, dz);
    if (r > c - 4) continue;
    const a = Math.atan2(dz, dx);
    const px = c + Math.cos(a) * r, py = c + Math.sin(a) * r;
    ctx.fillStyle = '#ff3b57';
    ctx.shadowColor = '#ff3b57'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
  for (const s2 of enemyShots) {
    const dx = (s2.mesh.position.x - player.pos.x) * scale;
    const dz = (s2.mesh.position.z - player.pos.z) * scale;
    const r = Math.hypot(dx, dz);
    if (r > c - 4) continue;
    const a = Math.atan2(dz, dx);
    ctx.fillStyle = '#ffb545';
    ctx.beginPath(); ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 2, 0, Math.PI * 2); ctx.fill();
  }

  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(-player.yaw);
  ctx.fillStyle = '#46f3ff';
  ctx.shadowColor = '#46f3ff'; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.shadowBlur = 0;
}

function updateHud(dt) {
  if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) ui.banner.classList.remove('show'); }
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) ui.toast.classList.remove('show'); }
  const v = parseFloat(ui.vignette.style.opacity || '0');
  if (v > 0) ui.vignette.style.opacity = String(Math.max(0, v - dt * 1.8));
  if (state.mode === 'playing') {
    ui.statusText.textContent = player.reloading ? 'RELOADING // COVER' : enemies.length ? `HOSTILES // ${String(enemies.length).padStart(2, '0')}` : 'SECTOR 7 // CLEAR';
  }
  drawRadar();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.1, clock.getDelta());
  state.time += dt;

  if (state.mode === 'menu') {
    const t = state.time * 0.12;
    camera.position.set(Math.sin(t) * 15, 6.4, Math.cos(t) * 21);
    camera.rotation.set(-0.12, Math.atan2(camera.position.x, camera.position.z) + Math.PI, 0);
    camera.lookAt(0, 1.7, 0);
    weapon.group.visible = false;
  } else if (state.mode === 'playing') {
    updatePlayer(dt);
    updateEnemies(dt);
    updateEnemyShots(dt);
    updateWave(dt);
    updateEffects(dt);
    updateHud(dt);
  }

  holoCore.rotation.y += dt * 0.35;
  holoCore.rotation.x += dt * 0.12;
  holoInner.rotation.y -= dt * 0.6;
  holoLight.intensity = 15 + Math.sin(state.time * 2.2) * 4;
  stars.rotation.y += dt * 0.004;
  dust.rotation.y += dt * 0.006;
  dust.position.y = Math.sin(state.time * 0.2) * 0.15;

  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateWeaponLayout();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Escape') { if (state.mode === 'playing' || state.mode === 'paused') togglePause(); }
  if (e.code === 'Enter' && state.mode === 'menu') startGame();
  if (e.code === 'Enter' && state.mode === 'over') startGame();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  document.body.classList.toggle('locked', pointerLocked);
});
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || state.mode !== 'playing') return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.35, 1.35);
});

canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  if (state.mode !== 'playing') return;
  if (!isTouch && !pointerLocked) requestLock();
  if (e.pointerType === 'mouse' && e.button === 0 && pointerLocked) { touch.firing = true; keys.add('Mouse0'); }
  if (e.pointerType !== 'mouse' || !pointerLocked) {
    if (e.clientX > window.innerWidth * 0.38 || e.pointerType === 'mouse') {
      touch.lookId = e.pointerId;
      touch.lastX = e.clientX; touch.lastY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (touch.lookId !== e.pointerId || state.mode !== 'playing') return;
  const dx = e.clientX - touch.lastX, dy = e.clientY - touch.lastY;
  touch.lastX = e.clientX; touch.lastY = e.clientY;
  const sens = e.pointerType === 'mouse' ? 0.0035 : 0.0052;
  player.yaw -= dx * sens;
  player.pitch = clamp(player.pitch - dy * sens, -1.35, 1.35);
});
function endLook(e) {
  if (touch.lookId === e.pointerId) touch.lookId = null;
  if (e.pointerType === 'mouse') { touch.firing = false; keys.delete('Mouse0'); }
}
canvas.addEventListener('pointerup', endLook);
canvas.addEventListener('pointercancel', endLook);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && pointerLocked && state.mode === 'playing') { touch.firing = true; keys.add('Mouse0'); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) { touch.firing = false; keys.delete('Mouse0'); }
});

function setupStick() {
  const zone = ui.stickZone;
  const knob = ui.stickKnob;
  const radius = 46;
  const update = (e) => {
    const rect = zone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > radius) { dx = (dx / d) * radius; dy = (dy / d) * radius; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touch.moveX = dx / radius;
    touch.moveZ = -dy / radius;
  };
  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touch.joyId = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch {}
    update(e);
  });
  zone.addEventListener('pointermove', (e) => { if (touch.joyId === e.pointerId) { e.preventDefault(); update(e); } });
  const end = (e) => {
    if (touch.joyId !== e.pointerId) return;
    touch.joyId = null; touch.moveX = 0; touch.moveZ = 0;
    knob.style.transform = 'translate(0px, 0px)';
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

function holdButton(el, onDown, onUp) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('on'); ensureAudio(); onDown(); });
  const up = (e) => { e.preventDefault(); el.classList.remove('on'); onUp?.(); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', (e) => { if (e.buttons === 0) return; up(e); });
}

function setupTouch() {
  setupStick();
  holdButton(ui.fireBtn, () => { touch.firing = true; }, () => { touch.firing = false; });
  holdButton(ui.jumpBtn, () => { touch.jump = true; }, () => {});
  holdButton(ui.reloadBtn, () => startReload(), () => {});
}

function setTiltUI(enabled, supported) {
  const label = enabled ? 'Tilt: ON — move device to aim' : supported ? 'Tilt: available on supported devices' : 'Tilt: no motion sensor detected';
  ui.tiltStatus.textContent = label;
  ui.menuTiltBtn.textContent = enabled ? 'Tilt Aim: On' : 'Enable Tilt Aim';
  ui.menuTiltBtn.classList.toggle('on', enabled);
  ui.pauseTiltBtn.textContent = enabled ? 'Tilt Aim: On' : 'Enable Tilt Aim';
  ui.pauseTiltBtn.classList.toggle('on', enabled);
  ui.tiltBtn.classList.toggle('on', enabled);
  ui.tiltBtn.innerHTML = `TILT<br /><small>${enabled ? 'ON' : 'OFF'}</small>`;
}

let tiltLast = { beta: null, gamma: null };
function onOrientation(e) {
  if (!state.tilt || e.beta === null || e.gamma === null) return;
  if (tiltLast.beta === null) { tiltLast.beta = e.beta; tiltLast.gamma = e.gamma; return; }
  const db = e.beta - tiltLast.beta, dg = e.gamma - tiltLast.gamma;
  tiltLast.beta = e.beta; tiltLast.gamma = e.gamma;
  if (state.mode !== 'playing') return;
  player.yaw -= dg * 0.0024;
  player.pitch = clamp(player.pitch - db * 0.0021, -1.35, 1.35);
}

async function enableTilt() {
  ensureAudio();
  if (!('DeviceOrientationEvent' in window)) {
    setTiltUI(false, false);
    showToast('MOTION SENSOR UNAVAILABLE');
    return;
  }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        showToast('MOTION PERMISSION DENIED');
        setTiltUI(false, true);
        return;
      }
    }
    if (!state.tilt) {
      state.tilt = true;
      tiltLast = { beta: null, gamma: null };
      window.addEventListener('deviceorientation', onOrientation);
      setTiltUI(true, true);
      showToast('TILT AIM ENABLED');
    } else {
      state.tilt = false;
      window.removeEventListener('deviceorientation', onOrientation);
      setTiltUI(false, true);
      showToast('TILT AIM DISABLED');
    }
  } catch {
    showToast('MOTION PERMISSION UNAVAILABLE');
    setTiltUI(false, true);
  }
}

ui.startBtn.addEventListener('click', () => { ensureAudio(); sfx.ui(); startGame(); });
ui.restartBtn.addEventListener('click', () => { ensureAudio(); sfx.ui(); startGame(); });
ui.resumeBtn.addEventListener('click', () => { ensureAudio(); sfx.ui(); togglePause(); });
ui.menuTiltBtn.addEventListener('click', enableTilt);
ui.pauseTiltBtn.addEventListener('click', enableTilt);
ui.tiltBtn.addEventListener('click', enableTilt);

for (let i = 0; i < player.maxAmmo; i++) {
  const pip = document.createElement('span');
  pip.className = 'pip';
  ui.ammoPips.appendChild(pip);
}

setupTouch();
setTiltUI(false, 'DeviceOrientationEvent' in window);
updateHealthUI();
updateAmmoUI();
updateScoreUI();
ui.menu.classList.remove('hidden');
window.__neonVanguard = { state, player, enemies, beginWave, makeEnemy, fire, startGame, takeDamage, startReload, togglePause, camera, scene };
animate();
