// =====================================================================
// Mars Landing VR - المنطق (بدون رسم): الإعدادات، توليد التضاريس، تقييم أمان الهبوط،
// قراءات البدلة، ومعالجة مخرجات موديل YOLO.
// هذا الملف يشتغل في المتصفح وفي Node (للاختبار: node tests/test_logic.js)
// =====================================================================

// =====================================================================
// الإعدادات - هذا الجزء الوحيد اللي تحتاجون تعدلونه
// =====================================================================
const CONFIG = {
  // ---- عالم المريخ (تضاريس مولّدة بالحاسب، مو خريطة حقيقية) ----
  SEED: 2031,               // غيّروا الرقم = تضاريس مختلفة (نفس الرقم يعطي نفس العالم كل مرة)
  WORLD_SIZE: 400,          // طول ضلع منطقة المسح بالمتر
  GRID: 320,                // عدد خلايا شبكة الارتفاعات في كل ضلع (الخلية = 1.25 م)
  CRATER_COUNT: 34,
  ROCK_TRIES: 12000,        // كل ما زاد الرقم زادت الصخور (وزاد الحمل على الجوال)

  // ---- تقييم منطقة الهبوط ----
  // قيم مرجعية للعرض (مصادرها في README)، مو معايير مهمة معتمدة:
  LZ_DIAMETER: 10,          // قطر دائرة الهبوط بالمتر
  SLOPE_CAUTION_DEG: 5,     // ALHAT: كشف الميل من 5 درجات
  SLOPE_UNSAFE_DEG: 15,     // InSight: الميل أقل من 15 درجة
  ROUGH_CAUTION_M: 0.30,    // ALHAT: خشونة السطح من 30 سم
  ROUGH_UNSAFE_M: 0.60,
  ROCK_HAZARD_M: 0.30,      // ALHAT: الصخرة من 30 سم تعتبر خطر
  ROCK_UNSAFE_M: 0.50,      // صخرة بهذا الارتفاع أو أكثر = غير آمن
  ROCK_COVER_CAUTION: 0.05, // نسبة تغطية الصخور لدائرة الهبوط
  ROCK_COVER_UNSAFE: 0.10,  // InSight: تغطية الصخور أقل من 10%
  HAZARD_CELL: 2.5,         // دقة خريطة المخاطر بالمتر
  STABLE_FRAMES: 5,         // نفس القرار يتكرر كم مرة قبل ما يتغير على الشاشة (يمنع الرجفة)
  SAFE_SEARCH_M: 150,       // أبعد مسافة للبحث عن أقرب موقع آمن

  // ---- الطيران ----
  HOVER_ALT: 60,            // ارتفاع التحليق فوق السطح بالمتر
  EYE_HEIGHT: 1.8,          // ارتفاع العين بعد الهبوط
  TRANSIT_SPEED: 14,        // م/ث أثناء الانتقال فوق موقع الهبوط
  MAX_DESCENT_RATE: 9,      // م/ث
  MOVE_SPEED: 18,           // م/ث للتحريك بالكيبورد أثناء التحليق
  DWELL_SECONDS: 4,         // ثبّت نظرك على موقع كم ثانية عشان يبدأ الهبوط
  LIFTOFF_LOOK_UP_DEG: 40,  // على السطح: ارفع راسك فوق هذي الزاوية عشان تقلع
  LIFTOFF_SECONDS: 3,
  ALLOW_UNSAFE_LANDING: false, // لو true يسمح بالهبوط حتى في المواقع الحمراء

  // ---- موديل YOLO (اختياري): يشتغل على صورة المشهد الافتراضي ----
  MODEL_URL: "best.onnx",
  INPUT_SIZE: 416,                   // الصفحة تكتشف الحجم الصحيح من الموديل تلقائيًا
  CLASS_NAMES: ["boulder", "rocks"], // نفس ترتيب الموديل
  CONF_THRESHOLD: 0.35,
  IOU_THRESHOLD: 0.45,
  CLASS_RISK: { boulder: 2, rocks: 1 }, // 0 منخفض، 1 حذر، 2 عالي
  DEFAULT_RISK: 1,
  AI_FOV_DEG: 70,                    // زاوية الكاميرا الافتراضية اللي يشوف منها الموديل
  AI_AFFECTS_VERDICT: true,          // لو الموديل كشف جسم عالي الخطورة داخل دائرة الهبوط يرفع التقييم إلى "حذر"

  // ---- قراءات محاكاة (ما فيه حساسات حقيقية) ----
  SIM_SPEED: 30,
  MARS_TEMP_C: -63,         // متوسط حرارة سطح المريخ (مرجعي)
  MARS_PRESS_PA: 610,       // متوسط ضغط سطح المريخ (مرجعي)
  SUIT_TEMP_C: 22,
  SUIT_PRESS_KPA: 29.6,     // ضغط تشغيل بدلة NASA EMU (4.3 psi)
  O2_CAPACITY_MIN: 480,
  SUIT_PRESS_CAUTION: 27, SUIT_PRESS_DANGER: 24, // حدود للعرض فقط
  O2_CAUTION: 30, O2_DANGER: 15,
  COMM_CAUTION: 40, COMM_DANGER: 15,
  LEAK_KPA_PER_S: 0.12,
  LEAK_O2_FACTOR: 8,
  DEMO_CYCLE_S: 120,

  // ---- العرض ----
  FOV_DEG: 75,              // زاوية الرؤية في العرض العادي
  STEREO_FOV_DEG: 85,       // زاوية الرؤية لكل عين في العرض المزدوج
  IPD: 0.064,               // المسافة بين العينين بالمتر
  HUD_DISTANCE: 3,          // بُعد لوحة الـ HUD عن العين بالمتر
  HUD_FPS: 15               // كم مرة تتحدث لوحة الـ HUD في الثانية
};

