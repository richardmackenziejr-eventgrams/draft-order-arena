// Two-Minute Drill — the page. You are the quarterback: 2:00 on the clock, ball on your own 25.
// Everything is simulated here in real time (the server only hands out a seed and scores the
// finished drive -- see lib/gameEngine/twoMinuteDrill.js):
//
//   * Snap the ball, drop back, and move the QB with the arrow keys / on-screen stick / controller.
//   * Four receivers run routes (labeled 1-4, tinted green/yellow/red by how open they are); press
//     a number to throw to that receiver. Throw it well and the catch is a roll weighted by how open
//     he is and how clean your throw was; a smothered receiver gets picked off.
//   * The defense rushes: a lineman breaks free, then another, and a linebacker blitzes. Hold the
//     ball too long and you're sacked; cross the line of scrimmage and you're running it yourself.
//   * Incomplete passes, spikes, timeouts and going out of bounds stop the clock. Four downs to get
//     a first down. Touchdown = 7, field goal = 3.
//
// The rules (clock, downs, scoring, how a throw is judged, the playbook) are in drill-rules.js;
// the players and their animation blending are in drill-actors.js.
import * as THREE from 'three';
import { createStadium } from '/js/stadium.js?v=2';
import { createSidelineCrew } from '/js/sideline-crew.js?v=3';
import { setupFullscreenToggle } from '/js/fullscreen.js?v=1';
import * as R from '/js/drill-rules.js?v=3';
import { loadDrillAssets, Actor, QB_THROW_CLIP } from '/js/drill-actors.js?v=5';

let instanceId = qs('instance');
const leagueId = qs('league');
let memberId = qs('member');
const previewMode = qs('preview') === '1';

const $ = (id) => document.getElementById(id);
const canvasWrap = $('drill-canvas-wrap');
setupFullscreenToggle($('drill-panel'));

// ---- Three.js scene ----------------------------------------------------------------------------
const SIDELINE_X = 25.65;      // the drawn sideline: stepping past it is out of bounds
const GOAL_Z = -100;           // the opponent's goal line
const isTouch = window.matchMedia('(pointer: coarse)').matches;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec9f0);
scene.fog = new THREE.Fog(0x8ec9f0, 55, 160);
const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
canvasWrap.insertBefore(renderer.domElement, canvasWrap.firstChild);

function resizeRenderer() {
  const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeRenderer);
new ResizeObserver(resizeRenderer).observe(canvasWrap);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.1));
const sun = new THREE.DirectionalLight(0xfff4d6, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
sun.shadow.camera.left = -34; sun.shadow.camera.right = 34; sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;
scene.add(sun, sun.target);

const stadium = createStadium(scene, { lengthYards: 100, goalLineZ: GOAL_Z }); // z=0 is the offense's own goal line
const crew = createSidelineCrew(stadium.root, { lengthYards: 100 });

const ball = new THREE.Mesh(
  new THREE.SphereGeometry(0.11, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0x8a4b26, roughness: 0.5 })
);
ball.scale.set(1, 1, 1.5);
ball.castShadow = true;
scene.add(ball);

// ---- game state ----------------------------------------------------------------------------------
const FORMATION = {
  ol: [-2.4, -1.2, 0, 1.2, 2.4],
  dl: [-2.4, -0.8, 0.8, 2.4],
};
const QB_BACK = 5.4;           // shotgun depth behind the line
const BALL_ARRIVES = 0.45;     // seconds from the snap until the QB has the ball
const WINDUP = 0.34;           // seconds from pressing a number until the ball leaves
const RELEASE_AT = 0.22;
const RISE_TIME = 0.9;         // linemen standing up out of their stance
const THROW_SPEED = 21;        // yards per second
const REC_SPEED = 7.8;
const QB_FORWARD_SPEED = 5.9;   // yards/second: a mobile QB, but slower than the linemen (6.8), linebacker (7.0) and backs (8.0) who run him down
const BALL_HELD = 1.25;

const S = {
  phase: 'loading',  // loading | presnap | play | flight | yac | dead | fg | over
  t: 0,              // seconds since the snap
  deadT: 0,
  seed: 1,
  playIndex: 0,
  plan: null,
  rng: Math.random,
  drive: null,
  z0: -25,           // the line of scrimmage (a negative z)
  qbVel: new THREE.Vector3(),
  throwing: null,    // { rec, t, released }
  flight: null,
  carrier: null,     // the receiver (or QB) running with the ball
  carrierSlow: 0,
  qbHasBall: false,
  bannerUntil: 0,
  simTime: 0,
  ready: false,
  ended: false,
};
let A = null;        // all actors once loaded: { qb, rb, recs, ol, dl, lb, dbs, defenders }
let drill = { startYard: R.START_YARD, clockSeconds: R.CLOCK_SECONDS, timeouts: R.TIMEOUTS };

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = (x) => x * x * (3 - 2 * x);
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// ---- HUD ---------------------------------------------------------------------------------------------
function banner(text, kind = '', seconds = 1.8) {
  const el = $('drill-banner');
  $('drill-banner-text').textContent = text;
  el.className = 'show' + (kind ? ' ' + kind : '');
  S.bannerUntil = S.simTime + seconds;
}
function hideBanner() { $('drill-banner').className = ''; }

function updateHud() {
  const d = S.drive;
  if (!d) return;
  const clockEl = $('hud-clock');
  clockEl.textContent = R.clockText(d.clock);
  clockEl.className = d.clock <= 10 ? 'low' : (d.clockRunning ? '' : 'stopped');
  $('hud-down').textContent = R.downAndDistanceText(d);
  $('hud-spot').textContent = `Ball on ${R.ballOnText(d.losYard)}`;
  $('hud-timeouts').innerHTML = `Timeouts <b>${'&bull;'.repeat(d.timeouts) || '&ndash;'}</b>`;
  if (S.bannerUntil && S.simTime > S.bannerUntil) { hideBanner(); S.bannerUntil = 0; }

  const pre = S.phase === 'presnap' && !d.over;
  $('btn-snap').disabled = !(pre && S.ready);
  $('btn-snap').textContent = S.ready ? 'Snap!' : 'Loading…';
  $('btn-spike').disabled = !pre;
  $('btn-timeout').disabled = !(pre && d.timeouts > 0 && d.clockRunning);
  $('btn-fg').disabled = !(pre && R.fieldGoalAllowed(d.losYard));
  $('btn-fg').textContent = pre && R.fieldGoalAllowed(d.losYard) ? `Field goal (${Math.round(R.fieldGoalChance(d.losYard) * 100)}%)` : 'Field goal';
}

