// Field Goal Kick — 3D. A low-poly stadium/field/kicker scene (Three.js)
// driving the same two-click retro kicker mechanic as every other game here:
// stop a power meter in the sweet spot, then stop a direction meter to split
// the uprights, with wind pushing the actual landing spot off wherever you
// aimed. Ported from an earlier pure-visual prototype (fg3d-test.js) — this
// version is wired to the real server (lib/gameEngine/fieldGoal.js via
// routes/games.js): distance/wind/outcomes all come from the server, never
// computed locally, following the same "client renders, server scores"
// split as every other game's play-*.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const instanceId = qs('instance');
const leagueId = qs('league');
const memberId = qs('member');
document.getElementById('back-link').href = '/'; // "Home" -- always the site's main page, not back into this league specifically

const wrap = document.getElementById('fg3d-canvas-wrap');

// ---- Renderer / scene / camera -------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec9f0);
scene.fog = new THREE.Fog(0x8ec9f0, 35, 95);

const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
camera.position.set(-2, 3.2, 13); // placeholder — updateDistance() below sets the real framing

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, -30); // placeholder, same reason
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 4;
controls.maxDistance = 90;
controls.maxPolarAngle = Math.PI * 0.49; // don't let it dip below the field
controls.update();

// ---- Lighting --------------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xfff4d6, 1.15);
sun.position.set(-20, 35, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -60;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 120;
scene.add(sun);

// ---- Field -------------------------------------------------------------
const FIELD_HALF_WIDTH = 15;
const NEAR_Z = 20;   // camera-side edge of the visible field
const FAR_Z = -62;   // just past the goal line
const GOAL_LINE_Z = -52;

function stripeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const stripeH = canvas.height / 10;
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#2f6b3f' : '#356f43';
    ctx.fillRect(0, i * stripeH, canvas.width, stripeH);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 6);
  return tex;
}

// A wide grass apron behind/beside the marked field -- the field plane
// above only spans the actual playing surface (30 units wide), but the
// stands sit well outside that (out past x=+-35 once past the curved
// corners), leaving open ground between the field edge and the stands
// with nothing drawn there but the sky-color background. This fills that
// gap with turf instead of a band of "empty sky at ground level".
const apron = new THREE.Mesh(
  new THREE.PlaneGeometry(140, (NEAR_Z - FAR_Z) + 50),
  new THREE.MeshStandardMaterial({ color: 0x2f6b3f, roughness: 0.95 })
);
apron.rotation.x = -Math.PI / 2;
apron.position.set(0, -0.02, (NEAR_Z + FAR_Z) / 2);
scene.add(apron);

const field = new THREE.Mesh(
  new THREE.PlaneGeometry(FIELD_HALF_WIDTH * 2, NEAR_Z - FAR_Z),
  new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.95 })
);
field.rotation.x = -Math.PI / 2;
field.position.set(0, 0, (NEAR_Z + FAR_Z) / 2);
field.receiveShadow = true;
scene.add(field);

// Yard lines (simple thin white strips every 10 units) + the goal line.
const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
for (let z = NEAR_Z - 5; z > FAR_Z; z -= 10) {
  const line = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_HALF_WIDTH * 2 - 1, 0.15), lineMat);
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, 0.01, z);
  scene.add(line);
}
const goalLine = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_HALF_WIDTH * 2 - 1, 0.3), lineMat);
goalLine.rotation.x = -Math.PI / 2;
goalLine.position.set(0, 0.011, GOAL_LINE_Z);
scene.add(goalLine);

// ---- Goalpost ------------------------------------------------------------
const postMat = new THREE.MeshStandardMaterial({ color: 0xffd400, roughness: 0.4, metalness: 0.2 });
const goalpost = new THREE.Group();
const CROSSBAR_Y = 3.05;      // ~10ft
const UPRIGHT_TOP_Y = 8.5;    // tall uprights, easy to spot from the tee
const UPRIGHT_HALF_SPAN = 2.82; // ~18.5ft actual width, in "half" units

const basePole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, CROSSBAR_Y, 12), postMat);
basePole.position.y = CROSSBAR_Y / 2;
basePole.castShadow = true;
goalpost.add(basePole);

const crossbar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.1, 0.1, UPRIGHT_HALF_SPAN * 2, 12),
  postMat
);
crossbar.rotation.z = Math.PI / 2;
crossbar.position.y = CROSSBAR_Y;
crossbar.castShadow = true;
goalpost.add(crossbar);

[-1, 1].forEach((side) => {
  const upright = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, UPRIGHT_TOP_Y - CROSSBAR_Y, 12),
    postMat
  );
  upright.position.set(side * UPRIGHT_HALF_SPAN, (CROSSBAR_Y + UPRIGHT_TOP_Y) / 2, 0);
  upright.castShadow = true;
  goalpost.add(upright);
});

goalpost.position.set(0, 0, GOAL_LINE_Z - 2);
scene.add(goalpost);