const LEVEL_NAME = ["SAFE", "CAUTION", "UNSAFE"];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function smoothstep(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

// =====================================================================
// أرقام عشوائية ثابتة (نفس SEED = نفس العالم)
// =====================================================================
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// value noise ناعم بين 0 و 1
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x, z, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x, z, seed + o * 17);
    norm += amp;
    x *= 2.03; z *= 2.03; amp *= 0.5;
  }
  return sum / norm;
}

// =====================================================================
// توليد عالم المريخ: تلال + سهول ناعمة + مناطق وعرة + فوهات + صخور
// =====================================================================

// التضاريس الواسعة فقط (تُستخدم أيضًا للأرض البعيدة خارج منطقة المسح)
function baseHeight(x, z, seed) {
  return (vnoise(x / 260 + 31.7, z / 260 - 12.3, seed) - 0.5) * 14;
}

// 0 = سهل ناعم، 1 = منطقة وعرة
function roughMask(x, z, seed) {
  return smoothstep(0.33, 0.6, fbm(x / 150 + 5.1, z / 150 + 9.4, 2, seed + 101));
}

function craterDelta(c, x, z) {
  const d = Math.hypot(x - c.x, z - c.z) / c.r;
  if (d >= 2.2) return 0;
  const rim = c.rim * Math.exp(-((d - 1) * (d - 1)) / (2 * 0.2 * 0.2));
  const bowl = d < 1 ? c.depth * (d * d - 1) : 0;
  return bowl + rim;
}

