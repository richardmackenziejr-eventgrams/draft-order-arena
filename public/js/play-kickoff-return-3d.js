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
let runAnim = null;

function findBone(root, name) {
  let found = null;
  root.traverse((o) => { if (o.isBone && o.name === name) found = o; });
  return found;
}

new GLTFLoader().load('/models/player-kick.glb', (gltf) => {
  const model = gltf.scene;
  model.rotation.y = Math.PI;
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  RUNNER_GROUP.add(model);

  const boneNames = {
    hips: 'mixamorigHips',
    leftUpLeg: 'mixamorigLeftUpLeg', rightUpLeg: 'mixamorigRightUpLeg',
    leftLeg: 'mixamorigLeftLeg', rightLeg: 'mixamorigRightLeg',
    leftArm: 'mixamorigLeftArm', rightArm: 'mixamorigRightArm',
    leftForeArm: 'mixamorigLeftForeArm', rightForeArm: 'mixamorigRightForeArm',
    spine: 'mixamorigSpine',
  };
  const bones = {};
  for (const key in boneNames) bones[key] = findBone(model, boneNames[key]);
  const binds = {};
  for (const key in bones) if (bones[key]) binds[key] = bones[key].rotation.clone();
  const hipsBindY = bones.hips ? bones.hips.position.y : 0;
  runAnim = { bones, binds, hipsBindY };
}, undefined, (err) => console.error('runner model load failed', err));

// Procedural run cycle -- same technique as the referee's arm-signal
// animation (direct bone rotation, no baked clip): legs swing opposite
// each other, knees bend more during forward recovery than plant, arms
// counter-swing opposite their same-side leg.
const STRIDE_HZ = 1.55;
const THIGH_SWING = 0.62;
const KNEE_BEND = 1.0;
const ARM_SWING = 0.55;
const ELBOW_BEND = 0.35;
const SPINE_LEAN = 0.12;
const BOB_AMP = 0.045;
let gaitPhase = 0;

function applyRunCycle() {
  if (!runAnim) return;
  const { bones, binds, hipsBindY } = runAnim;
  const p = gaitPhase;
  if (bones.leftUpLeg) bones.leftUpLeg.rotation.x = binds.leftUpLeg.x + Math.sin(p) * THIGH_SWING;
  if (bones.rightUpLeg) bones.rightUpLeg.rotation.x = binds.rightUpLeg.x + Math.sin(p + Math.PI) * THIGH_SWING;
  if (bones.leftLeg) bones.leftLeg.rotation.x = binds.leftLeg.x + Math.max(0, Math.sin(p + Math.PI * 0.5)) * KNEE_BEND;
  if (bones.rightLeg) bones.rightLeg.rotation.x = binds.rightLeg.x + Math.max(0, Math.sin(p + Math.PI * 1.5)) * KNEE_BEND;
  if (bones.leftArm) bones.leftArm.rotation.x = binds.leftArm.x + Math.sin(p + Math.PI) * ARM_SWING;
  if (bones.rightArm) bones.rightArm.rotation.x = binds.rightArm.x + Math.sin(p) * ARM_SWING;
  if (bones.leftForeArm) bones.leftForeArm.rotation.x = binds.leftForeArm.x - Math.max(0, Math.sin(p + Math.PI)) * ELBOW_BEND;
  if (bones.rightForeArm) bones.rightForeArm.rotation.x = binds.rightForeArm.x - Math.max(0, Math.sin(p)) * ELBOW_BEND;
  if (bones.spine) bones.spine.rotation.x = binds.spine.x + SPINE_LEAN;
  if (bones.hips) bones.hips.position.y = hipsBindY + Math.abs(Math.sin(p)) * BOB_AMP;
}

// ---- Controls: arrow keys steer laterally, forward speed is automatic --
const heldKeys = new Set();
window.addEventListener('keydown', (e) => heldKeys.add(e.key));
window.addEventListener('keyup', (e) => heldKeys.delete(e.key));

const FORWARD_SPEED = 8.5; // yards/sec
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
    const lateralLimit = FIELD_WIDTH / 2 - 1.5;

    RUNNER_GROUP.position.z -= FORWARD_SPEED * dt;
    RUNNER_GROUP.position.x = THREE.MathUtils.clamp(RUNNER_GROUP.position.x + lateral * LATERAL_SPEED * dt, -lateralLimit, lateralLimit);
    const targetYaw = lateral * 0.25;
    RUNNER_GROUP.rotation.y += (targetYaw - RUNNER_GROUP.rotation.y) * Math.min(1, dt * 8);

    gaitPhase += dt * STRIDE_HZ * Math.PI * 2;
    applyRunCycle();

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
  gaitPhase = 0;
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
