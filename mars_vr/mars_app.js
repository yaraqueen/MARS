// =====================================================================
// Mars Landing VR - التطبيق: مشهد المريخ ثلاثي الأبعاد + لوحة الـ HUD + الطيران والهبوط
// الإعدادات والمنطق كلها في mars_logic.js
// =====================================================================
(function () {
"use strict";
const THREE = window.THREE;
if (!THREE) { window.__bootError("ما انحملت مكتبة three.js. تأكدوا إن مجلد lib موجود بجانب الصفحة (lib/three.min.js)."); return; }

const L = window.MarsLogic, CONFIG = L.CONFIG;
const $ = id => document.getElementById(id);
const COLORS = { hud: "#3cff8f", warn: "#ffd23c", danger: "#ff4a4a", dim: "rgba(60,255,143,0.6)" };
const LEVEL_COLOR = [COLORS.hud, COLORS.warn, COLORS.danger];
const LEVEL_HEX = [0x3cff8f, 0xffd23c, 0xff4a4a];
const AI_LEVEL_NAME = ["LOW", "CAUTION", "HIGH"];
const HUD_LAYER = 1; // الـ HUD والعلامات في طبقة منفصلة عشان الموديل ما يشوفها

const statusEl = $("status"), modelStatusEl = $("modelStatus");
function setStatus(el, msg, cls) { el.textContent = msg; el.className = "status " + (cls || ""); }

const state = {
  ready: false, running: false, stereo: false, xr: false,
  phase: "HOVER", pos: { x: 0, z: 0 }, alt: CONFIG.HOVER_ALT, vspeed: 0, groundY: 0,
  yaw: 0, pitch: -0.6, yawOffset: 0, gyro: false,
  site: null, assessment: null, level: -1, target: null, targetAssessment: null,
  suggestion: null, nextSuggestAt: 0,
  dwell: 0, dwellAnchor: null, dwellEnabled: true, liftDwell: 0, phaseTime: 0,
  message: null, messageUntil: 0, dust: 0, overlay: false,
  tel: L.initTelemetry(CONFIG), telStatus: { st: {}, alarms: [] }, autoDemo: false, demoT: 0,
  session: null, ai: { busy: false, nextAt: 0, hazards: [], ms: 0 },
  keys: new Set(), lastFrame: 0, lastHud: 0, landings: 0
};
window.__hud = state; // للفحص من الـ Console فقط
let stabilize = L.makeStabilizer(CONFIG.STABLE_FRAMES, -1);

// =====================================================================
// المشهد
// =====================================================================
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.xr.setReferenceSpaceType("local");
const scene = new THREE.Scene();
const HORIZON = new THREE.Color("#d6ad86"), ZENITH = new THREE.Color("#8d6a50");
scene.background = HORIZON.clone();
scene.fog = new THREE.Fog(HORIZON.clone(), 120, 1700);

const rig = new THREE.Group();
const camera = new THREE.PerspectiveCamera(CONFIG.FOV_DEG, 1, 0.1, 7000);
camera.layers.enable(HUD_LAYER);
rig.add(camera);
scene.add(rig);
const eyes = [-1, 1].map(side => {
  const cam = new THREE.PerspectiveCamera(CONFIG.STEREO_FOV_DEG, 1, 0.1, 7000);
  cam.position.x = side * CONFIG.IPD / 2;
  cam.layers.enable(HUD_LAYER);
  camera.add(cam);
  return cam;
});

const SUN_AZ = 50 * Math.PI / 180, SUN_EL = 30 * Math.PI / 180;
const sunDir = new THREE.Vector3(Math.cos(SUN_EL) * Math.sin(SUN_AZ), Math.sin(SUN_EL), -Math.cos(SUN_EL) * Math.cos(SUN_AZ));
const shadowDir = new THREE.Vector2(-sunDir.x, -sunDir.z).normalize();
const sun = new THREE.DirectionalLight(0xfff1e0, 2.7);
sun.position.copy(sunDir);
scene.add(sun, new THREE.HemisphereLight(0xe6c09a, 0x5c3b29, 1.0));

let world = null, hmap = null, terrain = null, baseColors = null, hazardCanvas = null;
let sky = null, lzRing = null, suggestRing = null, beam = null, rockMarkers = null, selfShadow = null;

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildScene() {
  const rnd = L.mulberry32(CONFIG.SEED + 999);
  const half = world.half, n1 = world.n1, cell = world.cell;

  // ---------- السماء: قبة بلون متدرج + الشمس ----------
  const skyGeo = new THREE.SphereGeometry(5000, 32, 16);
  const sp = skyGeo.attributes.position, skyCol = new Float32Array(sp.count * 3), tmp = new THREE.Color();
  for (let i = 0; i < sp.count; i++) {
    const t = Math.pow(L.clamp(sp.getY(i) / 5000, 0, 1), 0.55);
    tmp.copy(HORIZON).lerp(ZENITH, t);
    skyCol.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(skyCol, 3));
  sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  const sunTex = canvasTexture(256, 256, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.07, "rgba(255,250,240,1)");
    g.addColorStop(0.12, "rgba(200,220,255,0.55)"); g.addColorStop(0.4, "rgba(170,200,255,0.12)"); g.addColorStop(1, "rgba(170,200,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, w, w);
  });
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
  sunSprite.position.copy(sunDir).multiplyScalar(4500);
  sunSprite.scale.setScalar(1500);
  sky.add(sunSprite);
  sky.renderOrder = -10;
  scene.add(sky);

  // ---------- أرض منطقة المسح ----------
  const detailTex = canvasTexture(256, 256, (c, w, h) => {
    const img = c.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = 196 + rnd() * 50 - (rnd() < 0.04 ? 60 * rnd() : 0);
      img.data.set([v, v * 0.985, v * 0.97, 255], i * 4);
    }
    c.putImageData(img, 0, 0);
  });
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
  detailTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const pos = new Float32Array(n1 * n1 * 3), uv = new Float32Array(n1 * n1 * 2);
  baseColors = new Float32Array(n1 * n1 * 3);
  const dust = new THREE.Color("#c27a4c"), mid = new THREE.Color("#a55f3a"), dark = new THREE.Color("#78472f");
  // لون الأرض: غبار فاتح في السهول، وأغمق في المناطق الوعرة (نفس الدالة للأرض القريبة والبعيدة)
  const groundColor = (x, z, rg) => {
    const v = L.fbm(x / 23, z / 23, 3, CONFIG.SEED + 300);
    return tmp.copy(dust).lerp(mid, L.clamp(0.25 + rg * 0.5 + (v - 0.5) * 0.9, 0, 1)).lerp(dark, L.clamp(rg * 0.55 + (v - 0.5) * 0.8 - 0.1, 0, 1));
  };
  for (let iz = 0; iz < n1; iz++) for (let ix = 0; ix < n1; ix++) {
    const i = iz * n1 + ix, x = -half + ix * cell, z = -half + iz * cell;
    pos.set([x, world.heights[i], z], i * 3);
    uv.set([x / 3.5, z / 3.5], i * 2);
    groundColor(x, z, world.rough[i]);
    tmp.multiplyScalar(0.92 + 0.16 * L.vnoise(x / 1.7, z / 1.7, CONFIG.SEED + 301));
    baseColors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  const N = world.N, idx = new Uint32Array(N * N * 6);
  for (let iz = 0, k = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    const a = iz * n1 + ix, b = a + 1, c = a + n1, d = c + 1;
    idx.set([a, c, b, b, c, d], k); k += 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(baseColors.slice(), 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTex }));
  scene.add(terrain);

  // ---------- الأرض البعيدة (خارج منطقة المسح) مع تلال في الأفق ----------
  const fc = half / 5, fseg = 2 * Math.round(3200 / fc), fsize = fseg * fc, fn1 = fseg + 1;
  const fpos = new Float32Array(fn1 * fn1 * 3), fcol = new Float32Array(fn1 * fn1 * 3), fuv = new Float32Array(fn1 * fn1 * 2), fidx = [];
  for (let iz = 0; iz < fn1; iz++) for (let ix = 0; ix < fn1; ix++) {
    const i = iz * fn1 + ix, x = -fsize / 2 + ix * fc, z = -fsize / 2 + iz * fc, d = Math.hypot(x, z);
    const hills = Math.max(0, L.fbm(x / 700 + 3, z / 700 + 8, 3, CONFIG.SEED + 400) - 0.42) * L.smoothstep(350, 2400, d) * 520;
    fpos.set([x, L.baseHeight(x, z, CONFIG.SEED) + hills - 0.05, z], i * 3);
    groundColor(x, z, L.roughMask(x, z, CONFIG.SEED));
    fcol.set([tmp.r, tmp.g, tmp.b], i * 3);
    fuv.set([x / 3.5, z / 3.5], i * 2);
  }
  for (let iz = 0; iz < fseg; iz++) for (let ix = 0; ix < fseg; ix++) {
    const x = -fsize / 2 + (ix + 0.5) * fc, z = -fsize / 2 + (iz + 0.5) * fc;
    if (Math.abs(x) < half && Math.abs(z) < half) continue; // فتحة مكان منطقة المسح
    const a = iz * fn1 + ix, b = a + 1, c = a + fn1, d = c + 1;
    fidx.push(a, c, b, b, c, d);
  }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute("position", new THREE.BufferAttribute(fpos, 3));
  fgeo.setAttribute("color", new THREE.BufferAttribute(fcol, 3));
  fgeo.setAttribute("uv", new THREE.BufferAttribute(fuv, 2));
  fgeo.setIndex(fidx);
  fgeo.computeVertexNormals();
  scene.add(new THREE.Mesh(fgeo, new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTex })));

  // ---------- الصخور + ظلالها ----------
  const rockGeo = detail => {
    const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.78 + 0.4 * L.vnoise(x * 1.7 + 9, y * 1.7 + z * 1.3 + 4, 77 + detail);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const small = world.rocks.filter(r => r.r < 0.3), big = world.rocks.filter(r => r.r >= 0.3);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e = new THREE.Euler();
  const v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();
  const rockA = new THREE.Color("#8a5a42"), rockB = new THREE.Color("#5e4033");
  for (const [list, detail] of [[small, 0], [big, 1]]) {
    const mesh = new THREE.InstancedMesh(rockGeo(detail), rockMat, list.length);
    list.forEach((rk, i) => {
      const sy = rk.h / 0.7;
      e.set((rk.tint - 0.5) * 0.5, rk.rot, (rk.sx - 1) * 1.2);
      m4.compose(v3.set(rk.x, rk.y - 0.3 * sy, rk.z), q.setFromEuler(e), s3.set(rk.r * rk.sx, sy, rk.r * rk.sz));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, tmp.copy(rockA).lerp(rockB, rk.tint));
    });
    scene.add(mesh);
  }
  const shadowRocks = world.rocks.filter(r => r.r >= 0.14);
  const shadowGeo = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x1a0d08, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, shadowRocks.length);
  const shadowYaw = Math.atan2(-shadowDir.y, shadowDir.x);
  shadowRocks.forEach((rk, i) => {
    const len = rk.h / Math.tan(SUN_EL) * 0.6, cx = rk.x + shadowDir.x * len * 0.5, cz = rk.z + shadowDir.y * len * 0.5;
    const gy = L.heightAt(world, cx, cz), gx1 = L.heightAt(world, cx + 0.6, cz), gz1 = L.heightAt(world, cx, cz + 0.6);
    nrm.set(-(gx1 - gy) / 0.6, 1, -(gz1 - gy) / 0.6).normalize();
    q.setFromUnitVectors(up, nrm).multiply(q2.setFromAxisAngle(up, shadowYaw));
    m4.compose(v3.set(cx, gy + 0.03, cz), q, s3.set(rk.r * 1.05 + len * 0.5, 1, rk.r * 1.05));
    shadows.setMatrixAt(i, m4);
  });
  scene.add(shadows);

  // ---------- علامات الهبوط (في طبقة الـ HUD) ----------
  lzRing = new ConformRing(CONFIG.LZ_DIAMETER / 2, true);
  suggestRing = new ConformRing(CONFIG.LZ_DIAMETER / 2, false);
  suggestRing.setColor(LEVEL_HEX[0]);
  beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 30, 8, 1, true).translate(0, 15, 0),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
  beam.layers.set(HUD_LAYER);
  scene.add(beam);
  rockMarkers = new THREE.InstancedMesh(new THREE.ConeGeometry(0.28, 0.6, 4).rotateX(Math.PI),
    new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.95, fog: false }), 16);
  rockMarkers.layers.set(HUD_LAYER);
  rockMarkers.renderOrder = 12;
  rockMarkers.frustumCulled = false;
  scene.add(rockMarkers);
  selfShadow = new THREE.Mesh(shadowGeo, shadowMat.clone());
  scene.add(selfShadow);

  // ---------- خريطة المخاطر: صورة صغيرة للرادار في الـ HUD + تلوين الأرض ----------
  hazardCanvas = document.createElement("canvas");
  hazardCanvas.width = hazardCanvas.height = hmap.n;
  const hc = hazardCanvas.getContext("2d"), img = hc.createImageData(hmap.n, hmap.n);
  const rgb = [[60, 255, 143], [255, 210, 60], [255, 74, 74]];
  for (let i = 0; i < hmap.n * hmap.n; i++) {
    const lv = hmap.levels[i];
    img.data.set(lv < 0 ? [0, 0, 0, 0] : [...rgb[lv], lv === 0 ? 120 : 210], i * 4);
  }
  hc.putImageData(img, 0, 0);
}