function buildWorld(cfg) {
  const seed = cfg.SEED, N = cfg.GRID, size = cfg.WORLD_SIZE, half = size / 2, cell = size / N;
  const rnd = mulberry32(seed);

  // الفوهات: كثير صغيرة وقليل كبيرة
  const craters = [];
  for (let i = 0; i < cfg.CRATER_COUNT; i++) {
    const r = clamp(3 / Math.pow(0.012 + rnd() * 0.988, 0.55), 3, 30);
    const c = {
      x: (rnd() - 0.5) * (size - 90), z: (rnd() - 0.5) * (size - 90), r,
      depth: r * (0.16 + rnd() * 0.2), rim: r * (0.03 + rnd() * 0.04)
    };
    // نخلي نقطة البداية (المنتصف) خارج الفوهات
    if (Math.hypot(c.x, c.z) < c.r * 1.6 + 8) { i--; continue; }
    craters.push(c);
  }

  const n1 = N + 1;
  const heights = new Float32Array(n1 * n1), rough = new Float32Array(n1 * n1);
  let minH = Infinity, maxH = -Infinity;
  for (let iz = 0; iz < n1; iz++) {
    for (let ix = 0; ix < n1; ix++) {
      const x = -half + ix * cell, z = -half + iz * cell;
      // عند الحواف نرجع تدريجيًا للتضاريس الواسعة عشان تتصل بالأرض البعيدة
      const edge = smoothstep(0, 40, half - Math.max(Math.abs(x), Math.abs(z)));
      const rg = roughMask(x, z, seed);
      let h = baseHeight(x, z, seed);
      h += edge * (fbm(x / 45, z / 45, 3, seed + 7) - 0.5) * 2 * (0.35 + 3.4 * rg);
      h += edge * (vnoise(x / 6, z / 6, seed + 53) - 0.5) * (0.05 + 0.45 * rg);
      h += edge * (vnoise(x / 2.2, z / 2.2, seed + 71) - 0.5) * (0.02 + 0.10 * rg);
      let cr = 0;
      for (const c of craters) cr += craterDelta(c, x, z);
      h += edge * cr;
      const i = iz * n1 + ix;
      heights[i] = h; rough[i] = rg;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  const world = { cfg, seed, N, n1, size, half, cell, heights, rough, craters, minH, maxH, rocks: [], rockCell: 8 };

  // الصخور: كثيرة في المناطق الوعرة وحول حواف الفوهات، وقليلة في السهول
  const rocks = world.rocks;
  const addRock = (x, z) => {
    if (Math.abs(x) > half - 6 || Math.abs(z) > half - 6) return;
    const r = Math.min(1.9, 0.08 / Math.pow(0.006 + rnd() * 0.994, 0.625)); // نصف القطر الأفقي
    const h = r * (0.55 + rnd() * 0.55);                                    // الارتفاع فوق الأرض
    rocks.push({ x, z, r, h, y: heightAt(world, x, z), rot: rnd() * 6.283, sx: 0.85 + rnd() * 0.3, sz: 0.85 + rnd() * 0.3, tint: rnd() });
  };
  for (let i = 0; i < cfg.ROCK_TRIES; i++) {
    const x = (rnd() - 0.5) * size, z = (rnd() - 0.5) * size;
    const rg = roughMask(x, z, seed);
    if (rnd() < 0.02 + 0.95 * Math.pow(rg, 1.5)) addRock(x, z);
  }
  for (const c of craters) {
    const k = Math.round(c.r * 3);
    for (let i = 0; i < k; i++) {
      const a = rnd() * 6.283, d = c.r * (0.9 + rnd() * rnd() * 1.1);
      addRock(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d);
    }
  }

  // شبكة بحث سريعة عن الصخور القريبة
  const gc = world.rockCell, gn = Math.ceil(size / gc);
  world.rockGridN = gn;
  world.rockGrid = Array.from({ length: gn * gn }, () => []);
  rocks.forEach((rk, i) => {
    const gx = clamp(Math.floor((rk.x + half) / gc), 0, gn - 1), gz = clamp(Math.floor((rk.z + half) / gc), 0, gn - 1);
    world.rockGrid[gz * gn + gx].push(i);
  });
  return world;
}

// ارتفاع الأرض عند أي نقطة (NaN خارج منطقة المسح)
function heightAt(world, x, z) {
  const fx = (x + world.half) / world.cell, fz = (z + world.half) / world.cell;
  if (!(fx >= 0 && fz >= 0 && fx <= world.N && fz <= world.N)) return NaN;
  const ix = Math.min(world.N - 1, Math.floor(fx)), iz = Math.min(world.N - 1, Math.floor(fz));
  const tx = fx - ix, tz = fz - iz, n1 = world.n1, i = iz * n1 + ix, H = world.heights;
  const a = H[i], b = H[i + 1], c = H[i + n1], d = H[i + n1 + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

function rocksNear(world, x, z, radius) {
  const gc = world.rockCell, gn = world.rockGridN, reach = radius + 2;
  const x0 = clamp(Math.floor((x - reach + world.half) / gc), 0, gn - 1), x1 = clamp(Math.floor((x + reach + world.half) / gc), 0, gn - 1);
  const z0 = clamp(Math.floor((z - reach + world.half) / gc), 0, gn - 1), z1 = clamp(Math.floor((z + reach + world.half) / gc), 0, gn - 1);
  const out = [];
  for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
    for (const i of world.rockGrid[gz * gn + gx]) {
      const rk = world.rocks[i];
      if (Math.hypot(rk.x - x, rk.z - z) < radius + rk.r) out.push(rk);
    }
  }
  return out;
}

// =====================================================================
// تقييم منطقة الهبوط: قواعد واضحة تنشرح في العرض
//   نأخذ عينات ارتفاع داخل دائرة الهبوط (مثل مسح ليدار) ونحسب:
//   1) الميل: نطابق مستوى (plane) على العينات، وزاويته = ميل الموقع
//   2) الخشونة: أكبر فرق بين الأرض والمستوى المطابق
//   3) الصخور: أعلى صخرة داخل الدائرة + نسبة المساحة اللي تغطيها الصخور
//   4) الفوهات: الموقع داخل فوهة أو على حافتها = حذر على الأقل
//   التقييم النهائي = أسوأ مستوى بين هذي المعايير (0 آمن، 1 حذر، 2 غير آمن)
// =====================================================================
function levelOf(v, caution, unsafe) { return v >= unsafe ? 2 : v >= caution ? 1 : 0; }

function assessSite(world, x, z, cfg) {
  const R = cfg.LZ_DIAMETER / 2, step = 1;
  let n = 0, sh = 0, sxh = 0, szh = 0, sxx = 0, szz = 0;
  const samples = [];
  for (let dz = -R; dz <= R + 1e-9; dz += step) {
    for (let dx = -R; dx <= R + 1e-9; dx += step) {
      if (dx * dx + dz * dz > R * R) continue;
      const h = heightAt(world, x + dx, z + dz);
      if (Number.isNaN(h)) return { level: -1, noData: true, reasons: [] };
      samples.push(dx, dz, h);
      n++; sh += h; sxh += dx * h; szh += dz * h; sxx += dx * dx; szz += dz * dz;
    }
  }
  // العينات متماثلة حول المركز، فمعاملات المستوى تنحسب مباشرة
  const a = sxh / sxx, b = szh / szz, c = sh / n;
  const slopeDeg = Math.atan(Math.hypot(a, b)) * 180 / Math.PI;
  let roughness = 0;
  for (let i = 0; i < samples.length; i += 3) {
    roughness = Math.max(roughness, Math.abs(samples[i + 2] - (a * samples[i] + b * samples[i + 1] + c)));
  }

  const near = rocksNear(world, x, z, R);
  let maxRock = 0, rockCount = 0, rockArea = 0;
  const hazardRocks = [];
  for (const rk of near) {
    maxRock = Math.max(maxRock, rk.h);
    if (Math.hypot(rk.x - x, rk.z - z) <= R) rockArea += Math.PI * rk.r * rk.r;
    if (rk.h >= cfg.ROCK_HAZARD_M) { rockCount++; hazardRocks.push(rk); }
  }
  const cover = Math.min(1, rockArea / (Math.PI * R * R));

  let crater = false;
  for (const cr of world.craters) if (Math.hypot(x - cr.x, z - cr.z) < cr.r * 1.15 + R * 0.5) { crater = true; break; }

  const lv = {
    slope: levelOf(slopeDeg, cfg.SLOPE_CAUTION_DEG, cfg.SLOPE_UNSAFE_DEG),
    rough: levelOf(roughness, cfg.ROUGH_CAUTION_M, cfg.ROUGH_UNSAFE_M),
    rock: levelOf(maxRock, cfg.ROCK_HAZARD_M, cfg.ROCK_UNSAFE_M),
    cover: levelOf(cover, cfg.ROCK_COVER_CAUTION, cfg.ROCK_COVER_UNSAFE),
    crater: crater ? 1 : 0
  };
  const reasons = [];
  if (lv.slope) reasons.push({ level: lv.slope, msg: "SLOPE " + slopeDeg.toFixed(0) + " DEG" });
  if (lv.rock) reasons.push({ level: lv.rock, msg: "ROCK " + maxRock.toFixed(1) + " m" });
  if (lv.rough) reasons.push({ level: lv.rough, msg: "ROUGH " + roughness.toFixed(1) + " m" });
  if (lv.cover) reasons.push({ level: lv.cover, msg: "ROCK COVER " + Math.round(cover * 100) + "%" });
  if (lv.crater) reasons.push({ level: lv.crater, msg: "CRATER" });
  reasons.sort((p, q) => q.level - p.level);
  const level = Math.max(lv.slope, lv.rough, lv.rock, lv.cover, lv.crater);
  return { level, slopeDeg, roughness, maxRock, rockCount, cover, crater, lv, reasons, hazardRocks, groundY: c };
}

// خريطة المخاطر لكل منطقة المسح (تنحسب مرة وحدة عند التحميل)
function buildHazardMap(world, cfg) {
  const cell = cfg.HAZARD_CELL, n = Math.round(world.size / cell);
  const levels = new Int8Array(n * n), core = new Uint8Array(n * n), counts = [0, 0, 0, 0];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = assessSite(world, -world.half + (i + 0.5) * cell, -world.half + (j + 0.5) * cell, cfg);
    levels[j * n + i] = a.level;
    counts[a.level < 0 ? 3 : a.level]++;
  }
  // "آمن بهامش": الخلية آمنة وكل جيرانها آمنين (نقترحها كموقع بديل)
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    let ok = 1;
    for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) {
      if (levels[(j + dj) * n + i + di] !== 0) { ok = 0; break; }
    }
    core[j * n + i] = ok;
  }
  return { n, cell, half: world.half, levels, core, counts };
}