// A jersey-colored canvas texture with an optional name arched above a big
// number — used for the torso's box faces so the kicker reads as an actual
// numbered/named player instead of a plain colored block.
function jerseyTextTexture(jerseyColor, number, name) {
  const w = 128, h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `#${jerseyColor.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (name) {
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(name, w / 2, 26);
  }
  ctx.font = `bold ${name ? 92 : 105}px sans-serif`;
  ctx.fillText(String(number), w / 2, name ? h / 2 + 20 : h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
}

// ---- Simple stylized humanoid (shared shape for kicker + referees) --------
function buildFigure({ jersey, pants, skin = 0xe8b98a, helmet = jersey, number = null, name = null }) {
  const g = new THREE.Group();
  const jerseyMat = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.7 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: helmet, roughness: 0.3, metalness: 0.5 });

  // BoxGeometry's face order is [+x, -x, +y, -y, +z, -z]. The kicker faces
  // -z (downfield), so his BACK — the side the "kick cam" actually looks
  // at — is the +z face (index 4); his chest/front is -z (index 5).
  let torsoMat = jerseyMat;
  if (number != null) {
    torsoMat = [
      jerseyMat, jerseyMat, jerseyMat, jerseyMat,
      jerseyTextTexture(jersey, number, name), // back: name + number
      jerseyTextTexture(jersey, number, null), // front: number only
    ];
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.35), torsoMat);
  torso.position.y = 1.35;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), skinMat);
  head.position.y = 1.85;
  head.castShadow = true;
  g.add(head);

  // Slightly bigger than the head sphere it covers (0.22) so it fully
  // encloses the crown with a little clearance, positioned so a small
  // sliver of skin still shows at the neck above the torso rather than
  // either a bald patch poking through the top or no neck at all.
  const helmetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), helmetMat);
  helmetMesh.position.y = 1.86;
  helmetMesh.castShadow = true;
  g.add(helmetMesh);

  // Legs hang from a hip pivot rather than being placed directly, so a kick
  // animation can rotate the whole leg like a hinge instead of just
  // translating a fixed capsule.
  const HIP_Y = 0.98;
  const cleatMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.5 });
  const legPivots = {};
  // Arm span, split into a jersey-colored sleeve (top quarter, at the
  // shoulder) and bare skin for the rest — a plain single-tone arm read as
  // a full sleeve down to the wrist.
  const ARM_TOP = 1.715;
  const ARM_BOTTOM = 0.985;
  const SLEEVE_LEN = (ARM_TOP - ARM_BOTTOM) * 0.25;
  const ARM_LEN = (ARM_TOP - ARM_BOTTOM) - SLEEVE_LEN;
  [-1, 1].forEach((side) => {
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, SLEEVE_LEN, 8), jerseyMat);
    sleeve.position.set(side * 0.4, ARM_TOP - SLEEVE_LEN / 2, 0);
    sleeve.castShadow = true;
    g.add(sleeve);

    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, ARM_LEN - 0.18, 4, 8), skinMat);
    arm.position.set(side * 0.4, ARM_BOTTOM + ARM_LEN / 2, 0);
    arm.castShadow = true;
    g.add(arm);

    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.16, HIP_Y, 0);
    const legY = -(HIP_Y - 0.55); // hang down to the original resting position
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.65, 4, 8), pantsMat);
    leg.position.y = legY;
    leg.castShadow = true;
    legPivot.add(leg);

    // A cleat at the foot — the capsule's total height is 0.65 + 2*0.11,
    // so its bottom sits 0.435 below the leg's own center.
    const footY = legY - 0.435;
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.24), cleatMat);
    cleat.position.set(0, footY - 0.02, -0.06); // toe pointed forward, downfield
    cleat.castShadow = true;
    legPivot.add(cleat);

    g.add(legPivot);
    legPivots[side > 0 ? 'right' : 'left'] = legPivot;
  });

  g.userData.legPivots = legPivots;
  return g;
}

// Kicker: blue jersey, set up well back and to the left of the ball so his
// run-up reads as a real diagonal approach rather than a near-straight line
// (real kickers set up several steps back AND to the side). z is set by
// updateDistance() below, once the kick distance is known.
const KICKER_SIDE_OFFSET = -1.7;
// The "kick cam" sits to the right of the kicker (see updateDistance() below).
const CAMERA_X = 0.6;
const kicker = buildFigure({
  jersey: 0x2f5fbf,
  pants: 0xb9bcc2,   // silver
  helmet: 0xb9bcc2,  // silver
  skin: 0xf0d9a0,    // light, yellow-leaning skin tone for the bare arms
  number: 1,
  name: 'MACK',
});
kicker.position.x = KICKER_SIDE_OFFSET;
scene.add(kicker);

// Swap the procedural kicker figure for the Rodin-generated, Mixamo-rigged
// .glb model -- mesh, textures, a 65-joint skeleton, and one baked
// animation ("Strike Forward Jog": a run-up into a real kicking motion)
// all bundled in the one file. Hide the procedural parts (but leave the
// group/legPivots structure intact so the OLD tween-based fallback below
// still works if this model hasn't finished loading -- or fails to load --
// by the time a kick starts) and stand the loaded model in the same spot.
//
// The clip has real baked root motion (the hips bone actually translates
// through the animation, confirmed by sampling its world position frame by
// frame), which performKick() below uses to drive the run-up instead of a
// generic tween -- see calibrateKickAnimation() for how that's extracted.
kicker.children.forEach((child) => { child.visible = false; });
new GLTFLoader().load('/models/player-kick.glb', (gltf) => {
  const model = gltf.scene;
  // Real-world height from Rodin's own bounding box (~1.896) vs. this
  // figure's procedural height (helmet top ~2.12) -- scale up to match.
  model.scale.setScalar(2.12 / 1.896);
  model.rotation.y = Math.PI; // face downfield (-z), like the procedural figure
  kicker.add(model);

  const clip = gltf.animations[0];
  if (!clip) { console.warn('player-kick.glb has no animation clip -- falling back to the procedural tween'); return; }
  let hips = null;
  model.traverse((o) => { if (o.isBone && o.name === 'mixamorigHips') hips = o; });
  if (!hips) { console.warn('no hips bone found in player-kick.glb -- falling back to the procedural tween'); return; }

  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.clampWhenFinished = true;
  action.setLoop(THREE.LoopOnce);

  kicker.userData.kickAnim = calibrateKickAnimation({ kicker, model, mixer, action, clip, hips });
}, undefined, (err) => console.error('kicker model load failed', err));

// The clip's own root motion doesn't travel the exact distance/direction
// this scene's run-up needs (real kickers set up wherever the scene's
// camera framing wants them, not wherever the mocap actor happened to be
// standing), so this samples the hips bone's real per-frame displacement
// once, up front, with the kicker at a neutral identity transform -- then
// performKick() reuses that as a progress-over-time curve to drive a
// straight-line lerp from the run-up's actual start/plant positions. This
// keeps the organic acceleration/deceleration feel and correct foot-plant
// timing of the real mocap (no foot-sliding), without needing the raw clip
// to happen to travel the right distance in the right direction.
//
// CONTACT_TIME is where the kicking foot is near its most forward/highest
// reach in the swing (found by sampling mixamorigRightFoot's position
// relative to the hips across the clip) -- close enough to real "the foot
// meets the ball" for the ball-launch trigger below. SEQUENCE_END is a bit
// past that, for a brief visible follow-through before the rest of
// performKick() takes over (camera/ball flight/referee signal). Both are in
// clip-time seconds -- how far through the animation's own motion each
// moment is, independent of how long that's stretched over in real time.
const CONTACT_TIME = 0.55;
const SEQUENCE_END = 1.0;

// How long the run-up+kick actually takes on screen, in real milliseconds.
// Kept separate from SEQUENCE_END (the clip-time range above) specifically
// so this can be tuned for feel -- at 1:1 (SEQUENCE_END * 1000) it played
// the full motion in exactly 1 real second, which read as too rushed;
// stretching it out here slows the whole run-up+kick uniformly (still
// hitting the same poses in the same order, just given more time to read).
const PLAYBACK_DURATION_MS = 1200;

function calibrateKickAnimation({ kicker, model, mixer, action, clip, hips }) {
  const hipsBindLocalPos = hips.position.clone();

  // Run the calibration with the whole group at a clean identity transform
  // so the hips' world position directly reflects only the animation's own
  // motion, not wherever the kicker actually happens to be standing right
  // now -- restored below once the sample table is built.
  const savedPos = kicker.position.clone();
  const savedRot = kicker.rotation.y;
  kicker.position.set(0, 0, 0);
  kicker.rotation.y = 0;

  action.paused = false;
  action.play();
  const start = new THREE.Vector3();
  hips.getWorldPosition(start);

  const SAMPLE_STEP = 1 / 60;
  const table = []; // [{t, dist}] -- cumulative straight-line distance traveled from t=0
  const p = new THREE.Vector3();
  for (let t = 0; t <= SEQUENCE_END + SAMPLE_STEP; t += SAMPLE_STEP) {
    mixer.setTime(Math.min(t, clip.duration));
    model.updateMatrixWorld(true);
    hips.getWorldPosition(p);
    table.push({ t, dist: p.distanceTo(start) });
  }
  const distAtContact = table.find((s) => s.t >= CONTACT_TIME)?.dist || table[table.length - 1].dist;

  // Reset back to a stopped, t=0 state and hand the scene back the way
  // performKick() expects to find it before a real kick starts.
  action.stop();
  mixer.setTime(0);
  hips.position.copy(hipsBindLocalPos);
  kicker.position.copy(savedPos);
  kicker.rotation.y = savedRot;

  // progress(t): 0..1 fraction of the way to the plant position, by real
  // mocap pacing rather than a generic ease curve. Flat 1 past CONTACT_TIME
  // -- the plant foot doesn't keep sliding forward through the follow-through.
  function progress(t) {
    if (t <= 0) return 0;
    if (t >= CONTACT_TIME) return 1;
    // table is sampled at a fixed step, so this index is a direct lookup
    // (with a clamp for float error right at the edges).
    const i = Math.min(table.length - 1, Math.max(0, Math.round(t / SAMPLE_STEP)));
    return Math.min(1, table[i].dist / distAtContact);
  }

  return { mixer, action, clip, hips, hipsBindLocalPos, progress };
}

// Referees: proper NFL look — horizontal black/white striped shirt
// (including sleeves), solid black pants/knickers, and a white cap rather
// than the kicker's football helmet. Positioned just this side of the
// goalpost (real refs hold the goal line regardless of kick distance, so
// these don't move between kicks).
function stripedShirtMat() {
  // Real referee jerseys are vertical black/white stripes (not horizontal
  // bands) — columns here so they read the same way on the torso.
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#111111' : '#f4f4f4';
    ctx.fillRect(i * 4, 0, 4, 32);
  }
  const tex = new THREE.CanvasTexture(canvas);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
}

function buildReferee() {
  const g = new THREE.Group();
  const shirtMat = stripedShirtMat();
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe8b98a, roughness: 0.6 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xf7f7f7, roughness: 0.5 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.35), shirtMat);
  torso.position.y = 1.35;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), skinMat);
  head.position.y = 1.85;
  head.castShadow = true;
  g.add(head);

  // A plain white cap — a dome plus a small brim — instead of a helmet.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), capMat);
  cap.position.y = 1.93;
  cap.castShadow = true;
  g.add(cap);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 16), capMat);
  brim.position.set(0, 1.87, 0.11);
  g.add(brim);

  // Arms hang from a shoulder pivot so a signal animation can swing the
  // whole arm rather than just repositioning a fixed capsule.
  const SHOULDER_Y = 1.62;
  const armPivots = {};
  [-1, 1].forEach((side) => {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.4, SHOULDER_Y, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.55, 4, 8), shirtMat);
    arm.position.y = -(SHOULDER_Y - 1.35); // hang down to the original resting position
    arm.castShadow = true;
    armPivot.add(arm);
    g.add(armPivot);
    armPivots[side > 0 ? 'right' : 'left'] = armPivot;

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.65, 4, 8), pantsMat);
    leg.position.set(side * 0.16, 0.55, 0);
    leg.castShadow = true;
    g.add(leg);
  });

  g.userData.armPivots = armPivots;
  return g;
}

// Signal-pose arm rotations for the Mixamo-rigged referee model, relative
// to its own bind pose (a T-pose -- arms held straight out to the sides,
// which is why these deltas look different from the procedural armPivots'
// numbers below, which hang from a rest pose of arms straight DOWN).
// Found empirically (see the local three-test harness this was tuned in):
// local X swings the arm's elevation (bind + PI/2 = down at the sides,
// bind - PI/2 = straight up overhead), local Z swings it forward/toward
// the body's centerline (bind + ~1.1 = crossed in front of the chest).
// Both arms use the SAME sign for both axes despite being mirrored bones
// -- Mixamo's left/right arm bones are set up so matching signs produce
// mirrored motion, not opposite ones.
const REF_ARM_IDLE_X = Math.PI / 2;
const REF_ARM_UP_X = -Math.PI / 2;
const REF_ARM_CROSSED_X = -0.5;
const REF_ARM_CROSSED_Z = 1.1;

function setRefereeIdle(ref) {
  ref.userData.armPivots.left.rotation.set(0, 0, 0);
  ref.userData.armPivots.right.rotation.set(0, 0, 0);
  const anim = ref.userData.refAnim;
  if (anim) {
    anim.leftArm.rotation.set(anim.bindLeft.x + REF_ARM_IDLE_X, anim.bindLeft.y, anim.bindLeft.z);
    anim.rightArm.rotation.set(anim.bindRight.x + REF_ARM_IDLE_X, anim.bindRight.y, anim.bindRight.z);
  }
}

// The referee model loads asynchronously, so it can finish AFTER
// showFrozenResult() has already set the procedural armPivots to a
// specific result pose (a page reload landing on an already-resolved
// kick) -- calling setRefereeIdle() unconditionally at that point would
// clobber it back to idle. Instead, read whatever pose the (synchronous,
// always-correct) armPivots already ended up in and apply the matching
// bone pose, without touching the armPivots themselves.
function syncRefereeAnimToCurrentPose(ref) {
  const anim = ref.userData.refAnim;
  if (!anim) return;
  const { leftArm, rightArm, bindLeft, bindRight } = anim;
  const pivotX = ref.userData.armPivots.left.rotation.x;
  const deltaX = Math.abs(pivotX + Math.PI) < 0.01 ? REF_ARM_UP_X // made: pivots at -PI
    : Math.abs(pivotX) < 0.01 ? REF_ARM_IDLE_X // idle: pivots at 0
    : REF_ARM_CROSSED_X; // miss (resolved): pivots at -1.3
  leftArm.rotation.set(bindLeft.x + deltaX, bindLeft.y, bindLeft.z);
  rightArm.rotation.set(bindRight.x + deltaX, bindRight.y, bindRight.z);
}

const referees = [-1, 1].map((side) => {
  const ref = buildReferee();
  ref.position.set(side * (UPRIGHT_HALF_SPAN + 1.6), 0, GOAL_LINE_Z + 3);
  ref.rotation.y = Math.PI; // face back toward the kicker
  scene.add(ref);

  // Swap the procedural referee for the Rodin-generated, Mixamo-rigged
  // model, same pattern as the kicker -- hide the procedural parts (but
  // leave the group/armPivots structure intact so the fallback animation
  // below still works if this hasn't loaded, or fails to, in time) and
  // stand the loaded model in the same spot.
  ref.children.forEach((child) => { child.visible = false; });
  new GLTFLoader().load('/models/referee.glb', (gltf) => {
    const model = gltf.scene;
    // Real-world height from Rodin's own bounding box (~1.898) vs. this
    // figure's procedural height (cap top ~2.17) -- scale up to match.
    model.scale.setScalar(2.17 / 1.898);
    model.rotation.y = Math.PI; // Rodin's default facing, same correction the kicker model needed
    ref.add(model);

    let leftArm = null, rightArm = null;
    model.traverse((o) => {
      if (o.name === 'mixamorigLeftArm') leftArm = o;
      if (o.name === 'mixamorigRightArm') rightArm = o;
    });
    if (!leftArm || !rightArm) { console.warn('referee.glb missing expected arm bones -- falling back to the procedural signal animation'); return; }

    ref.userData.refAnim = {
      leftArm, rightArm,
      bindLeft: leftArm.rotation.clone(),
      bindRight: rightArm.rotation.clone(),
    };
    syncRefereeAnimToCurrentPose(ref); // starts in bind pose (T-pose) -- match whatever pose the scene is actually in by now
  }, undefined, (err) => console.error('referee model load failed', err));

  return ref;
});

// ---- Ball on tee -----------------------------------------------------------
// z is set by updateDistance() below.
const BALL_REST_Y = 0.24; // resting height on the tee — reused by resetPose() after a kick
const tee = new THREE.Mesh(
  new THREE.ConeGeometry(0.06, 0.16, 10),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
);
tee.position.y = 0.08;
tee.castShadow = true;
scene.add(tee);

const ball = new THREE.Mesh(
  new THREE.SphereGeometry(0.11, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0x8a4b26, roughness: 0.5 })
);
ball.scale.set(1, 1, 1.5);
ball.rotation.x = Math.PI / 2;
ball.position.y = BALL_REST_Y;
ball.castShadow = true;
scene.add(ball);

// ---- Stadium: crowd stand model + light stanchions -------------------------
const concreteMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.95 });

const STAND_HEIGHT = 8;
const STAND_DEPTH = NEAR_Z - FAR_Z + 30;

[-1, 1].forEach((side) => {
  // Stadium light stanchions at each end of the stand, poking up above the
  // roofline — mostly a silhouette against the sky, but it sells "stadium"
  // a lot harder than bare stands do.
  [-1, 1].forEach((endSide) => {
    const poleX = side * (FIELD_HALF_WIDTH + 6);
    const poleZ = (NEAR_Z + FAR_Z) / 2 + endSide * (STAND_DEPTH / 2 - 4);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 14, 8), concreteMat);
    pole.position.set(poleX, 7, poleZ);
    scene.add(pole);

    const fixture = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.8, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xfff2c0, emissiveIntensity: 0.6 })
    );
    fixture.position.set(poleX, 14, poleZ);
    scene.add(fixture);
  });
});

// A stand behind the goalpost too, so missing a kick doesn't sail off into
// empty sky — closes out the "bowl" on the one side that was still open.
const BACK_STAND_Z = FAR_Z - 4;

// Real 3D stand sections (Rodin-generated from a ChatGPT crowd photo, via
// image-to-3D) tiled along each stand's length, replacing a flat
// crowd-photo-textured box. The model is a single static mesh (no
// skeleton), so gltf.scene.clone() correctly shares its geometry/material/
// textures across every tile instead of duplicating them in memory.
//
// Scaled uniformly (never stretched non-uniformly) off the model's own
// real bounding-box height to match STAND_HEIGHT, so its proportions stay
// true to the source photo -- tiled side by side along the needed length
// instead, the same way the earlier flat-texture version repeated.
const STAND_MODEL_BBOX = { w: 1.8945350050926208, h: 0.5554050207138062, d: 0.9296950101852417 };
const STAND_MODEL_SCALE = STAND_HEIGHT / STAND_MODEL_BBOX.h;
const STAND_MODEL_TILE_LEN = STAND_MODEL_BBOX.w * STAND_MODEL_SCALE;
// Local-Z offset from the model's pivot to its crowd-facing (front) edge --
// used below to chain tiles by their front edge instead of their
// centerline (see placeSweptTile).
const STAND_MODEL_FRONT_LOCAL_Z = 0.4630330204963684;
const STAND_MODEL_FRONT_OFFSET = STAND_MODEL_FRONT_LOCAL_Z * STAND_MODEL_SCALE;

// A real, purpose-built curved corner (Rodin-generated: a two-tier
// grandstand modeled as an actual L-shaped/curved footprint, not a rigid
// straight tile rotated to approximate one) -- replaces the earlier
// faceted-rotation approximation, which read as angled straight panels
// bolted together rather than a genuine bend.
const CORNER_BBOX_H = 0.6803219318389893;
const CORNER_SCALE = STAND_HEIGHT / CORNER_BBOX_H;

let straightGltf = null;
let cornerGltf = null;
function buildStadiumStands() {
  if (!straightGltf || !cornerGltf) return;

  function addStraightTile(x, z, rotationY) {
    const tile = straightGltf.scene.clone();
    tile.scale.setScalar(STAND_MODEL_SCALE);
    tile.rotation.y = rotationY;
    tile.position.set(x, 0, z);
    scene.add(tile);
  }

  // The corner model's two arms are NOT mirror images of each other in the
  // source file (it's a single right-handed L), so the left corner needs an
  // actual mirror (negative X scale), not just a rotation -- a rotation
  // can't turn a right-handed shape into its left-handed reflection. A
  // negative scale on one axis flips the mesh's winding order, which would
  // make it invisible from the "wrong" side under normal backface culling,
  // so the mirrored copy's materials are set to double-sided.
  function addCornerTile(x, z, mirror) {
    const tile = cornerGltf.scene.clone();
    tile.scale.set(CORNER_SCALE * mirror, CORNER_SCALE, CORNER_SCALE);
    if (mirror < 0) {
      tile.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          o.material.side = THREE.DoubleSide;
        }
      });
    }
    tile.position.set(x, 0, z);
    scene.add(tile);
  }

  // Chains a straight tile forward from `edge` (its trailing front-edge
  // point) by its own front-edge offset -- same technique used to close
  // the gap between the center tile and the corners: chaining on the
  // crowd-facing edge, not the centerline, because the model has real
  // depth and an angled/differently-shaped neighbor's centerline doesn't
  // predict where its front face actually lands.
  function addStraightFromEdge(edge, mirror) {
    const sweep = Math.PI / 2;
    const rotationY = mirror === 1 ? -sweep : sweep;
    const dir = mirror === 1
      ? new THREE.Vector3(Math.cos(sweep), 0, Math.sin(sweep))
      : new THREE.Vector3(-Math.cos(sweep), 0, Math.sin(sweep));
    const front = new THREE.Vector3(Math.sin(rotationY), 0, Math.cos(rotationY));
    const frontEdgeCenter = edge.clone().addScaledVector(dir, STAND_MODEL_TILE_LEN / 2);
    const origin = frontEdgeCenter.clone().addScaledVector(front, -STAND_MODEL_FRONT_OFFSET);
    addStraightTile(origin.x, origin.z, rotationY);
    return edge.clone().addScaledVector(dir, STAND_MODEL_TILE_LEN);
  }

  // ONE straight section spanning the width directly behind the endzone
  // (not two tiles meeting at a center seam) -- the curve starts from ITS
  // edges, matching a real stadium's layout: straight behind the goalpost,
  // curving only at the corners, straight again down each sideline.
  addStraightTile(0, BACK_STAND_Z, 0);

  // Corner placement: tuned by hand against the actual model (its hinge
  // point isn't exactly at its local origin, and unlike the straight
  // tiles' bounding box, this one-off asset has no clean formula for it)
  // so its arm sits flush against the center tile with no gap.
  const CORNER_X = 12.8;
  const CORNER_Z = -65.7;
  addCornerTile(CORNER_X, CORNER_Z, 1);
  addCornerTile(-CORNER_X, CORNER_Z, -1);

  // The corner's far arm tapers to a narrow tip rather than ending in a
  // flat cross-section sized to match the straight tiles, so the
  // continuing sideline run starts from a conservative point well inside
  // the corner's stable (non-tapered) cross-section -- overlapping the
  // corner's own tail generously rather than chasing an exact seam.
  // Overlap is invisible; a gap isn't, and exactly where the sideline
  // picks up doesn't matter as long as it connects cleanly.
  const SIDELINE_ANCHOR_X = 16;
  const SIDELINE_ANCHOR_Z = -70;
  const targetZ = NEAR_Z + 10;

  [1, -1].forEach((mirror) => {
    let edge = new THREE.Vector3(SIDELINE_ANCHOR_X * mirror, 0, SIDELINE_ANCHOR_Z);
    let guard = 0;
    while (edge.z < targetZ && guard < 20) {
      edge = addStraightFromEdge(edge, mirror);
      guard++;
    }
  });
}

new GLTFLoader().load('/models/stadium-stand.glb', (gltf) => {
  straightGltf = gltf;
  buildStadiumStands();
}, undefined, (err) => console.error('stadium stand model load failed', err));
new GLTFLoader().load('/models/stadium-corner.glb', (gltf) => {
  cornerGltf = gltf;
  buildStadiumStands();
}, undefined, (err) => console.error('stadium corner model load failed', err));

// ---- Kick distance positioning ---------------------------------------------
// Distance now comes from the server (one value per kick, shared by every
// league member) — there's no manual control here anymore. Stylized, not to
// real-world scale — a true 55-yard kick would put the kicker so far from
// the goalpost it'd vanish into the fog. Compressing the range keeps every
// distance clearly readable while still visibly farther apart from each
// other.
const MIN_DISTANCE = 25;
const MAX_DISTANCE = 55;
const DEFAULT_DISTANCE = 40; // used only for the initial framing before the first kick loads

// Apparent size is roughly 1/distance, so equal *yardage* steps do NOT read
// as equal *visual* steps — a straight linear mapping left most of the
// perceptible "pulling back" concentrated in the 25-40yd stretch, so 40yd
// already looked close to as far as it gets. This curve keeps every kick
// under ~40yd clustered close to the goalpost (matching how close a 25-40yd
// attempt should feel) and saves the dramatic pull-back for the last
// stretch toward the 55yd max, so the farthest kick unambiguously reads as
// the farthest view.
const DISTANCE_CURVE_POWER = 2.4;
const BALL_Z_AT_MIN_DISTANCE = GOAL_LINE_Z + 2 + MIN_DISTANCE * 0.85;
const BALL_Z_AT_MAX_DISTANCE = GOAL_LINE_Z + 2 + MAX_DISTANCE * 0.85;

function kickerZFor(distanceYards) {
  const t = (distanceYards - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE);
  const curved = Math.pow(t, DISTANCE_CURVE_POWER);
  return BALL_Z_AT_MIN_DISTANCE + (BALL_Z_AT_MAX_DISTANCE - BALL_Z_AT_MIN_DISTANCE) * curved;
}

// A real kicker sets up a couple of steps behind and to the side of the
// ball, then approaches forward into it — not standing right at the same
// depth as the ball, which reads as if he's in front of it instead.
const KICKER_SETUP_OFFSET = 1.6;

// Moves the kicker/ball back for longer kicks and pulls the camera back
// along with them (like a broadcast "kick cam" riding behind the kicker),
// while always framing toward the goalpost — so the goalpost reads as
// farther away on a long kick instead of just leaving the kicker off-screen.
function updateDistance(distanceYards) {
  const ballZ = kickerZFor(distanceYards);
  const kickerZ = ballZ + KICKER_SETUP_OFFSET;
  kicker.position.z = kickerZ;
  tee.position.z = ballZ;
  ball.position.z = ballZ;
  // Sitting to the right of the kicker (rather than further left, past him)
  // reads as the familiar broadcast "kick cam" angle — the kicker ends up
  // left-of-frame with the ball and goalpost centered, instead of the
  // kicker crowding the middle of the shot.
  camera.position.set(CAMERA_X, 3.2, kickerZ + 7);
  controls.target.set(0, 2, GOAL_LINE_Z + 10);
  controls.update();
}

let currentDistance = DEFAULT_DISTANCE;
updateDistance(currentDistance); // initial framing, while the first kick loads

// ---- Power & direction meters (interactive) ---------------------------------
// The same two-click mechanic the server scores (a deterministic triangle
// wave, sampled at the instant you click) — rendered here as 3D overlays: a
// vertical power bar next to the kicker, and a curved "kicking arc" gauge
// with a banking arrow for direction, both sitting right over the scene.
const POWER_SWEET_HALF_LONG = 0.05;   // 50+ yards
const POWER_SWEET_HALF_MID = 0.09;    // 40-49 yards
const POWER_SWEET_HALF_SHORT = 0.14;  // under 40 yards
const LONG_DISTANCE_THRESHOLD = 50;
const MID_DISTANCE_THRESHOLD = 40;

function trianglePosition(elapsedMs, periodMs) {
  const cycle = ((elapsedMs % periodMs) + periodMs) % periodMs;
  const t = cycle / periodMs;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}
// Mirrors lib/gameEngine/fieldGoal.js's powerSweetHalfFor() exactly — used
// here only to color-preview the power marker (green/yellow/red) the
// instant it's locked. The server is the sole authority on scoring; this is
// cosmetic feedback only.
function powerSweetHalfFor(distance) {
  if (distance >= LONG_DISTANCE_THRESHOLD) return POWER_SWEET_HALF_LONG;
  if (distance >= MID_DISTANCE_THRESHOLD) return POWER_SWEET_HALF_MID;
  return POWER_SWEET_HALF_SHORT;
}

// A tube mesh following a sub-range [tStart, tEnd] of a curve — gives the
// arc real 3D thickness (a plain Line reads as a flat, thin scribble)
// instead of an actual rounded gauge like Madden's kicking arc.
function tubeFromCurve(curve, tStart, tEnd, radius, color, opacity) {
  const steps = 24;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    points.push(curve.getPointAt(tStart + (tEnd - tStart) * (i / steps)));
  }
  const subCurve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(subCurve, steps, radius, 8, false);
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.35,
    transparent: opacity < 1, opacity, roughness: 0.4,
  });
  return new THREE.Mesh(geo, mat);
}

// A 3D vertical power bar — a track, a highlighted sweet-spot band, and a
// sliding marker, built as real boxes with depth and floating in the scene
// next to the kicker instead of in a side panel.
//
// Polish pass: a flat-shaded box per part reads as plastic/blocky no
// matter how it's lit. The fix isn't better geometry (still just boxes —
// vendoring a rounded-box geometry for one HUD element isn't worth it) but
// layering: a metal bezel with a bright inset rim and corner screws behind
// a near-black track, tick marks and a glass cover on the track's face,
// and a two-layer marker (dark metal clip + bright colorable core) instead
// of one flat-colored box. Each decorative piece is added as a CHILD of
// the part it belongs to (frame/track/marker), so it inherits that part's
// position and visibility automatically — rebuildPowerMeter() and
// updatePowerMarkerPosition() below only need to move the four parent
// meshes, exactly as before.
const POWER_BAR_HEIGHT = 2.3;
const POWER_BAR_WIDTH = 0.46;
const POWER_BAR_DEPTH = 0.14;
// A metal frame sitting just behind the track, a bit larger in
// width/height — since it's also a bit thinner in depth, the track
// (thicker, closer to the camera) covers it everywhere except that
// overhanging border, reading as an actual bezel edge around the meter.
const POWER_FRAME_MARGIN = 0.09;
const powerFrame = new THREE.Mesh(
  new THREE.BoxGeometry(POWER_BAR_WIDTH + POWER_FRAME_MARGIN * 2, POWER_BAR_HEIGHT + POWER_FRAME_MARGIN * 2, POWER_BAR_DEPTH * 0.6),
  new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.4, metalness: 0.75 })
);
scene.add(powerFrame);

// A bright, more polished inset rim between the dark bezel and the track —
// sized between the two so it shows as a thin lit lip catching the light,
// the way a real instrument panel's bezel has a highlighted inner edge.
const powerFrameRim = new THREE.Mesh(
  new THREE.BoxGeometry(POWER_BAR_WIDTH + POWER_FRAME_MARGIN, POWER_BAR_HEIGHT + POWER_FRAME_MARGIN, POWER_BAR_DEPTH * 0.15),
  new THREE.MeshStandardMaterial({ color: 0xf3f5f7, roughness: 0.25, metalness: 0.85 })
);
powerFrameRim.position.z = POWER_BAR_DEPTH * 0.3 + 0.02;
powerFrame.add(powerFrameRim);

// Four small dark screw-head accents at the bezel corners — a cheap detail
// that reads as "a real bolted panel" rather than a plain colored box.
const powerScrewMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.35, metalness: 0.6 });
const POWER_SCREW_INSET = 0.055;
[-1, 1].forEach((sx) => {
  [-1, 1].forEach((sy) => {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8), powerScrewMat);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(
      sx * (POWER_BAR_WIDTH / 2 + POWER_FRAME_MARGIN - POWER_SCREW_INSET),
      sy * (POWER_BAR_HEIGHT / 2 + POWER_FRAME_MARGIN - POWER_SCREW_INSET),
      POWER_BAR_DEPTH * 0.3 + 0.02
    );
    powerFrame.add(screw);
  });
});

const powerTrack = new THREE.Mesh(
  new THREE.BoxGeometry(POWER_BAR_WIDTH, POWER_BAR_HEIGHT, POWER_BAR_DEPTH),
  new THREE.MeshStandardMaterial({ color: 0x0a140f, transparent: true, opacity: 0.9, roughness: 0.55, metalness: 0.1 })
);
scene.add(powerTrack);

// Graduation ticks along the track's face — a real gauge has marked
// increments, not a blank bar, and it's a cheap way to sell "instrument"
// over "colored rectangle".
const powerTickMat = new THREE.MeshStandardMaterial({ color: 0xaeb8c2, roughness: 0.5, metalness: 0.3 });
const POWER_TICK_COUNT = 9;
for (let i = 0; i < POWER_TICK_COUNT; i++) {
  const tick = new THREE.Mesh(new THREE.BoxGeometry(POWER_BAR_WIDTH * 0.6, 0.016, 0.01), powerTickMat);
  tick.position.set(0, (i / (POWER_TICK_COUNT - 1) - 0.5) * POWER_BAR_HEIGHT, POWER_BAR_DEPTH / 2 + 0.006);
  powerTrack.add(tick);
}

// A thin glossy "under glass" cover over the whole face — MeshPhysicalMaterial
// (core three.js, not an addon) gives a real clear-coat highlight instead of
// the flatter specular a MeshStandardMaterial produces.
const powerGlass = new THREE.Mesh(
  new THREE.BoxGeometry(POWER_BAR_WIDTH + 0.02, POWER_BAR_HEIGHT + 0.02, 0.012),
  new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 0.12,
    roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1,
  })
);
powerGlass.position.z = POWER_BAR_DEPTH / 2 + 0.014;
powerTrack.add(powerGlass);

const powerMarkerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.7 });
const powerMarker = new THREE.Mesh(
  new THREE.BoxGeometry(POWER_BAR_WIDTH - 0.06, 0.07, POWER_BAR_DEPTH + 0.2),
  powerMarkerMat
);
scene.add(powerMarker);
// A dark metal clip behind/around the bright core above — without it the
// marker was just a flat colored slab; the clip gives it a visible edge
// and reads as a needle/indicator held in a bracket rather than a sticker.
const powerMarkerClip = new THREE.Mesh(
  new THREE.BoxGeometry(POWER_BAR_WIDTH + 0.16, 0.14, POWER_BAR_DEPTH * 0.5),
  new THREE.MeshStandardMaterial({ color: 0x3a4147, roughness: 0.35, metalness: 0.7 })
);
powerMarkerClip.position.z = -0.05;
powerMarker.add(powerMarkerClip);

let powerSweetMesh = null;
let powerMeterCenter = new THREE.Vector3();

// Repositions the bar beside the ball and resizes the green sweet-spot band
// for this kick's distance — called at the start of every attempt. Kept
// well to the left of the kicker's own resting spot (-1.7) so it doesn't
// clip through him during the approach.
function rebuildPowerMeter(distanceYards) {
  // Beside the kicker (his own x, minus an offset) at his own depth — not
  // the ball's depth, which sits far enough behind him that reaching this
  // far left of the ball puts the bar outside the kick cam's frame
  // entirely. Sitting at his depth instead means the visible x-range at
  // that distance from the camera is exactly what already comfortably
  // fits him on screen, so a similar offset from his x still fits too, and
  // it doesn't need to be raised above his head to dodge occlusion since
  // it's beside him, not behind him.
  powerMeterCenter = new THREE.Vector3(kicker.position.x - 1.0, ball.position.y + 1.3, kicker.position.z);
  powerTrack.position.copy(powerMeterCenter);
  powerFrame.position.set(powerMeterCenter.x, powerMeterCenter.y, powerMeterCenter.z - 0.02);

  if (powerSweetMesh) {
    scene.remove(powerSweetMesh);
    powerSweetMesh.geometry.dispose();
    powerSweetMesh.material.dispose();
    const core = powerSweetMesh.children[0];
    if (core) { core.geometry.dispose(); core.material.dispose(); }
  }
  const sweetHalf = powerSweetHalfFor(distanceYards);
  // Full frame width (not just the track's own width) and a good deal
  // deeper than the track — at the kick cam's angle, a green band sized to
  // only match the track let a sliver of the track/frame edge show through
  // on the right side. Spanning the whole frame and sitting further
  // forward removes any angle that could catch that gap.
  powerSweetMesh = new THREE.Mesh(
    new THREE.BoxGeometry(POWER_BAR_WIDTH + POWER_FRAME_MARGIN * 2, sweetHalf * 2 * POWER_BAR_HEIGHT, POWER_BAR_DEPTH + 0.16),
    new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x2f7d54, emissiveIntensity: 0.4, roughness: 0.5 })
  );
  powerSweetMesh.position.copy(powerMeterCenter); // sweet spot sits at the bar's vertical center — position 0.5
  // A brighter, more saturated core stripe down the middle of the band —
  // a flat green box reads as a colored panel; a brighter inner band on
  // top of it reads as a lit/neon strip instead.
  const sweetCore = new THREE.Mesh(
    new THREE.BoxGeometry(POWER_BAR_WIDTH * 0.5, sweetHalf * 2 * POWER_BAR_HEIGHT, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x86efac, emissive: 0x86efac, emissiveIntensity: 0.6, roughness: 0.3 })
  );
  sweetCore.position.z = (POWER_BAR_DEPTH + 0.16) / 2 + 0.011;
  powerSweetMesh.add(sweetCore);
  scene.add(powerSweetMesh);
}

function updatePowerMarkerPosition(t) {
  powerMarker.position.set(
    powerMeterCenter.x,
    powerMeterCenter.y + (t - 0.5) * POWER_BAR_HEIGHT,
    powerMeterCenter.z + 0.09
  );
}

// A curved horizontal "gauge" for direction — a shallow bow-shaped track
// with an arrow gliding left-to-right along it (banking to match the
// curve's own angle as it goes), instead of a straight bar with a marker.
let directionCurve = null;
let directionTrack = null;

function rebuildDirectionMeter() {
  if (directionTrack) { scene.remove(directionTrack); directionTrack.geometry.dispose(); directionTrack.material.dispose(); }
  // Low and centered directly under the ball, rather than up near the
  // goalpost/crossbar height.
  const y = ball.position.y + 0.4;
  const z = ball.position.z + 0.3;
  const left = new THREE.Vector3(ball.position.x - 1.3, y, z);
  const peak = new THREE.Vector3(ball.position.x, y + 0.35, z);
  const right = new THREE.Vector3(ball.position.x + 1.3, y, z);
  directionCurve = new THREE.QuadraticBezierCurve3(left, peak, right);
  directionTrack = tubeFromCurve(directionCurve, 0, 1, 0.035, 0xffffff, 0.6);
  scene.add(directionTrack);
}

function buildDirectionArrowMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0xffcc33, emissiveIntensity: 0.35 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8), mat);
  shaft.rotation.z = Math.PI / 2; // cylinders default along Y — lay it along local +X instead
  shaft.position.x = -0.07;
  g.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 10), mat);
  head.rotation.z = -Math.PI / 2; // cones default pointing +Y — point it along local +X too
  head.position.x = 0.17;
  g.add(head);
  return g;
}
const directionArrow = buildDirectionArrowMesh();
scene.add(directionArrow);

// Slides the arrow to position t along the curve (0 = left end, 1 = right
// end) and banks it to match the aim direction, like a real gauge needle
// following a bowed track rather than just teleporting along it.
// How far the arrow leans from straight-up at the two extremes (t=0/t=1) —
// a direct, hand-tuned mapping rather than the curve's actual geometric
// tangent/normal, whose slope on this shallow a bow only works out to
// about +-15 degrees: too subtle to clearly read as "pointing left" vs
// "pointing right." This exaggerates the same idea for a clearer needle.
const DIRECTION_ARROW_MAX_TILT = 0.65; // radians, ~37 degrees

function updateDirectionArrowPosition(t) {
  directionArrow.position.copy(directionCurve.getPointAt(t));
  // The curve runs left-to-right, so its own tangent always points
  // rightward — using it directly made the arrow always point right no
  // matter where it sat. What should show instead is the aim itself:
  // straight up at center, leaning left/right toward whichever end it's
  // nearer.
  const tilt = (t - 0.5) * 2 * DIRECTION_ARROW_MAX_TILT;
  directionArrow.rotation.z = Math.PI / 2 - tilt;
}

// ---- Wind ---------------------------------------------------------------
// Wind is server-assigned per kick, just like distance — rolled by
// lib/gameEngine/fieldGoal.js's rollKick() each time a player reaches a new
// kick on their own difficulty ladder, and just displayed here.
let windMph = 0;
let windDir = 'calm'; // 'calm' | 'left' | 'right'

// A small canvas-texture label ("12 MPH" / "CALM") — same technique as the
// jersey numbers, just a plain readout instead of a 3D object with its own
// shape.
function windLabelTexture(mph, dir) {
  const w = 260, h = 94;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(10, 20, 15, 0.6)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText(dir === 'calm' ? 'CALM' : `${mph} MPH`, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true });
}

// A chunky custom arrow (cylinder shaft + cone head) rather than
// THREE.ArrowHelper — ArrowHelper's shaft is a hairline whose thickness
// isn't really adjustable (a WebGL line-width limitation), which reads as
// "thin" no matter how long it's made. Built pointing along local +X;
// flipped 180 degrees to point left.
function buildWindArrowMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.95, 12), mat);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = -0.18;
  g.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 14), mat);
  head.rotation.z = -Math.PI / 2;
  head.position.x = 0.5;
  g.add(head);
  return g;
}

let windArrow = null;
let windLabel = null;

// Rebuilds the wind indicator (arrow + mph label) high in the open sky
// above the stadium, near the goalpost — a fixed spot regardless of kick
// distance, unlike the other meters. Called once per new attempt.
function rebuildWindIndicator() {
  if (windArrow) { scene.remove(windArrow); }
  if (windLabel) { scene.remove(windLabel); windLabel.geometry.dispose(); windLabel.material.map.dispose(); windLabel.material.dispose(); }

  // Positioned relative to the *camera's own* current position rather than
  // a fixed world spot — the camera's z moves a lot across the kick
  // distance range (from well behind the kicker on a short attempt to
  // almost even with him on a long one), so a fixed world position either
  // ended up behind the camera entirely at some distances or safely in
  // front but too small at others. This offset (18 units ahead, 6 above
  // camera height) was picked by directly checking its projected screen
  // position at 25/40/55yd — comfortably inside the frame with margin at
  // all three, instead of guessing from screenshots.
  const pos = new THREE.Vector3(0, camera.position.y + 6, camera.position.z - 18);
  const WIND_SCALE = 3.5;
  if (windDir !== 'calm') {
    windArrow = buildWindArrowMesh();
    windArrow.position.copy(pos);
    windArrow.scale.setScalar(WIND_SCALE);
    if (windDir === 'left') windArrow.rotation.z = Math.PI; // built pointing right by default
    windArrow.visible = true;
    scene.add(windArrow);
  } else {
    windArrow = null;
  }

  windLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.5 * WIND_SCALE, 0.54 * WIND_SCALE), windLabelTexture(windMph, windDir));
  windLabel.position.set(pos.x, pos.y - 1.9, pos.z);
  windLabel.visible = true;
  scene.add(windLabel);
}

// ---- Result popup ------------------------------------------------------------
// A "GOOD!" / "NO GOOD" popup card hanging in the goalpost's opening. Two
// single-sided planes back to back rather than one DoubleSide plane — a
// DoubleSide material shows the same texture on both faces unmirrored,
// which reads backwards from whichever side the UVs weren't drawn for.
// Needs to read correctly from both the kick cam (looking at the front of
// the post, where the camera still is right as the popup appears) and the
// end-zone cam (looking at the back of it, where every outcome's camera
// ends up once it finishes following the ball there).
function resultPopupTexture(text, color) {
  const w = 640, h = 260;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(8, 16, 12, 0.85)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 110px sans-serif';
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true });
}

let resultPopup = null;

function showResultPopup(outcome) {
  hideResultPopup();
  const made = outcome === 'made';
  const text = made ? 'GOOD!' : 'NO GOOD';
  const color = made ? '#4ade80' : '#ef4444';
  // Every outcome (including 'short') now follows the ball to the same
  // close-up end-zone cam, so one size fits all -- no more special-casing
  // 'short' for a camera distance it doesn't use anymore.
  const geo = new THREE.PlaneGeometry(4.6, 1.9);

  const front = new THREE.Mesh(geo, resultPopupTexture(text, color));
  front.position.set(0, 5, GOAL_LINE_Z - 2 + 0.02); // faces +z, toward the kick cam / kicker side

  const back = new THREE.Mesh(geo, resultPopupTexture(text, color));
  back.position.set(0, 5, GOAL_LINE_Z - 2 - 0.02);
  back.rotation.y = Math.PI; // faces -z, toward the end-zone cam

  resultPopup = new THREE.Group();
  resultPopup.add(front, back);
  scene.add(resultPopup);
}

function hideResultPopup() {
  if (!resultPopup) return;
  scene.remove(resultPopup);
  resultPopup.children.forEach((mesh) => {
    mesh.material.map.dispose();
    mesh.material.dispose();
  });
  resultPopup.children[0].geometry.dispose(); // shared between both meshes
  resultPopup = null;
}

// ---- Game state / server wiring --------------------------------------------
let powerPeriodMs = 1000;
let directionPeriodMs = 1000;

// The exact server-provided start times the meters currently on screen are
// animating from — kept around so a click handler can measure "how long
// was I actually looking at this before I clicked" itself, in the same
// Date.now()-startedAt terms the animation is drawn in, and send THAT to
// the server rather than let the server's own (network-latency-delayed)
// receipt time silently score a different moment than what was on screen.
let currentPowerStartedAt = null;
let currentDirectionStartedAt = null;

// 'power-locking'/'direction-locking' are transient: set the instant the
// action button is clicked, for exactly as long as the power-stop/
// direction-stop request is in flight, so the render loop's live-animation
// branches below (which key off 'power'/'direction') stop touching the
// marker/arrow — freezing it at the snapped position instead of it sliding
// on for the whole round-trip and landing wherever real time moved on to
// once the response came back.
let kickPhase = 'power'; // 'power' | 'power-locking' | 'direction' | 'direction-locking' | 'flight' | 'result'
let currentPowerT = 0.5;
let currentDirectionT = 0.5;

const actionBtn = document.getElementById('fg3d-action-btn');
const nextKickBtn = document.getElementById('next-kick-btn');
const resultEl = document.getElementById('fg3d-result');

function outcomeText(outcome, distance) {
  if (outcome.outcome === 'made') return `IT'S GOOD! ${distance} yards — +${outcome.points} point${outcome.points === 1 ? '' : 's'}`;
  if (outcome.outcome === 'short') return "NO GOOD — didn't have the distance. Time the power meter's green zone better.";
  if (outcome.outcome === 'wide-left') return 'WIDE LEFT!';
  if (outcome.outcome === 'wide-right') return 'WIDE RIGHT!';
  return outcome.outcome;
}