// حلقة تتبع شكل الأرض (دائرة الهبوط)
class ConformRing {
  constructor(radius, filled) {
    this.radius = radius; this.seg = 72;
    this.rings = filled ? [0.33, 0.66, 0.94, 1] : [0.9, 1];
    const n = this.rings.length * this.seg;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
    const edgeIdx = [], fillIdx = [], S = this.seg, last = this.rings.length - 1;
    for (let r = 0; r < last; r++) for (let s = 0; s < S; s++) {
      const a = 1 + r * S + s, b = 1 + r * S + (s + 1) % S, c = a + S, d = b + S;
      (r === last - 1 ? edgeIdx : fillIdx).push(a, c, b, b, c, d);
    }
    if (filled) for (let s = 0; s < S; s++) fillIdx.push(0, 1 + s, 1 + (s + 1) % S);
    this.edgeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide, fog: false });
    this.fillMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthTest: false, side: THREE.DoubleSide, fog: false });
    const edgeGeo = this.geo.clone(), fillGeo = this.geo.clone();
    edgeGeo.attributes.position = fillGeo.attributes.position = this.geo.attributes.position; // نفس النقاط
    edgeGeo.setIndex(edgeIdx); fillGeo.setIndex(fillIdx);
    this.group = new THREE.Group();
    for (const [g, m, order] of [[fillGeo, this.fillMat, 10], [edgeGeo, this.edgeMat, 11]]) {
      if (!g.index.count) continue;
      const mesh = new THREE.Mesh(g, m);
      mesh.layers.set(HUD_LAYER); mesh.renderOrder = order; mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.group.visible = false;
    scene.add(this.group);
  }
  setColor(hex) { this.edgeMat.color.setHex(hex); this.fillMat.color.setHex(hex); }
  place(x, z) {
    const p = this.geo.attributes.position, S = this.seg;
    const y0 = L.heightAt(world, x, z);
    if (Number.isNaN(y0)) { this.group.visible = false; return; }
    p.setXYZ(0, x, y0 + 0.12, z);
    this.rings.forEach((f, r) => {
      for (let s = 0; s < S; s++) {
        const a = s / S * Math.PI * 2, px = x + Math.cos(a) * this.radius * f, pz = z + Math.sin(a) * this.radius * f;
        const h = L.heightAt(world, px, pz);
        p.setXYZ(1 + r * S + s, px, (Number.isNaN(h) ? y0 : h) + 0.12, pz);
      }
    });
    p.needsUpdate = true;
    this.group.visible = true;
  }
}