// ---- building the teams ---------------------------------------------------------------------------------
const ALL_CLIPS = ['idle', 'run', 'strafeL', 'strafeR', 'catch', 'fall', 'victory', 'flex', 'sad', 'throw', 'crouchSprint'];
const LINE_CLIPS = ['stance', 'push', 'fall', 'flex', 'idle'];

function buildTeams(assets) {
  const mk = (kind, clips) => new Actor(assets, kind, scene, clips);
  A = {
    ol: FORMATION.ol.map(() => mk('ol', LINE_CLIPS)),
    qb: mk('qb', ALL_CLIPS),
    rb: mk('wr', ['idle', 'run']),
    recs: [0, 1, 2, 3].map(() => mk('wr', ALL_CLIPS)),
    dl: FORMATION.dl.map(() => mk('dl', LINE_CLIPS)),
    lb: mk('db', ALL_CLIPS),
    dbs: [0, 1, 2, 3].map(() => mk('db', ALL_CLIPS)),
  };
  // Everyone who plays defense, with the data the AI needs.
  A.defenders = [
    ...A.dl.map((actor, i) => ({ actor, role: 'dl', idx: i, speed: 6.8 })),
    { actor: A.lb, role: 'lb', idx: 0, speed: 7.0 },
    ...A.dbs.map((actor, i) => ({ actor, role: 'db', idx: i, speed: 8.0, cushion: i === 0 || i === 3 ? 6 : 4.5 })),
  ];
  A.recs.forEach((r, i) => { r.slot = i; r.routeSpeed = REC_SPEED; });
}

function setRoutes() {
  const calls = S.plan.call.routes;
  A.recs.forEach((rec, i) => {
    const spot = R.RECEIVER_SPOTS[i];
    const start = { x: spot.x, z: S.z0 + spot.z };
    rec.path = [start, ...calls[i].map(([dx, dz]) => ({ x: clamp(start.x + dx, -23, 23), z: Math.max(start.z + dz, GOAL_Z + 3) }))];
    rec.segLen = rec.path.slice(1).map((p, k) => dist2(p.x, p.z, rec.path[k].x, rec.path[k].z));
  });
}

// Where a receiver is t seconds after the snap, running his route (and, past the end of it,
// drifting on at a walk so nobody freezes). Also returns the direction he's heading.
function routeAt(rec, t) {
  const s = Math.max(0, t - 0.12) * rec.routeSpeed;
  let acc = 0;
  for (let i = 0; i < rec.segLen.length; i++) {
    const len = rec.segLen[i];
    const a = rec.path[i], b = rec.path[i + 1];
    if (s <= acc + len) {
      const f = len > 0 ? (s - acc) / len : 1;
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, dx: (b.x - a.x) / (len || 1), dz: (b.z - a.z) / (len || 1), moving: true };
    }
    acc += len;
  }
  const n = rec.path.length;
  const a = rec.path[n - 2], b = rec.path[n - 1];
  const len = rec.segLen[n - 2] || 1;
  const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
  const extra = (s - acc) * 0.35;
  return { x: clamp(b.x + dx * extra, -24, 24), z: Math.max(GOAL_Z + 2, b.z + dz * extra), dx, dz, moving: true };
}

// A receiver waits in the crouch (the first frame of the crouch-to-sprint clip, held), then bursts out of it on the snap.
function crouchReceiver(r) {
  if (!r.actions.crouchSprint) return;
  r.play('crouchSprint', { fade: 0.05, timeScale: 0 });
  r.snapNext = true;
}
function burstReceiver(r) {
  if (r.actions.crouchSprint && r.override === 'crouchSprint') r.play('crouchSprint', { fade: 0.05, timeScale: 1 });
}

// Everybody back to the huddle spot for the next snap.
function lineUp() {
  const z0 = -S.drive.losYard;
  S.z0 = z0;
  S.t = 0;
  S.plan = R.planPlay(S.seed, S.playIndex);
  S.rng = R.mulberry32(S.plan.rngSeed);
  S.throwing = null; S.flight = null; S.carrier = null; S.carrierSlow = 0; S.qbHasBall = false; S.picker = null; S.result = null;
  A.recs.forEach((r) => { r.caught = false; r.brokeOne = false; r.vx = 0; r.vz = 0; });
  A.qb.vx = 0; A.qb.vz = 0;
  S.qbVel.set(0, 0, 0);
  const OFF = Math.PI, DEF = 0;

  A.ol.forEach((a, i) => { a.place(FORMATION.ol[i], z0 + 0.45, OFF); a.override = 'stance'; a.stanceT = a.assets.hipsOffset.stance.duration; a.snapNext = true; });
  A.dl.forEach((a, i) => { a.place(FORMATION.dl[i], z0 - 0.45, DEF); a.override = 'stance'; a.stanceT = a.assets.hipsOffset.stance.duration; a.snapNext = true; });
  A.qb.place(0, z0 + QB_BACK, OFF); A.qb.clearOverride(); A.qb.throwU = -1;
  A.rb.place(1.9, z0 + QB_BACK, OFF); A.rb.clearOverride();
  A.recs.forEach((r, i) => { r.place(R.RECEIVER_SPOTS[i].x, z0 + R.RECEIVER_SPOTS[i].z, OFF); r.clearOverride(); crouchReceiver(r); });
  setRoutes();
  A.lb.place(0.6, z0 - 4.2, DEF); A.lb.clearOverride();
  A.dbs.forEach((a, i) => {
    const rec = A.recs[i];
    a.place(rec.pos.x + (i === 0 ? 1.2 : i === 3 ? -1.2 : 0), z0 - A.defenders.find((d) => d.actor === a).cushion, DEF);
    a.clearOverride();
  });
  A.defenders.forEach((d) => { d.state = d.role === 'dl' ? 'engaged' : 'cover'; d.stumbleT = 0; d.ballChase = false; d.rushing = false; });

  ball.position.set(0, 0.115, z0);
  ball.rotation.set(0, 0, 0);
  S.ballMode = 'ground';
  setLabels(true);
}

// ---- movement helpers -------------------------------------------------------------------------------------
function moveToward(actor, tx, tz, speed, dt, face = true) {
  const dx = tx - actor.pos.x, dz = tz - actor.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.02) { actor.speed = 0; return d; }
  const step = Math.min(d, speed * dt);
  actor.pos.x += (dx / d) * step;
  actor.pos.z += (dz / d) * step;
  actor.speed = step / Math.max(dt, 1e-6);
  actor.back = false; actor.strafe = 0;
  if (face) actor.turnTo(Math.atan2(dx, dz), dt, 14);
  return d - step;
}
function stopActor(a) { a.speed = 0; a.back = false; a.strafe = 0; }