// Colors the power marker green/yellow/red the instant it's locked — purely
// cosmetic feedback (see powerSweetHalfFor()'s comment above); the server's
// stopDirection call is what actually decides whether it counted.
function paintPowerMarker(pos, distanceYards) {
  const deviation = Math.abs(pos - 0.5);
  const sweetHalf = powerSweetHalfFor(distanceYards);
  const isNearMiss = deviation > sweetHalf && deviation <= sweetHalf + NEAR_MISS_POWER_MARGIN;
  const color = deviation <= sweetHalf ? 0x4ade80 : isNearMiss ? 0xf5c542 : 0xef4444;
  powerMarkerMat.color.set(color);
  powerMarkerMat.emissive.set(color);
  powerMarker.visible = true;
  updatePowerMarkerPosition(pos);
}

// The exact power position the client itself just locked in with (set right
// before sending power-stop), so the post-response repaint below can reuse
// it instead of the server's own recomputed `k.powerPos` — which, if the
// player's system clock doesn't exactly match the server's, can come out
// as a different value even though both are "correct" scoring-wise (each
// self-consistent with its own clock). Since the client's own live
// animation and its own click-snap always share the same clock, they never
// disagree with each other — only a repaint sourced from the server's
// independently-computed value could visibly disagree with what the
// player actually saw and clicked, which is exactly what happened: the
// marker correctly froze instantly, then visibly relocated once this
// repaint ran with the server's value.
let lastLockedPowerT = null;