function applyOverlay(on) {
  state.overlay = on;
  const col = terrain.geometry.attributes.color, n1 = world.n1, tint = [new THREE.Color(0x2fe07f), new THREE.Color(0xffd23c), new THREE.Color(0xff3b3b)];
  const arr = col.array;
  arr.set(baseColors);
  if (on) for (let iz = 0; iz < n1; iz++) for (let ix = 0; ix < n1; ix++) {
    const lv = L.hazardLevelAt(hmap, -world.half + ix * world.cell, -world.half + iz * world.cell);
    if (lv < 0) continue;
    const i = (iz * n1 + ix) * 3, t = tint[lv], k = lv === 0 ? 0.3 : 0.5;
    arr[i] += (t.r - arr[i]) * k; arr[i + 1] += (t.g - arr[i + 1]) * k; arr[i + 2] += (t.b - arr[i + 2]) * k;
  }
  col.needsUpdate = true;
}

// =====================================================================
// لوحة الـ HUD: ترسم على canvas وتنعرض كلوحة شفافة ثابتة قدام العين
// =====================================================================
const hudCanvas = document.createElement("canvas");
const hctx = hudCanvas.getContext("2d");
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
hudTex.generateMipmaps = false;
hudTex.minFilter = THREE.LinearFilter;
const hud = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
hud.layers.set(HUD_LAYER);
hud.renderOrder = 100;
hud.frustumCulled = false;
camera.add(hud);

function layout() {
  const w = window.innerWidth, h = window.innerHeight, xr = renderer.xr.isPresenting;
  if (!xr) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
  }
  let aspect, fov, fill;
  if (xr) { aspect = 1.25; fov = 52; fill = 1; }
  else if (state.stereo) { aspect = (w / 2) / h; fov = CONFIG.STEREO_FOV_DEG; fill = 0.9; }
  else { aspect = w / h; fov = CONFIG.FOV_DEG; fill = 1; }
  if (!xr) {
    camera.fov = fov; camera.aspect = aspect; camera.updateProjectionMatrix();
    for (const cam of eyes) { cam.fov = fov; cam.aspect = aspect; cam.updateProjectionMatrix(); }
  }
  const D = CONFIG.HUD_DISTANCE, ph = 2 * D * Math.tan(fov * Math.PI / 360) * fill;
  hud.position.set(0, 0, -D);
  hud.scale.set(ph * aspect, ph, 1);
  const H = 900, W = Math.round(L.clamp(H * aspect, 700, 1800));
  if (hudCanvas.width !== W || hudCanvas.height !== H) { hudCanvas.width = W; hudCanvas.height = H; hudTex.dispose(); }
  state.lastHud = 0;
}
window.addEventListener("resize", layout);

function text(str, x, y, size, color, align, bold) {
  hctx.font = (bold ? "700 " : "600 ") + Math.round(size) + "px ui-monospace, Menlo, Consolas, monospace";
  hctx.textAlign = align; hctx.fillStyle = color; hctx.fillText(str, x, y);
}
function line(x1, y1, x2, y2) { hctx.beginPath(); hctx.moveTo(x1, y1); hctx.lineTo(x2, y2); hctx.stroke(); }
function plate(x, y, w, h, alpha) {
  hctx.save(); hctx.shadowBlur = 0; hctx.fillStyle = "rgba(0,0,0," + (alpha || 0.42) + ")"; hctx.fillRect(x, y, w, h); hctx.restore();
}
function bars(pct) { const k = Math.round(L.clamp(pct, 0, 100) / 25); return "|".repeat(k) + ".".repeat(4 - k); }
function telPanel(x, y, align, title, rows, u, w) {
  const h = u * 4 + rows.length * u * 6.6, left = align === "left" ? x - u : x - w + u;
  plate(left, y - u * 2.5, w, h);
  text(title, x, y, u * 1.6, COLORS.dim, align, true);
  rows.forEach(([label, value, level], i) => {
    const ry = y + u * 4 + i * u * 6.6;
    text(label, x, ry, u * 1.6, COLORS.dim, align);
    text(value, x, ry + u * 2.8, u * 2.6, LEVEL_COLOR[level || 0], align, true);
  });
}

const fwd = new THREE.Vector3(), upv = new THREE.Vector3(), headPos = new THREE.Vector3(), headQuat = new THREE.Quaternion(), eul = new THREE.Euler();
// اتجاه المستخدم على الأرض (يشتغل حتى لو ينظر لتحت مباشرة)
function groundHeading() {
  const gx = fwd.x - upv.x * fwd.y, gz = fwd.z - upv.z * fwd.y;
  return Math.atan2(gx, -gz); // 0 = شمال (-z)، ومع عقارب الساعة
}