function freezeAll(except) {
  [A.qb, A.rb, ...A.recs, ...A.ol, ...A.dl, A.lb, ...A.dbs].forEach((a) => { if (a !== except) stopActor(a); });
}

// ---- input -------------------------------------------------------------------------------------------------------
const keys = new Set();
const stick = { x: 0, y: 0 };
const pad = { x: 0, y: 0, prev: {} };

function inputVector() {
  let x = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0) + stick.x + pad.x;
  let z = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0) + stick.y + pad.y;
  const m = Math.hypot(x, z);
  if (m > 1) { x /= m; z /= m; }
  return { x, z };
}

window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') doSnap();
  else if (/^(Digit|Numpad)[1-4]$/.test(e.code)) doThrow(Number(e.code.slice(-1)) - 1);
  else if (e.code === 'KeyS') doSpike();
  else if (e.code === 'KeyT') doTimeout();
  else if (e.code === 'KeyF') doFieldGoal();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

$('btn-snap').addEventListener('click', doSnap);
$('btn-spike').addEventListener('click', doSpike);
$('btn-timeout').addEventListener('click', doTimeout);
$('btn-fg').addEventListener('click', doFieldGoal);

// touch: a one-thumb stick (like Kickoff Return) and four receiver buttons
(function setupTouch() {
  if (!isTouch) return;
  $('drill-touch').classList.add('on');
  const base = $('drill-stick'), knob = $('drill-stick-knob');
  let pointer = null;
  const update = (e) => {
    const r = base.getBoundingClientRect(), R_ = r.width / 2;
    let dx = (e.clientX - (r.left + R_)) / R_, dy = (e.clientY - (r.top + R_)) / R_;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    knob.style.transform = `translate(${dx * R_ * 0.55}px, ${dy * R_ * 0.55}px)`;
    stick.x = Math.abs(dx) > 0.15 ? dx : 0;
    stick.y = Math.abs(dy) > 0.15 ? dy : 0;
  };
  const end = (e) => { if (e.pointerId !== pointer) return; pointer = null; stick.x = 0; stick.y = 0; knob.style.transform = ''; };
  base.addEventListener('pointerdown', (e) => { if (pointer !== null) return; pointer = e.pointerId; try { base.setPointerCapture(e.pointerId); } catch (err) { /* stale pointer */ } update(e); e.preventDefault(); });
  base.addEventListener('pointermove', (e) => { if (e.pointerId === pointer) update(e); });
  base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end);
  document.querySelectorAll('.drill-rbtn').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('down'); doThrow(Number(btn.dataset.r)); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => btn.addEventListener(t, () => btn.classList.remove('down')));
  });
  $('drill-touch').addEventListener('contextmenu', (e) => e.preventDefault());
})();

// controller: left stick moves; X/Y/B/A throw to 1-4; Start snaps; LB spike; RB timeout; Back field goal
function pollGamepad() {
  if (!navigator.getGamepads) return;
  let gp = null;
  try { for (const p of navigator.getGamepads()) { if (p && p.connected) { gp = p; break; } } } catch (e) { return; }
  if (!gp) { pad.x = 0; pad.y = 0; return; }
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  pad.x = Math.abs(ax) > 0.3 ? ax : ((gp.buttons[15] && gp.buttons[15].pressed ? 1 : 0) - (gp.buttons[14] && gp.buttons[14].pressed ? 1 : 0));
  pad.y = Math.abs(ay) > 0.3 ? ay : ((gp.buttons[13] && gp.buttons[13].pressed ? 1 : 0) - (gp.buttons[12] && gp.buttons[12].pressed ? 1 : 0));
  const edge = (i, fn) => { const down = !!(gp.buttons[i] && gp.buttons[i].pressed); if (down && !pad.prev[i]) fn(); pad.prev[i] = down; };
  edge(2, () => doThrow(0)); edge(3, () => doThrow(1)); edge(1, () => doThrow(2)); edge(0, () => doThrow(3));
  edge(9, doSnap); edge(4, doSpike); edge(5, doTimeout); edge(8, doFieldGoal);
}

// ---- the player's actions ---------------------------------------------------------------------------------------------
function doSnap() {
  if (S.phase !== 'presnap' || !S.ready || S.drive.over) return;
  hideBanner();
  R.snap(S.drive);
  S.phase = 'play';
  S.t = 0;
  S.snapBall = { from: new THREE.Vector3(0, 0.12, S.z0), done: false };
  S.ballMode = 'snap';
  A.recs.forEach(burstReceiver);
}

function doThrow(i) {
  if (S.phase !== 'play' || !S.qbHasBall || S.throwing || S.t < BALL_ARRIVES) return;
  const rec = A.recs[i];
  if (!rec) return;
  S.throwing = { rec, t: 0, released: false };
  A.qb.speed = 0; S.qbVel.set(0, 0, 0);
  A.qb.throwU = 0;
  // the real throwing motion, started only now (see QB_THROW_CLIP): the QB stays in his normal ready/run stance until a number is pressed
  if (A.qb.actions.throw) A.qb.play('throw', { fade: 0.1, timeScale: QB_THROW_CLIP.speed, startTime: QB_THROW_CLIP.start });
}

function doSpike() {
  if (S.phase !== 'presnap' || S.drive.over) return;
  S.phase = 'dead'; S.deadT = 0;
  A.qb.throwU = 0; S.spiking = true;
  ball.position.set(A.qb.pos.x, 1.3, A.qb.pos.z - 0.2); S.ballMode = 'ground'; showHeldBall(null);
  banner(R.applyPlay(S.drive, { kind: 'spike' }), '', 1.6);
  A.qb.place(A.qb.pos.x, A.qb.pos.z, Math.PI);
}

function doTimeout() {
  if (S.phase !== 'presnap' || S.drive.over) return;
  if (R.useTimeout(S.drive)) banner('TIMEOUT', '', 1.4);
}

function doFieldGoal() {
  if (S.phase !== 'presnap' || S.drive.over || !R.fieldGoalAllowed(S.drive.losYard)) return;
  const made = S.rng() < R.fieldGoalChance(S.drive.losYard);
  S.phase = 'fg';
  S.fg = { t: 0, made, from: new THREE.Vector3(0, 0.3, S.z0 + 7), x: made ? (S.rng() - 0.5) * 3 : (S.rng() < 0.5 ? -1 : 1) * (4.2 + S.rng() * 2.5) };
  S.ballMode = 'fgflight';
  showHeldBall(null);
  hideBanner();
  banner(`Field goal attempt — ${R.fieldGoalKickDistance(S.drive.losYard)} yards`, '', 2.2);
}