// Renders whichever kick the server says is current — called on load, after
// every power-stop/next response, on resync, and (for the 'result' phase)
// when restoring an already-resolved kick on page reload. Pass
// `trustLocalPowerSnap: true` only right after this client's own
// power-stop response, so the power marker keeps showing exactly what was
// just clicked instead of being repainted from the server's echoed-back
// value (see lastLockedPowerT above) — every other caller (initial load,
// resync, next-kick) has no local snap to trust and needs the server's
// value to correctly restore the marker.
function renderKick(gi, { trustLocalPowerSnap = false } = {}) {
  const k = gi.currentKick;
  powerPeriodMs = gi.powerPeriodMs || powerPeriodMs;
  directionPeriodMs = gi.directionPeriodMs || directionPeriodMs;
  currentDistance = k.distance;
  windMph = k.windMph;
  windDir = k.windDir;

  document.getElementById('kick-panel').style.display = 'block';
  document.getElementById('done-panel').style.display = 'none';
  document.getElementById('status-line').textContent = `Kick ${k.index + 1} of ${k.total}`;
  document.getElementById('kick-info').textContent = `${k.distance} yard Field Goal`;

  hideResultPopup();
  nextKickBtn.style.display = 'none';
  actionBtn.style.display = '';
  if (resultEl) resultEl.textContent = '';

  if (k.phase === 'result') {
    showFrozenResult(k); // already resolved (e.g. a page reload) — restore instantly, don't replay
    return;
  }

  resetPose(); // clears whatever the previous kick's flight animation left behind
  rebuildPowerMeter(k.distance);
  rebuildDirectionMeter();
  rebuildWindIndicator();

  if (k.phase === 'direction') {
    // Power's already locked — freeze its marker right where it landed
    // instead of animating, and hand control over to the direction meter.
    kickPhase = 'direction';
    const powerPosToShow = (trustLocalPowerSnap && lastLockedPowerT != null)
      ? lastLockedPowerT
      : (k.powerPos != null ? k.powerPos : 0.5);
    paintPowerMarker(powerPosToShow, k.distance);
    directionArrow.visible = true;
    currentDirectionStartedAt = k.directionStartedAt;
    actionBtn.textContent = 'Lock Direction!';
    actionBtn.disabled = false;
  } else {
    kickPhase = 'power';
    lastLockedPowerT = null; // fresh kick — nothing locked yet to trust
    powerMarker.visible = true;
    powerMarkerMat.color.set(0xffffff);
    powerMarkerMat.emissive.set(0xffffff);
    directionArrow.visible = false;
    currentPowerStartedAt = k.powerStartedAt;
    actionBtn.textContent = 'Lock Power!';
    actionBtn.disabled = false;
  }
}