function drawHud(now) {
  const W = hudCanvas.width, H = hudCanvas.height, u = H / 100, cx = W / 2, cy = H / 2;
  const view = state.phase === "TRANSIT" || state.phase === "DESCENT" ? state.targetAssessment : state.assessment;
  const level = state.phase === "TRANSIT" || state.phase === "DESCENT" ? (view ? view.level : -1) : state.level;
  hctx.clearRect(0, 0, W, H);
  hctx.lineWidth = Math.max(1.5, u * 0.35);
  hctx.textBaseline = "middle";
  hctx.shadowColor = "rgba(0,0,0,0.9)";
  hctx.shadowBlur = u * 0.6;

  // 1) الحكم على منطقة الهبوط
  let head, headColor;
  if (state.phase === "TRANSIT") { head = "MOVING TO LANDING ZONE"; headColor = LEVEL_COLOR[Math.max(0, level)]; }
  else if (state.phase === "DESCENT") { head = "DESCENDING  ALT " + Math.max(0, state.alt - CONFIG.EYE_HEIGHT).toFixed(0) + " m"; headColor = LEVEL_COLOR[Math.max(0, level)]; }
  else if (state.phase === "ASCENT") { head = "LIFT-OFF  ALT " + state.alt.toFixed(0) + " m"; headColor = COLORS.hud; }
  else if (state.phase === "SURFACE" && state.phaseTime < 5) { head = "TOUCHDOWN - YOU ARE ON MARS"; headColor = COLORS.hud; }
  else if (level < 0) { head = "NO TARGET - LOOK AT THE SURFACE"; headColor = COLORS.dim; }
  else { head = ["LANDING ZONE: SAFE", "LANDING ZONE: CAUTION", "UNSAFE - DO NOT LAND"][level]; headColor = LEVEL_COLOR[level]; }
  plate(cx - W * 0.36, H * 0.04, W * 0.72, H * 0.155, 0.4);
  text(head, cx, H * 0.08, u * 3.8, headColor, "center", true);
  let why = "";
  if (view && level >= 0) {
    why = view.reasons.length ? view.reasons.slice(0, 3).map(r => r.msg).join("  +  ")
      : "SLOPE " + view.slopeDeg.toFixed(0) + " DEG  -  NO ROCKS OVER " + Math.round(CONFIG.ROCK_HAZARD_M * 100) + " cm";
  }
  text(why, cx, H * 0.128, u * 2, level >= 0 ? LEVEL_COLOR[level] : COLORS.dim, "center", true);

  // 2) التوجيه: رسالة مؤقتة، أو أقرب موقع آمن، أو طريقة الهبوط
  let guide = "", guideColor = COLORS.warn;
  const sg = state.suggestion;
  if (state.message && now < state.messageUntil) { guide = state.message.text; guideColor = LEVEL_COLOR[state.message.level]; }
  else if (state.phase === "SURFACE") { guide = "LOOK UP AND HOLD TO LIFT OFF"; guideColor = COLORS.dim; }
  else if (state.phase === "HOVER" && level >= 1 && sg) {
    const side = Math.abs(sg.bearing) < 12 ? "AHEAD" : (sg.bearing < 0 ? "<< LEFT " : "RIGHT >> ") + Math.round(Math.abs(sg.bearing)) + " DEG";
    guide = "NEAREST SAFE SITE " + Math.round(sg.dist) + " m  " + side;
  } else if (state.phase === "HOVER" && level === 0) { guide = state.dwellEnabled ? "HOLD YOUR GAZE TO LAND" : "TAP TO LAND"; guideColor = COLORS.hud; }
  text(guide, cx, H * 0.17, u * 2, guideColor, "center", true);

  // 3) إنذار البدلة (الأخطر أولًا)
  const alarms = state.telStatus.alarms;
  if (alarms.length) {
    const a = alarms[0], blink = a.level === 2 && Math.floor(now / 400) % 2 === 0;
    if (!blink) text("!! " + a.msg + (alarms.length > 1 ? "  (+" + (alarms.length - 1) + ")" : ""), cx, H * 0.235, u * 3, LEVEL_COLOR[a.level], "center", true);
  }

  // 4) علامة النظر في المنتصف + خط الميلان + عدّاد تثبيت النظر
  hctx.save();
  hctx.translate(cx, cy);
  hctx.rotate(state.roll || 0);
  hctx.strokeStyle = COLORS.dim;
  line(-W * 0.2, 0, -W * 0.07, 0); line(W * 0.07, 0, W * 0.2, 0);
  hctx.restore();
  hctx.strokeStyle = level >= 0 ? LEVEL_COLOR[level] : COLORS.hud;
  line(cx - u * 5, cy, cx - u * 1.5, cy); line(cx + u * 1.5, cy, cx + u * 5, cy); line(cx, cy - u * 1.5, cx, cy + u * 1.5);
  const prog = state.phase === "SURFACE" ? state.liftDwell / CONFIG.LIFTOFF_SECONDS : state.dwell / CONFIG.DWELL_SECONDS;
  if (prog > 0.02) {
    hctx.save();
    hctx.lineWidth = u * 0.9;
    hctx.beginPath(); hctx.arc(cx, cy, u * 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, prog)); hctx.stroke();
    hctx.restore();
    text(state.phase === "SURFACE" ? "LIFT-OFF" : "LANDING", cx, cy + u * 10, u * 1.8, hctx.strokeStyle, "center", true);
  } else if (state.site && state.phase !== "TRANSIT" && state.phase !== "DESCENT") {
    text("RNG " + Math.round(state.site.t) + " m", cx, cy + u * 4.2, u * 1.7, COLORS.dim, "center");
  }

  // 5) لوحة مسح الموقع (يسار) ولوحة البدلة (يمين)
  const pw = Math.min(W * 0.25, u * 34), lv = view && level >= 0 ? view.lv : {};
  const val = (ok, s) => (ok ? s : "--");
  const has = !!(view && level >= 0);
  telPanel(W * 0.04, H * 0.31, "left", "LZ SCAN - SIM LIDAR", [
    ["SLOPE", val(has, has && view.slopeDeg.toFixed(1) + " DEG"), lv.slope],
    ["ROUGHNESS", val(has, has && Math.round(view.roughness * 100) + " cm"), lv.rough],
    ["TALLEST ROCK", val(has, has && Math.round(view.maxRock * 100) + " cm"), lv.rock],
    ["ROCK COVER", val(has, has && Math.round(view.cover * 100) + "%  (" + view.rockCount + ")"), Math.max(lv.cover || 0, 0)]
  ], u, pw);
  const t = state.tel, st = state.telStatus.st;
  const o2Left = t.o2Rate > 0 ? t.o2 / t.o2Rate : 0;
  const hhmm = mins => Math.floor(mins / 60) + ":" + String(Math.floor(mins % 60)).padStart(2, "0");
  telPanel(W * 0.96, H * 0.31, "right", "SUIT - SIM", [
    ["SUIT TEMP", t.suitTemp.toFixed(1) + "°C", st.suitTemp],
    ["SUIT PRESS", t.suitPress.toFixed(1) + " kPa", st.suitPress],
    ["O2 LEFT", Math.round(t.o2) + "%  " + hhmm(o2Left), st.o2],
    ["COMM", Math.round(t.comm) + "%  " + bars(t.comm), st.comm]
  ], u, pw);

  // 6) رادار خريطة المخاطر (أسفل يسار): الأعلى = اتجاه نظرك
  const mr = u * 10.5, mx = W * 0.04 + mr, my = H * 0.735, scale = mr / 80, heading = groundHeading();
  hctx.save();
  hctx.shadowBlur = 0;
  hctx.beginPath(); hctx.arc(mx, my, mr, 0, Math.PI * 2); hctx.clip();
  hctx.fillStyle = "rgba(0,0,0,0.5)"; hctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  hctx.translate(mx, my); hctx.rotate(-heading); hctx.scale(scale, scale);
  hctx.imageSmoothingEnabled = false;
  hctx.drawImage(hazardCanvas, -world.half - state.pos.x, -world.half - state.pos.z, world.size, world.size);
  const mark = (p, color, r) => { hctx.fillStyle = color; hctx.beginPath(); hctx.arc(p.x - state.pos.x, p.z - state.pos.z, r, 0, Math.PI * 2); hctx.fill(); };
  if (sg && state.phase === "HOVER" && level >= 1) mark(sg, "#ffffff", 4);
  const lz = state.target || state.site;
  if (lz) { hctx.strokeStyle = "#ffffff"; hctx.lineWidth = 1.6; hctx.beginPath(); hctx.arc(lz.x - state.pos.x, lz.z - state.pos.z, 7, 0, Math.PI * 2); hctx.stroke(); }
  hctx.restore();
  hctx.strokeStyle = COLORS.dim;
  hctx.beginPath(); hctx.arc(mx, my, mr, 0, Math.PI * 2); hctx.stroke();
  hctx.fillStyle = "#ffffff";
  hctx.beginPath(); hctx.moveTo(mx, my - u * 1.3); hctx.lineTo(mx - u * 0.8, my + u * 0.9); hctx.lineTo(mx + u * 0.8, my + u * 0.9); hctx.fill();
  text("HAZARD MAP 160 m", mx, my + mr + u * 1.6, u * 1.4, COLORS.dim, "center");

  // 7) بيئة المريخ (أسفل يمين)
  plate(W * 0.96 - pw + u, H * 0.72, pw, u * 13);
  text("MARS ENV - REF", W * 0.96, H * 0.745, u * 1.6, COLORS.dim, "right", true);
  text(t.extTemp.toFixed(0) + "°C", W * 0.96, H * 0.785, u * 2.4, COLORS.hud, "right", true);
  text(Math.round(t.extPress) + " Pa", W * 0.96, H * 0.825, u * 2.4, COLORS.hud, "right", true);

  // 8) معلومات أسفل الشاشة
  const hdg = ((heading * 180 / Math.PI) + 360) % 360;
  text(state.phase + "   ALT " + (state.phase === "SURFACE" ? "0" : state.alt.toFixed(0)) + " m   V/S " + state.vspeed.toFixed(1) + " m/s   HDG " + String(Math.round(hdg)).padStart(3, "0"),
    cx, H * 0.895, u * 2, COLORS.hud, "center", true);
  const ai = state.session ? "AI CAM " + state.ai.hazards.length + " OBJ  " + Math.round(state.ai.ms) + " ms" : "NO AI MODEL - LIDAR ONLY";
  text(ai + (state.autoDemo ? "   AUTO DEMO" : "") + "   LANDINGS " + state.landings, cx, H * 0.93, u * 1.7, COLORS.dim, "center");
  text("SIMULATED TERRAIN + TELEMETRY - VISUAL GUIDANCE ONLY, NOT VERIFIED NAVIGATION", cx, H * 0.962, u * 1.35, COLORS.dim, "center");
  hudTex.needsUpdate = true;
}