// ---- per-frame: the linemen ------------------------------------------------------------------------------------------------
function updateLinemen(dt) {
  const t = S.phase === 'presnap' ? -1 : S.t;
  [...A.ol, ...A.dl].forEach((a, idx) => {
    const delay = ((idx * 7919) % 13) / 13 * 0.1;
    const dur = a.assets.hipsOffset.stance.duration;
    const local = t - delay;
    const def = A.defenders.find((d) => d.actor === a);
    if (def && def.rushing) return; // a rusher who's broken free runs (handled in updateDefense)
    if (S.phase === 'dead' || S.phase === 'over' || S.phase === 'fg') { /* keep whatever they were doing */ }
    if (local < 0) { a.override = 'stance'; a.stanceT = dur; a.overrideFade = 0.05; }
    else if (local < RISE_TIME) { a.override = 'stance'; a.stanceT = dur * (1 - smooth(local / RISE_TIME)); a.overrideFade = 0.05; }
    else { if (a.override !== 'push') { a.override = 'push'; a.overrideFade = 0.25; } }
    a.speed = 0;
  });
}

// ---- per-frame: the receivers, the QB, the defense ---------------------------------------------------------------------------------
function updateReceivers(dt) {
  A.recs.forEach((rec) => {
    // out of the crouch into the normal run once the burst clip has played
    if (rec.override === 'crouchSprint' && S.phase !== 'presnap' && rec.actions.crouchSprint.time >= rec.assets.clips.crouchSprint.duration - 0.02) rec.clearOverride();
    if (S.carrier === rec) return;
    if (rec.caught) return;
    const p = routeAt(rec, S.t);
    const moved = Math.hypot(p.x - rec.pos.x, p.z - rec.pos.z);
    rec.pos.x = p.x; rec.pos.z = p.z;
    rec.speed = moved / Math.max(dt, 1e-6);
    rec.back = false; rec.strafe = 0;
    if (moved > 0.001) rec.turnTo(Math.atan2(p.dx, p.dz), dt, 12);
  });
  // the back stays in to block: just stands there
  stopActor(A.rb);
}

function updateQb(dt) {
  const qb = A.qb;
  if (!S.qbHasBall && S.phase === 'play' && S.t >= BALL_ARRIVES && !S.carrier) S.qbHasBall = true;
  if (S.throwing) {
    // wound up: rooted, facing the target
    qb.speed = 0; qb.back = false; qb.strafe = 0;
    qb.faceXZ(S.throwing.rec.pos.x, S.throwing.rec.pos.z, dt, 20);
    S.throwing.t += dt;
    // with the real clip, the ball leaves at the clip's own release frame; without it, on the old fixed timing
    const clip = !!qb.actions.throw;
    const releaseAt = clip ? (QB_THROW_CLIP.release - QB_THROW_CLIP.start) / QB_THROW_CLIP.speed : RELEASE_AT;
    const doneAt = clip ? (QB_THROW_CLIP.end - QB_THROW_CLIP.start) / QB_THROW_CLIP.speed : WINDUP + 0.25;
    qb.throwU = clamp(S.throwing.t / WINDUP, 0, 1);
    if (!S.throwing.released && S.throwing.t >= releaseAt) releaseBall();
    if (S.throwing.t >= doneAt) { qb.throwU = -1; qb.clearOverride(); S.throwing = null; }
    return;
  }
  if (S.carrier === qb) return; // running with it: handled by updateCarrier
  if (S.phase === 'presnap') { stopActor(qb); return; }

  const inp = S.qbHasBall || S.t < BALL_ARRIVES ? inputVector() : { x: 0, z: 0 };
  // speeds: forward is quickest, backpedaling slowest
  const target = new THREE.Vector3(inp.x * 4.7, 0, inp.z < 0 ? inp.z * QB_FORWARD_SPEED : inp.z * 3.6);
  S.qbVel.lerp(target, 1 - Math.exp(-9 * dt));
  qb.pos.x = clamp(qb.pos.x + S.qbVel.x * dt, -SIDELINE_X - 0.3, SIDELINE_X + 0.3);
  qb.pos.z = clamp(qb.pos.z + S.qbVel.z * dt, S.z0 - 40, 6);
  const sp = Math.hypot(S.qbVel.x, S.qbVel.z);
  qb.speed = sp;
  qb.back = S.qbVel.z > 0.4 && Math.abs(S.qbVel.z) > Math.abs(S.qbVel.x);
  qb.strafe = !qb.back && Math.abs(S.qbVel.x) > Math.abs(S.qbVel.z) * 1.2 && sp > 0.6 ? Math.sign(S.qbVel.x) : 0;
  qb.turnTo(Math.PI, dt, 14); // always facing downfield, reading the defense
}

function releaseBall() {
  const th = S.throwing;
  th.released = true;
  const qb = A.qb, rec = th.rec;
  const from = qb.heldBallPosition(new THREE.Vector3()); // the ball leaves his hand
  // lead the receiver: he'll be where his route puts him by the time the ball gets there
  let T = 0.8, target = routeAt(rec, S.t + T);
  for (let k = 0; k < 4; k++) { // a few passes of "how long will it take to reach where he'll be"
    const d = dist2(from.x, from.z, target.x, target.z);
    T = clamp(d / THROW_SPEED, 0.45, 2.4);
    target = routeAt(rec, S.t + T);
  }
  const pressured = A.defenders.some((d) => (d.rushing || d.state === 'rush' || d.state === 'blitz' || d.state === 'pursue') && dist2(d.actor.pos.x, d.actor.pos.z, qb.pos.x, qb.pos.z) < 3.8);
  const moving = Math.hypot(S.qbVel.x, S.qbVel.z) > 1.5;
  const dist = dist2(from.x, from.z, target.x, target.z);
  const e = R.throwError({ dist, pressured, moving }, S.rng);
  const land = new THREE.Vector3(target.x + Math.cos(e.ang) * e.mag, 1.2, target.z + Math.sin(e.ang) * e.mag);
  const mid = new THREE.Vector3((from.x + land.x) / 2, 1.7 + Math.min(7, 0.08 * dist + 0.8), (from.z + land.z) / 2);
  S.flight = { from, mid, land, T, u: 0, rec, errMag: e.mag, dist };
  S.phase = 'flight';
  S.qbHasBall = false;
  S.ballMode = 'flight';
}

