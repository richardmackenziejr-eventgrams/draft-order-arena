// Field Goal Kick — 3D visual prototype.
//
// Pure visual test: builds a low-poly stadium/field/kicker scene in Three.js
// so we can evaluate whether a 3D version of the kicking scene is worth
// building out for real. Nothing here is wired to game state yet — it's a
// static scene with a free-look camera (OrbitControls) so it can be judged
// from any angle, plus a distance slider that repositions the kicker/ball
// (and the camera, which follows like a broadcast "kick cam") to preview how
// different kick distances would actually look.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
// updateDistance() below, once the kick-distance control exists.
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

// Referees: proper NFL look — horizontal black/white striped shirt
// (including sleeves), solid black pants/knickers, and a white cap rather
// than the kicker's football helmet. Positioned just this side of the
// goalpost (real refs hold the goal line regardless of kick distance, so
// these don't move with the slider).
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

const referees = [-1, 1].map((side) => {
  const ref = buildReferee();
  ref.position.set(side * (UPRIGHT_HALF_SPAN + 1.6), 0, GOAL_LINE_Z + 3);
  ref.rotation.y = Math.PI; // face back toward the kicker
  scene.add(ref);
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

// ---- Stadium: crowd-textured stands + light stanchions ---------------------
// A stylized, deliberately blurry stadium crowd — a low-res grid of random
// crowd-colored pixels on a seat-colored background. Left at low resolution
// and stretched across a big stand face, the texture's own linear filtering
// blurs it into an impressionistic "distant fans" look rather than
// individually-readable people (which would be way more detail than this
// scene needs, and wouldn't hold up this close for real).
function crowdTexture() {
  const cols = 48;
  const rows = 14;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#26313d';
  ctx.fillRect(0, 0, cols, rows);
  const colors = ['#e8b98a', '#8a5a3c', '#f4f4f4', '#c0392b', '#2f5fbf', '#f1c40f', '#27ae60', '#7f8c8d', '#ecf0f1', '#9b59b6'];
  // Leave the bottom couple of rows solid (a concrete wall under the seats)
  // and only scatter "fans" in the upper rows.
  for (let y = 0; y < rows - 2; y++) {
    for (let x = 0; x < cols; x++) {
      if (Math.random() < 0.88) {
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const concreteMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.95 });

function crowdMaterial(repeatX, repeatY) {
  const tex = crowdTexture();
  tex.repeat.set(repeatX, repeatY);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
}

// BoxGeometry's face material order is [+x, -x, +y, -y, +z, -z]. Only the
// face actually pointing back toward the field gets the crowd texture — the
// rest are plain stadium concrete, since nobody ever sees them.
function standMaterials(facingIndex, repeatX, repeatY) {
  const mats = [concreteMat, concreteMat, concreteMat, concreteMat, concreteMat, concreteMat];
  mats[facingIndex] = crowdMaterial(repeatX, repeatY);
  return mats;
}

const STAND_HEIGHT = 8;
const STAND_DEPTH = NEAR_Z - FAR_Z + 30;

[-1, 1].forEach((side) => {
  // side === -1 (left stand, negative x) faces the field in the +x
  // direction, so it needs the +x face (index 0). The right stand faces -x
  // (index 1).
  const facingIndex = side === -1 ? 0 : 1;
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(6, STAND_HEIGHT, STAND_DEPTH),
    standMaterials(facingIndex, 6, 2)
  );
  stand.position.set(side * (FIELD_HALF_WIDTH + 6), STAND_HEIGHT / 2, (NEAR_Z + FAR_Z) / 2);
  stand.receiveShadow = true;
  scene.add(stand);

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
const backStand = new THREE.Mesh(
  new THREE.BoxGeometry(FIELD_HALF_WIDTH * 2 + 12, STAND_HEIGHT + 2, 5),
  standMaterials(4, 8, 2) // +z face (index 4) is the one facing back toward the field
);
backStand.position.set(0, (STAND_HEIGHT + 2) / 2, BACK_STAND_Z);
backStand.receiveShadow = true;
scene.add(backStand);

// ---- Kick distance control ---------------------------------------------
// Stylized, not to real-world scale — a true 55-yard kick would put the
// kicker so far from the goalpost it'd vanish into the fog. Compressing the
// range keeps every distance clearly readable while still visibly farther
// apart from each other.
const MIN_DISTANCE = 25;
const MAX_DISTANCE = 55;
const DEFAULT_DISTANCE = 40;

// Apparent size is roughly 1/distance, so equal *yardage* steps do NOT read
// as equal *visual* steps — a straight linear mapping left most of the
// perceptible "pulling back" concentrated in the 25-40yd stretch, so 40yd
// already looked close to as far as it gets. This curve keeps every kick
// under ~40yd clustered close to the goalpost (matching how close a 25-40yd
// attempt should feel) and saves the dramatic pull-back for the last
// stretch toward the 55yd max, so the farthest kick unambiguously reads as
// the farthest view. The two endpoints are unchanged from the old linear
// mapping (25yd == -28.75, 55yd == -3.25) — only the shape in between does.
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

const distanceSlider = document.getElementById('fg3d-distance');
const distanceLabel = document.getElementById('fg3d-distance-label');
if (distanceSlider) {
  distanceSlider.min = MIN_DISTANCE;
  distanceSlider.max = MAX_DISTANCE;
  distanceSlider.value = DEFAULT_DISTANCE;
  distanceSlider.addEventListener('input', () => {
    const d = Number(distanceSlider.value);
    if (distanceLabel) distanceLabel.textContent = `${d} yd Field Goal`;
    updateDistance(d);
    // Only live-follow the slider while the power meter is still running —
    // once direction/flight has started, the ball's spot (and the meters
    // built around it) needs to hold still.
    if (kickPhase === 'power') {
      rebuildPowerMeter(d);
      rebuildDirectionMeter();
    }
  });
}
if (distanceLabel) distanceLabel.textContent = `${DEFAULT_DISTANCE} yd Field Goal`;
updateDistance(DEFAULT_DISTANCE);

// ---- Power & direction meters (interactive) ---------------------------------
// The same two-click mechanic as the 2D game (a deterministic triangle wave,
// sampled at the instant you click) — reimplemented here as 3D overlays
// instead of flat side-panel bars: a curved "kicking arc" (after the classic
// Madden power gauge) for power, and a sweeping arrow for direction, both
// sitting right over the scene instead of beside it. Client-only for this
// prototype, same as everything else here — no server round-trip.
const POWER_PERIOD_MS = 1000;
const DIRECTION_PERIOD_MS = 1000;
const POWER_SWEET_HALF_LONG = 0.05;   // 50+ yards
const POWER_SWEET_HALF_MID = 0.09;    // 40-49 yards
const POWER_SWEET_HALF_SHORT = 0.14;  // under 40 yards
const LONG_DISTANCE_THRESHOLD = 50;
const MID_DISTANCE_THRESHOLD = 40;
const WIDE_TOLERANCE = 0.22;   // direction tolerance at the closest distance
const NARROW_TOLERANCE = 0.05; // direction tolerance at the farthest distance

function trianglePosition(elapsedMs, periodMs) {
  const cycle = ((elapsedMs % periodMs) + periodMs) % periodMs;
  const t = cycle / periodMs;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}
function powerSweetHalfFor(distance) {
  if (distance >= LONG_DISTANCE_THRESHOLD) return POWER_SWEET_HALF_LONG;
  if (distance >= MID_DISTANCE_THRESHOLD) return POWER_SWEET_HALF_MID;
  return POWER_SWEET_HALF_SHORT;
}
function accuracyToleranceFor(distance) {
  const t = Math.max(0, Math.min(1, (distance - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE)));
  return WIDE_TOLERANCE - t * (WIDE_TOLERANCE - NARROW_TOLERANCE);
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

// A 3D vertical power bar — same shape/idea as the 2D game's vertical meter
// (a track, a highlighted sweet-spot band, a sliding marker), just built as
// real boxes with depth instead of a flat CSS bar, and floating in the 3D
// scene next to the kicker instead of in a side panel.
const POWER_BAR_HEIGHT = 2.3;
const POWER_BAR_WIDTH = 0.46;
const POWER_BAR_DEPTH = 0.14;
// A light frame sitting just behind the track, a bit larger in width/height
// — since it's also a bit thinner in depth, the track (thicker, closer to
// the camera) covers it everywhere except that overhanging border, reading
// as an actual picture-frame edge around the meter. Light/bright so it
// reads clearly against grass, not just another dark-on-green shape.
const POWER_FRAME_MARGIN = 0.09;
const powerFrame = new THREE.Mesh(
  new THREE.BoxGeometry(POWER_BAR_WIDTH + POWER_FRAME_MARGIN * 2, POWER_BAR_HEIGHT + POWER_FRAME_MARGIN * 2, POWER_BAR_DEPTH * 0.6),
  new THREE.MeshStandardMaterial({ color: 0xeceff1, roughness: 0.45, metalness: 0.2 })
);
scene.add(powerFrame);
const powerTrack = new THREE.Mesh(
  new THREE.BoxGeometry(POWER_BAR_WIDTH, POWER_BAR_HEIGHT, POWER_BAR_DEPTH),
  new THREE.MeshStandardMaterial({ color: 0x14251c, transparent: true, opacity: 0.85, roughness: 0.7 })
);
scene.add(powerTrack);
const powerMarkerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
const powerMarker = new THREE.Mesh(
  new THREE.BoxGeometry(POWER_BAR_WIDTH + 0.14, 0.12, POWER_BAR_DEPTH + 0.14),
  powerMarkerMat
);
scene.add(powerMarker);
let powerSweetMesh = null;
let powerMeterCenter = new THREE.Vector3();

// Repositions the bar beside the ball and resizes the green sweet-spot band
// for this kick's distance — called at the start of every attempt, and live
// while the slider moves during the power phase. Kept well to the left of
// the kicker's own resting spot (-1.7) so it doesn't clip through him
// during the approach.
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

  if (powerSweetMesh) { scene.remove(powerSweetMesh); powerSweetMesh.geometry.dispose(); powerSweetMesh.material.dispose(); }
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
// end) and banks it to match the curve's tangent there, like a real gauge
// needle following a bowed track rather than just teleporting along it.
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

let kickPhase = 'power'; // 'power' | 'direction' | 'flight'
let powerStartedAt = Date.now();
let directionStartedAt = Date.now();
let currentPowerT = 0.5;
let currentDirectionT = 0.5;
let lockedPowerT = 0.5;
let lockedPowerDeviation = 0; // |lockedPowerT - 0.5| — set in lockPower(), read in lockDirection()'s near-miss check
let hadPowerResult = false;

const actionBtn = document.getElementById('fg3d-action-btn');
const resultEl = document.getElementById('fg3d-result');

function outcomeText(outcome) {
  switch (outcome) {
    case 'made': return 'MADE!';
    case 'short': return 'NO GOOD — SHORT';
    case 'wide-left': return 'NO GOOD — WIDE LEFT';
    case 'wide-right': return 'NO GOOD — WIDE RIGHT';
    default: return '';
  }
}

function startPowerPhase() {
  kickPhase = 'power';
  powerStartedAt = Date.now();
  if (resultEl) resultEl.textContent = '';
  rebuildPowerMeter(Number(distanceSlider ? distanceSlider.value : DEFAULT_DISTANCE));
  rebuildDirectionMeter();
  powerMarker.visible = true;
  powerMarkerMat.color.set(0xffffff);
  powerMarkerMat.emissive.set(0xffffff);
  directionArrow.visible = false;
  if (actionBtn) { actionBtn.textContent = 'Lock Power!'; actionBtn.disabled = false; }
  if (distanceSlider) distanceSlider.disabled = false;
}

// A power click just outside the green isn't automatically a dead "short"
// anymore — if the direction lock is precise enough (see lockDirection()),
// a near-miss leg gets saved. This is that margin: how far past the sweet
// spot's own edge still counts as "just barely outside" rather than a
// clean miss.
const NEAR_MISS_POWER_MARGIN = 0.03;

function lockPower() {
  const distanceYards = Number(distanceSlider ? distanceSlider.value : DEFAULT_DISTANCE);
  lockedPowerT = currentPowerT;
  lockedPowerDeviation = Math.abs(lockedPowerT - 0.5);
  const sweetHalf = powerSweetHalfFor(distanceYards);
  hadPowerResult = lockedPowerDeviation <= sweetHalf;
  // Three-tier feedback: clean hit (green), just outside — still save-able
  // with a precise-enough direction lock, see lockDirection() — (yellow,
  // a caution rather than a flat miss), or a clean miss (red).
  const isNearMiss = !hadPowerResult && lockedPowerDeviation <= sweetHalf + NEAR_MISS_POWER_MARGIN;
  const color = hadPowerResult ? 0x4ade80 : isNearMiss ? 0xf5c542 : 0xef4444;
  powerMarkerMat.color.set(color);
  powerMarkerMat.emissive.set(color);

  kickPhase = 'direction';
  directionStartedAt = Date.now();
  directionArrow.visible = true;
  if (actionBtn) actionBtn.textContent = 'Lock Direction!';
  if (distanceSlider) distanceSlider.disabled = true;
}

function lockDirection() {
  const distanceYards = Number(distanceSlider ? distanceSlider.value : DEFAULT_DISTANCE);
  const offset = currentDirectionT - 0.5;
  const tolerance = accuracyToleranceFor(distanceYards);
  const sweetHalf = powerSweetHalfFor(distanceYards);

  // Power was just outside the green, but a dead-center direction lock
  // (within the *inner half* of the normal tolerance — noticeably more
  // precise than "just good enough") saves it anyway: precise aim making
  // up for a slightly-off leg.
  const nearMissSave = !hadPowerResult
    && lockedPowerDeviation <= sweetHalf + NEAR_MISS_POWER_MARGIN
    && Math.abs(offset) <= tolerance / 2;
  const enoughPower = hadPowerResult || nearMissSave;

  let outcome;
  if (!enoughPower) outcome = 'short';
  else if (Math.abs(offset) > tolerance) outcome = offset > 0 ? 'wide-right' : 'wide-left';
  else outcome = 'made';

  kickPhase = 'flight';
  if (actionBtn) actionBtn.disabled = true;
  performKick(outcome).then(() => startPowerPhase());
}

if (actionBtn) {
  actionBtn.addEventListener('click', () => {
    if (kickPhase === 'power') lockPower();
    else if (kickPhase === 'direction') lockDirection();
  });
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
// (3.05) at the moment the ball actually crosses the goalpost's plane — see
// the accompanying design notes: with the apex's z held at the midpoint of
// start/end z, z(t) is exactly linear, so the fraction of the flight at
// which the ball reaches the goalpost is easy to solve for and check against.
function ballFlightFor(outcome, startPos, distanceYards) {
  const goalpostZ = GOAL_LINE_Z - 2;
  const peakHeight = 5 + distanceYards * 0.1;

  if (outcome === 'short') {
    const travel = (startPos.z - goalpostZ) * 0.45; // falls well short of the posts
    const endZ = startPos.z - travel;
    return {
      p0: startPos.clone(),
      p1: new THREE.Vector3(startPos.x * 0.5, peakHeight * 0.45, (startPos.z + endZ) / 2),
      p2: new THREE.Vector3(startPos.x * 0.3, 0.15, endZ),
      duration: 650 + distanceYards * 4,
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
    // Slowed ~60% vs. the original (900 + distance*6) — at full speed the
    // ball crossed the goalpost's plane too fast to actually see whether it
    // split the uprights or sailed past them, especially on the wide misses.
    duration: (900 + distanceYards * 6) * 1.6,
  };
}

// Referee signal poses: both arms straight up overhead for a made kick, or
// a cross-then-spread-wide wave for a miss — echoing the 2D scene's
// 2-keyframe "straight up" vs. 3-keyframe "cross then out" signals.
function animateRefereeSignal(made) {
  const promises = referees.map((ref) => {
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

function resetPose() {
  cameraLocked = false;
  controls.enabled = true;
  const d = Number(distanceSlider ? distanceSlider.value : DEFAULT_DISTANCE);
  updateDistance(d); // resets ball/tee's z, but not x/y — the flight/approach leaves those wherever they ended (also resets the camera/controls.target back to the kick cam)
  kicker.position.x = KICKER_SIDE_OFFSET;
  kicker.position.y = 0;
  kicker.rotation.y = 0;
  kicker.userData.legPivots.left.rotation.x = 0;
  kicker.userData.legPivots.right.rotation.x = 0;
  tee.visible = true;
  ball.visible = true;
  ball.position.x = 0;
  ball.position.y = BALL_REST_Y;
  ball.scale.set(1, 1, 1.5);
  ball.rotation.set(Math.PI / 2, 0, 0);
  referees.forEach((ref) => {
    ref.userData.armPivots.left.rotation.set(0, 0, 0);
    ref.userData.armPivots.right.rotation.set(0, 0, 0);
  });
}

// Where the camera ends up once it follows the ball in flight — behind the
// goalpost looking back toward the kicker, so both uprights and both
// referees are in frame together when the result actually happens, instead
// of it playing out somewhere off past the edge of the kick-cam's view.
const END_CAM_POS = new THREE.Vector3(0, 3, GOAL_LINE_Z - 10);
const END_CAM_TARGET = new THREE.Vector3(0, 3, GOAL_LINE_Z);

async function performKick(outcome) {
  const distanceYards = Number(distanceSlider ? distanceSlider.value : DEFAULT_DISTANCE);
  if (distanceSlider) distanceSlider.disabled = true;
  controls.enabled = false; // hands-off for the whole sequence; resetPose() gives it back

  const ballStartZ = ball.position.z;
  const startPos = kicker.position.clone();
  const plantPos = { x: -0.22, z: ballStartZ + 0.1 };

  // Phase 1: jog up to the ball at a forward/right angle (not straight
  // ahead) — both the path itself (a real diagonal, not just a small
  // sideways drift) and the body's own facing angle, which straightens out
  // to square up with the ball right as he arrives.
  const approachAngle = -0.45; // angled toward the ball at the start of the run
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
  let flightAndFollowUp = Promise.resolve();
  await tween(260, (u) => {
    kicker.userData.legPivots.left.rotation.x = -0.15;
    const swing = u < 0.35
      ? lerp(0, -0.7, easeOutQuad(u / 0.35))
      : lerp(-0.7, 1.1, easeOutQuad((u - 0.35) / 0.65));
    kicker.userData.legPivots.right.rotation.x = swing;

    if (!contactFired && u >= 0.55) {
      contactFired = true;
      tee.visible = false;
      // A short kick never reaches the goalpost, so following the ball
      // there would just leave it stranded tiny and distant in the same
      // frame as the posts — easier to just watch it from the kick cam,
      // where it's actually close to the camera the whole time.
      const followBall = outcome !== 'short';
      if (followBall) cameraLocked = true; // hand the camera fully to this animation until resetPose() gives it back
      const camStartPos = camera.position.clone();
      const camStartTarget = new THREE.Vector3(0, 2, GOAL_LINE_Z + 10); // matches updateDistance()'s kick-cam target
      const flight = ballFlightFor(outcome, new THREE.Vector3(ball.position.x, ball.position.y, ballStartZ), distanceYards);
      const ballFlight = tween(flight.duration, (fu) => {
        const p = bezier2(flight.p0, flight.p1, flight.p2, fu);
        ball.position.copy(p);
        ball.rotation.z += 0.5; // spiral spin, purely cosmetic

        if (followBall) {
          // Camera eases from the kick cam to the end-zone view over the
          // same span as the ball's flight, so it arrives right as the
          // ball does.
          const ct = easeOutQuad(fu);
          camera.position.lerpVectors(camStartPos, END_CAM_POS, ct);
          const lookTarget = new THREE.Vector3().lerpVectors(camStartTarget, END_CAM_TARGET, ct);
          camera.lookAt(lookTarget);
        }
      });
      const refSignal = wait(flight.duration * 0.6).then(() => animateRefereeSignal(outcome === 'made'));
      flightAndFollowUp = Promise.all([ballFlight, refSignal]);
    }
  });

  await flightAndFollowUp;
  if (resultEl) {
    resultEl.textContent = outcomeText(outcome);
    resultEl.style.color = outcome === 'made' ? '#4ade80' : '#ef4444';
  }
  await wait(700);
  resetPose();
  if (distanceSlider) distanceSlider.disabled = false;
}

// ---- Resize handling --------------------------------------------------------
function resize() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- Render loop -------------------------------------------------------------
// While a kick animation is driving the camera directly (following the ball
// in flight — see performKick()), OrbitControls' own per-frame update() must
// be skipped: it recomputes camera.position from its stored target/spherical
// state every call, which would fight any manual position/lookAt changes.
let cameraLocked = false;
function animate() {
  requestAnimationFrame(animate);
  if (!cameraLocked) controls.update();

  if (kickPhase === 'power') {
    const elapsed = Date.now() - powerStartedAt;
    currentPowerT = trianglePosition(elapsed, POWER_PERIOD_MS);
    updatePowerMarkerPosition(currentPowerT);
  } else if (kickPhase === 'direction' && directionCurve) {
    const elapsed = Date.now() - directionStartedAt;
    currentDirectionT = trianglePosition(elapsed, DIRECTION_PERIOD_MS);
    updateDirectionArrowPosition(currentDirectionT);
  }

  renderer.render(scene, camera);
}
animate();
startPowerPhase();
