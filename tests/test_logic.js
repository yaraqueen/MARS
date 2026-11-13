// اختبارات المنطق: node tests/test_logic.js
const assert = require("assert");
const L = require("../mars_logic.js");
const cfg = L.CONFIG;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok  - " + name); };

const world = L.buildWorld(cfg);
const hmap = L.buildHazardMap(world, cfg);

// عالم مسطح بدون صخور، نعدله حسب كل اختبار
function flatWorld(heightFn, rocks = [], craters = []) {
  const N = 80, size = 100, n1 = N + 1, half = size / 2, cell = size / N;
  const heights = new Float32Array(n1 * n1);
  for (let iz = 0; iz < n1; iz++) for (let ix = 0; ix < n1; ix++) heights[iz * n1 + ix] = heightFn(-half + ix * cell, -half + iz * cell);
  const w = { cfg, N, n1, size, half, cell, heights, craters, rocks, rockCell: 8, minH: -5, maxH: 30 };
  w.rockGridN = Math.ceil(size / 8);
  w.rockGrid = Array.from({ length: w.rockGridN ** 2 }, () => []);
  rocks.forEach((r, i) => w.rockGrid[Math.floor((r.z + half) / 8) * w.rockGridN + Math.floor((r.x + half) / 8)].push(i));
  return w;
}
const rock = (x, z, r, h) => ({ x, z, r, h, y: 0 });

test("same seed gives the same world", () => {
  const w2 = L.buildWorld(cfg);
  assert.strictEqual(w2.rocks.length, world.rocks.length);
  assert.deepStrictEqual(Array.from(w2.heights.slice(5000, 5050)), Array.from(world.heights.slice(5000, 5050)));
});

test("world has a usable mix of safe / caution / unsafe sites", () => {
  const total = hmap.n * hmap.n - hmap.counts[3];
  for (const i of [0, 1, 2]) assert.ok(hmap.counts[i] / total > 0.1, "level " + i + " share too small");
  assert.ok(hmap.counts[0] / total < 0.8);
});

test("start point is inside the map and not inside a crater", () => {
  const a = L.assessSite(world, 0, 0, cfg);
  assert.ok(a.level >= 0 && !a.crater);
});

test("flat empty ground is SAFE with ~0 slope", () => {
  const a = L.assessSite(flatWorld(() => 2), 0, 0, cfg);
  assert.strictEqual(a.level, 0);
  assert.ok(a.slopeDeg < 0.01 && a.roughness < 0.01 && a.reasons.length === 0);
});

test("slope is measured correctly and graded by the thresholds", () => {
  const tilt = deg => flatWorld(x => x * Math.tan(deg * Math.PI / 180));
  const a3 = L.assessSite(tilt(3), 0, 0, cfg), a8 = L.assessSite(tilt(8), 0, 0, cfg), a20 = L.assessSite(tilt(20), 0, 0, cfg);
  assert.ok(Math.abs(a8.slopeDeg - 8) < 0.1, "slope " + a8.slopeDeg);
  assert.deepStrictEqual([a3.level, a8.level, a20.level], [0, 1, 2]);
  assert.ok(a20.reasons[0].msg.startsWith("SLOPE"));
  assert.ok(a8.roughness < 0.02, "a tilted plane is not rough");
});

test("rocks: below 30 cm ignored, 30-50 cm caution, taller unsafe, outside the circle ignored", () => {
  const lvl = rocks => L.assessSite(flatWorld(() => 0, rocks), 0, 0, cfg).level;
  assert.strictEqual(lvl([rock(1, 1, 0.2, 0.2)]), 0);
  assert.strictEqual(lvl([rock(1, 1, 0.3, 0.4)]), 1);
  assert.strictEqual(lvl([rock(-2, 3, 0.6, 0.8)]), 2);
  assert.strictEqual(lvl([rock(9, 0, 0.6, 0.8)]), 0);
  assert.strictEqual(lvl([rock(5.3, 0, 0.6, 0.8)]), 2, "rock overlapping the edge counts");
});

test("rock cover above 10% is unsafe even if every rock is short", () => {
  const rocks = [];
  for (let i = 0; i < 12; i++) rocks.push(rock(Math.cos(i) * 3, Math.sin(i) * 3, 0.55, 0.25));
  const a = L.assessSite(flatWorld(() => 0, rocks), 0, 0, cfg);
  assert.ok(a.cover > 0.1 && a.lv.cover === 2 && a.level === 2);
});

test("roughness: a bump inside the circle is detected", () => {
  const a = L.assessSite(flatWorld((x, z) => (Math.hypot(x - 1, z) < 1.3 ? 0.8 : 0)), 0, 0, cfg);
  assert.ok(a.roughness > 0.6 && a.level === 2, "roughness " + a.roughness);
});

test("crater site is at least CAUTION; outside the map is NO DATA", () => {
  const w = flatWorld(() => 0, [], [{ x: 0, z: 0, r: 8, depth: 0, rim: 0 }]);
  assert.strictEqual(L.assessSite(w, 2, 0, cfg).level, 1);
  assert.strictEqual(L.assessSite(w, 30, 30, cfg).level, 0);
  assert.strictEqual(L.assessSite(w, 48, 0, cfg).level, -1);
});

test("worst criterion wins and reasons are sorted worst first", () => {
  const w = flatWorld(x => x * Math.tan(8 * Math.PI / 180), [rock(0, 0, 0.7, 0.9)]);
  const a = L.assessSite(w, 0, 0, cfg);
  assert.strictEqual(a.level, 2);
  assert.ok(a.reasons[0].msg.startsWith("ROCK") && a.reasons[1].msg.startsWith("SLOPE"));
});

