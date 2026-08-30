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

// ---- Simple stylized humanoid (shared shape for kicker + referees) --------
function buildFigure({ jersey, pants, skin = 0xe8b98a }) {
  const g = new THREE.Group();
  const jerseyMat = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.7 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.35), jerseyMat);
  torso.position.y = 1.35;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), skinMat);
  head.position.y = 1.85;
  head.castShadow = true;
  g.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), jerseyMat);
  helmet.position.y = 1.9;
  helmet.castShadow = true;
  g.add(helmet);

  [-1, 1].forEach((side) => {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.55, 4, 8), jerseyMat);
    arm.position.set(side * 0.4, 1.35, 0);
    arm.castShadow = true;
    g.add(arm);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.65, 4, 8), pantsMat);
    leg.position.set(side * 0.16, 0.55, 0);
    leg.castShadow = true;
    leg.name = side > 0 ? 'legRight' : 'legLeft';
    g.add(leg);
  });

  return g;
}

// Kicker: blue jersey, to the left of the ball, facing downfield. Position
// is set by updateDistance() below, once the kick-distance control exists.
const kicker = buildFigure({ jersey: 0x2f5fbf, pants: 0xffffff });
kicker.position.x = -1.1;
scene.add(kicker);

// Referees: proper NFL look — horizontal black/white striped shirt
// (including sleeves), solid black pants/knickers, and a white cap rather
// than the kicker's football helmet. Positioned just this side of the
// goalpost (real refs hold the goal line regardless of kick distance, so
// these don't move with the slider).
function stripedShirtMat() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#111111' : '#f4f4f4';
    ctx.fillRect(0, i * 4, 32, 4);
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

  [-1, 1].forEach((side) => {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.55, 4, 8), shirtMat);
    arm.position.set(side * 0.4, 1.35, 0);
    arm.castShadow = true;
    g.add(arm);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.65, 4, 8), pantsMat);
    leg.position.set(side * 0.16, 0.55, 0);
    leg.castShadow = true;
    g.add(leg);
  });

  return g;
}

[-1, 1].forEach((side) => {
  const ref = buildReferee();
  ref.position.set(side * (UPRIGHT_HALF_SPAN + 1.6), 0, GOAL_LINE_Z + 3);
  ref.rotation.y = Math.PI; // face back toward the kicker
  scene.add(ref);
});

// ---- Ball on tee -----------------------------------------------------------
// z is set by updateDistance() below.
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
ball.position.y = 0.24;
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
const UNITS_PER_YARD = 0.85;

function kickerZFor(distanceYards) {
  return GOAL_LINE_Z + 2 + distanceYards * UNITS_PER_YARD;
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
  camera.position.set(-2, 3.2, kickerZ + 7);
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
  });
}
if (distanceLabel) distanceLabel.textContent = `${DEFAULT_DISTANCE} yd Field Goal`;
updateDistance(DEFAULT_DISTANCE);

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
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