// =====================================================================
// موديل YOLO (اختياري): يحلل صورة المشهد من كاميرا افتراضية بنفس اتجاه الرأس
// =====================================================================
const ORT_OK = typeof ort !== "undefined";
if (ORT_OK) {
  ort.env.wasm.wasmPaths = window.ORT_LOCAL ? new URL("ort/", location.href).href : "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
  ort.env.wasm.numThreads = 1;
}
const aiCam = new THREE.PerspectiveCamera(CONFIG.AI_FOV_DEG, 1, 0.1, 7000); // تشوف الطبقة 0 فقط
let aiTarget = null, aiPixels = null;
const AI_MAX = 20, aiSprites = [];

function bracketTexture(color) {
  return canvasTexture(128, 128, (c, w) => {
    c.strokeStyle = color; c.lineWidth = 7;
    const m = 5, len = 34;
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, w - m, 1, -1], [w - m, w - m, -1, -1]]) {
      c.beginPath(); c.moveTo(x + dx * len, y); c.lineTo(x, y); c.lineTo(x, y + dy * len); c.stroke();
    }
  });
}
const bracketTex = LEVEL_COLOR.map(bracketTexture);
for (let i = 0; i < AI_MAX; i++) {
  const box = new THREE.Sprite(new THREE.SpriteMaterial({ map: bracketTex[0], depthTest: false, fog: false }));
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 256; labelCanvas.height = 40;
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, depthTest: false, fog: false }));
  for (const s of [box, label]) { s.layers.set(HUD_LAYER); s.renderOrder = 20; s.visible = false; scene.add(s); }
  aiSprites.push({ box, label, labelCanvas, labelTex, dist: 1 });
}

async function loadModel(buffer, label) {
  if (!ORT_OK) { setStatus(modelStatusEl, "مكتبة onnxruntime ما انحملت. تأكدوا إن مجلد ort موجود بجانب الصفحة.", "bad"); return; }
  try {
    const session = await ort.InferenceSession.create(buffer, { executionProviders: ["wasm"] });
    const probe = await detectInputSize(session);
    if (!probe) throw new Error("could not detect model input size");
    CONFIG.INPUT_SIZE = probe.size;
    if (aiTarget) aiTarget.dispose();
    aiTarget = new THREE.WebGLRenderTarget(probe.size, probe.size);
    aiTarget.texture.colorSpace = THREE.SRGBColorSpace;
    aiPixels = new Uint8Array(probe.size * probe.size * 4);
    state.session = session;
    const nc = probe.channels - 4;
    const warn = nc !== CONFIG.CLASS_NAMES.length ? " · تنبيه: الموديل فيه " + nc + " فئات، و CLASS_NAMES فيها " + CONFIG.CLASS_NAMES.length : "";
    setStatus(modelStatusEl, "الموديل جاهز: " + label + " · حجم الإدخال " + probe.size + warn, warn ? "bad" : "ok");
  } catch (e) {
    console.error(e);
    setStatus(modelStatusEl, IS_FILE ? FILE_MSG : "تعذر تحميل الموديل. تأكدوا إنه ملف ONNX مصدّر من النوتبوك.", "bad");
  }
}

// نجرب أحجام الإدخال الشائعة لين نلقى الحجم اللي صُدّر فيه الموديل
async function detectInputSize(session) {
  const sizes = [...new Set([CONFIG.INPUT_SIZE, 320, 416, 480, 512, 640])];
  for (const S of sizes) {
    try {
      const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", new Float32Array(3 * S * S), [1, 3, S, S]) };
      const out = (await session.run(feeds))[session.outputNames[0]];
      return { size: S, channels: Math.min(out.dims[1], out.dims[2]) };
    } catch (_) { /* not this size */ }
  }
  return null;
}

const NO_MODEL_MSG = "بدون موديل: التقييم يعتمد على مسح التضاريس فقط (الموديل اختياري)";
const IS_FILE = location.protocol === "file:";
const FILE_MSG = "الصفحة مفتوحة مباشرة من الملف، فالمشهد يشتغل لكن الموديل يحتاج تشغيل الصفحة عن طريق serve.py أو رابط GitHub Pages. ";
if (IS_FILE) setStatus(modelStatusEl, FILE_MSG + NO_MODEL_MSG, "");
else {
  fetch(CONFIG.MODEL_URL)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(buf => loadModel(buf, CONFIG.MODEL_URL))
    .catch(() => setStatus(modelStatusEl, "ما لقينا " + CONFIG.MODEL_URL + " بجانب الصفحة. " + NO_MODEL_MSG, ""));
}
$("modelFile").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  setStatus(modelStatusEl, "جاري تحميل " + f.name + "...");
  await loadModel(await f.arrayBuffer(), f.name);
});

