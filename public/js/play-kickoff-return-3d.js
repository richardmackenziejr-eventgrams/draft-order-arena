// Kickoff Return — 3D movement/camera preview. NOT the real game yet: no
// defenders, no tackles, every return runs all the way to the end zone.
// This exists to nail the runner model, running animation, and chase
// camera in isolation before defenders are layered back in (see
// play-kickoff-return.js, the real 2D game, which stays live and untouched
// until this reaches feature parity with it).
//
// Wired into the REAL server/game engine (same instance/member/API calls
// as the 2D version) so the difficulty ladder and scoring are already
// live and correct — only the defender simulation and its "how did this
// return end" branch are missing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
let stopAction = null;
let turn180Action = null;
let activeAction = null;
let hipsBone = null;
let hipsBindPos = null;
let hipsBindQuat = null;
let spineBone = null;
let spineBindQuat = null;

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
  Promise.all(DANCE_MODEL_PATHS.map((path) => new Promise((resolve) => new GLTFLoader().load(path, resolve, undefined, (err) => { console.error(`dance clip load failed: ${path}`, err); resolve(null); })))),
]).then(([runnerGltf, runGltf, rightTurnGltf, leftTurnGltf, stopGltf, turn180Gltf, rightStrafeGltf, leftStrafeGltf, danceGltfs]) => {
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

  danceActions = danceGltfs
    .map((gltf, i) => (gltf ? { name: DANCE_MODEL_PATHS[i], action: mixer.clipAction(gltf.animations[0]) } : null))
    .filter(Boolean);
  danceActions.forEach(({ action }) => action.setLoop(THREE.LoopRepeat));

  // `paused` only stops an action's own time from advancing -- it does NOT
  // stop the action from being evaluated by the mixer, so a "paused" clip
  // still blends its frozen pose into the skeleton alongside whichever
  // clip is actually active. Only `enabled = false` fully removes an
  // action from the blend. Without this, the turn/stop clips' poses were
  // silently bleeding into the straight run the whole time, which is what
  // was actually behind the persistent "running at an angle" report.
  const allActions = [runAction, runRightTurnAction, runLeftTurnAction, rightStrafeAction, leftStrafeAction, stopAction, turn180Action, ...danceActions.map((d) => d.action)];
  allActions.forEach((a) => { a.play(); a.paused = true; a.enabled = false; });
  runAction.enabled = true;
  activeAction = runAction;
});