// Instantly shows an already-resolved kick's final state — no animation
// replay. Needed for a page reload/re-open after a kick's outcome is
// already known (the server's `phase` is 'result' for the current kick
// until /field-goal/next is called).
function showFrozenResult(k) {
  resetPose();
  rebuildWindIndicator();
  const attempt = k.attempt;

  const startPos = new THREE.Vector3(ball.position.x, ball.position.y, ball.position.z);
  tee.visible = false;
  const flight = ballFlightFor(attempt.outcome, startPos, k.distance);
  ball.position.copy(flight.p2);

  const followBall = true; // every outcome now flies far enough to be worth following to the end zone
  if (followBall) {
    cameraLocked = true;
    controls.enabled = false;
    camera.position.copy(END_CAM_POS);
    camera.lookAt(END_CAM_TARGET);
    if (windArrow) windArrow.visible = false;
    if (windLabel) windLabel.visible = false;
  }

  referees.forEach((ref) => {
    const { left, right } = ref.userData.armPivots;
    if (attempt.made) {
      left.rotation.set(-Math.PI, 0, 0);
      right.rotation.set(-Math.PI, 0, 0);
    } else {
      left.rotation.set(-1.3, 0, -1.4);
      right.rotation.set(-1.3, 0, 1.4);
    }
    const anim = ref.userData.refAnim;
    if (anim) {
      const { leftArm, rightArm, bindLeft, bindRight } = anim;
      if (attempt.made) {
        leftArm.rotation.set(bindLeft.x + REF_ARM_UP_X, bindLeft.y, bindLeft.z);
        rightArm.rotation.set(bindRight.x + REF_ARM_UP_X, bindRight.y, bindRight.z);
      } else {
        // Matches animateRefereeSignal()'s miss-signal end state: elevation
        // stays at the crossed value, Z resolved back to the bind pose's
        // arms-wide spread.
        leftArm.rotation.set(bindLeft.x + REF_ARM_CROSSED_X, bindLeft.y, bindLeft.z);
        rightArm.rotation.set(bindRight.x + REF_ARM_CROSSED_X, bindRight.y, bindRight.z);
      }
    }
  });

  showResultPopup(attempt.outcome);
  if (resultEl) {
    resultEl.textContent = outcomeText(attempt, k.distance);
    resultEl.style.color = attempt.made ? '#4ade80' : '#ef4444';
  }
  kickPhase = 'result';
  actionBtn.style.display = 'none';
  nextKickBtn.style.display = 'inline-block';
}

