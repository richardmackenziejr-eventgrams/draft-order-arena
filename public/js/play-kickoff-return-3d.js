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
// Three clips: a straight run, a dedicated "running right turn" used while
// holding forward+right so a turn actually looks like banking into one
// instead of the straight-run cycle playing under a yaw twist, and a
// one-shot "run to stop" played when the player releases every movement
// key after running, instead of just freezing mid-stride. There's no
// left-turn clip yet (only "Running Right Turn" was downloaded so far) --
// forward+left falls back to the straight run for now. A matching
// "Running Left Turn" download would let this mirror cleanly.
let mixer = null;
let runAction = null;
let runRightTurnAction = null;
let stopAction = null;
let activeAction = null;
let hipsBone = null;
let hipsBindPos = null;

Promise.all([
  new Promise((resolve) => new GLTFLoader().load('/models/player-kick.glb', resolve, undefined, (err) => console.error('runner model load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/running.glb', resolve, undefined, (err) => console.error('running animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/running-right-turn.glb', resolve, undefined, (err) => console.error('running-right-turn animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/run-to-stop.glb', resolve, undefined, (err) => console.error('run-to-stop animation load failed', err))),
]).then(([runnerGltf, runGltf, rightTurnGltf, stopGltf]) => {
  const model = runnerGltf.scene;
  model.rotation.y = Math.PI;
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  RUNNER_GROUP.add(model);

  model.traverse((o) => { if (o.isBone && o.name === 'mixamorigHips') hipsBone = o; });
  hipsBindPos = hipsBone ? hipsBone.position.clone() : null;

  mixer = new THREE.AnimationMixer(model);
  runAction = mixer.clipAction(runGltf.animations[0]);
  runRightTurnAction = mixer.clipAction(rightTurnGltf.animations[0]);
  stopAction = mixer.clipAction(stopGltf.animations[0]);
  stopAction.setLoop(THREE.LoopOnce);
  stopAction.clampWhenFinished = true; // holds the last frame instead of snapping back to frame 0
  [runAction, runRightTurnAction, stopAction].forEach((a) => { a.play(); a.paused = true; });
  activeAction = runAction;
});

// Switches which clip is actually advancing -- only one plays at a time
// (no crossfade yet, just an instant swap) so the mixer doesn't blend two
// full-body poses together.
function setActiveAction(next) {
  if (!next || next === activeAction) return;
  activeAction.paused = true;
  if (next !== stopAction) next.time = activeAction.time % next.getClip().duration; // keep stride phase roughly continuous across a run<->turn swap; the stop clip always starts from its own frame 0
  else next.time = 0;
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

// ---- Controls: hold forward to run, left/right to steer ------------------
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

// ---- Game loop ------------------------------------------------------------
let running = false;
let lastFrameAt = 0;
let animationHandle = null;
let wasMoving = false; // tracks the previous frame's movement state, to catch the exact moment it stops

function tick(now) {
  const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  if (running) {
    let lateral = 0;
    if (heldKeys.has('ArrowLeft')) lateral -= 1;
    if (heldKeys.has('ArrowRight')) lateral += 1;
    const movingForward = heldKeys.has('ArrowUp');
    const movingBackward = !movingForward && heldKeys.has('ArrowDown');
    const lateralLimit = FIELD_WIDTH / 2 - 1.5;

    if (movingForward) RUNNER_GROUP.position.z -= FORWARD_SPEED * dt;
    else if (movingBackward) RUNNER_GROUP.position.z = Math.min(0, RUNNER_GROUP.position.z + BACKWARD_SPEED * dt);
    RUNNER_GROUP.position.x = THREE.MathUtils.clamp(RUNNER_GROUP.position.x + lateral * LATERAL_SPEED * dt, -lateralLimit, lateralLimit);
    const targetYaw = lateral * 0.25;
    RUNNER_GROUP.rotation.y += (targetYaw - RUNNER_GROUP.rotation.y) * Math.min(1, dt * 8);

    // Forward+right uses the dedicated turn clip; everything else moving
    // (straight forward, forward+left, backward) uses the straight run.
    // The exact frame movement stops (was moving, now nothing/no longer
    // forward-or-back held) plays the one-shot "run to stop" clip instead
    // of just freezing mid-stride; it holds its own last frame afterward
    // (clampWhenFinished), so nothing needs to keep re-triggering it while
    // the player stays stopped. Pressing a movement key again immediately
    // switches back to the run, interrupting the stop clip if still mid-play.
    const isMoving = movingForward || movingBackward;
    if (isMoving) {
      if (runRightTurnAction && movingForward && lateral > 0) setActiveAction(runRightTurnAction);
      else setActiveAction(runAction);
      if (activeAction) activeAction.paused = false;
    } else if (wasMoving && stopAction) {
      setActiveAction(stopAction);
    }
    wasMoving = isMoving;
    if (mixer) mixer.update(dt);
    stripRootMotion();

    document.getElementById('kr3d-yards').textContent = `${Math.max(0, Math.round(fieldYards - (-RUNNER_GROUP.position.z)))} yards to go`;

    if (RUNNER_GROUP.position.z <= -fieldYards) {
      RUNNER_GROUP.position.z = -fieldYards;
      running = false;
      finishReturn();
    }
  }

  // Rigidly locked to the runner (no lerp/smoothing) -- a smoothed follow
  // camera settles into a constant lag behind steady forward motion, which
  // reads as the player slowly outrunning the camera until it "catches up"
  // in a jump on any frame-time hiccup. Setting position directly every
  // frame guarantees the camera moves at exactly the runner's own speed.
  camera.position.set(RUNNER_GROUP.position.x, CHASE_HEIGHT, RUNNER_GROUP.position.z + CHASE_BACK);
  camTarget.set(RUNNER_GROUP.position.x, LOOK_HEIGHT, RUNNER_GROUP.position.z - LOOK_AHEAD);
  camera.lookAt(camTarget);

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
  // Reset directly rather than through setActiveAction() -- that always
  // unpauses whatever it switches to, which would start the run cycle
  // animating before the player has pressed anything.
  [runAction, runRightTurnAction, stopAction].forEach((a) => { if (a) a.paused = true; });
  if (runAction) { activeAction = runAction; runAction.time = 0; }
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

async function finishReturn() {
  stopLoop();
  const yardsGained = fieldYards; // no defenders yet -- every return reaches the end zone
  const touchdown = true;

  document.getElementById('kr3d-overlay-text').textContent = 'TOUCHDOWN!';
  await wait(1200);
  document.getElementById('kr3d-overlay-text').textContent = '';

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