// Switches which clip is actually advancing -- only one is ever enabled at
// a time (no crossfade yet, just an instant swap) so the mixer never
// blends two full-body poses together.
function setActiveAction(next) {
  if (!next || next === activeAction) return;
  activeAction.paused = true;
  activeAction.enabled = false;
  if (next !== stopAction) next.time = activeAction.time % next.getClip().duration; // keep stride phase roughly continuous across a run<->turn swap; the stop clip always starts from its own frame 0
  else next.time = 0;
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

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function tick(now) {
  const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  if (running) {
    if (!document.hasFocus()) heldKeys.clear(); // backstop for whatever blur doesn't catch
    phaseElapsed += dt;
    let lateral = 0, movingForward = false, movingBackward = false;

    if (phase === 'play') {
      if (heldKeys.has('ArrowLeft')) lateral -= 1;
      if (heldKeys.has('ArrowRight')) lateral += 1;
      movingForward = heldKeys.has('ArrowUp');
      movingBackward = !movingForward && heldKeys.has('ArrowDown');
      const lateralLimit = FIELD_WIDTH / 2 - 1.5;

      if (movingForward) RUNNER_GROUP.position.z -= FORWARD_SPEED * dt;
      else if (movingBackward) RUNNER_GROUP.position.z = Math.min(0, RUNNER_GROUP.position.z + BACKWARD_SPEED * dt);
      RUNNER_GROUP.position.x = THREE.MathUtils.clamp(RUNNER_GROUP.position.x + lateral * LATERAL_SPEED * dt, -lateralLimit, lateralLimit);
      // Negative sign is deliberate and confirmed via Three.js's own
      // getWorldDirection(), not a guess: the model carries a base
      // rotation.y = Math.PI (needed so it faces away from camera at
      // yaw=0), and composing that with a POSITIVE steering yaw rotates
      // the facing direction toward -X -- opposite the +X the character
      // is actually moving toward when lateral > 0 (ArrowRight). Without
      // this negation the body visibly faces away from its own direction
      // of travel, which is what read as "legs running the wrong way."
      const targetYaw = -lateral * 0.32; // how far the whole body visibly turns to face the run direction
      RUNNER_GROUP.rotation.y += (targetYaw - RUNNER_GROUP.rotation.y) * Math.min(1, dt * 8);

      // Right/left (with or without forward) use their dedicated turn
      // clips; forward-only and backward use the straight run. Lateral
      // position already moved regardless of whether forward/backward was
      // also held (see position.x above), so isMoving has to include
      // lateral-only input too -- otherwise the position slides but no
      // clip plays, which is what read as sliding without actually
      // running. The exact frame movement stops (was moving, now nothing
      // held at all) plays the one-shot "run to stop" clip instead of
      // just freezing mid-stride; it holds its own last frame afterward
      // (clampWhenFinished), so nothing needs to keep re-triggering it
      // while the player stays stopped. Pressing a movement key again
      // immediately switches back to the run, interrupting the stop clip
      // if still mid-play.
      // Forward+turn uses the running-turn clips (banking into a turn
      // while sprinting); lateral-only or backward+lateral uses the
      // dedicated strafe clips instead -- a forward-run turn clip looks
      // wrong when he isn't actually running forward.
      const isMoving = movingForward || movingBackward || lateral !== 0;
      if (isMoving) {
        if (movingForward && runRightTurnAction && lateral > 0) setActiveAction(runRightTurnAction);
        else if (movingForward && runLeftTurnAction && lateral < 0) setActiveAction(runLeftTurnAction);
        else if (rightStrafeAction && lateral > 0) setActiveAction(rightStrafeAction);
        else if (leftStrafeAction && lateral < 0) setActiveAction(leftStrafeAction);
        else setActiveAction(runAction);
        if (activeAction) activeAction.paused = false;
      } else if (wasMoving && stopAction) {
        setActiveAction(stopAction);
      }
      wasMoving = isMoving;

      if (RUNNER_GROUP.position.z <= -fieldYards) {
        // Don't stop dead on the goal line -- keep auto-running a bit
        // further into the end zone, then spin to face the camera, then
        // (once some exist) a random celebration dance. See the phase
        // machine comment above.
        phase = 'endzone';
        phaseElapsed = 0;
        document.getElementById('kr3d-overlay-text').textContent = 'TOUCHDOWN!';
        setActiveAction(runAction);
        if (activeAction) activeAction.paused = false;
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
    }
    // 'dance' phase has nothing to drive here -- it just holds until
    // startDancePhase()'s own completion path (a timer for now, a
    // mixer 'finished' listener once real dance clips exist) calls
    // finalizeCelebration().

    if (mixer) mixer.update(dt);
    stripRootMotion();
    if (activeAction === runRightTurnAction || activeAction === runLeftTurnAction) dampTurnLean();

    if (phase === 'play') {
      document.getElementById('kr3d-yards').textContent = `${Math.max(0, Math.round(fieldYards - (-RUNNER_GROUP.position.z)))} yards to go`;
    }

    if (debugEl) {
      const clipName = activeAction === runAction ? 'run' : activeAction === runRightTurnAction ? 'rightTurn' : activeAction === runLeftTurnAction ? 'leftTurn' : activeAction === rightStrafeAction ? 'rightStrafe' : activeAction === leftStrafeAction ? 'leftStrafe' : activeAction === stopAction ? 'stop' : activeAction === turn180Action ? 'turn180' : 'dance';
      debugEl.textContent = `phase: ${phase}  held: [${[...heldKeys].join(', ')}]\nlateral: ${lateral}  movingForward: ${movingForward}  movingBackward: ${movingBackward}\nyaw: ${RUNNER_GROUP.rotation.y.toFixed(3)}  clip: ${clipName}  hasFocus: ${document.hasFocus()}`;
    }
  }

  // Rigidly locked to the runner (no lerp/smoothing) -- a smoothed follow
  // camera settles into a constant lag behind steady forward motion, which
  // reads as the player slowly outrunning the camera until it "catches up"
  // in a jump on any frame-time hiccup. Setting position directly every
  // frame guarantees the camera moves at exactly the runner's own speed.
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
  RUNNER_GROUP.position.set(0, 0, 0);
  RUNNER_GROUP.rotation.y = 0;
  wasMoving = false;
  heldKeys.clear();
  // Reset directly rather than through setActiveAction() -- that always
  // unpauses whatever it switches to, which would start the run cycle
  // animating before the player has pressed anything.
  const allActions = [runAction, runRightTurnAction, runLeftTurnAction, rightStrafeAction, leftStrafeAction, stopAction, turn180Action, ...danceActions.map((d) => d.action)];
  allActions.forEach((a) => { if (a) { a.paused = true; a.enabled = false; } });
  if (runAction) { runAction.enabled = true; activeAction = runAction; runAction.time = 0; }
  phase = 'play';
  phaseElapsed = 0;
  celebrationCamFrozen = false;
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
    finalizeCelebration();
    return;
  }
  const pick = danceActions[Math.floor(Math.random() * danceActions.length)];
  setActiveAction(pick.action);
  activeAction.paused = false;
  wait(600).then(finalizeCelebration);
}

async function finalizeCelebration() {
  // Deliberately does NOT stopLoop()/set running=false -- if a dance is
  // playing it keeps looping behind the result panel; the loop only
  // actually stops when startReturn() resets things for the next attempt.
  const yardsGained = fieldYards; // no defenders yet -- every return reaches the end zone
  const touchdown = true;

  // "TOUCHDOWN!" stays up through the whole celebration now -- it only
  // gets overwritten when the next return's "Kickoff..." message shows
  // (see startReturn()), not cleared here.

  try {
    const { outcome } = await api('POST', `/api/game-instances/${instanceId}/kickoff-return/submit`, { memberId, yardsGained, touchdown });
    const resultEl = document.getElementById('kr-result');
    resultEl.textContent = `Touchdown! ${outcome.yardsGained} yards — +${outcome.points.toFixed(1)} points`;
    resultEl.style.color = '#4ade80';
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