function updateDefense(dt) {
  const qb = A.qb;
  const live = S.phase === 'play' || S.phase === 'flight';
  const qbRunning = S.phase === 'play' && !S.throwing && S.qbHasBall && qb.pos.z < S.z0 - 0.4;
  const carrier = S.phase === 'yac' ? S.carrier : (S.carrier === qb ? qb : null);

  A.defenders.forEach((d) => {
    const a = d.actor;
    if (d.stumbleT > 0) { d.stumbleT -= dt; stopActor(a); return; }
    if (S.phase === 'presnap') { stopActor(a); return; }

    // chasing a ball carrier (the QB past the line, or a receiver after the catch)
    if (carrier) {
      d.state = 'pursue'; a.override = null;
      const lead = 0.28;
      moveToward(a, carrier.pos.x + (carrier.vx || 0) * lead, carrier.pos.z + (carrier.vz || 0) * lead, d.speed, dt);
      return;
    }
    if (qbRunning) { // the QB crossed the line: everyone converges on him
      d.state = 'pursue'; if (d.role === 'dl') { d.rushing = true; a.override = null; }
      moveToward(a, qb.pos.x, qb.pos.z, d.speed, dt);
      return;
    }
    if (!live) { stopActor(a); return; }

    if (d.role === 'dl') {
      const broke = (d.idx === S.plan.rusherA && S.t >= S.plan.breakA) || (d.idx === S.plan.rusherB && d.idx !== S.plan.rusherA && S.t >= S.plan.breakB);
      if (broke && !d.rushing) { d.rushing = true; a.override = null; d.state = 'rush'; }
      if (d.rushing) moveToward(a, qb.pos.x, qb.pos.z, d.speed, dt);
      return;
    }
    if (d.role === 'lb') {
      if (S.t >= S.plan.blitzAt) { d.state = 'blitz'; moveToward(a, qb.pos.x, qb.pos.z, d.speed, dt); }
      else moveToward(a, qb.pos.x * 0.6 + 0.3, S.z0 - 4.4, 3.2, dt);
      return;
    }
    // defensive back: man coverage on his receiver, or break on the ball once it's thrown his way
    const rec = A.recs[d.idx];
    if (S.phase === 'flight' && S.flight && d.ballChase) {
      moveToward(a, S.flight.land.x, S.flight.land.z, d.speed * 1.05, dt);
      return;
    }
    const skill = S.plan.cover[d.idx];                       // 0 = beaten, 1 = glued to his man
    const tight = 0.9 + (1 - skill) * 2.8;                   // how far off him he ends up trailing
    const lag = tight + (d.cushion - tight) * (1 - smooth(clamp((S.t - 0.15) / 1.6, 0, 1)));
    const dbSpeed = REC_SPEED * (0.9 + 0.2 * skill) + 0.3;   // a good one can run with a receiver, a bad one can't
    const tx = rec.pos.x, tz = rec.pos.z + lag;
    const m = Math.hypot(tx - a.pos.x, tz - a.pos.z);
    if (m > 0.05) {
      const sp = Math.min(dbSpeed, m / dt);
      const dx = (tx - a.pos.x) / m, dz = (tz - a.pos.z) / m;
      a.pos.x += dx * sp * dt; a.pos.z += dz * sp * dt;
      a.speed = sp;
      a.faceXZ(rec.pos.x, rec.pos.z, dt, 10);
      // running backward while keeping eyes on the receiver (he's moving away from where he faces)
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      a.back = dx * fx + dz * fz < -0.35;
      a.strafe = 0;
    } else stopActor(a);
  });
}

// QB sacked / tackled while holding the ball, or a defender reaching a runner.
function checkQbTackle() {
  const qb = A.qb;
  if (S.phase !== 'play' && !(S.phase === 'yac' && S.carrier === qb)) return;
  if (!S.qbHasBall && S.carrier !== qb) return;
  for (const d of A.defenders) {
    if (d.stumbleT > 0) continue;
    if (dist2(d.actor.pos.x, d.actor.pos.z, qb.pos.x, qb.pos.z) > 0.95) continue;
    const behind = qb.pos.z > S.z0 + 0.2;
    if (!behind && d.role !== 'dl' && S.rng() < 0.18) { d.stumbleT = 0.8; S.carrierSlow = 0.5; continue; } // a broken tackle
    endPlay({ kind: behind ? 'sack' : 'run', endYard: -qb.pos.z, tackler: d, carrier: qb });
    return;
  }
}

// ---- the ball in the air, the catch ---------------------------------------------------------------------------------------------------
function updateFlight(dt) {
  const f = S.flight;
  f.u = Math.min(1, f.u + dt / f.T);
  // two defenders closest to where it's going break on the ball a beat after release
  if (!f.reacted && f.u * f.T > 0.2) {
    f.reacted = true;
    const cands = A.defenders.filter((d) => d.role !== 'dl')
      .map((d) => ({ d, dd: dist2(d.actor.pos.x, d.actor.pos.z, f.land.x, f.land.z) })).sort((a, b) => a.dd - b.dd).slice(0, 2);
    cands.forEach((c) => { if (c.dd < 11) c.d.ballChase = true; });
  }
  if (f.u < 1) return;

  // arrival: judge it
  const sep = Math.min(...A.defenders.filter((d) => d.role !== 'dl').map((d) => dist2(d.actor.pos.x, d.actor.pos.z, f.land.x, f.land.z)));
  const err = dist2(f.rec.pos.x, f.rec.pos.z, f.land.x, f.land.z);
  const oob = Math.abs(f.land.x) > SIDELINE_X;
  const outcome = oob ? 'incomplete' : R.resolveThrow({ err, sep }, S.rng);
  f.outcome = outcome;
  if (outcome === 'complete') {
    S.carrier = f.rec; S.phase = 'yac'; S.ballMode = 'carried';
    f.rec.caught = true;
    f.rec.vx = 0; f.rec.vz = -1;
    f.rec.play('catch', { fade: 0.08, timeScale: 2.6 });
    S.catchT = 0;
    A.defenders.forEach((d) => { d.ballChase = false; });
  } else if (outcome === 'interception') {
    const picker = A.defenders.filter((d) => d.role !== 'dl').sort((a, b) => dist2(a.actor.pos.x, a.actor.pos.z, f.land.x, f.land.z) - dist2(b.actor.pos.x, b.actor.pos.z, f.land.x, f.land.z))[0];
    picker.actor.play('catch', { fade: 0.08, timeScale: 2.6 });
    S.picker = picker;
    S.ballMode = 'picked';
    endPlay({ kind: 'interception', picker });
  } else {
    S.ballMode = 'ground';
    ball.position.set(f.land.x, 0.12, f.land.z);
    endPlay({ kind: 'incomplete' });
  }
}