actionBtn.addEventListener('click', async () => {
  if (actionBtn.disabled) return;
  if (kickPhase === 'power') {
    // Measured first, before anything else runs — this is what the player
    // actually saw the instant they clicked.
    const elapsedMs = currentPowerStartedAt != null ? Date.now() - currentPowerStartedAt : 0;
    actionBtn.disabled = true;
    // Snap the marker to the exact position this elapsedMs maps to right
    // now, instead of leaving it wherever the last animation frame (up to
    // ~16ms stale) happened to land — the server will confirm this same
    // spot once it responds, so there's nothing left to visibly "jump" to
    // afterward. Critically, this ALSO has to stop the render loop's power
    // branch from touching the marker again on the very next frame (it
    // recalculates position from real elapsed time every frame purely off
    // `kickPhase === 'power'`) — otherwise the marker kept sliding for the
    // whole round-trip to the server and only stopped once the response
    // came back, landing wherever real time had moved on to by then rather
    // than where it was actually clicked. Moving off 'power' immediately
    // freezes it at the snapped position for the remainder of the request.
    kickPhase = 'power-locking';
    lastLockedPowerT = trianglePosition(elapsedMs, powerPeriodMs);
    paintPowerMarker(lastLockedPowerT, currentDistance); // color + position, from THIS client's own clock
    try {
      const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/power-stop`, { memberId, elapsedMs });
      // trustLocalPowerSnap: the marker above is already showing exactly
      // what was clicked — don't let the repaint below override it with
      // the server's independently-recomputed powerPos (see
      // lastLockedPowerT's comment for why those can legitimately differ).
      renderKick(gi, { trustLocalPowerSnap: true });
    } catch (err) {
      alert(err.message);
      kickPhase = 'power'; // let the meter resume live so a retry click measures real elapsed time again
      actionBtn.disabled = false;
    }
  } else if (kickPhase === 'direction') {
    const elapsedMs = currentDirectionStartedAt != null ? Date.now() - currentDirectionStartedAt : 0;
    actionBtn.disabled = true;
    kickPhase = 'direction-locking'; // same freeze, for the same reason, on the direction arrow
    updateDirectionArrowPosition(trianglePosition(elapsedMs, directionPeriodMs));
    try {
      const { outcome } = await api('POST', `/api/game-instances/${instanceId}/field-goal/direction-stop`, { memberId, elapsedMs });
      kickPhase = 'flight';
      await performKick(outcome.outcome, outcome.distance); // ball flight + ref signal, using the server's real outcome
      if (resultEl) {
        resultEl.textContent = outcomeText(outcome, outcome.distance);
        resultEl.style.color = outcome.made ? '#4ade80' : '#ef4444';
      }
      actionBtn.style.display = 'none';
      nextKickBtn.style.display = 'inline-block';
    } catch (err) {
      alert(err.message);
      kickPhase = 'direction';
      actionBtn.disabled = false;
    }
  }
});

nextKickBtn.addEventListener('click', async () => {
  nextKickBtn.disabled = true;
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/next`, { memberId });
    if (gi.status === 'completed') {
      // Whole contest just finished on this move (e.g. a solo test instance,
      // or the last real player to finish) — nothing left to wait on.
      showDone(`Contest finished. You went ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}.`);
    } else if (gi.hasCompleted) {
      showDone(`You finished ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}! Waiting on the rest of the league…`);
    } else {
      renderKick(gi);
    }
  } catch (err) {
    alert(err.message);
  } finally {
    nextKickBtn.disabled = false;
  }
});