const aiDir = new THREE.Vector3();
function aiCapture(now) {
  const ai = state.ai, S = CONFIG.INPUT_SIZE;
  ai.busy = true;
  const t0 = performance.now();
  // 1) نرسم المشهد (بدون HUD) من مكان واتجاه الرأس في صورة مربعة بحجم إدخال الموديل
  const pose = { pos: headPos.clone(), quat: headQuat.clone() };
  aiCam.position.copy(pose.pos); aiCam.quaternion.copy(pose.quat); aiCam.updateMatrixWorld();
  const xrOn = renderer.xr.enabled;
  renderer.xr.enabled = false;
  renderer.setRenderTarget(aiTarget);
  renderer.render(scene, aiCam);
  renderer.readRenderTargetPixels(aiTarget, 0, 0, S, S, aiPixels);
  renderer.setRenderTarget(null);
  renderer.xr.enabled = xrOn;
  // 2) نجهز الإدخال (الصورة المقروءة مقلوبة عموديًا)
  const input = new Float32Array(3 * S * S), plane = S * S;
  for (let y = 0; y < S; y++) {
    const src = (S - 1 - y) * S * 4, dst = y * S;
    for (let x = 0; x < S; x++) {
      const p = src + x * 4;
      input[dst + x] = aiPixels[p] / 255;
      input[plane + dst + x] = aiPixels[p + 1] / 255;
      input[2 * plane + dst + x] = aiPixels[p + 2] / 255;
    }
  }
  const feeds = { [state.session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, S, S]) };
  state.session.run(feeds).then(res => {
    const out = res[state.session.outputNames[0]];
    const dets = L.postprocess(out.data, out.dims, L.letterboxMeta(S, S, S), CONFIG);
    // 3) نحوّل كل مربع إلى موقع حقيقي على الأرض: خط من الكاميرا يمر بأسفل المربع
    const tanH = Math.tan(CONFIG.AI_FOV_DEG * Math.PI / 360), hazards = [];
    const ray = (nx, ny) => aiDir.set((nx * 2 - 1) * tanH, (1 - ny * 2) * tanH, -1).applyQuaternion(pose.quat).normalize();
    for (const d of dets) {
      if (hazards.length >= AI_MAX) break;
      const cxn = (d.x1 + d.x2) / 2, bh = d.y2 - d.y1;
      ray(cxn, d.y2 - bh * 0.12);
      const hit = L.raycastTerrain(world, pose.pos.x, pose.pos.y, pose.pos.z, aiDir.x, aiDir.y, aiDir.z, 500);
      if (!hit) continue;
      ray(cxn, (d.y1 + d.y2) / 2);
      const depth = hit.t;
      hazards.push({
        ...d, wx: hit.x, wz: hit.z, dist: depth, level: CONFIG.CLASS_RISK[d.name] ?? CONFIG.DEFAULT_RISK,
        center: pose.pos.clone().addScaledVector(aiDir, depth),
        w: (d.x2 - d.x1) * 2 * tanH * depth, h: bh * 2 * tanH * depth
      });
    }
    ai.hazards = hazards;
    aiSprites.forEach((s, i) => {
      const hz = hazards[i];
      s.box.visible = s.label.visible = !!hz && state.running;
      if (!hz) return;
      s.box.material.map = bracketTex[hz.level];
      s.box.position.copy(hz.center);
      s.box.scale.set(Math.max(hz.w, 0.2), Math.max(hz.h, 0.2), 1);
      const c = s.labelCanvas.getContext("2d");
      c.clearRect(0, 0, 256, 40);
      c.font = "700 22px ui-monospace, Menlo, Consolas, monospace";
      c.textBaseline = "middle"; c.textAlign = "center";
      c.shadowColor = "rgba(0,0,0,0.9)"; c.shadowBlur = 4;
      c.fillStyle = LEVEL_COLOR[hz.level];
      c.fillText(hz.name.toUpperCase() + " " + Math.round(hz.score * 100) + "% " + AI_LEVEL_NAME[hz.level], 128, 20);
      s.labelTex.needsUpdate = true;
      s.hz = hz;
    });
  }).catch(e => console.error(e)).finally(() => {
    ai.ms = performance.now() - t0;
    ai.busy = false;
    ai.nextAt = performance.now() + 120;
  });
}

function updateAiLabels() {
  for (const s of aiSprites) {
    if (!s.label.visible || !s.hz) continue;
    const d = headPos.distanceTo(s.hz.center), lh = d * 0.045;
    s.label.position.copy(s.hz.center).addScaledVector(upv, s.hz.h / 2 + lh * 0.8);
    s.label.scale.set(lh * 6.4, lh, 1);
  }
}

// =====================================================================
// التحكم: حركة الرأس (حساس الجوال / السحب بالماوس / نظارة WebXR) + اللمس + الكيبورد
// =====================================================================
const zee = new THREE.Vector3(0, 0, 1), devEuler = new THREE.Euler(), q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
window.addEventListener("deviceorientation", e => {
  if (e.alpha == null || e.beta == null || renderer.xr.isPresenting) return;
  state.gyro = true;
  const orient = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
  devEuler.set(e.beta * Math.PI / 180, e.alpha * Math.PI / 180, -e.gamma * Math.PI / 180, "YXZ");
  camera.quaternion.setFromEuler(devEuler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -orient));
});

function say(textStr, level, seconds) {
  state.message = { text: textStr, level };
  state.messageUntil = performance.now() + (seconds || 3) * 1000;
}

function setPhase(p) { state.phase = p; state.phaseTime = 0; state.dwell = 0; state.liftDwell = 0; state.dwellAnchor = null; }

// الزر الرئيسي: هبوط على الموقع اللي تنظر له / إلغاء الهبوط / إقلاع
function action() {
  if (!state.running) return;
  if (state.phase === "HOVER") {
    if (!state.site || state.level < 0) { say("NO TARGET - LOOK AT THE SURFACE", 1); return; }
    if (state.level === 2 && !CONFIG.ALLOW_UNSAFE_LANDING) { say("NO-GO: SITE UNSAFE - SELECT ANOTHER SITE", 2, 4); buzz(120); return; }
    state.target = { x: state.site.x, z: state.site.z };
    state.targetAssessment = state.assessment;
    say(state.level === 1 ? "LANDING WITH CAUTION" : "LANDING SITE LOCKED", state.level, 3);
    setPhase("TRANSIT");
  } else if (state.phase === "TRANSIT" || state.phase === "DESCENT") {
    say("LANDING ABORTED", 1);
    state.target = null;
    setPhase("ASCENT");
  } else if (state.phase === "SURFACE") {
    say("LIFT-OFF", 0);
    state.target = null;
    setPhase("ASCENT");
  }
}

function buzz(ms) { if (navigator.vibrate) navigator.vibrate(ms); }
function cycleFault() {
  const t = state.tel;
  if (!t.leak && !t.commLoss) t.leak = true;
  else if (!t.commLoss) t.commLoss = true;
  else state.tel = L.initTelemetry(CONFIG);
  buzz(60);
}

let lastTap = 0, down = null;
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, t: performance.now(), moved: 0 }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", e => {
  if (!down) return;
  const dx = e.clientX - down.px, dy = e.clientY - down.py;
  down.px = e.clientX; down.py = e.clientY;
  down.moved = Math.max(down.moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
  if (down.moved < 8) return;
  const k = (camera.fov * Math.PI / 180) / window.innerHeight; // السحب يحرك المشهد مع الإصبع
  if (state.gyro || renderer.xr.isPresenting) state.yawOffset += dx * k;
  else { state.yaw += dx * k; state.pitch = L.clamp(state.pitch + dy * k, -1.55, 1.55); }
});
canvas.addEventListener("pointerup", () => {
  if (!down) return;
  const now = performance.now(), held = now - down.t, moved = down.moved;
  down = null;
  if (moved >= 12) return;
  if (held > 700) { cycleFault(); lastTap = 0; return; }
  if (now - lastTap < 350) { stop(); return; }
  lastTap = now;
  action();
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && state.running && state.stereo && !renderer.xr.isPresenting) stop();
});
document.addEventListener("keydown", e => {
  if (!state.running) return;
  const k = e.key.toLowerCase(), t = state.tel;
  state.keys.add(k);
  if (k === "escape") stop();
  else if (k === " " || k === "enter") { e.preventDefault(); if (!e.repeat) action(); }
  else if (k === "1") t.leak = !t.leak;
  else if (k === "2") t.commLoss = !t.commLoss;
  else if (k === "0") state.tel = L.initTelemetry(CONFIG);
  else if (k === "h") applyOverlay(!state.overlay);
  else if (k.startsWith("arrow")) e.preventDefault();
});
document.addEventListener("keyup", e => state.keys.delete(e.key.toLowerCase()));
for (const i of [0, 1]) {
  const ctrl = renderer.xr.getController(i);
  ctrl.addEventListener("select", action);
  ctrl.addEventListener("squeeze", cycleFault);
  rig.add(ctrl);
}