function hazardLevelAt(hmap, x, z) {
  const i = Math.floor((x + hmap.half) / hmap.cell), j = Math.floor((z + hmap.half) / hmap.cell);
  if (i < 0 || j < 0 || i >= hmap.n || j >= hmap.n) return -1;
  return hmap.levels[j * hmap.n + i];
}

// أقرب موقع "آمن بهامش" من نقطة معينة
function nearestSafe(hmap, x, z, maxDist) {
  const n = hmap.n, cell = hmap.cell;
  const ci = Math.floor((x + hmap.half) / cell), cj = Math.floor((z + hmap.half) / cell);
  const reach = Math.ceil(maxDist / cell);
  let best = null, bestD = maxDist * maxDist;
  for (let j = Math.max(1, cj - reach); j <= Math.min(n - 2, cj + reach); j++) {
    for (let i = Math.max(1, ci - reach); i <= Math.min(n - 2, ci + reach); i++) {
      if (!hmap.core[j * n + i]) continue;
      const px = -hmap.half + (i + 0.5) * cell, pz = -hmap.half + (j + 0.5) * cell;
      const d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < bestD) { bestD = d; best = { x: px, z: pz }; }
    }
  }
  if (best) best.dist = Math.sqrt(bestD);
  return best;
}

// وين يقع خط النظر على الأرض؟ نمشي على الخط خطوة خطوة لين ننزل تحت السطح ثم نضبط النقطة
function raycastTerrain(world, ox, oy, oz, dx, dy, dz, maxT) {
  let t = 0, prevT = 0, started = false;
  for (let i = 0; i < 400 && t <= maxT; i++) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    const h = heightAt(world, x, z);
    if (Number.isNaN(h)) {
      if (started) return null;           // طلعنا من منطقة المسح
      t += 4; prevT = t; continue;        // لسا ما دخلنا المنطقة
    }
    started = true;
    if (y <= h) {
      let lo = prevT, hi = t;
      for (let k = 0; k < 14; k++) {
        const m = (lo + hi) / 2, hm = heightAt(world, ox + dx * m, oz + dz * m);
        if (Number.isNaN(hm) || oy + dy * m > hm) lo = m; else hi = m;
      }
      const px = ox + dx * hi, pz = oz + dz * hi, py = heightAt(world, px, pz);
      return Number.isNaN(py) ? null : { x: px, y: py, z: pz, t: hi };
    }
    if (dy >= 0 && y > world.maxH + 3) return null; // الخط طالع فوق كل التضاريس
    prevT = t;
    t += Math.max(0.3, (y - h) * 0.5);
  }
  return null;
}

