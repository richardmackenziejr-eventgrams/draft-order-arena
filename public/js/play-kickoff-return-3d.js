// Kickoff Return — 3D version. Defenders exist now (see the "Defenders"
// section below): they chase, commit to a lunge, and can end a return in a
// tackle instead of always reaching the end zone. Still missing: blockers
// on the return side (a separate, later phase) and a real tackle/fall
// animation (v1 just freezes his current pose). See
// play-kickoff-return.js, the real 2D game, which stays live and untouched
// independently of this one — the two are permanent, separate games (free
// "Retro Kick Return" vs. this paid 3D tier), not a replacement in progress.
//
// Wired into the REAL server/game engine (same instance/member/API calls
// as the 2D version) so the difficulty ladder and scoring were already
// live and correct before defenders did anything with them --
// defenderCount/defenderSpeed below come straight off that ladder.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedScene } from 'three/addons/utils/SkeletonUtils.js';

const instanceId = qs('instance');
const leagueId = qs('league');
const memberId = qs('member');
document.getElementById('back-link').href = '/';

let returnsPerPlayer = 5;
let fieldYards = 100;
let currentReturnConfig = null;

// ---- Three.js scene ---------------------------------------------------
const canvasWrap = document.getElementById('kr3d-canvas-wrap');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec9f0);
scene.fog = new THREE.Fog(0x8ec9f0, 40, 120);

const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
canvasWrap.insertBefore(renderer.domElement, canvasWrap.firstChild);

function resizeRenderer() {
  const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeRenderer);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(15, 25, 10);
sun.castShadow = true;
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 80;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

// ---- Field: forward = -Z, lateral = X, own goal line at z=0 -----------
const FIELD_WIDTH = 53.3;

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 1024;
  const ctx = c.getContext('2d');
  const n = 26;
  const stripeH = c.height / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#2f6b3f' : '#356f43';
    ctx.fillRect(0, i * stripeH, c.width, stripeH);
  }
  return new THREE.CanvasTexture(c);
}

let field = null;
function buildField(lengthYards) {
  if (field) scene.remove(field);
  field = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_WIDTH, lengthYards + 20),
    new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.95 })
  );
  field.rotation.x = -Math.PI / 2;
  field.position.set(0, 0, -lengthYards / 2);
  field.receiveShadow = true;
  scene.add(field);

  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let z = 0; z > -lengthYards; z -= 5) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_WIDTH - 2, 0.15), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.01, z);
    scene.add(line);
  }
  const goalLine = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_WIDTH - 2, 0.3), lineMat);
  goalLine.rotation.x = -Math.PI / 2;
  goalLine.position.set(0, 0.011, -lengthYards);
  scene.add(goalLine);

  // Hash marks (standard NFL spacing/offset: short ticks every yard, ~3.1
  // yards either side of the center). The yard-line stripes alone give no
  // LATERAL reference at all -- they're horizontal bands, identical no
  // matter how far the camera/runner shift sideways -- which is why a
  // spin/jump-cut's sideways burst read as invisible even once the camera
  // and position math were both confirmed correct. These are what actually
  // let a player see sideways movement, the same way they do on a real
  // broadcast, without needing any camera trickery to sell it.
  // One InstancedMesh rather than a mesh per tick (there's one every yard
  // for the whole field length, both sides -- a plain Mesh each would be a
  // couple hundred extra draw calls for no reason).
  const HASH_OFFSET = 3.1;
  const hashGeo = new THREE.PlaneGeometry(0.15, 0.7); // narrow laterally, long down-field -- real hash marks, not fat blobs
  const tickCount = Math.floor(lengthYards) * 2;
  const hashMesh = new THREE.InstancedMesh(hashGeo, lineMat, tickCount);
  hashMesh.rotation.x = -Math.PI / 2;
  const m = new THREE.Matrix4();
  let idx = 0;
  for (let z = 0; z > -lengthYards; z -= 1) {
    for (const x of [-HASH_OFFSET, HASH_OFFSET]) {
      // rotation.x above is on the whole InstancedMesh, so instance
      // transforms stay in the mesh's own (unrotated) local XY plane
      m.makeTranslation(x, -z, 0.01);
      hashMesh.setMatrixAt(idx++, m);
    }
  }
  scene.add(hashMesh);
}

// ---- Runner -------------------------------------------------------------
const RUNNER_GROUP = new THREE.Group();
scene.add(RUNNER_GROUP);

// Real Mixamo mocap clips (downloaded "without skin" -- pure animation
// data on the standard Mixamo rig, no character mesh of its own) applied
// directly to the kicker's existing skeleton. This works with no
// retargeting because all these files share the exact same bone names --
// replaces an earlier procedural (direct bone rotation) attempt that
// worked but looked stiff next to real mocap.
//
// Four clips: a straight run, dedicated "running right/left turn" clips
// used while holding forward+right or forward+left so a turn actually
// looks like banking into one instead of the straight-run cycle playing
// under a yaw twist, and a one-shot "run to stop" played when the player
// releases every movement key after running, instead of just freezing
// mid-stride. Mixamo has no "Running Left Turn" download, so the left
// clip is a programmatic mirror of the right-turn clip (swap each
// Left/Right bone pair's rotation track and negate the Y/Z quaternion
// components -- see scratchpad mirror_animation.py) -- verified visually
// frame-by-frame before shipping since a sign error there produces a
// silently broken-looking animation, not an error.
let mixer = null;
let runAction = null;
let runRightTurnAction = null;
let runLeftTurnAction = null;
let rightStrafeAction = null;
let leftStrafeAction = null;
let spinLeftAction = null;
let spinRightAction = null;
let jumpCutLeftAction = null;
let jumpCutRightAction = null;
let stopAction = null;
let turn180Action = null;
let activeAction = null;
let hipsBone = null;
let hipsBindPos = null;
let hipsBindQuat = null;
let spineBone = null;
let spineBindQuat = null;
let defenderTemplate = null; // the loaded (or null: not ready yet) defender scene -- each defender is its own SkeletonUtils.clone() of this
let defenderRunClip = null; // same AnimationClip object the runner uses, shared across every defender's own AnimationMixer

// The spin clips are JSON, not GLB: quaternion tracks retargeted offline
// onto this model's Mixamo bone names. Cascadeur-authored as of 2026-09-27
// (a genuine 360 -- same two-stage retarget pipeline as the jump cut, see
// [[kickoff-return-3d-controls-and-mocap]] memory), replacing the earlier
// DeepMotion capture. Right is the recorded clip; left is a programmatic
// mirror (same technique as the jump cut and the running-turn clips), until
// a second Cascadeur pass records it directly.
const SPIN_TIME_SCALE = 2.6; // the raw clip is ~1.17s; played faster so a spin is a quick move
function clipFromJson(j) {
  const tracks = Object.entries(j.tracks).map(([bone, vals]) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, j.times, vals));
  return new THREE.AnimationClip(j.name, j.duration, tracks);
}

// Celebration clips, played after crossing the goal line: a one-shot 180
// spin, then a randomly-picked dance loop. Each entry is { name, action }
// so a debug readout or future UI can show which dance got picked.
const DANCE_MODEL_PATHS = [
  '/models/hip-hop-dancing.glb',
  '/models/hip-hop-dancing-2.glb',
  '/models/robot-hip-hop-dance.glb',
  '/models/shuffling.glb',
  '/models/slide-hip-hop-dance.glb',
];
let danceActions = [];