// =====================================================================
// التشغيل والإيقاف
// =====================================================================
async function start(mode) {
  if (!state.ready) return;
  state.stereo = $("vrMode").checked && mode !== "xr";
  state.dwellEnabled = $("gazeLand").checked;
  state.autoDemo = $("autoDemo").checked;
  // iPhone يطلب إذن حساس الحركة
  if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
    try { await DeviceOrientationEvent.requestPermission(); } catch (_) {}
  }
  if (mode === "xr") {
    try {
      const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local"] });
      renderer.xr.enabled = true;
      await renderer.xr.setSession(session);
      session.addEventListener("end", () => { renderer.xr.enabled = false; if (state.running) stop(); });
      state.xr = true;
    } catch (e) {
      console.error(e);
      setStatus(statusEl, "ما قدرنا ندخل وضع WebXR على هذا الجهاز. جربوا \"ابدأ الرحلة\" مع العرض المزدوج.", "bad");
      return;
    }
  } else if (state.stereo) {
    try { await document.documentElement.requestFullscreen(); } catch (_) {}
    try { await screen.orientation.lock("landscape"); } catch (_) {}
  }
  try { state.wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {}

  $("menu").style.display = "none";
  canvas.style.display = "block";
  Object.assign(state, {
    phase: "HOVER", phaseTime: 0, pos: { x: 0, z: 0 }, alt: CONFIG.HOVER_ALT, vspeed: 0, groundY: L.heightAt(world, 0, 0),
    yaw: 0, pitch: -0.6, yawOffset: 0, site: null, assessment: null, level: -1, target: null, targetAssessment: null,
    suggestion: null, dwell: 0, liftDwell: 0, dwellAnchor: null, message: null, dust: 0, demoT: 0, landings: 0,
    tel: L.initTelemetry(CONFIG), running: true, lastFrame: performance.now(), lastHud: 0
  });
  stabilize = L.makeStabilizer(CONFIG.STABLE_FRAMES, -1);
  applyOverlay($("overlay").checked);
  layout();
  say("HOVERING OVER MARS - LOOK AROUND TO SCAN", 0, 5);
  renderer.setAnimationLoop(frame);
}

function stop() {
  if (!state.running) return;
  state.running = false;
  renderer.setAnimationLoop(null);
  const xrSession = renderer.xr.getSession();
  if (xrSession) xrSession.end().catch(() => {});
  state.xr = false;
  if (state.wakeLock) state.wakeLock.release().catch(() => {});
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  for (const s of aiSprites) s.box.visible = s.label.visible = false;
  state.ai.hazards = [];
  state.keys.clear();
  canvas.style.display = "none";
  $("menu").style.display = "flex";
}

$("btnStart").onclick = () => start("screen");
$("btnXR").onclick = () => start("xr");
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported("immersive-vr").then(ok => { if (ok) $("btnXR").style.display = "block"; }).catch(() => {});
}

// =====================================================================
// الحلقة الرئيسية
// =====================================================================
const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(1, 1, 1);
const upY = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), q2 = new THREE.Quaternion();

function updateFlight(dt) {
  const C = CONFIG, lim = world.half - 30;
  state.phaseTime += dt;
  let alt0 = state.alt;
  if (state.phase === "HOVER") {
    // تحريك بالكيبورد نسبةً لاتجاه النظر
    const k = state.keys, f = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    const r = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    if (f || r) {
      const h = groundHeading(), sp = C.MOVE_SPEED * dt / Math.hypot(f, r);
      state.pos.x += (Math.sin(h) * f + Math.cos(h) * r) * sp;
      state.pos.z += (-Math.cos(h) * f + Math.sin(h) * r) * sp;
    }
    state.alt += (C.HOVER_ALT - state.alt) * Math.min(1, dt * 2);
  } else if (state.phase === "TRANSIT") {
    const dx = state.target.x - state.pos.x, dz = state.target.z - state.pos.z, d = Math.hypot(dx, dz);
    const sp = Math.min(C.TRANSIT_SPEED, d * 1.2 + 1.5, 2 + state.phaseTime * 8) * dt;
    if (d <= sp || d < 0.2) { state.pos.x = state.target.x; state.pos.z = state.target.z; setPhase("DESCENT"); }
    else { state.pos.x += dx / d * sp; state.pos.z += dz / d * sp; }
  } else if (state.phase === "DESCENT") {
    const rate = L.clamp((state.alt - C.EYE_HEIGHT) * 0.4, 0.7, Math.min(C.MAX_DESCENT_RATE, 1 + state.phaseTime * 5));
    state.alt -= rate * dt;
    if (state.alt <= C.EYE_HEIGHT) {
      state.alt = C.EYE_HEIGHT; state.landings++; state.dust = 1; state.target = null;
      setPhase("SURFACE"); buzz(200);
    }
  } else if (state.phase === "ASCENT") {
    const rate = L.clamp((C.HOVER_ALT - state.alt) * 0.5 + 0.5, 0.5, Math.min(12, 1 + state.phaseTime * 6));
    state.alt += rate * dt;
    if (state.alt >= C.HOVER_ALT - 0.3) setPhase("HOVER");
  }
  state.pos.x = L.clamp(state.pos.x, -lim, lim); state.pos.z = L.clamp(state.pos.z, -lim, lim);
  const g = L.heightAt(world, state.pos.x, state.pos.z);
  // على السطح نتبع الأرض مباشرة، وفي الجو ننعّم التغير
  state.groundY = state.phase === "SURFACE" ? g : state.groundY + (g - state.groundY) * Math.min(1, dt * 3);
  state.vspeed = dt > 0 ? (state.alt - alt0) / dt : 0;
  rig.position.set(state.pos.x, state.groundY + state.alt, state.pos.z);
  rig.rotation.y = state.yawOffset;
  if (!state.gyro && !renderer.xr.isPresenting) camera.rotation.set(state.pitch, state.yaw, 0, "YXZ");
}