// يمنع تذبذب القرار: يتغير بس لو القرار الجديد تكرر عدة مرات متتالية
function makeStabilizer(n, initial) {
  let current = initial, cand = null, count = 0;
  return value => {
    if (value === current) { cand = null; count = 0; return current; }
    if (value === cand) count++; else { cand = value; count = 1; }
    if (count >= n) { current = value; cand = null; count = 0; }
    return current;
  };
}

// =====================================================================
// قراءات البدلة والبيئة: محاكاة فقط (نفس المشروع الأصلي)
// =====================================================================
function initTelemetry(cfg) {
  return {
    simMin: 0, extTemp: cfg.MARS_TEMP_C, extPress: cfg.MARS_PRESS_PA,
    suitTemp: cfg.SUIT_TEMP_C, suitPress: cfg.SUIT_PRESS_KPA,
    o2: 100, o2Rate: 100 / cfg.O2_CAPACITY_MIN, comm: 85, leak: false, commLoss: false
  };
}

function stepTelemetry(t, dt, cfg, rnd = Math.random) {
  const dMin = dt * cfg.SIM_SPEED / 60;
  t.simMin += dMin;
  const sol = 2 * Math.PI * t.simMin / 1477;     // يوم المريخ ≈ 1477 دقيقة
  t.extTemp = cfg.MARS_TEMP_C + 12 * Math.sin(sol) + (rnd() - 0.5) * 0.4;
  t.extPress = cfg.MARS_PRESS_PA + 10 * Math.sin(2 * sol + 1) + (rnd() - 0.5) * 1.5;
  t.suitTemp += (cfg.SUIT_TEMP_C - t.suitTemp) * Math.min(1, dt * 0.2) + (rnd() - 0.5) * 0.05;
  if (t.leak) t.suitPress = Math.max(0, t.suitPress - cfg.LEAK_KPA_PER_S * dt);
  else t.suitPress += (cfg.SUIT_PRESS_KPA - t.suitPress) * Math.min(1, dt * 0.5);
  t.o2Rate = (100 / cfg.O2_CAPACITY_MIN) * (t.leak ? cfg.LEAK_O2_FACTOR : 1);
  t.o2 = Math.max(0, t.o2 - t.o2Rate * dMin);
  const commTarget = t.commLoss ? 0 : 80 + 12 * Math.sin(t.simMin / 7);
  t.comm = clamp(t.comm + (commTarget - t.comm) * Math.min(1, dt * (t.commLoss ? 1.5 : 0.5)) + (rnd() - 0.5) * 2, 0, 100);
  return t;
}