// ---- after the catch -----------------------------------------------------------------------------------------------------------------------
function updateCarrier(dt) {
  const c = S.carrier;
  if (!c) return;
  if (S.phase === 'yac' && c !== A.qb) {
    S.catchT = (S.catchT || 0) + dt;
    // steer upfield, away from defenders and from the sideline
    let lat = 0;
    for (const d of A.defenders) {
      const dx = c.pos.x - d.actor.pos.x, dz = c.pos.z - d.actor.pos.z;
      if (dz > 1.5 || dz < -9) continue;
      const dd = Math.hypot(dx, dz);
      if (dd < 7) lat += Math.sign(dx || (S.rng() - 0.5)) * (1 / (dd + 0.6)) * 1.2;
    }
    if (c.pos.x > 18) lat -= (c.pos.x - 18) * 0.12;
    if (c.pos.x < -18) lat += (-18 - c.pos.x) * 0.12;
    const len = Math.hypot(lat, 1);
    let vx = lat / len, vz = -1 / len;
    const speed = (S.catchT < 0.25 ? 3 : 7.7) * (S.carrierSlow > 0 ? 0.8 : 1);
    S.carrierSlow = Math.max(0, S.carrierSlow - dt);
    c.pos.x += vx * speed * dt; c.pos.z += vz * speed * dt;
    c.vx = vx * speed; c.vz = vz * speed;
    c.speed = speed; c.back = false; c.strafe = 0;
    c.turnTo(Math.atan2(vx, vz), dt, 12);
    if (S.catchT > 0.3 && c.override === 'catch') c.clearOverride();
  }
  if (c === A.qb && S.phase !== 'dead') {
    // the QB running it himself (past the line): the player steers
    const inp = inputVector();
    const target = new THREE.Vector3(inp.x * 5.0, 0, inp.z < 0 ? inp.z * QB_FORWARD_SPEED : inp.z * 4);
    S.qbVel.lerp(target, 1 - Math.exp(-9 * dt));
    c.pos.x += S.qbVel.x * dt; c.pos.z += S.qbVel.z * dt;
    c.vx = S.qbVel.x; c.vz = S.qbVel.z;
    c.speed = Math.hypot(S.qbVel.x, S.qbVel.z); c.back = false; c.strafe = 0;
    if (c.speed > 0.5) c.turnTo(Math.atan2(S.qbVel.x, S.qbVel.z), dt, 10);
  }
  // touchdown / out of bounds / tackle
  if (c.pos.z <= GOAL_Z) { endPlay({ kind: 'touchdown', carrier: c }); return; }
  if (Math.abs(c.pos.x) > SIDELINE_X) { endPlay({ kind: c === A.qb ? 'run' : 'complete', endYard: -c.pos.z, outOfBounds: true, carrier: c }); return; }
  if (S.phase === 'yac' && c !== A.qb) {
    for (const d of A.defenders) {
      if (d.stumbleT > 0) continue;
      if (dist2(d.actor.pos.x, d.actor.pos.z, c.pos.x, c.pos.z) > 0.95) continue;
      if (d.role !== 'dl' && !c.brokeOne && S.rng() < 0.22) { c.brokeOne = true; d.stumbleT = 0.9; S.carrierSlow = 0.5; continue; }
      endPlay({ kind: 'complete', endYard: -c.pos.z, tackler: d, carrier: c });
      return;
    }
  }
}

// ---- ending a play -------------------------------------------------------------------------------------------------------------------------------
function endPlay(result) {
  if (S.phase === 'dead') return;
  S.phase = 'dead'; S.deadT = 0; S.result = result;
  const text = R.applyPlay(S.drive, result);
  const good = result.kind === 'touchdown';
  const bad = result.kind === 'interception' || result.kind === 'sack' || text === 'TURNOVER ON DOWNS' || text === 'TIME EXPIRED';
  banner(text, good ? 'good' : (bad ? 'bad' : ''), 2.2);
  freezeAll();
  S.throwing = null; A.qb.throwU = -1;
  const c = result.carrier;
  if (result.kind === 'touchdown') {
    if (c) { stopActor(c); c.play('victory', { timeScale: 1 }); }
    A.defenders.forEach((d) => d.actor.play('flex', {}));
  } else if (c && (result.kind === 'sack' || result.kind === 'run' || result.kind === 'complete')) {
    stopActor(c); c.play('fall', { fade: 0.08, timeScale: 2.4 });
    if (result.kind === 'sack' && result.tackler) result.tackler.actor.play('flex', {});
  } else if (result.kind === 'interception' && result.picker) {
    stopActor(result.picker.actor);
  }
  // wherever the ball is now: with the ball carrier, with the defender who picked it off, or on the ground
  if (c) { S.carrier = c; S.ballMode = 'carried'; }
}

// ---- dead-ball time, then the next snap -------------------------------------------------------------------------------------------------------------------
function updateDead(dt) {
  S.deadT += dt;
  if (S.spiking && A.qb.throwU >= 0) { A.qb.throwU = Math.min(1, A.qb.throwU + dt / 0.3); }
  const wait = S.drive.over ? 2.4 : 2.0;
  if (S.deadT < wait) return;
  S.spiking = false;
  if (S.drive.over) { endDrive(); return; }
  S.playIndex += 1;
  lineUp();
  S.phase = 'presnap';
  hideBanner();
  S.bannerUntil = 0;
}

function updateFieldGoal(dt) {
  const f = S.fg;
  f.t += dt;
  const u = clamp(f.t / 1.9, 0, 1);
  const end = new THREE.Vector3(f.x, 6.2, -110.5);
  const mid = new THREE.Vector3((f.from.x + end.x) / 2, 14 + (f.made ? 0 : 0), (f.from.z + end.z) / 2);
  const p = new THREE.Vector3(
    (1 - u) * (1 - u) * f.from.x + 2 * (1 - u) * u * mid.x + u * u * end.x,
    (1 - u) * (1 - u) * f.from.y + 2 * (1 - u) * u * mid.y + u * u * end.y,
    (1 - u) * (1 - u) * f.from.z + 2 * (1 - u) * u * mid.z + u * u * end.z
  );
  ball.position.copy(p);
  ball.rotation.x = Math.PI / 2 + u * 3; // end over end
  freezeAll();
  if (u >= 1 && f.t > 2.3) {
    const text = R.applyPlay(S.drive, { kind: 'fieldGoal', made: f.made });
    S.phase = 'dead'; S.deadT = 0; S.ballMode = 'ground';
    banner(text, f.made ? 'good' : 'bad', 2.4);
  }
}