function showDone(message) {
  hideResultPopup();
  document.getElementById('kick-panel').style.display = 'none';
  document.getElementById('done-panel').style.display = 'block';
  document.getElementById('done-message').textContent = message;
  // Hidden until the player has actually finished their kicks -- per
  // direction, no easy way to wander off mid-game.
  document.getElementById('back-link').style.display = '';
}

// ---- Kick animation ---------------------------------------------------------
// A small hand-rolled tween/easing kit (Three.js object properties aren't
// something the Web Animations API can drive, so this plays the same role
// that WAAPI does for the 2D scene's CSS/SVG animations). Every animated
// pose is written as a pure function of a normalized progress value `u` in
// [0,1], so each phase is easy to reason about — and easy to sanity-check by
// calling it directly with a specific `u` — independent of how it's driven
// over real time.
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInQuad(t) { return t * t; }
function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

// Quadratic Bezier through three 3D points, evaluated at t in [0,1].
function bezier2(p0, p1, p2, t) {
  const u = 1 - t;
  return new THREE.Vector3(
    u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z
  );
}

// Runs onUpdate(u) once per frame for `duration` ms, u sweeping 0 -> 1.
function tween(duration, onUpdate) {
  return new Promise((resolve) => {
    const start = performance.now();
    function frame(now) {
      const u = Math.min(1, (now - start) / duration);
      onUpdate(u);
      if (u < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The ball's flight path as a 3-point Bezier (start / apex / end), sized to
// the kick's distance so the peak is always comfortably above the crossbar
// (3.05) at the moment the ball actually crosses the goalpost's plane.
function ballFlightFor(outcome, startPos, distanceYards) {
  const goalpostZ = GOAL_LINE_Z - 2;
  const peakHeight = 5 + distanceYards * 0.1;

  if (outcome === 'short') {
    // Flies like a real, full-strength attempt -- same arc height and
    // pacing as a made kick -- right up until it runs out of leg a few
    // yards shy of the goal line and drops, instead of visibly dying in
    // the air just off the tee.
    const endZ = goalpostZ + 5; // a few yards short of the posts
    return {
      p0: startPos.clone(),
      p1: new THREE.Vector3(startPos.x * 0.5, peakHeight, (startPos.z + endZ) / 2),
      p2: new THREE.Vector3(startPos.x * 0.3, 0.2, endZ),
      duration: (900 + distanceYards * 6) * 1.6,
    };
  }

  const endZ = goalpostZ - 12; // carries on well past the posts before we reset
  const endX = outcome === 'wide-left' ? -(UPRIGHT_HALF_SPAN + 2.2)
    : outcome === 'wide-right' ? (UPRIGHT_HALF_SPAN + 2.2)
    : 0; // made — straight through the middle
  return {
    p0: startPos.clone(),
    p1: new THREE.Vector3(endX / 2, peakHeight, (startPos.z + endZ) / 2),
    p2: new THREE.Vector3(endX, 1.2, endZ),
    duration: (900 + distanceYards * 6) * 1.6,
  };
}

// Referee signal poses: both arms straight up overhead for a made kick, or
// a cross-then-spread-wide wave for a miss.
function animateRefereeSignal(made) {
  const promises = referees.map((ref) => {
    const anim = ref.userData.refAnim;
    if (anim) {
      const { leftArm, rightArm, bindLeft, bindRight } = anim;
      const fromLeftX = leftArm.rotation.x, fromLeftZ = leftArm.rotation.z;
      const fromRightX = rightArm.rotation.x, fromRightZ = rightArm.rotation.z;

      if (made) {
        const toLeftX = bindLeft.x + REF_ARM_UP_X, toRightX = bindRight.x + REF_ARM_UP_X;
        return tween(450, (u) => {
          const t = easeOutQuad(u);
          leftArm.rotation.x = lerp(fromLeftX, toLeftX, t);
          rightArm.rotation.x = lerp(fromRightX, toRightX, t);
        });
      }
      // Cross in front of the chest, then spread back out to the bind
      // pose's arms-wide stance -- elevation stays at the crossed value
      // through this second phase (matching the procedural version's
      // shape below, where only the spread/Z motion happens in phase 2).
      const crossedLeftX = bindLeft.x + REF_ARM_CROSSED_X, crossedLeftZ = bindLeft.z + REF_ARM_CROSSED_Z;
      const crossedRightX = bindRight.x + REF_ARM_CROSSED_X, crossedRightZ = bindRight.z + REF_ARM_CROSSED_Z;
      return tween(600, (u) => {
        if (u < 0.5) {
          const t = easeOutQuad(u / 0.5);
          leftArm.rotation.x = lerp(fromLeftX, crossedLeftX, t);
          leftArm.rotation.z = lerp(fromLeftZ, crossedLeftZ, t);
          rightArm.rotation.x = lerp(fromRightX, crossedRightX, t);
          rightArm.rotation.z = lerp(fromRightZ, crossedRightZ, t);
        } else {
          const t = easeOutQuad((u - 0.5) / 0.5);
          leftArm.rotation.z = lerp(crossedLeftZ, bindLeft.z, t);
          rightArm.rotation.z = lerp(crossedRightZ, bindRight.z, t);
        }
      });
    }

    // Fallback for when the animated model hasn't loaded (or failed to) by
    // the time a result fires -- the original hand-built arm-pivot tweens.
    const { left, right } = ref.userData.armPivots;
    if (made) {
      return tween(450, (u) => {
        const t = easeOutQuad(u);
        left.rotation.x = lerp(0, -Math.PI, t);
        right.rotation.x = lerp(0, -Math.PI, t);
      });
    }
    return tween(600, (u) => {
      if (u < 0.5) {
        const t = easeOutQuad(u / 0.5);
        left.rotation.x = lerp(0, -1.3, t);
        right.rotation.x = lerp(0, -1.3, t);
        left.rotation.z = lerp(0, 0.35, t);
        right.rotation.z = lerp(0, -0.35, t);
      } else {
        const t = easeOutQuad((u - 0.5) / 0.5);
        left.rotation.z = lerp(0.35, -1.4, t);
        right.rotation.z = lerp(-0.35, 1.4, t);
      }
    });
  });
  return Promise.all(promises);
}

// Resets the scene to its idle "about to kick" state — called at the start
// of every fresh kick to undo whatever the previous kick's flight animation
// (or a restored frozen result) left behind: camera handed back to
// OrbitControls, kicker/ball/tee back at their resting spots, referees'
// arms back down.
function resetPose() {
  cameraLocked = false;
  controls.enabled = true;
  updateDistance(currentDistance);
  kicker.position.x = KICKER_SIDE_OFFSET;
  kicker.position.y = 0;
  kicker.rotation.y = 0;
  kicker.userData.legPivots.left.rotation.x = 0;
  kicker.userData.legPivots.right.rotation.x = 0;
  const anim = kicker.userData.kickAnim;
  if (anim) {
    anim.action.stop();
    anim.mixer.setTime(0);
    anim.hips.position.copy(anim.hipsBindLocalPos);
  }
  tee.visible = true;
  ball.visible = true;
  ball.position.x = 0;
  ball.position.y = BALL_REST_Y;
  ball.scale.set(1, 1, 1.5);
  ball.rotation.set(Math.PI / 2, 0, 0);
  referees.forEach(setRefereeIdle);
  if (windArrow) windArrow.visible = true;
  if (windLabel) windLabel.visible = true;
}

// Where the camera ends up once it follows the ball in flight — behind the
// goalpost looking back toward the kicker, so both uprights and both
// referees are in frame together when the result actually happens, instead
// of it playing out somewhere off past the edge of the kick-cam's view.
const END_CAM_POS = new THREE.Vector3(0, 3, GOAL_LINE_Z - 10);
const END_CAM_TARGET = new THREE.Vector3(0, 3, GOAL_LINE_Z);

// Plays the full approach/swing/flight/referee-signal sequence for a kick
// whose outcome the server has already decided, then shows the result
// popup and stops — leaving the frozen result on screen until the player
// clicks "Next Kick" (renderKick()'s resetPose() is what cleans this up).
async function performKick(outcome, distanceYards) {
  controls.enabled = false; // hands-off for the whole sequence; the next renderKick()'s resetPose() gives it back

  const ballStartZ = ball.position.z;
  const startPos = kicker.position.clone();
  const plantPos = { x: -0.22, z: ballStartZ + 0.1 };
  const approachAngle = -0.45; // angled toward the ball at the start of the run

  let flightAndFollowUp = Promise.resolve();

  // Shared by both the animated and procedural-fallback paths below: tee
  // disappears, camera hands off to follow the ball to the end zone, wind
  // indicator hides, ball flies, referee signals the result partway
  // through the flight. Every outcome (including 'short') now flies far
  // enough down the field to be worth following there.
  function fireContact() {
    tee.visible = false;
    const followBall = true;
    if (followBall) {
      cameraLocked = true; // hand the camera fully to this animation until the next renderKick()'s resetPose() gives it back
      // The wind indicator's position tracks the kick-cam, not wherever the
      // camera ends up once it follows the ball to the end zone — left up,
      // it'd hang somewhere nonsensical relative to the new view (or right
      // behind the posts) for the rest of the kick.
      if (windArrow) windArrow.visible = false;
      if (windLabel) windLabel.visible = false;
    }
    const camStartPos = camera.position.clone();
    const camStartTarget = new THREE.Vector3(0, 2, GOAL_LINE_Z + 10); // matches updateDistance()'s kick-cam target
    const flight = ballFlightFor(outcome, new THREE.Vector3(ball.position.x, ball.position.y, ballStartZ), distanceYards);
    const ballFlight = tween(flight.duration, (fu) => {
      const p = bezier2(flight.p0, flight.p1, flight.p2, fu);
      ball.position.copy(p);
      ball.rotation.z += 0.5; // spiral spin, purely cosmetic

      if (followBall) {
        // Camera eases from the kick cam to the end-zone view over the same
        // span as the ball's flight, so it arrives right as the ball does.
        const ct = easeOutQuad(fu);
        camera.position.lerpVectors(camStartPos, END_CAM_POS, ct);
        const lookTarget = new THREE.Vector3().lerpVectors(camStartTarget, END_CAM_TARGET, ct);
        camera.lookAt(lookTarget);
      }
    });
    const refSignal = wait(flight.duration * 0.6).then(() => animateRefereeSignal(outcome === 'made'));
    flightAndFollowUp = Promise.all([ballFlight, refSignal]);
  }

  const anim = kicker.userData.kickAnim;
  if (anim) {
    // Real mocap run-up + kick, driven by the clip's own pacing (see
    // calibrateKickAnimation() above) instead of a generic tween. Position
    // is a straight-line lerp toward the plant spot using the clip's own
    // progress-over-time curve; the hips bone's baked translation is reset
    // to its bind pose every frame so it doesn't ALSO move the character on
    // top of that -- only its rotation (the actual stride motion) survives.
    let contactFired = false;
    anim.action.reset();
    anim.action.play();
    await tween(PLAYBACK_DURATION_MS, (u) => {
      const clipTime = u * SEQUENCE_END;
      anim.mixer.setTime(Math.min(clipTime, anim.clip.duration));
      anim.hips.position.copy(anim.hipsBindLocalPos);

      const t = anim.progress(clipTime);
      kicker.position.x = lerp(startPos.x, plantPos.x, t);
      kicker.position.z = lerp(startPos.z, plantPos.z, t);
      kicker.rotation.y = lerp(approachAngle, 0, t);

      if (!contactFired && clipTime >= CONTACT_TIME) {
        contactFired = true;
        fireContact();
      }
    });
  } else {
    // Fallback for when the animated model hasn't loaded (or failed to) by
    // the time a kick starts -- the original hand-built leg-pivot tweens.

    // Phase 1: jog up to the ball at a forward/right angle (not straight
    // ahead) — both the path itself (a real diagonal, not just a small
    // sideways drift) and the body's own facing angle, which straightens
    // out to square up with the ball right as he arrives.
    await tween(600, (u) => {
      const t = easeInQuad(u); // accelerate into the approach, like a real run-up
      kicker.position.x = lerp(startPos.x, plantPos.x, t);
      kicker.position.z = lerp(startPos.z, plantPos.z, t);
      kicker.position.y = Math.abs(Math.sin(u * Math.PI * 3)) * 0.05;
      kicker.rotation.y = lerp(approachAngle, 0, easeOutQuad(u));
      const stride = Math.sin(u * Math.PI * 6);
      kicker.userData.legPivots.left.rotation.x = stride * 0.5;
      kicker.userData.legPivots.right.rotation.x = -stride * 0.5;
    });
    kicker.position.y = 0;
    kicker.rotation.y = 0;

    // Phase 2: plant the left leg, cock the right leg back, then swing it
    // through. Contact happens partway through the forward swing.
    let contactFired = false;
    await tween(260, (u) => {
      kicker.userData.legPivots.left.rotation.x = -0.15;
      const swing = u < 0.35
        ? lerp(0, -0.7, easeOutQuad(u / 0.35))
        : lerp(-0.7, 1.1, easeOutQuad((u - 0.35) / 0.65));
      kicker.userData.legPivots.right.rotation.x = swing;

      if (!contactFired && u >= 0.55) {
        contactFired = true;
        fireContact();
      }
    });
  }

  await flightAndFollowUp;
  showResultPopup(outcome);
}

// ---- Resize handling --------------------------------------------------------
// #fg3d-canvas-wrap's actual size (width: 100%, aspect-ratio: 16/9) comes
// entirely from /style.css, not inline HTML, so its layout could in
// principle not be settled yet the instant this module runs. A
// ResizeObserver is a strictly more robust way to size the renderer than a
// single synchronous call regardless: it fires once immediately with
// whatever the current size is, and again automatically any time the
// element's actual layout size changes for any reason (a stylesheet
// finishing load, a font swap reflowing the page, the window resizing).
function resize() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (!w || !h) return; // not laid out yet — the observer will fire again once it is
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // ResizeObserver's own initial callback fires asynchronously (not in this
  // same script turn), so this may be the first time the renderer has ever
  // been sized correctly — repaint immediately rather than leaving it to
  // wait on animate()'s next requestAnimationFrame tick, which a
  // backgrounded/occluded tab can defer indefinitely (see the note above
  // animate() below).
  renderFrame();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(wrap);

// ---- Render loop -------------------------------------------------------------
// While a kick animation is driving the camera directly (following the ball
// in flight — see performKick()), OrbitControls' own per-frame update() must
// be skipped: it recomputes camera.position from its stored target/spherical
// state every call, which would fight any manual position/lookAt changes.
let cameraLocked = false;
function renderFrame() {
  if (!cameraLocked) controls.update();

  if (kickPhase === 'power' && currentPowerStartedAt != null) {
    const elapsed = Date.now() - currentPowerStartedAt;
    currentPowerT = trianglePosition(elapsed, powerPeriodMs);
    updatePowerMarkerPosition(currentPowerT);
  } else if (kickPhase === 'direction' && directionCurve && currentDirectionStartedAt != null) {
    const elapsed = Date.now() - currentDirectionStartedAt;
    currentDirectionT = trianglePosition(elapsed, directionPeriodMs);
    updateDirectionArrowPosition(currentDirectionT);
  }

  renderer.render(scene, camera);
}
function animate() {
  requestAnimationFrame(animate);
  renderFrame();
}
// A page load can land in a browser tab/window that isn't yet considered
// "visible" for compositing purposes (not focused, covered by another
// window, etc.) — Chromium can defer requestAnimationFrame indefinitely for
// a backgrounded tab, so relying on animate()'s first rAF callback alone
// left the canvas showing nothing but its CSS background color (the sky
// blue happened to match the scene's own background, which made this read
// as "the 3D scene never rendered" rather than "it's just delayed") until
// something — switching tabs, opening DevTools — finally woke it up. A
// direct synchronous render right here guarantees a first frame regardless
// of whether/when rAF gets around to firing, and a visibilitychange
// listener repaints again the moment the tab actually becomes visible, in
// case that first frame landed while still occluded.
renderFrame();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderFrame();
});
animate();

// ---- Server wiring: load / resync / poll -----------------------------------
// Mirrors lib/gameEngine/fieldGoal.js's NEAR_MISS_POWER_MARGIN exactly —
// used only by paintPowerMarker()'s cosmetic color preview above.
const NEAR_MISS_POWER_MARGIN = 0.03;

// If the tab gets backgrounded while a meter is actively running (switching
// apps/tabs, a notification, the screen locking), the animation pauses —
// same as any browser tab — but real elapsed time doesn't. Rather than let
// a click after coming back silently score off however far the clock
// drifted while nobody was watching, ask the server for a fresh start on
// whichever meter was running the moment we're looking again.
let needsResync = false;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    if (kickPhase === 'power' || kickPhase === 'direction') needsResync = true;
    return;
  }
  if (!needsResync || !memberId) return;
  needsResync = false;
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/resync`, { memberId });
    if (gi.status === 'completed') {
      showDone(gi.yourScore != null ? `Contest finished. You went ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}.` : 'Contest finished.');
    } else if (gi.hasCompleted) {
      showDone(`You finished ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}! Waiting on the rest of the league…`);
    } else {
      renderKick(gi);
    }
  } catch {
    // Best-effort — worst case the meter's just slightly stale until the
    // next click naturally corrects it anyway.
  }
});

async function init() {
  if (!memberId) {
    document.getElementById('status-line').textContent = 'This is a spectator link — field goals are kicked individually by each member.';
    document.getElementById('kick-panel').style.display = 'none';
    return;
  }
  const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
  powerPeriodMs = gi.powerPeriodMs || powerPeriodMs;
  directionPeriodMs = gi.directionPeriodMs || directionPeriodMs;

  if (gi.status === 'completed') {
    showDone(gi.yourScore != null ? `Contest finished. You went ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}.` : 'Contest finished.');
    return;
  }
  if (gi.hasCompleted) {
    showDone(`You finished ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}! Waiting on the rest of the league…`);
    poll();
    return;
  }
  renderKick(gi);
}

function poll() {
  setInterval(async () => {
    const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
    if (gi.status === 'completed') {
      showDone(gi.yourScore != null ? `Contest finished. You went ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}.` : 'Contest finished.');
    }
  }, 4000);
}

init();