// السيناريو التلقائي: 0-30 ث طبيعي، 30-80 تسرب، 55-80 انقطاع اتصال، بعدها طبيعي لين تخلص الدورة
function demoFaults(sec, cfg) {
  const ph = sec % cfg.DEMO_CYCLE_S;
  return { leak: ph >= 30 && ph < 80, commLoss: ph >= 55 && ph < 80 };
}

function telemetryStatus(t, cfg) {
  const below = (v, caution, danger) => v < danger ? 2 : v < caution ? 1 : 0;
  const st = {
    suitPress: below(t.suitPress, cfg.SUIT_PRESS_CAUTION, cfg.SUIT_PRESS_DANGER),
    o2: below(t.o2, cfg.O2_CAUTION, cfg.O2_DANGER),
    comm: below(t.comm, cfg.COMM_CAUTION, cfg.COMM_DANGER),
    suitTemp: (t.suitTemp < 10 || t.suitTemp > 35) ? 2 : (t.suitTemp < 18 || t.suitTemp > 27) ? 1 : 0
  };
  const alarms = [];
  if (st.suitPress) alarms.push({ level: st.suitPress, msg: "SUIT PRESSURE LOW" });
  if (st.o2) alarms.push({ level: st.o2, msg: "O2 LOW" });
  if (st.comm) alarms.push({ level: st.comm, msg: st.comm === 2 ? "COMM LOSS" : "COMM WEAK" });
  if (st.suitTemp) alarms.push({ level: st.suitTemp, msg: "SUIT TEMP" });
  alarms.sort((a, b) => b.level - a.level);
  return { st, alarms };
}