// ---- the ball ----------------------------------------------------------------------------------------------------------------------------------
// While a player has the ball it lives in his hand (see drill-actors.js); the loose ball is hidden.
// Everyone else's hand-ball is hidden. `holder` = null means the ball is loose / in the air.
function showHeldBall(holder) {
  [A.qb, ...A.recs, A.lb, ...A.dbs].forEach((a) => a.setHeldBall(a === holder));
  ball.visible = !holder;
}

function updateBall(dt) {
  const holder = S.ballMode === 'held' ? A.qb : S.ballMode === 'carried' ? S.carrier : S.ballMode === 'picked' && S.picker ? S.picker.actor : null;
  showHeldBall(holder);
  switch (S.ballMode) {
    case 'snap': {
      // center -> QB hands (shotgun)
      const u = clamp(S.t / BALL_ARRIVES, 0, 1);
      const to = new THREE.Vector3(A.qb.pos.x, 1.2, A.qb.pos.z - 0.1);
      ball.position.set(S.snapBall.from.x + (to.x - S.snapBall.from.x) * u, S.snapBall.from.y + (to.y - S.snapBall.from.y) * u + Math.sin(u * Math.PI) * 0.5, S.snapBall.from.z + (to.z - S.snapBall.from.z) * u);
      ball.rotation.set(0, 0, 0);
      if (u >= 1) S.ballMode = 'held';
      break;
    }
    case 'held': break; // in the QB's hand
    case 'flight': {
      const f = S.flight;
      const u = f.u, v = 1 - u;
      ball.position.set(
        v * v * f.from.x + 2 * v * u * f.mid.x + u * u * f.land.x,
        v * v * f.from.y + 2 * v * u * f.mid.y + u * u * f.land.y,
        v * v * f.from.z + 2 * v * u * f.mid.z + u * u * f.land.z
      );
      ball.rotation.z += 14 * dt; // spiral
      break;
    }
    case 'carried': case 'picked': break; // in the carrier's / defender's hand
    default: break;
  }
}

// ---- receiver labels ---------------------------------------------------------------------------------------------------------------------------------
const labelEls = [];
function buildLabels() {
  const host = $('drill-labels');
  for (let i = 0; i < 4; i++) { const el = document.createElement('div'); el.className = 'rl'; el.textContent = String(i + 1); host.appendChild(el); labelEls.push(el); }
}
let labelsOn = true;
function setLabels(on) { labelsOn = on; if (!on) labelEls.forEach((el) => { el.style.display = 'none'; }); }
const _v = new THREE.Vector3();
function updateLabels() {
  const show = A && labelsOn && (S.phase === 'presnap' || (S.phase === 'play' && S.qbHasBall && !S.throwing) || (S.phase === 'play' && S.t < BALL_ARRIVES));
  labelEls.forEach((el, i) => {
    if (!show) { el.style.display = 'none'; return; }
    const rec = A.recs[i];
    _v.set(rec.pos.x, 2.5, rec.pos.z).project(camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.style.left = `${(_v.x * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-_v.y * 0.5 + 0.5) * 100}%`;
    let cls = 'rl';
    if (S.phase === 'play' && S.t > 0.8) {
      const sep = Math.min(...A.defenders.filter((d) => d.role !== 'dl').map((d) => dist2(d.actor.pos.x, d.actor.pos.z, rec.pos.x, rec.pos.z)));
      cls += sep >= 2.8 ? ' open' : (sep >= 1.6 ? ' maybe' : ' covered');
    }
    el.className = cls;
  });
}

// ---- camera ---------------------------------------------------------------------------------------------------------------------------------------------
const camPos = new THREE.Vector3(0, 6, 12), camLook = new THREE.Vector3(0, 1.4, -10);
let camSnap = true;
function updateCamera(dt) {
  if (!A) return;
  let px, py, pz, lx, ly, lz;
  let chase = false;
  const qb = A.qb;
  if (S.phase === 'presnap' || S.phase === 'loading') {
    px = 0; py = 5.2; pz = S.z0 + 13.8; lx = 0; ly = 1.4; lz = S.z0 - 9;   // far enough back that the wide receivers (11 yards out) are inside the frame
  } else if (((S.phase === 'yac' || S.phase === 'play' || S.phase === 'dead') && S.carrier)) {
    // chasing whoever has the ball once he's running with it (a receiver after the catch, or the QB
    // who has scrambled past the line): stay right behind him, left and right as well as downfield
    const c = S.carrier;
    px = clamp(c.pos.x * 0.94, -22, 22); py = 4.0; pz = c.pos.z + 8.2; lx = clamp(c.pos.x, -24, 24); ly = 1.3; lz = c.pos.z - 10;
    chase = true;
  } else if (S.phase === 'fg') {
    px = 0; py = 7; pz = S.z0 + 14; lx = S.fg ? S.fg.x * 0.3 : 0; ly = 6; lz = -100;
  } else {
    // in the pocket: behind the QB, tracking him sideways too so a scramble never leaves the picture
    px = clamp(qb.pos.x * 0.92, -22, 22); py = 4.5; pz = qb.pos.z + 8.6; lx = clamp(qb.pos.x * 0.85, -24, 24); ly = 1.7; lz = qb.pos.z - 14;
    if (S.phase === 'flight' && S.flight) { // keep the throw in frame
      lx = lx * 0.5 + ball.position.x * 0.5; lz = lz * 0.45 + ball.position.z * 0.55; ly = 1.8;
    }
  }
  const k = camSnap ? 1 : 1 - Math.exp(-(chase ? 6.5 : 4.2) * dt);
  camSnap = false;
  camPos.x += (px - camPos.x) * k; camPos.y += (py - camPos.y) * k; camPos.z += (pz - camPos.z) * k;
  camLook.x += (lx - camLook.x) * k; camLook.y += (ly - camLook.y) * k; camLook.z += (lz - camLook.z) * k;
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  // keep the shadow map centered on the action
  const fx = camLook.x, fz = camLook.z + 8;
  sun.position.set(fx + 14, 28, fz + 10);
  sun.target.position.set(fx, 0, fz);
}

// ---- the main update ------------------------------------------------------------------------------------------------------------------------------------------
function update(dt) {
  S.simTime += dt;
  if (!A || !S.drive) { updateCamera(dt); return; }
  pollGamepad();

  const d = S.drive;
  if (!d.over && S.phase !== 'loading' && S.phase !== 'over') {
    R.tickClock(d, dt);
    if (S.phase === 'presnap' && R.expireIfOutOfTime(d)) { banner('TIME EXPIRED', 'bad', 2.2); S.phase = 'dead'; S.deadT = 0; }
  }

  switch (S.phase) {
    case 'presnap': updateLinemen(dt); updateBall(dt); break;
    case 'play':
      S.t += dt;
      updateLinemen(dt); updateReceivers(dt); updateQb(dt); updateDefense(dt);
      if (S.carrier === A.qb) updateCarrier(dt);
      checkQbTackle();
      if (S.phase === 'play' && !S.carrier && A.qb.pos.z < S.z0 - 0.6 && S.qbHasBall && !S.throwing) { S.carrier = A.qb; } // crossed the line: he's a runner
      if (S.phase === 'play' && S.carrier === A.qb) updateCarrier(dt);
      updateBall(dt);
      break;
    case 'flight':
      S.t += dt;
      updateLinemen(dt); updateReceivers(dt); updateQb(dt); updateDefense(dt); updateFlight(dt); updateBall(dt);
      break;
    case 'yac':
      S.t += dt;
      updateLinemen(dt); updateReceivers(dt); updateQb(dt); updateDefense(dt); updateCarrier(dt); updateBall(dt);
      break;
    case 'dead': updateDead(dt); updateBall(dt); break;
    case 'fg': updateFieldGoal(dt); break;
    default: break;
  }
  // animate everyone
  [A.qb, A.rb, ...A.recs, ...A.ol, ...A.dl, A.lb, ...A.dbs].forEach((a) => a.step(dt));
  crew.update(dt, ball.position);
  updateCamera(dt);
  updateLabels();
  updateHud();
}

// ---- ending the drive and reporting it ----------------------------------------------------------------------------------------------------------------------
async function endDrive() {
  if (S.ended) return;
  S.ended = true;
  S.phase = 'over';
  setLabels(false);
  const report = R.driveReport(S.drive);
  const d = S.drive;
  const headline = d.touchdown ? 'Touchdown!' : d.fieldGoal ? 'Field goal!' : `Drive over — ${d.endReason}`;
  $('drill-result').textContent = `${headline}  ${d.points} point${d.points === 1 ? '' : 's'} · ${report.yards} yards · ${R.clockText(d.clock)} left. Saving your drive…`;
  $('drill-result').style.color = d.points > 0 ? '#4ade80' : '#f87171';
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/two-minute-drill/submit`, { memberId, report });
      showDone(gi, headline, report);
      return;
    } catch (err) {
      console.warn('saving the drive failed, retrying', err);
      $('drill-result').textContent = `Couldn't reach the server — retrying (${attempt}/6)…`;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  $('drill-result').textContent = 'Could not save your drive. Please check your connection and reload the page to run it again.';
}

function showDone(gi, headline, report) {
  $('drill-panel').style.display = 'none';
  $('done-panel').style.display = 'block';
  const total = gi.yourScore != null ? gi.yourScore : (report ? report.points : 0);
  const yards = gi.yourYards != null ? gi.yourYards : (report ? report.yards : 0);
  const base = `${headline ? headline + (/[.!]$/.test(headline) ? ' ' : '. ') : ''}You scored ${total} point${total === 1 ? '' : 's'} with ${yards} yard${yards === 1 ? '' : 's'} on the drive.`;
  $('done-message').textContent = gi.status === 'completed' ? `${base} The contest is finished.` : `${base} Waiting on the rest of the league…`;
  $('back-link').style.display = '';
  if (previewMode && leagueId) {
    const again = document.createElement('a');
    again.className = 'btn';
    again.href = `/play-two-minute-drill.html?preview=1&league=${encodeURIComponent(leagueId)}`;
    again.textContent = 'Run another drive';
    again.style.marginRight = '10px';
    $('back-link').parentNode.insertBefore(again, $('back-link'));
  }
}

// ---- starting up --------------------------------------------------------------------------------------------------------------------------------------------------
const nextFrames = (n) => new Promise((resolve) => { const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step); });