test("hazard map agrees with direct assessment; nearest safe site is really safe", () => {
  for (const [i, j] of [[40, 40], [80, 80], [100, 30], [20, 120]]) {
    const x = -world.half + (i + 0.5) * hmap.cell, z = -world.half + (j + 0.5) * hmap.cell;
    assert.strictEqual(L.hazardLevelAt(hmap, x, z), L.assessSite(world, x, z, cfg).level);
  }
  let checked = 0;
  for (let k = 0; k < hmap.levels.length && checked < 25; k += 397) {
    if (hmap.levels[k] !== 2) continue;
    const x = -world.half + (k % hmap.n + 0.5) * hmap.cell, z = -world.half + (Math.floor(k / hmap.n) + 0.5) * hmap.cell;
    const s = L.nearestSafe(hmap, x, z, cfg.SAFE_SEARCH_M);
    assert.ok(s, "no safe site near an unsafe one");
    assert.strictEqual(L.assessSite(world, s.x, s.z, cfg).level, 0);
    assert.ok(Math.abs(Math.hypot(s.x - x, s.z - z) - s.dist) < 1e-6);
    checked++;
  }
  assert.ok(checked > 5);
});

test("gaze ray lands on the surface; sky and off-map rays miss", () => {
  const hit = L.raycastTerrain(world, 0, 60, 0, 0, -1, 0, 450);
  assert.ok(Math.abs(hit.y - L.heightAt(world, 0, 0)) < 0.01 && Math.abs(hit.t - (60 - hit.y)) < 0.05);
  const d = Math.SQRT1_2, h2 = L.raycastTerrain(world, 0, 60, 0, d, -d, 0, 450);
  assert.ok(Math.abs(h2.y - L.heightAt(world, h2.x, h2.z)) < 0.05 && Math.abs(h2.z) < 1e-9 && h2.x > 40);
  assert.strictEqual(L.raycastTerrain(world, 0, 60, 0, 0, 1, 0, 450), null);
  assert.strictEqual(L.raycastTerrain(world, 0, 60, 0, 0.999, -0.04, 0, 450), null);
  const flat = flatWorld(() => 0);
  const h3 = L.raycastTerrain(flat, 0, 1.8, 0, 0.6, -0.8, 0, 450);
  assert.ok(Math.abs(h3.x - 1.35) < 0.01 && Math.abs(h3.y) < 1e-6);
});

test("stabilizer ignores short flickers", () => {
  const s = L.makeStabilizer(3, 0);
  assert.deepStrictEqual([2, 0, 2, 2, 0, 2, 2, 2, 2].map(s), [0, 0, 0, 0, 0, 0, 0, 2, 2]);
});

test("AI detection inside the landing circle raises SAFE to CAUTION only", () => {
  const safe = L.assessSite(flatWorld(() => 0), 0, 0, cfg), site = { x: 0, z: 0 };
  const boulder = { name: "boulder", level: 2, wx: 2, wz: 1 }, far = { name: "boulder", level: 2, wx: 20, wz: 0 }, small = { name: "rocks", level: 1, wx: 0, wz: 0 };
  const a = L.applyAiToVerdict(safe, [boulder], site, cfg);
  assert.ok(a.level === 1 && a.reasons.some(r => r.msg === "AI: BOULDER"));
  assert.strictEqual(L.applyAiToVerdict(safe, [far, small], site, cfg).level, 0);
  const unsafe = { ...safe, level: 2 };
  assert.strictEqual(L.applyAiToVerdict(unsafe, [boulder], site, cfg).level, 2);
  assert.strictEqual(L.applyAiToVerdict(safe, [boulder], site, { ...cfg, AI_AFFECTS_VERDICT: false }).level, 0);
});

test("telemetry: leak drops pressure and raises alarms; demo schedule", () => {
  const t = L.initTelemetry(cfg);
  assert.strictEqual(L.telemetryStatus(t, cfg).alarms.length, 0);
  t.leak = true;
  for (let i = 0; i < 600; i++) L.stepTelemetry(t, 0.1, cfg, () => 0.5);
  const st = L.telemetryStatus(t, cfg);
  assert.ok(t.suitPress < cfg.SUIT_PRESS_DANGER && st.alarms[0].level === 2 && st.alarms[0].msg === "SUIT PRESSURE LOW");
  assert.deepStrictEqual(L.demoFaults(10, cfg), { leak: false, commLoss: false });
  assert.deepStrictEqual(L.demoFaults(60, cfg), { leak: true, commLoss: true });
  assert.deepStrictEqual(L.demoFaults(100, cfg), { leak: false, commLoss: false });
});

test("YOLO postprocess: threshold, NMS, coordinates", () => {
  const N = 8, data = new Float32Array(6 * N); // N أكبر من عدد القنوات مثل الموديل الحقيقي
  const put = (i, v) => v.forEach((x, c) => { data[c * N + i] = x; });
  put(0, [208, 208, 104, 104, 0.9, 0]); put(1, [210, 210, 100, 100, 0.6, 0]); put(2, [100, 300, 40, 40, 0.1, 0.8]); put(3, [50, 50, 20, 20, 0.2, 0.1]);
  const out = L.postprocess(data, [1, 6, N], L.letterboxMeta(416, 416, 416), cfg);
  assert.strictEqual(out.length, 2);
  assert.ok(out[0].name === "boulder" && Math.abs(out[0].x1 - 0.375) < 1e-6 && Math.abs(out[0].y2 - 0.625) < 1e-6);
  assert.strictEqual(out[1].name, "rocks");
});

console.log("\n" + passed + " tests passed");