// =====================================================================
// معالجة مخرجات الموديل (YOLOv8 ONNX) - نفس المشروع الأصلي
// =====================================================================
function letterboxMeta(vw, vh, size) {
  const scale = Math.min(size / vw, size / vh);
  const nw = Math.round(vw * scale), nh = Math.round(vh * scale);
  return { scale, padX: (size - nw) / 2, padY: (size - nh) / 2, nw, nh, vw, vh };
}

function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return ua > 0 ? inter / ua : 0;
}

function nms(boxes, iouThr) {
  boxes.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const b of boxes) {
    if (keep.every(k => k.cls !== b.cls || iou(k, b) < iouThr)) keep.push(b);
  }
  return keep;
}

// المخرج شكله [1, 4+classes, N] (أو مقلوب). كل عمود = مربع مرشح
function postprocess(data, dims, meta, cfg) {
  let C = dims[1], N = dims[2], transposed = false;
  if (C > N) { [C, N] = [N, C]; transposed = true; }
  const get = transposed ? (ch, i) => data[i * C + ch] : (ch, i) => data[ch * N + i];
  const nc = cfg.CLASS_NAMES.length || (C - 4);
  const boxes = [];
  for (let i = 0; i < N; i++) {
    let best = 0, cls = -1;
    for (let c = 0; c < nc; c++) {
      const s = get(4 + c, i);
      if (s > best) { best = s; cls = c; }
    }
    if (best < cfg.CONF_THRESHOLD) continue;
    const cx = get(0, i), cy = get(1, i), w = get(2, i), h = get(3, i);
    const x1 = (cx - w / 2 - meta.padX) / meta.scale / meta.vw;
    const y1 = (cy - h / 2 - meta.padY) / meta.scale / meta.vh;
    const x2 = (cx + w / 2 - meta.padX) / meta.scale / meta.vw;
    const y2 = (cy + h / 2 - meta.padY) / meta.scale / meta.vh;
    boxes.push({
      x1: clamp(x1, 0, 1), y1: clamp(y1, 0, 1), x2: clamp(x2, 0, 1), y2: clamp(y2, 0, 1),
      score: best, cls, name: cfg.CLASS_NAMES[cls] || ("class " + cls)
    });
  }
  return nms(boxes, cfg.IOU_THRESHOLD);
}

// دمج كشف الموديل مع تقييم الموقع: جسم عالي الخطورة داخل دائرة الهبوط يرفع التقييم إلى "حذر"
function applyAiToVerdict(assessment, aiHazards, site, cfg) {
  if (!cfg.AI_AFFECTS_VERDICT || !assessment || assessment.level < 0 || !site) return assessment;
  const R = cfg.LZ_DIAMETER / 2 + 1;
  const hit = aiHazards.find(d => d.level >= 2 && Math.hypot(d.wx - site.x, d.wz - site.z) <= R);
  if (!hit) return assessment;
  const reasons = assessment.reasons.concat([{ level: 1, msg: "AI: " + hit.name.toUpperCase() }]);
  return { ...assessment, level: Math.max(assessment.level, 1), reasons, aiHit: true };
}

const MarsLogic = {
  CONFIG, LEVEL_NAME, clamp, smoothstep, mulberry32, vnoise, fbm, baseHeight, roughMask,
  buildWorld, heightAt, rocksNear, assessSite, buildHazardMap, hazardLevelAt, nearestSafe, raycastTerrain,
  makeStabilizer, initTelemetry, stepTelemetry, demoFaults, telemetryStatus,
  letterboxMeta, postprocess, nms, iou, applyAiToVerdict
};
if (typeof window !== "undefined") window.MarsLogic = MarsLogic;
if (typeof module !== "undefined") module.exports = MarsLogic;