async function ensurePreviewInstance() {
  if (instanceId || !previewMode || !leagueId) return;
  const { instanceId: id } = await api('POST', `/api/leagues/${leagueId}/test-two-minute-drill`, {});
  instanceId = id; memberId = 'solo-test';
  history.replaceState(null, '', `?instance=${id}&league=${leagueId}&member=solo-test&preview=1`);
}

async function init() {
  $('back-link').href = '/';
  await ensurePreviewInstance();
  if (!memberId || !instanceId) {
    $('status-line').textContent = 'This is a spectator link — the two-minute drill is played individually by each member.';
    return;
  }
  const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
  if (gi.hasCompleted) { showDone(gi, '', null); return; }
  const cd = gi.currentDrive;
  S.seed = cd.seed;
  drill = { startYard: cd.startYard, clockSeconds: cd.clockSeconds, timeouts: cd.timeouts };

  $('status-line').style.display = 'none';
  $('drill-panel').style.display = 'block';
  $('drill-info').textContent = `Your drive: ${R.clockText(drill.clockSeconds)} · ball on your own ${drill.startYard}`;
  S.drive = R.createDrive(drill);
  buildLabels();
  resizeRenderer();
  requestAnimationFrame(frame); // keeps drawing the empty field while the players load

  const assets = await loadDrillAssets();
  if (!assets.tpl.qb || !assets.tpl.wr || !assets.tpl.ol || !assets.tpl.dl || !assets.tpl.db) {
    $('drill-info').textContent = 'The players failed to load. Please reload the page.';
    return;
  }
  buildTeams(assets);
  lineUp();
  S.phase = 'presnap';
  camSnap = true;
  await Promise.race([
    Promise.all([stadium.ready, crew.ready]).then(() => nextFrames(3)),
    new Promise((resolve) => setTimeout(resolve, 25000)),
  ]);
  S.ready = true;
}

let lastMs = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - lastMs) / 1000, 0, 0.05);
  lastMs = now;
  if (!(window.__drill && window.__drill.paused)) { try { update(dt); } catch (err) { console.error('update failed', err); } }
  renderer.render(scene, camera);
}

init().catch((err) => { console.error(err); $('status-line').textContent = err.message || 'Something went wrong loading the game.'; });

// ?debug=1 on localhost exposes the simulation for stepping it by hand (used to test it without a real clock)
if (qs('debug') === '1' && /^(localhost|127.0.0.1)$/.test(location.hostname)) window.__drill = { paused: false, S, R, update, press: (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code })), get A() { return A; }, ball, camera, renderer, scene };