function updateScan(dt, now) {
  camera.updateWorldMatrix(true, false);
  camera.getWorldPosition(headPos);
  camera.getWorldQuaternion(headQuat);
  fwd.set(0, 0, -1).applyQuaternion(headQuat);
  upv.set(0, 1, 0).applyQuaternion(headQuat);
  eul.setFromQuaternion(headQuat, "YXZ");
  state.roll = -eul.z;

  // 1) وين ينظر المستخدم على الأرض؟ + تقييم الموقع
  const hit = L.raycastTerrain(world, headPos.x, headPos.y, headPos.z, fwd.x, fwd.y, fwd.z, 450);
  let a = hit ? L.assessSite(world, hit.x, hit.z, CONFIG) : null;
  if (a && a.level < 0) a = null;
  if (a) a = L.applyAiToVerdict(a, state.ai.hazards, hit, CONFIG);
  state.site = a ? hit : null;
  state.assessment = a;
  state.level = stabilize(a ? a.level : -1);
  if (a && a.level !== state.level) state.assessment = a = { ...a, level: state.level < 0 ? a.level : state.level };

  // 2) أقرب موقع آمن (لو الموقع الحالي مو آمن)
  if (now >= state.nextSuggestAt) {
    state.nextSuggestAt = now + 250;
    const sg = state.site && state.level >= 1 ? L.nearestSafe(hmap, state.site.x, state.site.z, CONFIG.SAFE_SEARCH_M) : null;
    if (sg) {
      const h = groundHeading(), b = Math.atan2(sg.x - state.pos.x, -(sg.z - state.pos.z)) - h;
      sg.bearing = Math.atan2(Math.sin(b), Math.cos(b)) * 180 / Math.PI;
    }
    state.suggestion = sg;
    if (sg && state.phase === "HOVER") suggestRing.place(sg.x, sg.z); else suggestRing.group.visible = false;
  }

  // 3) علامات الموقع في المشهد
  const locked = state.phase === "TRANSIT" || state.phase === "DESCENT";
  const lz = locked ? state.target : state.site, la = locked ? state.targetAssessment : a;
  const tooClose = state.phase === "SURFACE" && lz && lz.t < 9; // على السطح: ما نغطي الأرض تحت رجلك
  if (lz && la && state.phase !== "ASCENT" && !tooClose) {
    const hex = LEVEL_HEX[Math.max(0, la.level)];
    lzRing.setColor(hex);
    lzRing.place(lz.x, lz.z);
    beam.visible = true;
    beam.material.color.setHex(hex);
    beam.position.set(lz.x, L.heightAt(world, lz.x, lz.z), lz.z);
    const hr = la.hazardRocks || [];
    rockMarkers.count = Math.min(16, hr.length);
    for (let i = 0; i < rockMarkers.count; i++) {
      const rk = hr[i], bob = 0.12 * Math.sin(now / 250 + i);
      m4.compose(v3.set(rk.x, rk.y + rk.h + 0.7 + bob, rk.z), q.identity(), s3.setScalar(1 + rk.h * 0.5));
      rockMarkers.setMatrixAt(i, m4);
      rockMarkers.setColorAt(i, tmpColor.setHex(LEVEL_HEX[rk.h >= CONFIG.ROCK_UNSAFE_M ? 2 : 1]));
    }
    rockMarkers.instanceMatrix.needsUpdate = true;
    if (rockMarkers.instanceColor) rockMarkers.instanceColor.needsUpdate = true;
  } else {
    lzRing.group.visible = false; beam.visible = false; rockMarkers.count = 0;
  }

  // 4) الهبوط بتثبيت النظر، والإقلاع برفع الرأس
  if (state.phase === "HOVER" && state.dwellEnabled && state.site && state.level >= 0 && state.level < 2 && state.phaseTime > 2.5) {
    const tol = Math.max(3, state.site.t * 0.05), an = state.dwellAnchor;
    if (an && Math.hypot(state.site.x - an.x, state.site.z - an.z) <= tol) state.dwell += dt;
    else { state.dwellAnchor = { x: state.site.x, z: state.site.z }; state.dwell = 0; }
    if (state.dwell >= CONFIG.DWELL_SECONDS) action();
  } else if (state.phase === "HOVER") { state.dwell = 0; state.dwellAnchor = null; }
  if (state.phase === "SURFACE" && state.dwellEnabled && state.phaseTime > 3) {
    const pitchDeg = Math.asin(L.clamp(fwd.y, -1, 1)) * 180 / Math.PI;
    state.liftDwell = pitchDeg > CONFIG.LIFTOFF_LOOK_UP_DEG ? state.liftDwell + dt : 0;
    if (state.liftDwell >= CONFIG.LIFTOFF_SECONDS) action();
  }
}
const tmpColor = new THREE.Color();

function updateWorldFx(dt) {
  sky.position.copy(rig.position);
  // غبار الهبوط: الضباب يقرب لحظة ملامسة السطح ثم ينقشع
  state.dust = Math.max(0, state.dust - dt / 3.5);
  const d = state.dust * state.dust;
  scene.fog.near = 120 + (1.5 - 120) * d;
  scene.fog.far = 1700 + (45 - 1700) * d;
  // ظل المركبة في الجو، وظل رائد الفضاء على السطح
  const onGround = state.alt < 4, len = CONFIG.EYE_HEIGHT / Math.tan(SUN_EL);
  const sx = state.pos.x + (onGround ? shadowDir.x * len * 0.5 : 0), sz = state.pos.z + (onGround ? shadowDir.y * len * 0.5 : 0);
  const gy = L.heightAt(world, sx, sz), gx1 = L.heightAt(world, sx + 0.6, sz), gz1 = L.heightAt(world, sx, sz + 0.6);
  if (Number.isNaN(gy) || Number.isNaN(gx1) || Number.isNaN(gz1)) { selfShadow.visible = false; return; }
  selfShadow.visible = true;
  nrm.set(-(gx1 - gy) / 0.6, 1, -(gz1 - gy) / 0.6).normalize();
  q.setFromUnitVectors(upY, nrm).multiply(q2.setFromAxisAngle(upY, Math.atan2(-shadowDir.y, shadowDir.x)));
  selfShadow.position.set(sx, gy + 0.04, sz);
  selfShadow.quaternion.copy(q);
  if (onGround) selfShadow.scale.set(len * 0.5, 1, 0.33); else selfShadow.scale.set(2.6, 1, 2.6);
  selfShadow.material.opacity = onGround ? 0.45 : 0.4 * L.clamp(1.2 - state.alt / 90, 0.25, 1);
}

function frame(nowArg) {
  if (!state.running) return;
  const now = performance.now(), dt = Math.min(0.1, (now - state.lastFrame) / 1000);
  state.lastFrame = now;

  if (state.autoDemo) {
    state.demoT += dt;
    const f = L.demoFaults(state.demoT, CONFIG);
    if (state.tel.leak && !f.leak) state.tel = L.initTelemetry(CONFIG);
    state.tel.leak = f.leak; state.tel.commLoss = f.commLoss;
  }
  L.stepTelemetry(state.tel, dt, CONFIG);
  state.telStatus = L.telemetryStatus(state.tel, CONFIG);

  updateFlight(dt);
  updateScan(dt, now);
  updateWorldFx(dt);
  updateAiLabels();
  if (now - state.lastHud >= 1000 / CONFIG.HUD_FPS) { state.lastHud = now; drawHud(now); }
  if (state.session && !state.ai.busy && now >= state.ai.nextAt) aiCapture(now);

  if (renderer.xr.isPresenting) {
    renderer.render(scene, camera);
  } else if (state.stereo) {
    const w = window.innerWidth, h = window.innerHeight, ew = w / 2; // three يضرب في دقة الشاشة تلقائيًا
    renderer.setScissorTest(true);
    eyes.forEach((cam, i) => {
      renderer.setViewport(i * ew, 0, ew, h);
      renderer.setScissor(i * ew, 0, ew, h);
      renderer.render(scene, cam);
    });
    renderer.setScissorTest(false);
  } else {
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.render(scene, camera);
  }
}

// =====================================================================
// التجهيز عند فتح الصفحة
// =====================================================================
setTimeout(() => {
  try {
    const t0 = performance.now();
    world = L.buildWorld(CONFIG);
    hmap = L.buildHazardMap(world, CONFIG);
    buildScene();
    state.world = world; state.hmap = hmap;
    state.ready = true;
    const total = hmap.n * hmap.n - hmap.counts[3], pct = i => Math.round(hmap.counts[i] / total * 100) + "%";
    setStatus(statusEl, "سطح المريخ جاهز · آمن " + pct(0) + " · حذر " + pct(1) + " · غير آمن " + pct(2) + " · " + world.rocks.length + " صخرة · " + Math.round(performance.now() - t0) + " ms", "ok");
    $("btnStart").disabled = false;
  } catch (e) {
    console.error(e);
    setStatus(statusEl, "تعذر تجهيز المشهد ثلاثي الأبعاد. تأكدوا إن المتصفح يدعم WebGL وإن مجلد lib موجود بجانب الصفحة.", "bad");
  }
}, 30);
})();