Promise.all([
  new Promise((resolve) => new GLTFLoader().load('/models/player-kick.glb', resolve, undefined, (err) => console.error('runner model load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/running.glb', resolve, undefined, (err) => console.error('running animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/running-right-turn.glb', resolve, undefined, (err) => console.error('running-right-turn animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/running-left-turn.glb', resolve, undefined, (err) => console.error('running-left-turn animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/run-to-stop.glb', resolve, undefined, (err) => console.error('run-to-stop animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/running-turn-180.glb', resolve, undefined, (err) => console.error('running-turn-180 animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/right-strafe.glb', resolve, undefined, (err) => console.error('right-strafe animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/left-strafe.glb', resolve, undefined, (err) => console.error('left-strafe animation load failed', err))),
  fetch('/models/spin-left.json').then((r) => r.json()),
  fetch('/models/spin-right.json').then((r) => r.json()),
  fetch('/models/jump-cut-left.json').then((r) => r.json()),
  fetch('/models/jump-cut-right.json').then((r) => r.json()),
  Promise.all(DANCE_MODEL_PATHS.map((path) => new Promise((resolve) => new GLTFLoader().load(path, resolve, undefined, (err) => { console.error(`dance clip load failed: ${path}`, err); resolve(null); })))),
  // Rodin-generated, Mixamo-rigged (33 bones -- a reduced rig, no per-finger
  // articulation beyond one representative digit each hand, but every bone
  // the shared running.glb clip actually drives is present and matches the
  // runner's naming). Same graceful-miss pattern as the dance clips above
  // (resolve(null) on load failure) as a defense-in-depth fallback to plain
  // capsules, not because this is expected to be missing anymore.
  new Promise((resolve) => new GLTFLoader().load('/models/defender.glb', resolve, undefined, (err) => { console.error('defender model load failed -- falling back to placeholder capsules', err); resolve(null); })),
]).then(([runnerGltf, runGltf, rightTurnGltf, leftTurnGltf, stopGltf, turn180Gltf, rightStrafeGltf, leftStrafeGltf, spinLeftJson, spinRightJson, jumpCutLeftJson, jumpCutRightJson, danceGltfs, defenderGltf]) => {
  const model = runnerGltf.scene;
  model.rotation.y = Math.PI;
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  RUNNER_GROUP.add(model);

  model.traverse((o) => {
    if (o.isBone && o.name === 'mixamorigHips') hipsBone = o;
    if (o.isBone && o.name === 'mixamorigSpine') spineBone = o;
  });
  hipsBindPos = hipsBone ? hipsBone.position.clone() : null;
  hipsBindQuat = hipsBone ? hipsBone.quaternion.clone() : null;
  spineBindQuat = spineBone ? spineBone.quaternion.clone() : null;

  mixer = new THREE.AnimationMixer(model);
  runAction = mixer.clipAction(runGltf.animations[0]);
  runRightTurnAction = mixer.clipAction(rightTurnGltf.animations[0]);
  runLeftTurnAction = mixer.clipAction(leftTurnGltf.animations[0]);
  stopAction = mixer.clipAction(stopGltf.animations[0]);
  stopAction.setLoop(THREE.LoopOnce);
  stopAction.clampWhenFinished = true; // holds the last frame instead of snapping back to frame 0
  turn180Action = mixer.clipAction(turn180Gltf.animations[0]);
  turn180Action.setLoop(THREE.LoopOnce);
  turn180Action.clampWhenFinished = true;
  rightStrafeAction = mixer.clipAction(rightStrafeGltf.animations[0]);
  leftStrafeAction = mixer.clipAction(leftStrafeGltf.animations[0]);
  spinLeftAction = mixer.clipAction(clipFromJson(spinLeftJson));
  spinRightAction = mixer.clipAction(clipFromJson(spinRightJson));
  [spinLeftAction, spinRightAction].forEach((a) => { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.setEffectiveTimeScale(SPIN_TIME_SCALE); });
  // Cascadeur-authored (real performer footage will replace these later) --
  // already captured at normal speed, no coaching-footage slowdown to
  // compensate for like the spin clips need.
  jumpCutLeftAction = mixer.clipAction(clipFromJson(jumpCutLeftJson));
  jumpCutRightAction = mixer.clipAction(clipFromJson(jumpCutRightJson));
  [jumpCutLeftAction, jumpCutRightAction].forEach((a) => { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.setEffectiveTimeScale(JUMPCUT_TIME_SCALE); });
  ONE_SHOT_ACTIONS.add(stopAction).add(turn180Action).add(spinLeftAction).add(spinRightAction).add(jumpCutLeftAction).add(jumpCutRightAction);

  danceActions = danceGltfs
    .map((gltf, i) => (gltf ? { name: DANCE_MODEL_PATHS[i], action: mixer.clipAction(gltf.animations[0]) } : null))
    .filter(Boolean);
  danceActions.forEach(({ action }) => action.setLoop(THREE.LoopRepeat));

  if (defenderGltf) {
    defenderTemplate = defenderGltf.scene;
    defenderTemplate.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }
  defenderRunClip = runGltf.animations[0]; // one AnimationClip, reused across every defender's own mixer

  // `paused` only stops an action's own time from advancing -- it does NOT
  // stop the action from being evaluated by the mixer, so a "paused" clip
  // still blends its frozen pose into the skeleton alongside whichever
  // clip is actually active. Only `enabled = false` fully removes an
  // action from the blend. Without this, the turn/stop clips' poses were
  // silently bleeding into the straight run the whole time, which is what
  // was actually behind the persistent "running at an angle" report.
  const allActions = [runAction, runRightTurnAction, runLeftTurnAction, rightStrafeAction, leftStrafeAction, spinLeftAction, spinRightAction, jumpCutLeftAction, jumpCutRightAction, stopAction, turn180Action, ...danceActions.map((d) => d.action)];
  allActions.forEach((a) => { a.play(); a.paused = true; a.enabled = false; });
  runAction.enabled = true;
  activeAction = runAction;
});

// Switches which clip is actually advancing -- only one is ever enabled at
// a time (no crossfade yet, just an instant swap) so the mixer never
// blends two full-body poses together.
// Phase-continuity (carrying the previous clip's stride time over) only
// makes sense between the cyclical gait clips (run/right-turn/left-turn/
// strafes), which share a similar-length loop -- it's what keeps a
// run<->turn swap from popping mid-stride. stopAction and turn180Action
// are one-shot choreographed clips, not gait loops: starting turn180Action
// from a carried-over, effectively random mid-clip time made it begin
// from a jarring wrong pose AND finish its own animation early (since our
// separately-computed rotation eases over the clip's FULL duration while
// the clip itself only had the remaining fraction left to play), leaving
// him frozen mid-limb-pose while still visibly rotating for the rest of
// the turn -- this is what read as "a weird move before turning around."
const ONE_SHOT_ACTIONS = new Set();
// Short crossfade, used only for the spin's entry and exit: its captured
// pose differs enough from the run cycle that an instant swap visibly pops.
// Weights are driven by hand (not three's fade helpers) so the
// enabled/paused bookkeeping in setActiveAction stays the single source of
// truth; any later setActiveAction() call simply snaps a blend to done.
let blend = null; // { from, to, elapsed, dur }
function finishBlend() {
  if (!blend) return;
  blend.from.enabled = false;
  blend.from.paused = true;
  blend.from.weight = 1;
  blend.to.weight = 1;
  blend = null;
}
function blendToAction(next, dur) {
  if (!next || next === activeAction) return;
  finishBlend();
  const prev = activeAction;
  next.time = 0;
  next.weight = 0;
  next.enabled = true;
  next.paused = false;
  prev.weight = 1;
  prev.paused = false; // keeps advancing while it fades out
  blend = { from: prev, to: next, elapsed: 0, dur };
  activeAction = next;
}
function updateBlend(dt) {
  if (!blend) return;
  blend.elapsed += dt;
  const t = Math.min(1, blend.elapsed / blend.dur);
  blend.from.weight = 1 - t;
  blend.to.weight = t;
  if (t >= 1) finishBlend();
}

function setActiveAction(next) {
  if (!next || next === activeAction) return;
  finishBlend();
  activeAction.paused = true;
  activeAction.enabled = false;
  next.time = ONE_SHOT_ACTIONS.has(next) ? 0 : activeAction.time % next.getClip().duration;
  next.enabled = true;
  next.paused = false;
  activeAction = next;
}

// The clip has real baked root motion (the hips bone actually translates
// each stride, same as the kicker's own kick clip) -- reset to the bind
// pose every frame below so it only articulates limbs; actual world
// movement is driven by the game loop, not the animation.
//
// Resets ALL THREE axes, not just the horizontal X/Z (an earlier version
// preserved Y for a "natural" vertical bob). This clip's translation data
// turned out to be in a different unit scale than our model -- Y alone
// swings from ~0.5 to ~378 across one loop, versus the model's own
// ~1.8-unit total height -- a leftover from converting the standalone
// Mixamo download through Blender with no scale correction. That's not
// just an oversized bob: at that scale it flings the whole character up
// off-camera and snaps it back every loop, which is what actually looked
// like a camera jump. Discarding all three axes and relying purely on the
// rotation tracks (unaffected by any scale mismatch) for the visible
// running motion sidesteps the bad data entirely.
function stripRootMotion() {
  if (!hipsBone || !hipsBindPos) return;
  hipsBone.position.copy(hipsBindPos);
}

// The real "Running Right/Left Turn" mocap clips bank the whole torso
// hard into the turn (a real sprinter cutting sharply does lean that far)
// -- looks fine in isolation, but next to the shallow RUNNER_GROUP yaw
// turn below, it read as leaning without actually turning. Pull the
// hips/spine rotation partway back toward their bind pose every frame
// while a turn clip is active, damping the lean without touching the
// leg/arm swing (which is what actually sells "turning stride" and comes
// from other bones untouched here).
const TURN_LEAN_KEEP = 0.45; // fraction of the clip's own lean to keep; rest blends back to upright
function dampTurnLean() {
  if (hipsBone && hipsBindQuat) hipsBone.quaternion.slerp(hipsBindQuat, 1 - TURN_LEAN_KEEP);
  if (spineBone && spineBindQuat) spineBone.quaternion.slerp(spineBindQuat, 1 - TURN_LEAN_KEEP);
}

// ---- Controls: hold forward to run, left/right to steer ------------------
// A key is held from its keydown until its matching keyup -- nothing
// fancier. An earlier version tried to auto-expire "stale" entries using
// the OS's own key-repeat events as a heartbeat, on the theory that a lost
// keyup (e.g. from focus loss) needed a self-healing fallback. That was
// wrong: OS key-repeat commonly only re-fires for the single
// most-recently-pressed key (not every key still held), and even a solo
// held key can go quiet for longer than any reasonable staleness window
// before its first repeat fires. That made the "fix" prune genuinely-held
// keys mid-play, which is worse than the bug it was chasing. The real fix
// for lost focus is below: clear on blur/visibilitychange, plus a
// per-frame document.hasFocus() check in tick() as a backstop for
// whatever blur doesn't catch.
const heldKeys = new Set();
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
window.addEventListener('keydown', (e) => {
  if ((e.key === 's' || e.key === 'S') && !e.repeat) { spinQueued = true; return; }
  if ((e.key === 'a' || e.key === 'A') && !e.repeat) { jumpCutQueued = true; return; }
  if (!GAME_KEYS.has(e.key)) return;
  e.preventDefault(); // arrow keys scroll the page by default -- stop that while playing
  heldKeys.add(e.key);
});
window.addEventListener('keyup', (e) => {
  if (!GAME_KEYS.has(e.key)) return;
  e.preventDefault();
  heldKeys.delete(e.key);
});
window.addEventListener('blur', () => heldKeys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) heldKeys.clear(); });

// ---- Debug overlay (?debug=1) ---------------------------------------------
// Shows live held-key/steering/animation state on screen so a reported bug
// can be diagnosed from what the player actually sees, instead of guessing
// from a different machine/browser where it may not even reproduce.
const DEBUG = qs('debug') === '1';
let debugEl = null;
if (DEBUG) {
  debugEl = document.createElement('div');
  debugEl.style.cssText = 'position:absolute;bottom:6px;left:6px;right:6px;font:11px monospace;color:#0f0;background:#000c;padding:4px 6px;border-radius:4px;white-space:pre;pointer-events:none;z-index:5;';
  document.getElementById('kr3d-canvas-wrap').appendChild(debugEl);
}

const FORWARD_SPEED = 8.5; // yards/sec
const BACKWARD_SPEED = 4; // yards/sec
const LATERAL_SPEED = 6.5; // yards/sec

// ---- Chase camera ---------------------------------------------------------
const CHASE_HEIGHT = 3.4;
const CHASE_BACK = 5.5;
const LOOK_AHEAD = 10;
const LOOK_HEIGHT = 1.1;
const camTarget = new THREE.Vector3();
// Tried lagging/easing the camera's X during a spin/jump-cut so the burst
// would separate the runner from screen-center. Dropped it: any lag has to
// be paid back afterward, and the camera re-centering itself reads as the
// runner sliding backward toward where he started, whether that catch-up is
// instant (a visible pop) or eased (a slower slide) -- same complaint either
// way, just paced differently. The camera now always tracks the runner's X
// with zero lag, like it always did for steering. What actually makes the
// burst visible is the hash marks added to the field in buildField() -- a
// real lateral reference the yard-line stripes never provided (they're
// horizontal bands, identical no matter how far you shift sideways), the
// same way a real broadcast lets you see a cut via the hash marks/sideline,
// not via the camera doing anything unusual.
function snapCamera() {
  camera.position.set(RUNNER_GROUP.position.x, CHASE_HEIGHT, RUNNER_GROUP.position.z + CHASE_BACK);
  camera.lookAt(RUNNER_GROUP.position.x, LOOK_HEIGHT, RUNNER_GROUP.position.z - LOOK_AHEAD);
}

// Once the player crosses the goal line, the camera stops rigidly chasing
// and holds a single wider, slightly higher shot for the rest of the
// celebration (auto-run into the end zone, the 180 turn, the dance) --
// framed on where the endzone run actually ends, pulled back further than
// the tight over-the-shoulder running distance so the whole celebration
// reads as one held shot instead of the camera staying welded to his back.
const CELEBRATION_CAM_BACK = CHASE_BACK + 0.5;
const CELEBRATION_CAM_HEIGHT = CHASE_HEIGHT + 0.5;
let celebrationCamFrozen = false;
function freezeCelebrationCamera() {
  const finalZ = -(fieldYards + ENDZONE_RUN_YARDS);
  camera.position.set(RUNNER_GROUP.position.x, CELEBRATION_CAM_HEIGHT, finalZ + CELEBRATION_CAM_BACK);
  camTarget.set(RUNNER_GROUP.position.x, LOOK_HEIGHT + 0.3, finalZ);
  camera.lookAt(camTarget);
  celebrationCamFrozen = true;
}

// ---- Game loop ------------------------------------------------------------
let running = false;
let lastFrameAt = 0;
let animationHandle = null;
let wasMoving = false; // tracks the previous frame's movement state, to catch the exact moment it stops

// ---- Touchdown celebration -------------------------------------------------
// 'play' (player-controlled) -> 'endzone' (auto-run a bit further in) ->
// 'turn' (spin to face the camera) -> 'dance' (random pick, or skipped
// straight through if none are loaded yet) -> finalize (submit + show the
// result panel). Player input is ignored once phase leaves 'play'.
const ENDZONE_RUN_YARDS = 1;
let phase = 'play';
let phaseElapsed = 0;
let turnStartYaw = 0;

// Pure-backward turnaround: holding only ArrowDown (no forward, no
// lateral) spins the runner 180 to face his own goal line and then runs
// "forward" in that direction, instead of visibly running forward while
// drifting backward. Fast and clip-independent -- see the comment at the
// trigger site for why this doesn't reuse the celebration's turn180Action.
const BACKWARD_TURN_DURATION = 0.2;
let facingBackward = false;
let turningAround = false;
let turnFromYaw = 0;
let turnToYaw = 0;
let turnAroundElapsed = 0;

// Spin move (S). Goes the SAME direction he's already traveling laterally
// (forward+right spins right) -- run straight and it goes opposite the
// nearest defender -- there are no defenders yet, so straight-ahead spins
// just alternate sides for now.
const SPIN_COOLDOWN = 0.5;
const SPIN_FORWARD_FACTOR = 0.65; // fraction of run speed kept while spinning (if he was running forward)
const SPIN_LATERAL_SPEED = 10;    // yards/sec sideways burst, easing out over the spin
const SPIN_BLEND = 0.12;
let spin = null; // { dir: -1 left / +1 right, action, elapsed, dur, forward }
let spinCooldown = 0;
let spinQueued = false;
let lastSpinDir = 1;
// -1 / +1 = which side the closest defender is on; 0 = none close enough to
// matter. Ignores 'done' (already-resolved) defenders. A defender further
// than 15 yards away isn't a real influence on which way to spin/cut.
function nearestDefenderSide() {
  let nearest = null, nearestDist = Infinity;
  for (const d of defenders) {
    if (d.state === 'done') continue;
    const dist = Math.hypot(RUNNER_GROUP.position.x - d.group.position.x, RUNNER_GROUP.position.z - d.group.position.z);
    if (dist < nearestDist) { nearestDist = dist; nearest = d; }
  }
  if (!nearest || nearestDist > 15) return 0;
  const dx = nearest.group.position.x - RUNNER_GROUP.position.x;
  return dx === 0 ? 0 : Math.sign(dx);
}
function chooseSpinDir(lateral) {
  if (lateral !== 0) return Math.sign(lateral);
  const side = nearestDefenderSide();
  if (side !== 0) return -side;
  return -lastSpinDir;
}

// Jump cut (A). Unlike the spin, a cut is a hard plant-and-go in the SAME
// direction he's already drifting -- not a full reversal -- so it shares the
// spin's cooldown/commit shape but never negates the chosen side. Running
// straight alternates sides the same way spin does until defenders exist to
// actually pick a side from. He plants and stops his forward progress for
// the move (a real cut is a dead-stop weight transfer, not a stride) --
// FORWARD_FACTOR 0, not partial like the spin.
const JUMPCUT_COOLDOWN = 0.5;
const JUMPCUT_FORWARD_FACTOR = 0; // plants -- no forward progress during the cut itself
const JUMPCUT_LATERAL_SPEED = 13.5; // higher than spin's -- same move now plays out over a shorter clip (see JUMPCUT_TIME_SCALE), so speed has to carry more of the total distance
const JUMPCUT_TIME_SCALE = 2.5; // the raw Cascadeur clip reads as sluggish for a gameplay cut at its captured speed
const JUMPCUT_BLEND = 0.12;
let jumpCut = null; // { dir, action, elapsed, dur, forward }
let jumpCutCooldown = 0;
let jumpCutQueued = false;
let lastJumpCutDir = 1;
function chooseJumpCutDir(lateral) {
  if (lateral !== 0) return Math.sign(lateral);
  const side = nearestDefenderSide();
  if (side !== 0) return side;
  return -lastJumpCutDir;
}
function locomotionAction(lateral, movingForward) {
  if (movingForward && runRightTurnAction && lateral > 0) return runRightTurnAction;
  if (movingForward && runLeftTurnAction && lateral < 0) return runLeftTurnAction;
  if (rightStrafeAction && lateral > 0) return rightStrafeAction;
  if (leftStrafeAction && lateral < 0) return leftStrafeAction;
  return runAction;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// ---- Defenders --------------------------------------------------------
// Designed fresh for this 3D game rather than porting the 2D game's
// telegraphed wind-up/lunge/blocker system verbatim (that one's built
// around a 2D top-down "committed side" abstraction that doesn't map
// cleanly onto real 3D positions) -- but it keeps that system's one core
// fairness idea: a defender COMMITS to a target before closing the
// distance, rather than homing in continuously right up to contact. A pure
// proximity-triggers-instant-tackle rule would make the spin/jump-cut
// bursts nearly worthless, since they'd have to already be mid-move before
// a defender got close enough to matter. With a commit-then-resolve lunge,
// a burst that fires while a defender is closing is what actually saves
// the runner -- it physically moves him out of tackle radius before the
// lunge's target check happens.
//
// Each defender: chasing (seeks the runner's CURRENT position) -> once
// within DEFENDER_TRIGGER_RANGE, lunging (locked onto wherever the runner
// was the instant the lunge started, not tracking him further) -> resolved
// after DEFENDER_LUNGE_DURATION by checking the runner's position AT THAT
// MOMENT against the defender's -> tackle (ends the return) or recovering
// (a short pause) back to chasing.
const DEFENDER_BASE_SPEED = 7.5; // yd/s at the server's defenderSpeed multiplier of 1.0 -- a little under the runner's own 8.5 so the easiest level is never helplessly run down
const DEFENDER_LUNGE_SPEED_MULT = 1.6; // a lunge is a burst, faster than the steady chase speed
const DEFENDER_TRIGGER_RANGE = 2.5; // yards -- distance at which a chasing defender commits to a lunge
const DEFENDER_LUNGE_DURATION = 0.3; // seconds -- the commit window
const DEFENDER_TACKLE_RADIUS = 1.1; // yards -- matches the 2D game's own tackle radius
const DEFENDER_RECOVER_DURATION = 0.5; // seconds -- pause after a missed lunge before resuming the chase
const TACKLE_RESULT_DELAY = 0.8; // seconds -- brief beat on "TACKLED" before the result panel shows, same pacing idea as the touchdown celebration

let defenders = [];

function clearDefenders() {
  defenders.forEach((d) => scene.remove(d.group));
  defenders = [];
}

// count/speedMultiplier come straight off the server's difficulty ladder
// (gi.currentReturn.defenderCount/.defenderSpeed -- already computed and
// already reaching the client on every return, just unused until now).
function spawnDefenders(count, speedMultiplier) {
  clearDefenders();
  for (let i = 0; i < count; i++) {
    const group = new THREE.Group();
    let model, mixer = null, hipsBoneD = null, hipsBindPosD = null;
    if (defenderTemplate) {
      // A plain .clone() does not correctly share/duplicate a SkinnedMesh's
      // skeleton -- SkeletonUtils.clone() is the standard three.js pattern
      // for multiple independent posed instances of one rigged character.
      model = cloneSkinnedScene(defenderTemplate);
      model.rotation.y = Math.PI; // same base-facing correction as the runner's own model
      mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(defenderRunClip).play();
      // Same real baked root motion as the runner's own running clip (it's
      // the exact same clip -- see stripRootMotion()'s comment for why):
      // without resetting the hips bone every frame, each loop snaps the
      // mesh through the clip's full translation swing, which is what read
      // as "runs forward then glitches backwards, disappears and reappears
      // behind where it was."
      model.traverse((o) => { if (o.isBone && o.name === 'mixamorigHips') hipsBoneD = o; });
      hipsBindPosD = hipsBoneD ? hipsBoneD.position.clone() : null;
    } else {
      // Fallback if defender.glb fails to load for some reason (network
      // hiccup, file missing) -- the real Rodin/Mixamo model above is what
      // actually ships. Nothing about a defender's behavior below depends
      // on which one this is.
      model = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0xc0392b }));
      model.position.y = 1.0;
      model.castShadow = true;
    }
    group.add(model);
    scene.add(group);

    // Staggered down the field ahead of the runner (not one flat line) with
    // lateral jitter, clamped so nobody spawns past the goal line on a
    // short test field.
    const spawnZ = Math.max(-(fieldYards - 5), -(8 + i * 9 + Math.random() * 6));
    const spawnX = THREE.MathUtils.clamp((Math.random() * 2 - 1) * (FIELD_WIDTH / 2 - 4), -(FIELD_WIDTH / 2 - 2), FIELD_WIDTH / 2 - 2);
    group.position.set(spawnX, 0, spawnZ);

    defenders.push({
      group, mixer, hipsBone: hipsBoneD, hipsBindPos: hipsBindPosD,
      speed: DEFENDER_BASE_SPEED * speedMultiplier,
      state: 'chasing', // 'chasing' | 'lunging' | 'recovering' | 'done'
      lungeElapsed: 0, lungeTargetX: 0, lungeTargetZ: 0,
      recoverElapsed: 0,
    });
  }
}

function updateDefenders(dt) {
  for (const d of defenders) {
    if (d.state === 'chasing') {
      const dx = RUNNER_GROUP.position.x - d.group.position.x;
      const dz = RUNNER_GROUP.position.z - d.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= DEFENDER_TRIGGER_RANGE) {
        // Commit: lock onto where the runner IS right now. Everything from
        // here plays out against this fixed point, not his live position.
        d.state = 'lunging';
        d.lungeElapsed = 0;
        d.lungeTargetX = RUNNER_GROUP.position.x;
        d.lungeTargetZ = RUNNER_GROUP.position.z;
      } else if (dist > 1e-4) {
        d.group.position.x += (dx / dist) * d.speed * dt;
        d.group.position.z += (dz / dist) * d.speed * dt;
        d.group.rotation.y = Math.atan2(dx, dz) + Math.PI; // face travel direction -- same base-yaw convention as the runner's own model
      }
    } else if (d.state === 'lunging') {
      d.lungeElapsed += dt;
      const dx = d.lungeTargetX - d.group.position.x;
      const dz = d.lungeTargetZ - d.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-4) {
        const step = Math.min(dist, d.speed * DEFENDER_LUNGE_SPEED_MULT * dt);
        d.group.position.x += (dx / dist) * step;
        d.group.position.z += (dz / dist) * step;
        d.group.rotation.y = Math.atan2(dx, dz) + Math.PI;
      }
      // Checked every frame the lunge is active, not just once the fixed
      // window elapses -- against a defender closing HEAD-ON (they spawn
      // downfield and run back toward the returner), the closest approach
      // usually happens mid-lunge as the two paths cross, not at the end of
      // a fixed duration. Waiting for the window to finish before checking
      // let a defender who was briefly well inside tackle radius sail on
      // past and read as a clean miss. Resolved against the runner's
      // CURRENT position, not the locked target -- this is what a
      // spin/jump-cut fired during the closing distance actually beats:
      // he's no longer where the lunge was aimed.
      const hitDist = Math.hypot(RUNNER_GROUP.position.x - d.group.position.x, RUNNER_GROUP.position.z - d.group.position.z);
      if (hitDist <= DEFENDER_TACKLE_RADIUS) {
        d.state = 'done';
        triggerTackle();
      } else if (d.lungeElapsed >= DEFENDER_LUNGE_DURATION) {
        d.state = 'recovering';
        d.recoverElapsed = 0;
      }
    } else if (d.state === 'recovering') {
      d.recoverElapsed += dt;
      if (d.recoverElapsed >= DEFENDER_RECOVER_DURATION) d.state = 'chasing';
    }
    if (d.mixer) d.mixer.update(dt);
    if (d.hipsBone && d.hipsBindPos) d.hipsBone.position.copy(d.hipsBindPos);
  }
}

function triggerTackle() {
  if (phase !== 'play') return; // already resolved (e.g. reached the goal line the same frame) -- don't double-fire
  phase = 'tackled';
  phaseElapsed = 0;
  spin = null;
  jumpCut = null;
  setActiveAction(stopAction);
  if (activeAction) activeAction.paused = false;
  document.getElementById('kr3d-overlay-text').textContent = 'TACKLED';
}

function tick(now) {
  const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  if (running) {
    if (!document.hasFocus()) heldKeys.clear(); // backstop for whatever blur doesn't catch
    phaseElapsed += dt;
    let lateral = 0, movingForward = false, movingBackward = false;
    const wantSpin = spinQueued; // consumed (or dropped) every frame -- no buffering
    spinQueued = false;
    const wantJumpCut = jumpCutQueued;
    jumpCutQueued = false;

    if (phase === 'play') {
      if (heldKeys.has('ArrowLeft')) lateral -= 1;
      if (heldKeys.has('ArrowRight')) lateral += 1;
      movingForward = heldKeys.has('ArrowUp');
      movingBackward = !movingForward && heldKeys.has('ArrowDown');
      const lateralLimit = FIELD_WIDTH / 2 - 1.5;

      // Pure backward (no forward, no lateral) triggers a quick spin to
      // face his own goal line, then runs "forward" in that direction --
      // otherwise he visibly runs forward while drifting backward, the
      // same class of mismatch fixed for pure-lateral movement earlier,
      // just on the Z axis. Any OTHER combination (forward, or backward
      // with lateral) keeps the existing behavior untouched.
      //
      // Deliberately NOT turn180Action here (that's the touchdown
      // celebration's clip) -- it's a real ~0.7s captured performance
      // that lunges to one side as part of its own choreography, which
      // read as sluggish and lurchy for a gameplay direction change once
      // it always started from frame 0 (a prior fix). This is a pure
      // rotation instead, fast and clip-independent, with the run clip
      // already animating throughout so his legs don't pause either --
      // a snappy "spin move" rather than a stylized turn.
      if (spinCooldown > 0) spinCooldown -= dt;
      if (wantSpin && !spin && !jumpCut && spinCooldown <= 0 && !turningAround && !facingBackward) {
        const dir = chooseSpinDir(lateral);
        const action = dir < 0 ? spinLeftAction : spinRightAction;
        if (action) {
          lastSpinDir = dir;
          spin = { dir, action, elapsed: 0, dur: action.getClip().duration / SPIN_TIME_SCALE, forward: movingForward ? SPIN_FORWARD_FACTOR : 0 };
          blendToAction(action, SPIN_BLEND);
        }
      }

      if (jumpCutCooldown > 0) jumpCutCooldown -= dt;
      if (wantJumpCut && !jumpCut && !spin && jumpCutCooldown <= 0 && !turningAround && !facingBackward) {
        const dir = chooseJumpCutDir(lateral);
        const action = dir < 0 ? jumpCutLeftAction : jumpCutRightAction;
        if (action) {
          lastJumpCutDir = dir;
          jumpCut = { dir, action, elapsed: 0, dur: action.getClip().duration / JUMPCUT_TIME_SCALE, forward: JUMPCUT_FORWARD_FACTOR };
          blendToAction(action, JUMPCUT_BLEND);
        }
      }

      const wantsBackward = movingBackward && lateral === 0;
      if (!spin && !jumpCut && !turningAround && wantsBackward !== facingBackward) {
        turningAround = true;
        turnFromYaw = facingBackward ? Math.PI : 0;
        turnToYaw = wantsBackward ? Math.PI : 0;
        facingBackward = wantsBackward;
        turnAroundElapsed = 0;
        setActiveAction(runAction);
        if (activeAction) activeAction.paused = false;
      }

      if (spin) {
        // Committed move: steering input is ignored, he keeps drifting
        // forward (if he was running) and bursts sideways in the spin
        // direction, easing out as the rotation finishes.
        spin.elapsed += dt;
        const t = Math.min(1, spin.elapsed / spin.dur);
        RUNNER_GROUP.position.z -= FORWARD_SPEED * spin.forward * dt;
        RUNNER_GROUP.position.x = THREE.MathUtils.clamp(RUNNER_GROUP.position.x + spin.dir * SPIN_LATERAL_SPEED * (1 - t) * dt, -lateralLimit, lateralLimit);
        RUNNER_GROUP.rotation.y += (0 - RUNNER_GROUP.rotation.y) * Math.min(1, dt * 10); // fade out any steering lean
        if (t >= 1) {
          spin = null;
          spinCooldown = SPIN_COOLDOWN;
          const stillMoving = movingForward || movingBackward || lateral !== 0;
          blendToAction(stillMoving ? locomotionAction(lateral, movingForward) : stopAction, SPIN_BLEND);
          wasMoving = stillMoving;
        }
      } else if (jumpCut) {
        // Same committed-move shape as spin: steering ignored, lateral burst
        // in the SAME direction he picked (not reversed, unlike spin),
        // easing out as the clip finishes. Forward progress stops for the
        // move (JUMPCUT_FORWARD_FACTOR is 0) -- a cut is a plant, not a
        // stride, unlike the spin which keeps drifting forward.
        jumpCut.elapsed += dt;
        const t = Math.min(1, jumpCut.elapsed / jumpCut.dur);
        RUNNER_GROUP.position.z -= FORWARD_SPEED * jumpCut.forward * dt;
        RUNNER_GROUP.position.x = THREE.MathUtils.clamp(RUNNER_GROUP.position.x + jumpCut.dir * JUMPCUT_LATERAL_SPEED * (1 - t) * dt, -lateralLimit, lateralLimit);
        RUNNER_GROUP.rotation.y += (0 - RUNNER_GROUP.rotation.y) * Math.min(1, dt * 10);
        if (t >= 1) {
          jumpCut = null;
          jumpCutCooldown = JUMPCUT_COOLDOWN;
          const stillMoving = movingForward || movingBackward || lateral !== 0;
          blendToAction(stillMoving ? locomotionAction(lateral, movingForward) : stopAction, JUMPCUT_BLEND);
          wasMoving = stillMoving;
        }
      } else if (turningAround) {
        // Position stays put for this brief window (a committed action,
        // not cancelable mid-spin by tapping a different key) but it's
        // short enough now to barely register as a pause.
        turnAroundElapsed += dt;
        const t = Math.min(1, turnAroundElapsed / BACKWARD_TURN_DURATION);
        RUNNER_GROUP.rotation.y = turnFromYaw + (turnToYaw - turnFromYaw) * easeOutCubic(t);
        if (t >= 1) turningAround = false;
      } else {
        if (facingBackward) {
          // Turned around -- this is now his "forward": full running
          // speed and the normal run clip, not the slower backward
          // shuffle used when backward is combined with lateral input.
          RUNNER_GROUP.position.z = Math.min(0, RUNNER_GROUP.position.z + FORWARD_SPEED * dt);
        } else if (movingForward) {
          RUNNER_GROUP.position.z -= FORWARD_SPEED * dt;
        } else if (movingBackward) {
          RUNNER_GROUP.position.z = Math.min(0, RUNNER_GROUP.position.z + BACKWARD_SPEED * dt);
        }
        RUNNER_GROUP.position.x = THREE.MathUtils.clamp(RUNNER_GROUP.position.x + lateral * LATERAL_SPEED * dt, -lateralLimit, lateralLimit);
        // Negative sign is deliberate and confirmed via Three.js's own
        // getWorldDirection(), not a guess: the model carries a base
        // rotation.y = Math.PI (needed so it faces away from camera at
        // yaw=0), and composing that with a POSITIVE steering yaw rotates
        // the facing direction toward -X -- opposite the +X the character
        // is actually moving toward when lateral > 0 (ArrowRight). Without
        // this negation the body visibly faces away from its own direction
        // of travel, which is what read as "legs running the wrong way."
        const baseYaw = facingBackward ? Math.PI : 0;
        const targetYaw = baseYaw + -lateral * 0.32; // how far the whole body visibly turns to face the run direction
        RUNNER_GROUP.rotation.y += (targetYaw - RUNNER_GROUP.rotation.y) * Math.min(1, dt * 8);

        // Right/left (with or without forward) use their dedicated turn
        // clips; forward-only and backward use the straight run. Lateral
        // position already moved regardless of whether forward/backward
        // was also held (see position.x above), so isMoving has to
        // include lateral-only input too -- otherwise the position
        // slides but no clip plays, which is what read as sliding
        // without actually running. The exact frame movement stops (was
        // moving, now nothing held at all) plays the one-shot "run to
        // stop" clip instead of just freezing mid-stride; it holds its
        // own last frame afterward (clampWhenFinished), so nothing needs
        // to keep re-triggering it while the player stays stopped.
        // Pressing a movement key again immediately switches back to the
        // run, interrupting the stop clip if still mid-play.
        // Forward+turn uses the running-turn clips (banking into a turn
        // while sprinting); lateral-only or backward+lateral uses the
        // dedicated strafe clips instead -- a forward-run turn clip looks
        // wrong when he isn't actually running forward.
        const isMoving = movingForward || movingBackward || lateral !== 0;
        if (isMoving) {
          if (facingBackward) setActiveAction(runAction);
          else setActiveAction(locomotionAction(lateral, movingForward));
          if (activeAction) activeAction.paused = false;
        } else if (wasMoving && stopAction) {
          setActiveAction(stopAction);
        }
        wasMoving = isMoving;
      }

      updateDefenders(dt); // can flip phase to 'tackled' (triggerTackle) -- guard the touchdown check below on phase still being 'play'

      if (phase === 'play' && RUNNER_GROUP.position.z <= -fieldYards) {
        // Don't stop dead on the goal line -- keep auto-running a bit
        // further into the end zone, then spin to face the camera, then
        // (once some exist) a random celebration dance. See the phase
        // machine comment above.
        phase = 'endzone';
        phaseElapsed = 0;
        document.getElementById('kr3d-overlay-text').textContent = 'TOUCHDOWN!';
        setActiveAction(runAction);
        if (activeAction) activeAction.paused = false;
        spin = null;
        jumpCut = null;
        freezeCelebrationCamera();
      }
    } else if (phase === 'endzone') {
      RUNNER_GROUP.position.z -= FORWARD_SPEED * dt;
      if (RUNNER_GROUP.position.z <= -(fieldYards + ENDZONE_RUN_YARDS)) {
        phase = 'turn';
        phaseElapsed = 0;
        turnStartYaw = RUNNER_GROUP.rotation.y;
        if (turn180Action) {
          setActiveAction(turn180Action);
          activeAction.paused = false;
        }
      }
    } else if (phase === 'turn') {
      // The clip's own hip rotation only carries the animation part-way
      // around and drifts back toward 0 by its end (verified by sampling
      // it directly -- it peaks around 80 degrees, not a full 180), so the
      // actual about-face is driven explicitly here rather than trusted to
      // the clip. The clip still supplies the leg/arm motion underneath.
      const dur = turn180Action ? turn180Action.getClip().duration : 0.7;
      const t = Math.min(1, phaseElapsed / dur);
      RUNNER_GROUP.rotation.y = turnStartYaw + Math.PI * easeOutCubic(t);
      if (t >= 1) {
        phase = 'dance';
        phaseElapsed = 0;
        startDancePhase();
      }
    } else if (phase === 'tackled') {
      // No celebration for a tackle -- just a brief beat on "TACKLED"
      // (matching the touchdown path's own pacing idea) before the result
      // panel shows. Yardage is wherever he actually got to, clamped the
      // same way the server itself would (defense in depth, even though
      // the server already re-clamps on submit).
      if (phaseElapsed >= TACKLE_RESULT_DELAY) {
        const yardsGained = THREE.MathUtils.clamp(-RUNNER_GROUP.position.z, 0, fieldYards);
        finalizeCelebration(yardsGained, false);
      }
    }
    // 'dance' phase has nothing to drive here -- it just holds until
    // startDancePhase()'s own completion path (a timer for now, a
    // mixer 'finished' listener once real dance clips exist) calls
    // finalizeCelebration().

    updateBlend(dt);
    if (mixer) mixer.update(dt);
    stripRootMotion();
    if (activeAction === runRightTurnAction || activeAction === runLeftTurnAction) dampTurnLean();

    if (phase === 'play') {
      document.getElementById('kr3d-yards').textContent = `${Math.max(0, Math.round(fieldYards - (-RUNNER_GROUP.position.z)))} yards to go`;
    }

    if (debugEl) {
      const clipName = activeAction === runAction ? 'run' : activeAction === runRightTurnAction ? 'rightTurn' : activeAction === runLeftTurnAction ? 'leftTurn' : activeAction === rightStrafeAction ? 'rightStrafe' : activeAction === leftStrafeAction ? 'leftStrafe' : activeAction === spinLeftAction ? 'spinLeft' : activeAction === spinRightAction ? 'spinRight' : activeAction === jumpCutLeftAction ? 'jumpCutLeft' : activeAction === jumpCutRightAction ? 'jumpCutRight' : activeAction === stopAction ? 'stop' : activeAction === turn180Action ? 'turn180' : 'dance';
      const defSummary = defenders.map((d, i) => `${i}:${d.state}@${Math.hypot(RUNNER_GROUP.position.x - d.group.position.x, RUNNER_GROUP.position.z - d.group.position.z).toFixed(1)}yd`).join(' ');
      debugEl.textContent = `phase: ${phase}  held: [${[...heldKeys].join(', ')}]\nlateral: ${lateral}  movingForward: ${movingForward}  movingBackward: ${movingBackward}\nyaw: ${RUNNER_GROUP.rotation.y.toFixed(3)}  clip: ${clipName}  hasFocus: ${document.hasFocus()}\nfacingBackward: ${facingBackward}  turningAround: ${turningAround}  spin: ${spin ? spin.dir : '-'}  jumpCut: ${jumpCut ? jumpCut.dir : '-'}\npos: x=${RUNNER_GROUP.position.x.toFixed(3)} z=${RUNNER_GROUP.position.z.toFixed(3)}\ndefenders: ${defSummary || '(none)'}`;
    }
  }

  // Rigidly locked to the runner (no lerp/smoothing) -- a smoothed follow
  // camera settles into a constant lag behind steady forward motion, which
  // reads as the player slowly outrunning the camera until it "catches up"
  // in a jump on any frame-time hiccup. Setting position directly every
  // frame guarantees the camera moves at exactly the runner's own speed --
  // in X too (see the comment above snapCamera() for why X lag was tried
  // and dropped: any catch-up it owes back reads as him sliding backward).
  // Stops once the touchdown celebration camera takes over (see
  // freezeCelebrationCamera) so the celebration reads as one held shot
  // instead of the camera continuing to chase into the end zone.
  if (!celebrationCamFrozen) {
    camera.position.set(RUNNER_GROUP.position.x, CHASE_HEIGHT, RUNNER_GROUP.position.z + CHASE_BACK);
    camTarget.set(RUNNER_GROUP.position.x, LOOK_HEIGHT, RUNNER_GROUP.position.z - LOOK_AHEAD);
    camera.lookAt(camTarget);
  }

  renderer.render(scene, camera);
  animationHandle = requestAnimationFrame(tick);
}

function stopLoop() {
  if (animationHandle != null) cancelAnimationFrame(animationHandle);
  animationHandle = null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Return lifecycle -------------------------------------------------
async function startReturn(returnConfig) {
  currentReturnConfig = returnConfig;
  buildField(fieldYards);
  spawnDefenders(returnConfig.defenderCount ?? 3, returnConfig.defenderSpeed ?? 1); // ?? not || -- a legitimate 0 defenderCount shouldn't get silently overridden to 3
  RUNNER_GROUP.position.set(0, 0, 0);
  RUNNER_GROUP.rotation.y = 0;
  wasMoving = false;
  heldKeys.clear();
  // Reset directly rather than through setActiveAction() -- that always
  // unpauses whatever it switches to, which would start the run cycle
  // animating before the player has pressed anything.
  const allActions = [runAction, runRightTurnAction, runLeftTurnAction, rightStrafeAction, leftStrafeAction, spinLeftAction, spinRightAction, jumpCutLeftAction, jumpCutRightAction, stopAction, turn180Action, ...danceActions.map((d) => d.action)];
  finishBlend();
  spin = null;
  spinCooldown = 0;
  spinQueued = false;
  jumpCut = null;
  jumpCutCooldown = 0;
  jumpCutQueued = false;
  allActions.forEach((a) => { if (a) { a.paused = true; a.enabled = false; a.weight = 1; } });
  if (runAction) { runAction.enabled = true; activeAction = runAction; runAction.time = 0; }
  phase = 'play';
  phaseElapsed = 0;
  celebrationCamFrozen = false;
  facingBackward = false;
  turningAround = false;
  resizeRenderer();
  snapCamera();
  renderer.render(scene, camera);

  document.getElementById('return-info').textContent = `Return ${returnConfig.index + 1} of ${returnsPerPlayer}`;
  document.getElementById('kr-result').textContent = '';
  document.getElementById('next-return-btn').style.display = 'none';
  document.getElementById('kr3d-yards').textContent = `${fieldYards} yards to go`;

  const overlay = document.getElementById('kr3d-overlay-text');
  overlay.textContent = 'Kickoff...';
  await wait(900);
  overlay.textContent = '';

  running = true;
  lastFrameAt = performance.now();
  stopLoop();
  animationHandle = requestAnimationFrame(tick);
}

// Picks a random dance and lets it keep looping indefinitely -- these are
// full 15-17s routines (one's ~3.4s), not short loops, so there's no
// fixed hold time that lands on a clean loop boundary within a snappy
// celebration window; any flat timer just relocates the abrupt mid-motion
// cutoff rather than avoiding it. Instead, finalize (submit + show the
// result panel) after a brief beat but leave the dance running in the
// background -- the player watches as long as they want and moves on by
// clicking Next Return, which is what actually stops the animation loop
// (via the fresh requestAnimationFrame chain startReturn() sets up).
// If no dance clips loaded (DANCE_MODEL_PATHS empty), skips straight to
// finalizing -- the 'turn' phase's about-face is still a complete-feeling
// celebration on its own.
function startDancePhase() {
  if (danceActions.length === 0) {
    finalizeCelebration(fieldYards, true);
    return;
  }
  const pick = danceActions[Math.floor(Math.random() * danceActions.length)];
  setActiveAction(pick.action);
  activeAction.paused = false;
  wait(600).then(() => finalizeCelebration(fieldYards, true));
}

// Takes the actual outcome now instead of assuming a touchdown -- the
// 'tackled' phase branch above calls this too, with wherever he actually
// got to and touchdown: false. Both paths share the same submit/result-panel
// plumbing; only the reported outcome and the result text differ.
async function finalizeCelebration(yardsGained, touchdown) {
  // Deliberately does NOT stopLoop()/set running=false -- if a dance is
  // playing it keeps looping behind the result panel; the loop only
  // actually stops when startReturn() resets things for the next attempt.

  // "TOUCHDOWN!"/"TACKLED" stays up through the whole celebration now -- it
  // only gets overwritten when the next return's "Kickoff..." message shows
  // (see startReturn()), not cleared here.

  try {
    const { outcome } = await api('POST', `/api/game-instances/${instanceId}/kickoff-return/submit`, { memberId, yardsGained, touchdown });
    const resultEl = document.getElementById('kr-result');
    resultEl.textContent = outcome.touchdown
      ? `Touchdown! ${outcome.yardsGained} yards — +${outcome.points.toFixed(1)} points`
      : `Tackled after ${outcome.yardsGained} yards — +${outcome.points.toFixed(1)} points`;
    resultEl.style.color = outcome.touchdown ? '#4ade80' : '#f87171';
    document.getElementById('next-return-btn').style.display = 'inline-block';
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById('next-return-btn').addEventListener('click', async () => {
  const btn = document.getElementById('next-return-btn');
  btn.disabled = true;
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/kickoff-return/next`, { memberId });
    if (gi.status === 'completed') {
      showDone(`Contest finished. You scored ${gi.yourScore.toFixed(1)} points (${gi.yourTouchdowns} touchdown${gi.yourTouchdowns === 1 ? '' : 's'}).`);
    } else if (gi.hasCompleted) {
      showDone(`You finished with ${gi.yourScore.toFixed(1)} points! Waiting on the rest of the league…`);
      poll();
    } else {
      returnsPerPlayer = gi.returnsPerPlayer || returnsPerPlayer;
      fieldYards = gi.currentReturn.fieldYards || fieldYards;
      startReturn(gi.currentReturn);
    }
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

function showDone(message) {
  stopLoop();
  document.getElementById('game-panel').style.display = 'none';
  document.getElementById('done-panel').style.display = 'block';
  document.getElementById('done-message').textContent = message;
  document.getElementById('back-link').style.display = '';
}

async function init() {
  if (!memberId) {
    document.getElementById('status-line').textContent = 'This is a spectator link — kickoff returns are played individually by each member.';
    return;
  }
  const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
  returnsPerPlayer = gi.returnsPerPlayer || returnsPerPlayer;

  if (gi.status === 'completed') {
    showDone(gi.yourScore != null ? `Contest finished. You scored ${gi.yourScore.toFixed(1)} points (${gi.yourTouchdowns} touchdown${gi.yourTouchdowns === 1 ? '' : 's'}).` : 'Contest finished.');
    return;
  }
  if (gi.hasCompleted) {
    showDone(`You finished with ${gi.yourScore.toFixed(1)} points! Waiting on the rest of the league…`);
    poll();
    return;
  }

  document.getElementById('status-line').style.display = 'none';
  document.getElementById('game-panel').style.display = 'block';
  fieldYards = gi.currentReturn.fieldYards || fieldYards;
  buildField(fieldYards);
  resizeRenderer();
  RUNNER_GROUP.position.set(0, 0, 0);
  snapCamera();
  renderer.render(scene, camera);

  if (gi.currentReturn.index === 0) {
    currentReturnConfig = gi.currentReturn;
    document.getElementById('return-info').textContent = `Return 1 of ${returnsPerPlayer}`;
    document.getElementById('start-return-btn').style.display = 'inline-block';
    document.getElementById('start-return-btn').addEventListener('click', () => {
      document.getElementById('start-return-btn').style.display = 'none';
      startReturn(gi.currentReturn);
    }, { once: true });
  } else {
    startReturn(gi.currentReturn);
  }
}

function poll() {
  setInterval(async () => {
    const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
    if (gi.status === 'completed') {
      showDone(gi.yourScore != null ? `Contest finished. You scored ${gi.yourScore.toFixed(1)} points (${gi.yourTouchdowns} touchdown${gi.yourTouchdowns === 1 ? '' : 's'}).` : 'Contest finished.');
    }
  }, 4000);
}

init();
