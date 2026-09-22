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

// A real Mixamo "Running" mocap clip (downloaded "without skin" -- it's
// pure animation data on the standard Mixamo rig, no character mesh of its
// own) applied directly to the kicker's existing skeleton. This works with
// no retargeting because both files share the exact same bone names --
// replaces an earlier procedural (direct bone rotation) attempt that
// worked but looked stiff next to a real mocap cycle.
let mixer = null;
let runAction = null;
let hipsBone = null;
let hipsBindPos = null;

Promise.all([
  new Promise((resolve) => new GLTFLoader().load('/models/player-kick.glb', resolve, undefined, (err) => console.error('runner model load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/running.glb', resolve, undefined, (err) => console.error('running animation load failed', err))),
]).then(([runnerGltf, animGltf]) => {
  const model = runnerGltf.scene;
  model.rotation.y = Math.PI;
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  RUNNER_GROUP.add(model);

  model.traverse((o) => { if (o.isBone && o.name === 'mixamorigHips') hipsBone = o; });
  hipsBindPos = hipsBone ? hipsBone.position.clone() : null;

  mixer = new THREE.AnimationMixer(model);
  runAction = mixer.clipAction(animGltf.animations[0]);
  runAction.play();
  runAction.paused = true; // only advances while actually running forward -- see tick()
});

// The clip has real baked root motion (the hips bone actually translates
// forward each stride, same as the kicker's own kick clip) -- stripped out
// every frame below so it only articulates limbs; actual world movement is
// driven by the game loop, not the animation.
function stripRootMotion() {
  if (!hipsBone || !hipsBindPos) return;
  hipsBone.position.x = hipsBindPos.x;
  hipsBone.position.z = hipsBindPos.z;
}

// ---- Controls: hold forward to run, left/right to steer ------------------
const heldKeys = new Set();
window.addEventListener('keydown', (e) => heldKeys.add(e.key));
window.addEventListener('keyup', (e) => heldKeys.delete(e.key));

const FORWARD_SPEED = 8.5; // yards/sec
const BACKWARD_SPEED = 4; // yards/sec
const LATERAL_SPEED = 6.5; // yards/sec

// ---- Chase camera ---------------------------------------------------------
const CHASE_HEIGHT = 3.4;
const CHASE_BACK = 5.5;
const LOOK_AHEAD = 10;
const LOOK_HEIGHT = 1.1;
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();
function snapCamera() {
  camera.position.set(RUNNER_GROUP.position.x, CHASE_HEIGHT, RUNNER_GROUP.position.z + CHASE_BACK);
  camera.lookAt(RUNNER_GROUP.position.x, LOOK_HEIGHT, RUNNER_GROUP.position.z - LOOK_AHEAD);
}

// ---- Game loop ------------------------------------------------------------
let running = false;
let lastFrameAt = 0;
let animationHandle = null;

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

    // The run cycle only plays while actually moving -- standing still (or
    // only side-stepping with no forward/back held) freezes on whatever
    // frame it's on rather than running in place.
    if (runAction) runAction.paused = !(movingForward || movingBackward);
    if (mixer) mixer.update(dt);
    stripRootMotion();

    document.getElementById('kr3d-yards').textContent = `${Math.max(0, Math.round(fieldYards - (-RUNNER_GROUP.position.z)))} yards to go`;

    if (RUNNER_GROUP.position.z <= -fieldYards) {
      RUNNER_GROUP.position.z = -fieldYards;
      running = false;
      finishReturn();
    }
  }

  camPos.set(RUNNER_GROUP.position.x, CHASE_HEIGHT, RUNNER_GROUP.position.z + CHASE_BACK);
  camTarget.set(RUNNER_GROUP.position.x, LOOK_HEIGHT, RUNNER_GROUP.position.z - LOOK_AHEAD);
  camera.position.lerp(camPos, Math.min(1, dt * 6));
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
