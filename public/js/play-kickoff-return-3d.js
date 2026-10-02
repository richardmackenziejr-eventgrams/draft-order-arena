// Kickoff Return — 3D version. Each return opens with a real kickoff
// sequence (see "Kickoff sequence" section): a kicker boots it from his own
// 35 while the kicking-team defenders (10, on the receiving team's 40) and
// return-team blockers (9, on their own 35) hold formation, the camera
// follows the ball to the returner, and only once he catches it does the
// player-controlled return begin. Defenders (see "Defenders") chase, commit
// to a lunge, and tackle -- the tackler plays a Push clip then a Flex
// celebration, everyone else plays Victory. Blockers (see "Blockers")
// engage a chasing/lunging defender and hold it in place for a few seconds
// before it resumes the chase. See play-kickoff-return.js, the real 2D
// game, which stays live and untouched independently of this one for now
// -- the two were originally meant as permanent separate games (free
// "Retro Kick Return" vs. this paid 3D tier), but the user has since
// decided to eliminate the free tier and have this 3D game replace Retro
// once it's ready to swap in. That swap hasn't happened yet.
//
// Wired into the REAL server/game engine (same instance/member/API calls
// as the 2D version) so the difficulty ladder and scoring were already
// live and correct before defenders did anything with them --
// defenderSpeed below comes straight off that ladder (defenderCount no
// longer does -- see DEFENDER_FORMATION_COUNT).
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
// Real NFL endzone depth -- this game's own gameplay endzone
// (ENDZONE_RUN_YARDS, in the touchdown-celebration section below) is only
// 1yd, just enough room for the auto-run-in before stopping, but the
// VISUAL endzone (the lined, marked area a broadcast would show, and
// where the goalposts sit) should read as a real one. Shared at module
// scope so buildField()'s back-of-endzone lines and buildGoalposts()'s
// placement can never drift out of sync with each other.
const ENDZONE_DEPTH = 10;
// Goalpost upright half-span, hoisted here (not local to buildGoalposts()
// like it originally was) now that buildReferees() also needs it to place
// referees just outside the uprights -- same "shared constant, one place"
// fix already applied to ENDZONE_DEPTH/CORNER_FRONT_OFFSET for the same
// two-functions-need-the-same-number reason.
const UPRIGHT_HALF_SPAN = 2.82;
// Inset of the drawn sideline from the true field edge -- hoisted for the
// same reason as UPRIGHT_HALF_SPAN above, now that buildPylons() also needs
// it to sit the pylons right on the sideline/goal-line corners.
const SIDELINE_INSET = 1;

// Declared up here (not down with the other character templates below)
// because the independent, non-blocking GLTFLoader calls for these run
// earlier in file-execution order, right alongside the stadium-stand loads --
// a `const`/`let` referenced before its own declaration line throws, unlike
// a hoisted function declaration.
const CHEERLEADER_COUNT = 4;
let cheerleaderTemplates = [null, null, null, null]; // one per public/models/cheerleader-{1..4}.glb -- loaded independently below (like the stadium stands), not gated behind charactersLoaded since they're purely decorative
let cheerCheeringClip = null;
let cheerleaders = []; // { mixer } for each spawned instance -- see buildCheerleaders()
let refereeTemplate = null; // public/models/referee.glb -- same Rodin/Mixamo model Field Goal Kick uses
let referees = []; // { group, leftArm, rightArm, bindLeft, bindRight, armTweenElapsed } -- see buildReferees()
let cameramanTemplate = null; // public/models/cameraman.glb -- user's own Rodin download, a static kneeling pose, no rig/animation at all
let standingCameramanTemplate = null; // public/models/standing-cameraman.glb -- user's own Rodin download, a static standing-with-camera pose, no rig/animation at all -- same pipeline/convention as cameramanTemplate above (raw orientation also faces +Z, confirmed via the same calibrated-arrow check)
let sidelineBoredClip = null; // public/models/sideline-bored.glb -- user's own Mixamo "Bored" download, animation-only
let sidelineIdleClip = null; // public/models/sideline-idle.glb -- user's own Mixamo "Standing Idle" download, animation-only
let sidelineLookingAroundClip = null; // public/models/sideline-looking-around.glb -- user's own Mixamo "Looking Around" download, animation-only
let sidelinePlayers = []; // { mixer } for each spawned instance -- see buildSidelinePlayers()
let benchTemplate = null; // public/models/bench.glb -- user's own Rodin download, a static mesh, no rig/animation at all
let sittingTalkingClip = null; // public/models/sitting-talking.glb -- user's own Mixamo "Sitting Talking" download, animation-only
let sittingAngryClip = null; // public/models/sitting-angry.glb -- user's own Mixamo "Sitting Angry" download, animation-only
let sittingRubbingArmClip = null; // public/models/sitting-rubbing-arm.glb -- user's own Mixamo "Sitting Rubbing Arm" download, animation-only
let sittingPlayers = []; // { mixer } for each spawned instance -- see buildBenches()

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

let groundApron = null;
let field = null;
function buildField(lengthYards) {
  // A flat green ground plane well past the striped field's own edges on
  // every side -- the striped field mesh is only FIELD_WIDTH wide with no
  // padding, and the stadium stands sit further out and further back than
  // that, so without this the gap between the field's edge and the stands
  // showed raw sky-blue (scene.background) straight through at ground
  // level. Sits a hair below the striped field (y=-0.05 vs. the field's
  // own y=0) so it never z-fights with it -- the striped mesh simply
  // covers it everywhere the striped mesh exists, and the apron only
  // shows through in the surrounding gap.
  if (groundApron) scene.remove(groundApron);
  groundApron = new THREE.Mesh(
    // +120, not the stands' own ~20yd endzone setback -- the corner
    // tiles' own footprint reaches noticeably further back past their
    // pivot than the setback number alone suggests (see
    // CORNER_FRONT_OFFSET in buildEndzoneStands), so a margin tied
    // exactly to the setback came up short and left a blue gap under the
    // near corner's own outer edge. Generous margin here is free (it's a
    // flat-shaded plane, cheap regardless of size) so there's no reason
    // to chase an exact number the way the tile-to-tile seams do.
    new THREE.PlaneGeometry(300, lengthYards + 120),
    new THREE.MeshStandardMaterial({ color: 0x2f6b3f, roughness: 0.95 })
  );
  groundApron.rotation.x = -Math.PI / 2;
  groundApron.position.set(0, -0.05, -lengthYards / 2);
  groundApron.receiveShadow = true;
  scene.add(groundApron);

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

  // Back-of-endzone lines, ENDZONE_DEPTH (module-level, shared with
  // buildGoalposts()) behind each goal line.
  [-(lengthYards + ENDZONE_DEPTH), ENDZONE_DEPTH].forEach((z) => {
    const backLine = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_WIDTH - 2, 0.3), lineMat);
    backLine.rotation.x = -Math.PI / 2;
    backLine.position.set(0, 0.011, z);
    scene.add(backLine);
  });

  // Sideline boundary lines -- the yard-line stripes above only ever ran
  // ACROSS the field, so the two long edges (what actually makes an
  // out-of-bounds catch/step read as a real sideline instead of just an
  // arbitrary spot on green turf) were bare grass. Same inset from the
  // true edge as the yard lines/hash marks already use elsewhere. Spans
  // both endzones too (a real sideline runs the full length, goal line to
  // goal line and both back lines), not just the playable field.
  const sidelineGeo = new THREE.PlaneGeometry(0.3, lengthYards + ENDZONE_DEPTH * 2);
  [-1, 1].forEach((side) => {
    const sideline = new THREE.Mesh(sidelineGeo, lineMat);
    sideline.rotation.x = -Math.PI / 2;
    sideline.position.set(side * (FIELD_WIDTH / 2 - SIDELINE_INSET), 0.01, -lengthYards / 2);
    scene.add(sideline);
  });

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

  buildEndzoneMarkings(lengthYards);
  buildYardNumbers(lengthYards);
  buildPylons(lengthYards);
  buildEndzoneStands(lengthYards);
  buildGoalposts(lengthYards);
  buildCheerleaders(lengthYards);
  buildReferees(lengthYards);
  buildRunningReferees(lengthYards);
  buildCameraman(lengthYards);
  buildStandingCameramen(lengthYards);
  buildCoaches(lengthYards);
  buildSidelinePlayers(lengthYards);
  buildBenches(lengthYards);
}

// ---- Yard numbers ---------------------------------------------------------
// Painted 10/20/30/40/50/40/30/20/10 markers near both sidelines, NFL style:
// glyphs read upright from the NEAREST sideline (top of the numeral points
// toward midfield), and every number except the 50 carries a small triangle
// pointing at the nearer goal line. Same CanvasTexture technique as the
// endzone lettering above. `arrow` is 'left' / 'right' (which side of the
// numeral the triangle sits on, in the TEXT's own left-to-right frame) or null.
function yardNumberTexture(text, arrow) {
  const W = 640, H = 280;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.font = '900 300px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  const textW = ctx.measureText(text).width;
  const ARROW_W = 110, GAP = 30;
  const total = textW + (arrow ? ARROW_W + GAP : 0);
  let x = (W - total) / 2;
  const midY = H / 2 + 10;
  const drawArrow = (ax, pointsLeft) => {
    ctx.beginPath();
    if (pointsLeft) { ctx.moveTo(ax, midY); ctx.lineTo(ax + ARROW_W, midY - 70); ctx.lineTo(ax + ARROW_W, midY + 70); }
    else { ctx.moveTo(ax + ARROW_W, midY); ctx.lineTo(ax, midY - 70); ctx.lineTo(ax, midY + 70); }
    ctx.closePath();
    ctx.fill();
  };
  if (arrow === 'left') { drawArrow(x, true); x += ARROW_W + GAP; }
  ctx.fillText(text, x, midY);
  if (arrow === 'right') drawArrow(x + textW + GAP, false);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const YARD_NUMBER_X = FIELD_WIDTH / 2 - SIDELINE_INSET - 13; // numerals sit ~12-14yd in from the drawn sideline, same as a real field
const YARD_NUMBER_PLANE_W = 5.5, YARD_NUMBER_PLANE_H = YARD_NUMBER_PLANE_W * (280 / 640);
const YARD_NUMBER_LINE_OFFSET = 2.6; // yd from the yard line to the label's center (label sits on the midfield side of its line)
let yardNumbersGroup = null;
function buildYardNumbers(lengthYards) {
  if (yardNumbersGroup) scene.remove(yardNumbersGroup);
  yardNumbersGroup = new THREE.Group();
  const texCache = {};
  const getTex = (text, arrow) => (texCache[text + '|' + arrow] ||= yardNumberTexture(text, arrow));
  const geo = new THREE.PlaneGeometry(YARD_NUMBER_PLANE_W, YARD_NUMBER_PLANE_H);

  for (let yd = 10; yd < lengthYards; yd += 10) {
    const label = Math.min(yd, lengthYards - yd);
    const isMid = yd * 2 === lengthYards;
    const lineZ = -yd;
    const goalDir = isMid ? 0 : (yd < lengthYards / 2 ? 1 : -1); // world-z direction toward the nearer goal line (+z = near end, -z = far end)
    // side -1 = left sideline: text reads toward +z; side +1 = right: toward -z
    // (derived from "glyph top points toward midfield, reading left-to-right as seen from that sideline").
    [-1, 1].forEach((side) => {
      const textRightDir = side < 0 ? 1 : -1;
      const arrow = isMid ? null : (textRightDir === goalDir ? 'right' : 'left');
      const mat = new THREE.MeshBasicMaterial({ map: getTex(String(label), arrow), transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2; // lay flat; local +y (glyph top) -> world -z, local +x (reading direction) -> world +x
      const holder = new THREE.Group();
      holder.add(mesh);
      holder.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
      const midfieldSign = -goalDir; // label sits on the midfield side of its line
      holder.position.set(side * YARD_NUMBER_X, 0.012, lineZ + midfieldSign * (isMid ? 0 : YARD_NUMBER_LINE_OFFSET));
      yardNumbersGroup.add(holder);
    });
  }
  scene.add(yardNumbersGroup);
}

// ---- Endzone color fill + "HOME" lettering --------------------------------
// A solid-color plane over each endzone (real fields paint the whole zone a
// team color) plus block-letter text drawn via a canvas texture -- same
// CanvasTexture technique stripeTexture() above already uses for the field's
// own grass stripes, just drawing text instead of stripes. Text is drawn
// with a THICK white stroke behind a blue fill (ctx.strokeText() under
// ctx.fillText()) so the letters stay legible against the also-blue
// background -- real fields do the same thing for exactly this reason.
function endzoneTextTexture(text, fillColor, strokeColor) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 220;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = '900 170px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 22;
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = fillColor;
  ctx.strokeText(text, c.width / 2, c.height / 2 + 8);
  ctx.fillText(text, c.width / 2, c.height / 2 + 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const ENDZONE_FILL_COLOR = 0x0a2f6b; // dark navy, same family as the team's own blue (runner/cheerleaders/blockers)
const ENDZONE_TEXT_FILL = 0x1c4fa8; // a lighter blue than the fill -- reads as a deliberate two-tone, not just invisible-on-itself, even before the white stroke does the real legibility work
let endzoneMarkingsGroup = null;
function buildEndzoneMarkings(lengthYards) {
  if (endzoneMarkingsGroup) scene.remove(endzoneMarkingsGroup);
  endzoneMarkingsGroup = new THREE.Group();

  const fillMat = new THREE.MeshStandardMaterial({ color: ENDZONE_FILL_COLOR, roughness: 0.95 });
  const textTex = endzoneTextTexture('HOME', `#${ENDZONE_TEXT_FILL.toString(16).padStart(6, '0')}`, '#ffffff');
  const textMat = new THREE.MeshBasicMaterial({ map: textTex, transparent: true });

  // Both endzones get the same treatment -- it's the home team's stadium at
  // both ends, same as a real one. Near end spans z=0..ENDZONE_DEPTH (center
  // ENDZONE_DEPTH/2); far end spans z=-lengthYards..-(lengthYards+ENDZONE_DEPTH)
  // (center -(lengthYards+ENDZONE_DEPTH/2)).
  [-(lengthYards + ENDZONE_DEPTH / 2), ENDZONE_DEPTH / 2].forEach((z) => {
    // y=0.005: above the bare striped field (y=0) but below the goal/back
    // lines and sideline (y=0.01-0.011) -- so the white boundary lines stay
    // visibly on top of the fill at the zone's own edges, same layering
    // order as everything else in buildField(). Width stops at the drawn
    // SIDELINE (FIELD_WIDTH - SIDELINE_INSET*2), not the true field edge --
    // using FIELD_WIDTH itself let the blue visibly spill a yard past the
    // white sideline mark on both sides, confirmed live.
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_WIDTH - SIDELINE_INSET * 2, ENDZONE_DEPTH), fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(0, 0.005, z);
    fill.receiveShadow = true;
    endzoneMarkingsGroup.add(fill);

    // Baseline runs ACROSS the field (along X, same as the fill's own long
    // axis) -- the common real broadcast convention (letters upright as
    // seen looking into the endzone from midfield), and it fits this
    // zone's own proportions naturally (53.3yd wide, only 10yd deep --
    // plenty of room lengthwise, tight vertically).
    const TEXT_WIDTH = ENDZONE_DEPTH * 3.2; // yards
    const TEXT_HEIGHT = TEXT_WIDTH * (220 / 1024); // matches the canvas's own aspect ratio, ~6.9yd -- comfortably inside the 10yd-deep zone
    const text = new THREE.Mesh(new THREE.PlaneGeometry(TEXT_WIDTH, TEXT_HEIGHT), textMat);
    text.rotation.x = -Math.PI / 2;
    text.position.set(0, 0.006, z);
    endzoneMarkingsGroup.add(text);
  });

  scene.add(endzoneMarkingsGroup);
}

// ---- Pylons ----------------------------------------------------------------
// One at each of the 4 corners of EACH endzone (8 total, matching a real
// NFL field) -- where the goal line and back-of-endzone line each meet the
// sideline. Bright orange, same real-world size regardless of field width
// (absolute units, like the goalposts).
const PYLON_COLOR = 0xff4400;
const PYLON_WIDTH = 0.15; // yards
const PYLON_HEIGHT = 0.5; // yards -- real pylons are ~18in
let pylonGroup = null;
function buildPylons(lengthYards) {
  if (pylonGroup) scene.remove(pylonGroup);
  pylonGroup = new THREE.Group();

  const pylonMat = new THREE.MeshStandardMaterial({ color: PYLON_COLOR, roughness: 0.5 });
  const pylonGeo = new THREE.BoxGeometry(PYLON_WIDTH, PYLON_HEIGHT, PYLON_WIDTH);
  const sidelineX = FIELD_WIDTH / 2 - SIDELINE_INSET; // right on the drawn sideline, same X the sideline mesh itself uses

  const cornerZs = [0, ENDZONE_DEPTH, -lengthYards, -(lengthYards + ENDZONE_DEPTH)];
  cornerZs.forEach((z) => {
    [-1, 1].forEach((side) => {
      const pylon = new THREE.Mesh(pylonGeo, pylonMat);
      pylon.position.set(side * sidelineX, PYLON_HEIGHT / 2, z);
      pylon.castShadow = true;
      pylonGroup.add(pylon);
    });
  });

  scene.add(pylonGroup);
}

// ---- Goalposts -----------------------------------------------------------
// Same real-world dimensions/geometry as Field Goal Kick's own goalpost
// (public/js/play-field-goal.js) -- these are absolute units (a real
// upright's height/width doesn't scale with field width), so reused
// as-is rather than re-deriving. One at each end, centered on the field
// and sitting just behind the back-of-endzone line (ENDZONE_DEPTH,
// module-level, shared with buildField()) -- matches where a real
// goalpost actually sits, right on the back line. A small extra margin
// (GOALPOST_LINE_CLEARANCE) keeps the base pole from visually poking
// through the line itself.
let goalpostGroup = null;
function buildGoalposts(lengthYards) {
  if (goalpostGroup) scene.remove(goalpostGroup);
  goalpostGroup = new THREE.Group();

  const postMat = new THREE.MeshStandardMaterial({ color: 0xffd400, roughness: 0.4, metalness: 0.2 });
  const CROSSBAR_Y = 3.05;
  const UPRIGHT_TOP_Y = 8.5;
  const GOALPOST_LINE_CLEARANCE = 0.5;
  const GOALPOST_SETBACK = ENDZONE_DEPTH + GOALPOST_LINE_CLEARANCE;

  function addGoalpost(z) {
    const post = new THREE.Group();
    const basePole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, CROSSBAR_Y, 12), postMat);
    basePole.position.y = CROSSBAR_Y / 2;
    basePole.castShadow = true;
    post.add(basePole);

    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, UPRIGHT_HALF_SPAN * 2, 12), postMat);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.y = CROSSBAR_Y;
    crossbar.castShadow = true;
    post.add(crossbar);

    [-1, 1].forEach((side) => {
      const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, UPRIGHT_TOP_Y - CROSSBAR_Y, 12), postMat);
      upright.position.set(side * UPRIGHT_HALF_SPAN, (CROSSBAR_Y + UPRIGHT_TOP_Y) / 2, 0);
      upright.castShadow = true;
      post.add(upright);
    });

    post.position.set(0, 0, z);
    goalpostGroup.add(post);
  }

  addGoalpost(GOALPOST_SETBACK); // behind the returner's own goal line (z=0)
  addGoalpost(-(lengthYards + GOALPOST_SETBACK)); // behind the opponent's goal line (z=-lengthYards)

  scene.add(goalpostGroup);
}

// ---- Referees --------------------------------------------------------------
// Same referee.glb model Field Goal Kick uses (public/js/play-field-goal.js),
// one on each side of the field at the FAR (scoring) endzone's goal line
// only -- that's the one the runner actually reaches on a touchdown. Stand
// right on the sideline (same X the pylons/sideline mesh use), facing INWARD
// across the field -- matches where an NFL back judge/side judge actually
// stands for a touchdown signal, per live feedback. Purely decorative until
// a touchdown is scored (see triggerRefereeCelebration(), called from the
// touchdown block in tick()): no walk-up, just both arms raised straight
// for the "good" signal in place -- reusing the exact arm-bone tween Field
// Goal Kick's own animateRefereeSignal() uses -- rotating
// mixamorigLeftArm/RightArm's local X from their bind pose. NOTE: the raw
// glTF JSON in referee.glb actually stores these names WITH a colon
// (`mixamorig:LeftArm`, confirmed by parsing the file's bytes directly) --
// but three.js's GLTFLoader strips the colon when it builds the runtime
// Bone objects, so `o.name` at runtime is `mixamorigLeftArm` with no colon.
// Confirmed live in the browser (dumped every bone name off the actual
// loaded/cloned model) before trusting this, since the raw-file check alone
// would have pointed the wrong way.
let refereeGroup = null;
function buildReferees(lengthYards) {
  if (refereeGroup) scene.remove(refereeGroup);
  referees = [];
  if (!refereeTemplate) return;
  refereeGroup = new THREE.Group();

  const REF_X = FIELD_WIDTH / 2 - SIDELINE_INSET; // right behind the drawn sideline -- same X the sideline mesh and pylons both use
  const z = -lengthYards; // the FRONT (goal) line of the endzone, next to the front pylon

  [1, -1].forEach((side) => {
    const model = cloneSkinnedScene(refereeTemplate);
    // Raw/uncorrected orientation faces +Z (same convention as the
    // cheerleaders) -- rotating the whole model -side*90 degrees around Y
    // turns that into facing INWARD across the field (the +1 side referee
    // faces -X toward center, the -1 side referee faces +X toward center).
    model.rotation.y = -side * (Math.PI / 2);
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    let leftArm = null, rightArm = null, leftForeArm = null, rightForeArm = null, leftHand = null, rightHand = null;
    model.traverse((o) => {
      if (o.name === 'mixamorigLeftArm') leftArm = o;
      if (o.name === 'mixamorigRightArm') rightArm = o;
      if (o.name === 'mixamorigLeftForeArm') leftForeArm = o;
      if (o.name === 'mixamorigRightForeArm') rightForeArm = o;
      if (o.name === 'mixamorigLeftHand') leftHand = o;
      if (o.name === 'mixamorigRightHand') rightHand = o;
    });
    if (!leftArm || !rightArm) { console.warn('referee.glb missing expected arm bones -- signal animation will be skipped'); }

    const group = new THREE.Group();
    group.add(model);
    group.position.set(side * REF_X, 0, z);
    refereeGroup.add(group);

    const bindLeft = leftArm ? leftArm.rotation.clone() : null;
    const bindRight = rightArm ? rightArm.rotation.clone() : null;
    if (leftArm && rightArm) {
      // referee.glb's raw bind pose is a T-pose (arms straight out to the
      // sides) -- same starting point Field Goal Kick's own referee has,
      // fixed there (setRefereeIdle()) by rotating the arms down into a
      // relaxed standing pose rather than leaving them in the T-pose
      // whenever a touchdown hasn't happened (yet) to trigger the signal.
      leftArm.rotation.set(bindLeft.x + REF_ARM_IDLE_X, bindLeft.y, bindLeft.z);
      rightArm.rotation.set(bindRight.x + REF_ARM_IDLE_X, bindRight.y, bindRight.z);
    }
    referees.push({
      group, leftArm, rightArm, leftForeArm, rightForeArm, leftHand, rightHand,
      bindLeft, bindRight,
      armTweenElapsed: null,
    });
  });
  scene.add(refereeGroup);
}

const REF_ARM_IDLE_X = Math.PI / 2; // same value as Field Goal Kick's own REF_ARM_IDLE_X -- rotates the arm from the raw T-pose bind down into a relaxed standing pose
const REF_ARM_UP_X = -Math.PI / 2; // same value as Field Goal Kick's own REF_ARM_UP_X -- rotates the arm from the T-pose bind to straight up
const REF_ARM_RAISE_DURATION = 0.45; // seconds -- same duration Field Goal Kick's own signal tween uses

// Called the instant a touchdown is scored (see the touchdown block in
// tick()). No walk-up (per live feedback -- the referee stays put on the
// sideline and just raises both arms) -- tweens FROM the current (idle)
// pose TO the signal target, captured fresh rather than assumed. Y/Z are
// tweened toward 0 too (not just X) -- the upper arm bone's own bind pose
// carries a small Y/Z tilt (part of referee.glb's T-pose not being
// perfectly flat), invisible at the idle pose but enough to visibly point
// the whole raised arm outward instead of straight up (confirmed live:
// straightening the forearm/hand alone wasn't enough, because the UPPER
// ARM itself was already off-vertical).
function triggerRefereeCelebration() {
  referees.forEach((r) => {
    if (!r.leftArm || !r.rightArm) return; // no arm bones found -- signal can't play
    r.armTweenFrom = {
      leftArm: r.leftArm.rotation.clone(),
      rightArm: r.rightArm.rotation.clone(),
    };
    // The forearm/hand bones keep whatever local bend they had (their
    // bind pose isn't a perfectly straight T -- there's a small natural
    // wrist/elbow bend baked in) -- straighten them out to zero as part
    // of the signal so the arm reads as one clean line overhead instead
    // of a straight upper arm with the hand visibly bent/splayed out at
    // the end (confirmed live: barely visible with the arm out to the
    // side, obviously wrong once the arm points straight up).
    r.straightenFrom = {
      leftForeArm: r.leftForeArm ? r.leftForeArm.rotation.clone() : null,
      rightForeArm: r.rightForeArm ? r.rightForeArm.rotation.clone() : null,
      leftHand: r.leftHand ? r.leftHand.rotation.clone() : null,
      rightHand: r.rightHand ? r.rightHand.rotation.clone() : null,
    };
    r.armTweenElapsed = 0;
  });
}

function updateRefereeAnimations(dt) {
  for (const r of referees) {
    if (r.armTweenElapsed != null) {
      r.armTweenElapsed += dt;
      const t = Math.min(1, r.armTweenElapsed / REF_ARM_RAISE_DURATION);
      const e = easeOutCubic(t);
      const targetLeftX = r.bindLeft.x + REF_ARM_UP_X;
      const targetRightX = r.bindRight.x + REF_ARM_UP_X;
      r.leftArm.rotation.set(
        r.armTweenFrom.leftArm.x + (targetLeftX - r.armTweenFrom.leftArm.x) * e,
        r.armTweenFrom.leftArm.y * (1 - e),
        r.armTweenFrom.leftArm.z * (1 - e),
      );
      r.rightArm.rotation.set(
        r.armTweenFrom.rightArm.x + (targetRightX - r.armTweenFrom.rightArm.x) * e,
        r.armTweenFrom.rightArm.y * (1 - e),
        r.armTweenFrom.rightArm.z * (1 - e),
      );
      // Straighten the forearm/hand toward zero local rotation (a dead-
      // straight line continuing the now-vertical upper arm) at the same
      // pace as the raise itself.
      const straighten = (bone, from) => {
        if (!bone || !from) return;
        bone.rotation.set(from.x * (1 - e), from.y * (1 - e), from.z * (1 - e));
      };
      straighten(r.leftForeArm, r.straightenFrom.leftForeArm);
      straighten(r.rightForeArm, r.straightenFrom.rightForeArm);
      straighten(r.leftHand, r.straightenFrom.leftHand);
      straighten(r.rightHand, r.straightenFrom.rightHand);
      if (t >= 1) r.armTweenElapsed = null; // done -- left holding the arms-up pose, same as a real ref holding the signal through the celebration
    }
  }
}

// ---- Running referees ---------------------------------------------------------
// Two more referee.glb instances (same model as the stationary goal-line
// refs above), one per sideline, that sprint downfield staying
// RUNNING_REF_LEAD_YARDS ahead of the returner -- reusing the RUNNER's own
// right-strafe/left-strafe clips rather than a new asset: a strafe is a
// "face one direction, translate perpendicular to it" gait, which is
// exactly a ref running the sideline while watching the field (faces
// INWARD, translates along Z) just rotated 90 from how the runner uses it
// (faces downfield/-Z, translates along X). Starts pinned at the near 20
// (RUNNING_REF_START_Z) in the same relaxed idle stance the goal-line refs
// use, starts actually moving once the returner closes to
// RUNNING_REF_LEAD_YARDS away, and locks/returns to that same idle stance
// once it reaches the far 20 (RUNNING_REF_END_Z, computed per field length)
// -- there's already a stationary ref waiting on the goal line itself, so
// covering only the middle of the field is the whole job here.
let runningRefereeGroup = null;
let runningReferees = []; // { group, mixer, action, bindPose: [{bone,quat}], leftArm, rightArm, bindLeft, bindRight, hipsBone, hipsBindPos }
const RUNNING_REF_START_Z = -20;
const RUNNING_REF_LEAD_YARDS = 5;
let runningRefEndZ = 0; // set per build (depends on fieldYards) -- the far 20, where the ref stops

function setRunningRefIdlePose(r) {
  r.bindPose.forEach(({ bone, quat }) => bone.quaternion.copy(quat));
  if (r.leftArm && r.rightArm && r.bindLeft && r.bindRight) {
    // Same relaxed-standing adjustment buildReferees() applies to the
    // goal-line refs -- rotates out of the raw T-pose bind.
    r.leftArm.rotation.set(r.bindLeft.x + REF_ARM_IDLE_X, r.bindLeft.y, r.bindLeft.z);
    r.rightArm.rotation.set(r.bindRight.x + REF_ARM_IDLE_X, r.bindRight.y, r.bindRight.z);
  }
}

function buildRunningReferees(lengthYards) {
  if (runningRefereeGroup) scene.remove(runningRefereeGroup);
  runningReferees = [];
  if (!refereeTemplate || !rightStrafeClip || !leftStrafeClip) return;
  runningRefereeGroup = new THREE.Group();
  runningRefEndZ = -(lengthYards - 20);

  const REF_X = FIELD_WIDTH / 2 - SIDELINE_INSET; // same sideline X buildReferees() uses

  [1, -1].forEach((side) => {
    const model = cloneSkinnedScene(refereeTemplate);
    // Same convention as the stationary refs: raw orientation faces +Z,
    // rotating -side*90 turns that to face INWARD across the field.
    model.rotation.y = -side * (Math.PI / 2);
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    const bindPose = [];
    let leftArm = null, rightArm = null, hipsBone = null;
    model.traverse((o) => {
      if (o.isBone) bindPose.push({ bone: o, quat: o.quaternion.clone() });
      if (o.name === 'mixamorigLeftArm') leftArm = o;
      if (o.name === 'mixamorigRightArm') rightArm = o;
      if (o.name === 'mixamorigHips') hipsBone = o;
    });
    const bindLeft = leftArm ? leftArm.rotation.clone() : null;
    const bindRight = rightArm ? rightArm.rotation.clone() : null;
    const hipsBindPos = hipsBone ? hipsBone.position.clone() : null;

    // Same reduced-rig/full-rig mismatch already hit with the referee's own
    // walk clip and the sideline players' idle clips -- filter each strafe
    // clip's tracks down to bones this model actually has.
    const modelBoneNames = new Set(bindPose.map(({ bone }) => bone.name));
    // Side +1 sits on the +X sideline facing -X; side -1 sits on -X facing
    // +X -- picked empirically which raw clip (right vs left) reads as
    // running forward rather than backward/crossed-up once rotated onto
    // each side, same verify-visually approach as the cameraman facing fix.
    // First guess (side 1 -> left clip) read backward per live feedback --
    // swapped.
    const rawClip = side === 1 ? rightStrafeClip : leftStrafeClip;
    const tracks = rawClip.tracks.filter((t) => modelBoneNames.has(t.name.split('.')[0]));
    const clip = new THREE.AnimationClip(rawClip.name, rawClip.duration, tracks);
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(clip);
    action.play();

    const group = new THREE.Group();
    group.add(model);
    group.position.set(side * REF_X, 0, RUNNING_REF_START_Z);
    runningRefereeGroup.add(group);

    const r = { group, mixer, action, bindPose, leftArm, rightArm, bindLeft, bindRight, hipsBone, hipsBindPos };
    setRunningRefIdlePose(r);
    runningReferees.push(r);
  });

  scene.add(runningRefereeGroup);
}

// Called every frame from inside the phase === 'play' block (see tick()) --
// gating it there, rather than in the unconditional per-frame section
// alongside updateCameraman()/updateSidelinePlayers(), means the refs
// naturally freeze in whatever pose they're in (position AND animation)
// the instant the runner is tackled/scores/steps out, with no separate
// timeScale=0 bookkeeping needed (the same trick defenders/blockers DO
// need, but only because THEIR mixer upkeep runs unconditionally).
function updateRunningReferees(dt) {
  const runnerZ = RUNNER_GROUP.position.z;
  const target = THREE.MathUtils.clamp(runnerZ - RUNNING_REF_LEAD_YARDS, runningRefEndZ, RUNNING_REF_START_Z);
  // Strictly between the two ends -- pinned at either end (hasn't started
  // yet, or already reached the far 20) both read as "standing," not
  // "running," hence the shared idle branch below for both.
  const active = target > runningRefEndZ + 1e-4 && target < RUNNING_REF_START_Z - 1e-4;
  runningReferees.forEach((r) => {
    r.group.position.z = target;
    if (active) {
      r.mixer.update(dt);
      if (r.hipsBone && r.hipsBindPos) r.hipsBone.position.copy(r.hipsBindPos); // same root-motion strip as the runner's own stripRootMotion() -- the clip's baked hip translation is unreliable scale, the actual travel is driven by `target` above
    } else {
      setRunningRefIdlePose(r);
    }
  });
}

// ---- Sideline cameramen ------------------------------------------------------
// The user's own Rodin download -- a static kneeling-with-camera pose baked
// directly into the mesh (no rig, no animation at all, unlike every other
// character in this file). Purely decorative, three instances at the FAR
// endzone: one by the near upright (goal line), two more at the back
// corners past the cheer squad (one per side), roughly where the back
// pylons sit. Never gated behind charactersLoaded. Position is fixed per
// instance, but each one turns in place to track the runner every frame
// (updateCameraman(), below) -- a fixed facing looked wrong the moment the
// runner wasn't lined up directly in front of it.
let cameramanGroup = null;
let cameramen = []; // model refs -- updateCameraman() turns each one to face the runner every frame
function buildCameraman(lengthYards) {
  if (cameramanGroup) scene.remove(cameramanGroup);
  cameramen = [];
  if (!cameramanTemplate) return;
  cameramanGroup = new THREE.Group();

  // Kneels near the near upright, close to the goalpost's own base
  // (GOALPOST_SETBACK ≈ ENDZONE_DEPTH + 0.5, mirrored here rather than
  // imported since that constant is local to buildGoalposts()) but pulled
  // back an extra yard past it, plus one at each back corner -- past the
  // cheer squad's own widest row (x up to ~21, see buildCheerleaders()
  // above), near where the back pylons sit (x = FIELD_WIDTH/2 -
  // SIDELINE_INSET ≈ 25.65) but pulled in a couple yards so he doesn't sit
  // on top of the pylon itself. All three pulled a few yards further back
  // from the back-of-endzone line than their first placement -- per
  // feedback, sitting right ON that line read as crowding it.
  const spots = [
    { x: UPRIGHT_HALF_SPAN + 0.5, z: -(lengthYards + ENDZONE_DEPTH + 1.5) },
    { x: FIELD_WIDTH / 2 - SIDELINE_INSET - 2, z: -(lengthYards + ENDZONE_DEPTH + 3) },
    { x: -(FIELD_WIDTH / 2 - SIDELINE_INSET - 2), z: -(lengthYards + ENDZONE_DEPTH + 3) },
  ];

  spots.forEach(({ x, z }) => {
    const model = cameramanTemplate.clone();
    // No base-facing correction (same reasoning as the cheerleaders) -- raw
    // orientation already faces +Z. NOTE: an earlier pass here applied a
    // Math.PI "fix" based on a top-down read that turned out to be a
    // misjudged silhouette (kneeling poses don't read clearly from directly
    // overhead) -- that fix actually flipped him to face AWAY from the field.
    // Confirmed the real answer via a calibrated reference (an arrow on a
    // known world axis, and an eye-level shot from the field looking back at
    // him): raw orientation shows his face/camera pointed at the field,
    // no rotation needed as the RESTING orientation -- see updateCameraman()
    // for why he doesn't just sit at that fixed angle, though.
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    model.position.set(x, 0, z);
    cameramanGroup.add(model);
    cameramen.push(model);
  });

  scene.add(cameramanGroup);
}

// Standing photographers at the 10 and 25-yard lines, on BOTH halves of
// the field (near the returner's own goal AND the far/scoring goal) and
// both sidelines -- 8 total. "Both sides" in the original request meant
// both halves of the 50, not just left/right -- a first pass only built
// the near half (4 total), confirmed missing by the user ("I saw the
// cameramen on one half of the field but not on the other"). The far-half
// z mirrors the near-half one around midfield (-(lengthYards - yard)),
// same reflection every other far-side distance in this file already uses.
// The user's own Rodin download, same no-rig static-prop shape as
// cameramanTemplate above. z-values use this file's usual convention (z=0
// is the returner's OWN goal line), so these sit outside the sideline-
// players/benches' own team-box span (z=-30 to -70 on a 100yd field) --
// no placement overlap with those. Pushed into the SAME `cameramen` array
// the kneeling trio uses, so updateCameraman() (below) tracks all of them
// with no changes needed.
//
// X is the real sideline distance (FIELD_WIDTH/2 + 1, matching the
// standing sideline PLAYERS' own apron row) -- briefly pulled in to 5yd
// (inside the normal chase cam's own ~5.6yd visible half-width, so they'd
// actually be seen) per an earlier request, but that put them visibly
// standing ON the field itself, which reads as flatly broken -- reverted.
// The underlying visibility problem is real (see below) but needs solving
// with the CAMERA, not by moving them onto the playing field.
let standingCameramanGroup = null;
function buildStandingCameramen(lengthYards) {
  if (standingCameramanGroup) scene.remove(standingCameramanGroup);
  if (!standingCameramanTemplate) return;
  standingCameramanGroup = new THREE.Group();

  const STANDING_CAMERAMAN_X = FIELD_WIDTH / 2 + 1; // same apron distance as the sideline players' own front row -- see the comment above
  [10, 25].forEach((yard) => {
    [-yard, -(lengthYards - yard)].forEach((z) => {
      [-1, 1].forEach((sign) => {
        const model = standingCameramanTemplate.clone();
        // Raw orientation already faces +Z, confirmed via a calibrated-arrow
        // check (same technique the kneeling cameraman's own comment above
        // describes) -- no base-yaw correction needed, same as that model.
        model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        model.position.set(sign * STANDING_CAMERAMAN_X, 0, z);
        standingCameramanGroup.add(model);
        cameramen.push(model);
      });
    });
  });

  scene.add(standingCameramanGroup);
}

// Turns each cameraman to track the returner every frame, like a real
// sideline photographer actually would -- a fixed facing looked wrong per
// live feedback the moment the runner wasn't lined up directly in front of
// one. No base-yaw correction in this formula (unlike the defenders'/
// blockers' own `atan2(dx,dz) + Math.PI`) because this model's raw
// orientation already faces +Z with zero correction, so `atan2(dx,dz)`
// alone already points it at a target sitting on +Z -- the same
// convention, just without the extra half-turn the -Z-raw characters need.
function updateCameraman() {
  for (const model of cameramen) {
    const dx = RUNNER_GROUP.position.x - model.position.x;
    const dz = RUNNER_GROUP.position.z - model.position.z;
    if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) {
      model.rotation.y = Math.atan2(dx, dz);
    }
  }
}

// ---- Head coaches ------------------------------------------------------------
// One per team, at midfield on that team's own sideline (blue = left/-X like
// the blocker-model sideline players, red = right/+X like the defender-model
// ones). The user's own Rodin characters, auto-rigged on Mixamo (33-bone
// reduced rig, same as every other Mixamo character here) with Mixamo's
// "Pointing" clip baked into each GLB (mesh + armature + animations[0], same
// shape as player-kick.glb) -- so unlike the animation-only clips elsewhere,
// each coach plays the clip authored against ITS OWN rig. Raw orientation
// faces +Z (same Mixamo export convention as the cameramen/cheerleaders), so
// facing the runner is just group.rotation.y = atan2(dx,dz), same formula as
// updateCameraman(). Each GLB's own loader calls buildCoaches() on arrival
// (no other dependencies, so no multi-trigger retry wiring needed).
const coachTemplates = { blue: null, red: null }; // { scene, clip } once loaded
let coachGroup = null;
let coaches = []; // { group, mixer, hipsBone, hipsBindPos }
const COACH_X = FIELD_WIDTH / 2 + 0.35; // just outside the true field edge, in front of the sideline players' own rows
function buildCoaches(lengthYards) {
  if (coachGroup) scene.remove(coachGroup);
  coaches = [];
  coachGroup = new THREE.Group();
  // Standing in a gap between two neighboring sideline players (they sit at
  // midfield +/- 2.2yd multiples, the back row staggered by half that) rather
  // than dead center, where one of them already stands.
  const z = -lengthYards / 2 + 1.1;
  [{ key: 'blue', sign: -1 }, { key: 'red', sign: 1 }].forEach(({ key, sign }) => {
    const t = coachTemplates[key];
    if (!t) return;
    const model = cloneSkinnedScene(t.scene);
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // Same hips capture/reset every other Mixamo character here uses -- the
    // pointing clip carries baked hip translation that would otherwise drag
    // him around within the loop and snap back on each repeat.
    let hipsBone = null;
    model.traverse((o) => { if (o.isBone && o.name === 'mixamorigHips') hipsBone = o; });
    const hipsBindPos = hipsBone ? hipsBone.position.clone() : null;
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(t.clip);
    action.setLoop(THREE.LoopRepeat);
    action.play();
    const group = new THREE.Group();
    group.add(model);
    group.position.set(sign * COACH_X, 0, z);
    coachGroup.add(group);
    coaches.push({ group, mixer, hipsBone, hipsBindPos });
  });
  scene.add(coachGroup);
}

function updateCoaches(dt) {
  for (const c of coaches) {
    c.mixer.update(dt);
    if (c.hipsBone && c.hipsBindPos) c.hipsBone.position.copy(c.hipsBindPos);
    const dx = RUNNER_GROUP.position.x - c.group.position.x;
    const dz = RUNNER_GROUP.position.z - c.group.position.z;
    if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) c.group.rotation.y = Math.atan2(dx, dz);
  }
}

// ---- Sideline players --------------------------------------------------------
// LEFT sideline (-X) reuses blocker.glb (already blue); RIGHT sideline (+X)
// reuses defender.glb (already red, same Mixamo-rig convention -- see
// [[kickoff-return-3d-controls-and-mocap]]) -- no new character assets
// needed for either. Both sides use the same two-row layout between the two
// 40-yard lines, facing INWARD across the field, each player looping one of
// three idle clips (the user's own Mixamo "Bored"/"Standing Idle"/"Looking
// Around" downloads), cycling through which clip a given player gets so
// neighbors don't all mirror each other, plus a random start offset so even
// two players on the SAME clip don't sync up.
let sidelineGroup = null;
// Real NFL sideline convention: the team-box/player area runs from each
// team's own 30-yard line to midfield and on to the opponent's 30 -- a
// 40yd-wide zone (20yd either side of midfield), not the narrower "40 to
// 40" strip this used before. Shared by buildSidelinePlayers() and
// buildBenches() below since both populate that same real-world span;
// each derives its own instance count from this so the fill density stays
// the same as before rather than just spreading the old count out thinner.
const TEAM_AREA_HALF_SPREAD = 20; // yd either side of midfield (30-yard line to 30-yard line)
function buildSidelinePlayers(lengthYards) {
  if (sidelineGroup) scene.remove(sidelineGroup);
  sidelinePlayers = [];
  if (!blockerTemplate || !defenderTemplate || !sidelineBoredClip || !sidelineIdleClip) return;
  sidelineGroup = new THREE.Group();

  // Two rows out on the dark-green apron (groundApron, buildField() above),
  // back from the drawn sideline rather than standing right on it -- same
  // "two staggered rows" (quincunx) formation as buildCheerleaders() below:
  // the back row sits further out and gets one extra player at the same
  // fixed gap, offset by half a gap in Z so it interlocks between the
  // front row's players instead of hiding directly behind them. Only a
  // narrow strip of apron is actually usable here: the sideline stands
  // (buildEndzoneStands's full-length chain, addStandStraightFromEdge)
  // start their front edge at SIDELINE_ANCHOR_X, which works out to
  // exactly FIELD_WIDTH/2 + 6 (the same X as the runner's own
  // out-of-bounds limit) -- going further out than that puts players
  // inside the stand geometry, which is what a first attempt at this did
  // (they rendered fine, just invisible, swallowed by the riser mesh).
  const CENTER_Z = -lengthYards / 2; // midfield
  const ROW_GAP_Z = 2.2; // yd between neighbors in a row -- close to the previous single-row spacing
  const FRONT_ROW_COUNT = Math.round((TEAM_AREA_HALF_SPREAD * 2) / ROW_GAP_Z) + 1;
  const FRONT_HALF_SPREAD = (ROW_GAP_Z * (FRONT_ROW_COUNT - 1)) / 2;
  // Third clip (Looking Around) is optional at build time -- filtered out
  // if it hasn't loaded yet rather than gating the whole feature on it, so
  // players still show up with 2 alternating clips in the meantime; the
  // clip's own loader calls buildSidelinePlayers() again once it arrives,
  // upgrading every player to pick from all 3 on the next rebuild.
  const clips = [sidelineBoredClip, sidelineIdleClip, sidelineLookingAroundClip].filter(Boolean);

  // sign -1 = left sideline (blue, blocker.glb), +1 = right sideline (red,
  // defender.glb). Both templates share blocker's own raw-orientation
  // convention (faces +Z at rest, same as every other character in this
  // file) -- rotating +90 turns +Z into +X (left, facing inward from -X),
  // rotating -90 turns it into -X (right, facing inward from +X).
  const SIDES = [
    { sign: -1, template: () => blockerTemplate, facingY: Math.PI / 2 },
    { sign: 1, template: () => defenderTemplate, facingY: -Math.PI / 2 },
  ];

  SIDES.forEach(({ sign, template, facingY }) => {
    const ROW_X = [sign * (FIELD_WIDTH / 2 + 1), sign * (FIELD_WIDTH / 2 + 2.3)];
    let clipIndex = 0; // runs across BOTH rows (within one side) so neighbors alternate, not just within a row
    ROW_X.forEach((x, rowIndex) => {
      const staggered = rowIndex === 1;
      const rowCount = staggered ? FRONT_ROW_COUNT + 1 : FRONT_ROW_COUNT;
      const rowHalfSpread = staggered ? (ROW_GAP_Z * (rowCount - 1)) / 2 : FRONT_HALF_SPREAD;
      for (let i = 0; i < rowCount; i++) {
        const model = cloneSkinnedScene(template());
        model.rotation.y = facingY;
        model.traverse((o) => { if (o.isMesh) o.castShadow = true; });

        // Same reduced-rig/full-rig mismatch already hit with the referee's
        // own walk clip -- filter each clip's tracks down to bones this
        // model actually has before playing it, rather than risk the same
        // THREE.PropertyBinding console-warning flood.
        const modelBoneNames = new Set();
        model.traverse((o) => { if (o.isBone) modelBoneNames.add(o.name); });
        const rawClip = clips[clipIndex % clips.length];
        clipIndex++;
        const tracks = rawClip.tracks.filter((t) => modelBoneNames.has(t.name.split('.')[0]));
        const clip = new THREE.AnimationClip(rawClip.name, rawClip.duration, tracks);

        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(clip).play();
        mixer.setTime(Math.random() * clip.duration);

        const group = new THREE.Group();
        group.add(model);
        group.position.set(x, 0, CENTER_Z + evenLineX(i, rowCount, rowHalfSpread));
        sidelineGroup.add(group);

        sidelinePlayers.push({ mixer });
      }
    });
  });

  scene.add(sidelineGroup);
}

function updateSidelinePlayers(dt) {
  for (const p of sidelinePlayers) p.mixer.update(dt);
}

// ---- Benches + sitting players ---------------------------------------------------
// One row of bleacher benches per sideline (the user's own Rodin "bench"
// download, a static mesh, same conversion pipeline as cameraman.glb),
// positioned further out than the standing sideline players above --
// "behind" them from the field's point of view, in the remaining strip of
// apron before the stands. 3 seated players per bench, cycling through the
// user's own three Mixamo "Sitting Talking"/"Sitting Angry"/"Sitting
// Rubbing Arm" downloads. Reuses blockerTemplate/defenderTemplate, same
// blue-left/red-right convention as buildSidelinePlayers() above.
let benchGroup = null;
// Model's own bounding box (measured once off the actual loaded scene):
// size (1.9, 0.393, 0.32) in local (X,Y,Z) -- long axis is local X, pivot
// already sits at the model's own ground level (min.y = 0).
const BENCH_LENGTH = 1.9;
// 0.32 (a guess, "a hair below the model's own 0.393 top") put sitters up
// near backrest height, floating well above the actual seat and clipping
// backward into the stand behind them -- a direct Blender vertex-height
// histogram of bench.glb found the SEAT surface itself (where most of the
// mesh's vertices actually cluster) sits around Y=0.18-0.20, not near the
// 0.393 bounding-box top (that's the back rail, a small fraction of the
// vertex count). Confirmed visually after the fix, see memory.
const BENCH_SEAT_Y = 0.19;
function buildBenches(lengthYards) {
  if (benchGroup) scene.remove(benchGroup);
  sittingPlayers = [];
  if (!benchTemplate || !blockerTemplate || !defenderTemplate) return;
  // Each sitter needs an actual clip to animate -- optional/graceful like
  // sidelineLookingAroundClip above: build with whichever of the 3 have
  // loaded so far rather than waiting on all three, upgrading on each
  // clip's own independent load.
  const clips = [sittingTalkingClip, sittingAngryClip, sittingRubbingArmClip].filter(Boolean);
  if (clips.length === 0) return;
  benchGroup = new THREE.Group();

  const CENTER_Z = -lengthYards / 2; // midfield
  const BENCH_GAP_Z = 4; // yd between bench centers -- real gaps between benches, not edge-to-edge (BENCH_LENGTH is only 1.9)
  const BENCH_COUNT = Math.round((TEAM_AREA_HALF_SPREAD * 2) / BENCH_GAP_Z) + 1;
  const BENCH_HALF_SPREAD = (BENCH_GAP_Z * (BENCH_COUNT - 1)) / 2;
  const SEAT_OFFSETS = [-0.55, 0, 0.55]; // along the bench's own (rotated) length, one seat per sitter, within its 1.9yd span

  // sign -1 = left sideline (blue, blocker.glb), +1 = right sideline (red,
  // defender.glb) -- same convention and raw-orientation reasoning as
  // buildSidelinePlayers() above.
  const SIDES = [
    { sign: -1, template: () => blockerTemplate, facingY: Math.PI / 2 },
    { sign: 1, template: () => defenderTemplate, facingY: -Math.PI / 2 },
  ];

  SIDES.forEach(({ sign, template, facingY }) => {
    // Between the standing rows (FIELD_WIDTH/2 + 1 / +2.3) and the stands'
    // own front edge (FIELD_WIDTH/2 + 6) -- same apron-clearance reasoning
    // as the sideline players' own comment above.
    const BENCH_X = sign * (FIELD_WIDTH / 2 + 4.5);
    let clipIndex = 0; // runs across every sitter on this side so neighbors (including bench-to-bench) alternate

    for (let i = 0; i < BENCH_COUNT; i++) {
      const benchZ = CENTER_Z + evenLineX(i, BENCH_COUNT, BENCH_HALF_SPREAD);
      const bench = benchTemplate.clone();
      bench.rotation.y = Math.PI / 2; // raw model's long axis is local X -- rotate it onto world Z, parallel to the sideline
      bench.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      bench.position.set(BENCH_X, 0, benchZ);
      benchGroup.add(bench);

      SEAT_OFFSETS.forEach((seatOffset) => {
        const model = cloneSkinnedScene(template());
        model.rotation.y = facingY;
        model.traverse((o) => { if (o.isMesh) o.castShadow = true; });

        // Same reduced-rig/full-rig mismatch already hit with the referee's
        // own walk clip -- filter each clip's tracks down to bones this
        // model actually has before playing it.
        const modelBoneNames = new Set();
        model.traverse((o) => { if (o.isBone) modelBoneNames.add(o.name); });
        const rawClip = clips[clipIndex % clips.length];
        clipIndex++;
        const tracks = rawClip.tracks.filter((t) => modelBoneNames.has(t.name.split('.')[0]));
        const clip = new THREE.AnimationClip(rawClip.name, rawClip.duration, tracks);

        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(clip).play();
        mixer.setTime(Math.random() * clip.duration); // stagger each one's loop so neighbors don't sit in lockstep

        const group = new THREE.Group();
        group.add(model);
        // seatOffset runs along the bench's own (now-rotated) length, i.e.
        // world Z, same as benchZ's own axis.
        group.position.set(BENCH_X, BENCH_SEAT_Y, benchZ + seatOffset);
        benchGroup.add(group);

        sittingPlayers.push({ mixer });
      });
    }
  });

  scene.add(benchGroup);
}

function updateSittingPlayers(dt) {
  for (const p of sittingPlayers) p.mixer.update(dt);
}

// ---- Cheerleaders ---------------------------------------------------------
// Two squads (two rows of the same 4 cheerleader-1..4.glb models, cycling
// through them since each row is wider than 4), one per side of the goalpost
// at the FAR (scoring) end only -- that's the endzone the runner actually
// reaches on a touchdown, matching where they'd be seen/used in-game.
// Purely decorative, like the stadium stands: loaded independently (see the
// GLTFLoader calls near stadium-stand.glb below), never gated behind
// charactersLoaded.
let cheerleaderGroup = null;
function buildCheerleaders(lengthYards) {
  if (cheerleaderGroup) scene.remove(cheerleaderGroup);
  cheerleaders = [];
  if (!cheerCheeringClip) return; // wait for the shared clip too -- a T-posed cheerleader frozen in place would look broken, worse than just not showing up yet
  cheerleaderGroup = new THREE.Group();

  // Two rows, both inside the clear grass strip behind the far endzone:
  // between the back-of-endzone line (ENDZONE_DEPTH behind the goal line)
  // and the stand's own front edge (ENDZONE_STAND_SETBACK,
  // buildEndzoneStands() below) -- 12/17 leaves a comfortable ~2yd margin off
  // the back line and ~1.3yd off the stand front even if that setback gets
  // retuned again.
  const CHEER_ROW_SETBACKS = [12, 17];
  const CHEER_GROUP_CENTER_X = 13; // roughly the middle of each half of the field
  const CHEER_FRONT_ROW_COUNT = 8; // extended laterally per live feedback -- reaches closer to both the goalpost and the corner than the original tighter 4-wide row did
  const CHEER_ROW_GAP = 2; // fixed yd gap between neighbors in a row
  const CHEER_FRONT_HALF_SPREAD = (CHEER_ROW_GAP * (CHEER_FRONT_ROW_COUNT - 1)) / 2;

  [1, -1].forEach((side) => {
    CHEER_ROW_SETBACKS.forEach((setback, rowIndex) => {
      const z = -(lengthYards + setback);
      // The back row gets one extra cheerleader (9 instead of 8) at the SAME
      // fixed gap, centered on the same X -- that extra body is what makes
      // the row symmetric while still landing exactly BETWEEN every
      // adjacent pair in the row in front of it (and flanking outside its
      // two end ones), a real staggered/quincunx formation rather than a
      // row shifted entirely to one side (which an earlier attempt at this
      // did, and which broke left-right symmetry within that row).
      const staggered = rowIndex === 1;
      const rowCount = staggered ? CHEER_FRONT_ROW_COUNT + 1 : CHEER_FRONT_ROW_COUNT;
      const rowHalfSpread = staggered ? (CHEER_ROW_GAP * (rowCount - 1)) / 2 : CHEER_FRONT_HALF_SPREAD;
      for (let i = 0; i < rowCount; i++) {
        const template = cheerleaderTemplates[i % CHEERLEADER_COUNT]; // cycle back through the 4 models -- each row is wider than 4
        if (!template) continue; // that particular model hasn't loaded yet -- buildCheerleaders() reruns once it does
        const model = cloneSkinnedScene(template);
        // No base-facing correction here (unlike the runner/defender/blocker
        // models, which all apply `rotation.y = Math.PI`) -- those need it to
        // face this game's own "forward" (-Z) running direction, but a
        // cheerleader stationed past the FAR goal line just needs to face
        // back toward the field (+Z), which is the raw/uncorrected Mixamo
        // export orientation already.
        model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(cheerCheeringClip).play();
        mixer.setTime(Math.random() * cheerCheeringClip.duration); // stagger each one's loop so they don't all cheer in lockstep
        const offset = CHEER_GROUP_CENTER_X + evenLineX(i, rowCount, rowHalfSpread);
        model.position.set(side * offset, 0, z);
        cheerleaderGroup.add(model);
        cheerleaders.push({ mixer });
      }
    });
  });

  // Single row along EACH sideline, touchdown-side only, per a direct
  // request: starts around the 35 (near the standing cameraman at the
  // 25/far-side spot -- "35" is the user's own rough landmark, kept as
  // given) and runs down through the endzone to its back line. Unlike the
  // two squads above (which stand BEHIND the goal line facing back at the
  // field), this row stands BESIDE the field along its length, so needs
  // the inward-facing correction every sideline character uses -- same
  // raw-+Z-at-rest convention as blocker/defender (before THEIR OWN
  // Math.PI base correction, which cheerleaders never get at all), so the
  // same +-90deg turns buildSidelinePlayers()'s own SIDES array uses apply
  // directly here. X is offset one notch further out than the standing
  // cameramen's own FIELD_WIDTH/2+1 (same "+2.3" second-row offset
  // buildSidelinePlayers() already uses) specifically so this row's long
  // span doesn't land directly on top of the far-side cameramen at z=-75/-90.
  const CHEER_SIDELINE_X = FIELD_WIDTH / 2 + 2.3;
  const CHEER_SIDELINE_START_Z = -(lengthYards - 35); // the 35-yard line
  const CHEER_SIDELINE_END_Z = -(lengthYards + ENDZONE_DEPTH); // back of the endzone
  const CHEER_SIDELINE_GAP = 2; // yd between neighbors -- same spacing as the back squads' own CHEER_ROW_GAP
  const CHEER_SIDELINE_COUNT = Math.round(Math.abs(CHEER_SIDELINE_END_Z - CHEER_SIDELINE_START_Z) / CHEER_SIDELINE_GAP) + 1;
  [-1, 1].forEach((sign) => {
    const facingY = sign < 0 ? Math.PI / 2 : -Math.PI / 2; // same convention as buildSidelinePlayers()'s own SIDES array
    for (let i = 0; i < CHEER_SIDELINE_COUNT; i++) {
      const template = cheerleaderTemplates[i % CHEERLEADER_COUNT];
      if (!template) continue; // that particular model hasn't loaded yet -- buildCheerleaders() reruns once it does
      const model = cloneSkinnedScene(template);
      model.rotation.y = facingY;
      model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(cheerCheeringClip).play();
      mixer.setTime(Math.random() * cheerCheeringClip.duration);
      const t = i / (CHEER_SIDELINE_COUNT - 1);
      const z = CHEER_SIDELINE_START_Z + (CHEER_SIDELINE_END_Z - CHEER_SIDELINE_START_Z) * t;
      model.position.set(sign * CHEER_SIDELINE_X, 0, z);
      cheerleaderGroup.add(model);
      cheerleaders.push({ mixer });
    }
  });

  scene.add(cheerleaderGroup);
}

function updateCheerleaderAnimations(dt) {
  for (const c of cheerleaders) c.mixer.update(dt);
}

// ---- Stadium: crowd stand model + 90-degree corners --------------------
// Same Rodin-generated stand/corner models used for Field Goal Kick's own
// stadium (public/models/stadium-stand.glb / stadium-corner.glb, see
// play-field-goal.js) -- reused as-is rather than building anything new.
// Two differences from that game's own build: this field is much longer
// (100+ yards vs. Field Goal Kick's ~80-yard visible span), so the
// sideline chain has to run much further; and BOTH ends need to be closed
// off, not just the one behind the goalpost -- a return can end in either
// direction's view (the kickoff camera starts near the kicking team's own
// end, a touchdown run reaches the far end), unlike a field-goal kick
// which only ever looks toward the goalpost.
const STAND_HEIGHT = 8;
const STAND_MODEL_BBOX = { w: 1.8945350050926208, h: 0.5554050207138062, d: 0.9296950101852417 };
const STAND_MODEL_SCALE = STAND_HEIGHT / STAND_MODEL_BBOX.h;
const STAND_MODEL_TILE_LEN = STAND_MODEL_BBOX.w * STAND_MODEL_SCALE;
// Local-Z offset from the model's pivot to its crowd-facing (front) edge --
// used below to chain tiles by their front edge instead of their
// centerline (an angled/differently-shaped neighbor's centerline doesn't
// predict where its front face actually lands).
const STAND_MODEL_FRONT_LOCAL_Z = 0.4630330204963684;
const STAND_MODEL_FRONT_OFFSET = STAND_MODEL_FRONT_LOCAL_Z * STAND_MODEL_SCALE;

const CORNER_BBOX_H = 0.6803219318389893;
const CORNER_SCALE = STAND_HEIGHT / CORNER_BBOX_H;
// Yards from the corner tile's own pivot to its own crowd-facing front
// edge -- measured the same way STAND_MODEL_FRONT_OFFSET was (a Box3 on a
// placed, unrotated, mirror=1 instance). Notably bigger than the straight
// tile's own ~6.67yd offset: using the STRAIGHT tile's offset for the
// corners too (an earlier version of this code did) placed the corners'
// pivots close enough that their own, bigger front-reach stuck out well
// past the straight tile's front edge -- invisible while everything sat
// close to the field, but once both were pushed back for real endzone
// clearance it read as the corners "encroaching" past a visibly-recessed
// center section, with a gap/notch of sky between them.
const CORNER_FRONT_OFFSET = 11.17;

// Field Goal Kick's own field is half as wide (FIELD_HALF_WIDTH=15 there)
// as this one (FIELD_WIDTH/2 ≈ 26.65) -- shift every corner/sideline X
// offset outward by the difference so the same, physically-fixed-size
// model sits the same real distance off the sideline instead of clipping
// this wider field.
//
// SIDELINE_RUNOFF adds further margin on top of that, purely for out-of-
// bounds room (see triggerOutOfBounds()) -- the runner can now actually
// cross the sideline and needs somewhere to visibly run out into before
// the stands themselves start, not just enough clearance to avoid
// clipping the field. Bumped from an initial too-tight gap (0) to 10 per
// live feedback, then found THAT too far back ("somewhere halfway") --
// split the difference.
const SIDELINE_RUNOFF = 5;
const STAND_WIDTH_DELTA = (FIELD_WIDTH / 2) - 15 + SIDELINE_RUNOFF;

// Real stadium stands sit on a raised concrete base, not flush with the
// field -- the source model itself is built to sit AT ground level
// (y=0), so simply lifting it left a visible gap of green field showing
// underneath, floating. RISER_MAT/addRiser() fill that gap with a plain
// box under every tile, color-matched to the model's own support
// structure (sampled directly from the rendered pixels, not guessed --
// its concrete/steel understructure reads as a light neutral gray,
// nowhere near as dark as this started at). Doesn't need to match each
// tile's exact footprint (an irregular corner's silhouette isn't a
// rectangle anyway), just wide/deep enough that the gap is fully
// covered -- but DOES need `rotationY` applied, same as the tile it sits
// under: a first version left this off entirely, so every rotated
// SIDELINE tile's riser kept its un-rotated width/depth axes, physically
// swapping which direction was "long" and which was "short" -- the
// riser's long axis ended up running laterally, straight out into the
// playable field, instead of along the sideline underneath its own tile.
const STAND_ELEVATION = 2;
const RISER_MAT = new THREE.MeshStandardMaterial({ color: 0x8c8c8a, roughness: 0.95 });
// A single flat-colored box read as an edgeless, textureless slab abutting
// the grass with no visible transition -- same "layer simple boxes for
// detail" trick already used elsewhere in this codebase (the power meter's
// bezel/inset-rim/corner-screw layering in play-field-goal.js) fixes it
// cheaply, no new texture/asset needed: a lighter concrete "coping" cap
// along the top edge (where the riser meets the seating above) and a
// darker "toe" line along the base (where it meets the grass) give the
// eye two real edges to read instead of one flat color bleeding straight
// into green turf.
const RISER_CAP_MAT = new THREE.MeshStandardMaterial({ color: 0xb0b0ac, roughness: 0.8 });
const RISER_BASE_MAT = new THREE.MeshStandardMaterial({ color: 0x2e2e2c, roughness: 0.95 });
const RISER_CAP_HEIGHT = 0.25;
const RISER_CAP_OVERHANG = 0.4; // slight lip past the riser's own footprint -- a real coping detail, not just a same-size box restated in a different color
const RISER_BASE_HEIGHT = 0.35;
function addRiser(x, z, width, depth, rotationY = 0) {
  const riser = new THREE.Mesh(new THREE.BoxGeometry(width, STAND_ELEVATION, depth), RISER_MAT);
  riser.position.set(x, STAND_ELEVATION / 2, z);
  riser.rotation.y = rotationY;
  riser.receiveShadow = true;
  standGroup.add(riser);

  const cap = new THREE.Mesh(new THREE.BoxGeometry(width + RISER_CAP_OVERHANG, RISER_CAP_HEIGHT, depth + RISER_CAP_OVERHANG), RISER_CAP_MAT);
  cap.position.set(x, STAND_ELEVATION - RISER_CAP_HEIGHT / 2, z);
  cap.rotation.y = rotationY;
  cap.castShadow = true;
  standGroup.add(cap);

  const base = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, RISER_BASE_HEIGHT, depth + 0.1), RISER_BASE_MAT);
  base.position.set(x, RISER_BASE_HEIGHT / 2, z);
  base.rotation.y = rotationY;
  standGroup.add(base);
}

let standStraightGltf = null;
let standCornerGltf = null;
const standGroup = new THREE.Group();
scene.add(standGroup);

function addStandStraightTile(x, z, rotationY) {
  const tile = standStraightGltf.scene.clone();
  tile.scale.setScalar(STAND_MODEL_SCALE);
  tile.rotation.y = rotationY;
  tile.position.set(x, STAND_ELEVATION, z);
  standGroup.add(tile);
  addRiser(x, z, STAND_MODEL_TILE_LEN, STAND_MODEL_BBOX.d * STAND_MODEL_SCALE, rotationY);
}

// `flip` is for the near (returner's own) end's corners, which need the
// whole assembly turned 180 to face back toward the field -- the far
// end's corners (Field Goal Kick's own, proven orientation) pass false.
function addStandCornerTile(x, z, mirror, flip) {
  const tile = standCornerGltf.scene.clone();
  tile.scale.set(CORNER_SCALE * mirror, CORNER_SCALE, CORNER_SCALE);
  addRiser(x, z, CORNER_FRONT_OFFSET * 2.2, CORNER_FRONT_OFFSET * 2.2); // generous square footprint -- the corner's own silhouette isn't a rectangle, this just needs to cover under it
  if (flip) tile.rotation.y = Math.PI;
  if (mirror < 0) {
    // The corner model's two arms are NOT mirror images of each other in
    // the source file (it's a single right-handed L), so the left corner
    // needs an actual mirror (negative X scale), not just a rotation -- a
    // rotation can't turn a right-handed shape into its left-handed
    // reflection. Negative scale flips winding order, so the mirrored
    // copy needs double-sided materials or it goes invisible from the
    // "wrong" side.
    tile.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.side = THREE.DoubleSide;
      }
    });
  }
  tile.position.set(x, STAND_ELEVATION, z);
  standGroup.add(tile);
}

function addStandStraightFromEdge(edge, mirror) {
  const sweep = Math.PI / 2;
  const rotationY = mirror === 1 ? -sweep : sweep;
  const dir = mirror === 1
    ? new THREE.Vector3(Math.cos(sweep), 0, Math.sin(sweep))
    : new THREE.Vector3(-Math.cos(sweep), 0, Math.sin(sweep));
  const front = new THREE.Vector3(Math.sin(rotationY), 0, Math.cos(rotationY));
  const frontEdgeCenter = edge.clone().addScaledVector(dir, STAND_MODEL_TILE_LEN / 2);
  const origin = frontEdgeCenter.clone().addScaledVector(front, -STAND_MODEL_FRONT_OFFSET);
  addStandStraightTile(origin.x, origin.z, rotationY);
  return edge.clone().addScaledVector(dir, STAND_MODEL_TILE_LEN);
}

// The single center tile behind the endzone is only ~27yd wide
// (STAND_MODEL_TILE_LEN), but the corners now sit much further out than
// that (CORNER_X, pushed out for sideline out-of-bounds room -- see
// SIDELINE_RUNOFF -- independent of how wide any one stand tile is) --
// direct measurement of the corner's own mesh confirmed its inward-facing
// surface (the part that's supposed to meet the center tile) sits well
// short of its overall bounding-box front, which is dominated by the tip
// of its outer, tapering arm instead. A single center tile can no longer
// reach it at all, at any Z -- this isn't a depth/front-offset problem,
// it's a WIDTH problem, and no amount of nudging the center tile's Z ever
// closes an X gap. Chains extra tiles outward from the center at the SAME
// Z/rotation (same generous-overlap philosophy as the sideline chain)
// until they clear the corner's own pivot.
function addBackStandFlankingTiles(z, rotationY, cornerX) {
  const halfTile = STAND_MODEL_TILE_LEN / 2;
  [1, -1].forEach((mirror) => {
    let x = mirror * STAND_MODEL_TILE_LEN;
    let guard = 0;
    while (mirror * x - halfTile < cornerX && guard < 10) {
      addStandStraightTile(x, z, rotationY);
      x += mirror * STAND_MODEL_TILE_LEN;
      guard++;
    }
  });
}

function buildEndzoneStands(lengthYards) {
  if (!standStraightGltf || !standCornerGltf) return;
  standGroup.clear();

  const CORNER_X = 12.8 + STAND_WIDTH_DELTA;
  const SIDELINE_ANCHOR_X = 16 + STAND_WIDTH_DELTA;

  // How far behind the actual goal line each element's own crowd-facing
  // edge should sit -- a real NFL endzone is about this deep, giving
  // clear green space between the playable endzone and the stands rather
  // than the stands looming right at the goal line. Each element's PIVOT
  // is derived from this same target front line using ITS OWN front
  // offset (not a shared/flat margin) so the straight tile and the
  // corners land their front edges at the SAME place instead of one
  // sticking out past the other.
  const ENDZONE_STAND_SETBACK = 20 * (2 / 3) + 5; // ~18.3yd -- +5 more past the previous ~13.3yd, per live feedback: leaves ~8.3yd of clear grass behind the back-of-endzone line (ENDZONE_DEPTH=10yd) instead of ~3.3yd, room for a planned cheerleader routine back there. Still clear of the goalposts (ENDZONE_DEPTH + GOALPOST_LINE_CLEARANCE ≈ 10.5yd) by an even wider margin than before.
  const farFrontZ = -(lengthYards + ENDZONE_STAND_SETBACK);
  const farBackZ = farFrontZ - STAND_MODEL_FRONT_OFFSET;
  const farCornerZ = farFrontZ - CORNER_FRONT_OFFSET;
  addStandStraightTile(0, farBackZ, 0);
  addBackStandFlankingTiles(farBackZ, 0, CORNER_X);
  addStandCornerTile(CORNER_X, farCornerZ, 1, false);
  addStandCornerTile(-CORNER_X, farCornerZ, -1, false);

  // Near end (the returner's own goal line, +Z) -- a mirror of the far
  // end: the whole assembly turned 180 so it faces back toward the field
  // instead of away from it. The 180 flips BOTH local axes, not just the
  // one facing the field -- the corner's own back-arm (the one that
  // reaches toward the center back-stand along X) flips its X-direction
  // too, so the left/right mirror sign is swapped here to compensate,
  // keeping each arm reaching toward the back stand the way it did
  // unrotated. Verified gap-free at all 4 corners with this combination
  // (see the stadium build entry in memory for the full verification
  // pass -- and a real bug this same pass caught: the corner tile's own
  // position was never actually applied at all for a while, which made
  // every earlier "looks right" read on this section worthless).
  const nearFrontZ = ENDZONE_STAND_SETBACK;
  const nearBackZ = nearFrontZ + STAND_MODEL_FRONT_OFFSET;
  const nearCornerZ = nearFrontZ + CORNER_FRONT_OFFSET;
  addStandStraightTile(0, nearBackZ, Math.PI);
  addBackStandFlankingTiles(nearBackZ, Math.PI, CORNER_X);
  addStandCornerTile(CORNER_X, nearCornerZ, -1, true);
  addStandCornerTile(-CORNER_X, nearCornerZ, 1, true);

  // One long straight-tile chain per sideline, running the FULL length
  // between the two ends' corners (Field Goal Kick's own chain only ever
  // needed to close one end) -- same generous-overlap philosophy at both
  // anchor points, no exact seam-chasing. Anchored off the CORNER's own
  // (now further-back) pivot, not the straight tile's, since the corner
  // sits deeper than the straight tile once each is placed off its own
  // front offset.
  const farAnchorZ = farCornerZ - 4;
  const nearAnchorZ = nearCornerZ + 4;
  [1, -1].forEach((mirror) => {
    let edge = new THREE.Vector3(SIDELINE_ANCHOR_X * mirror, 0, farAnchorZ);
    let guard = 0;
    while (edge.z < nearAnchorZ && guard < 200) {
      edge = addStandStraightFromEdge(edge, mirror);
      guard++;
    }
  });
}

// Both stand models load asynchronously over the network, well after the
// idle "about to start" screen's own first render -- the idle screen's
// idleRenderTick() (see stopLoop()/tick() area) keeps redrawing every
// frame regardless, so whichever model finishes loading second just
// naturally shows up on the next frame with no extra handling needed
// here.
new GLTFLoader().load('/models/stadium-stand.glb', (gltf) => {
  standStraightGltf = gltf;
  buildEndzoneStands(fieldYards);
}, undefined, (err) => console.error('stadium stand model load failed', err));
new GLTFLoader().load('/models/stadium-corner.glb', (gltf) => {
  standCornerGltf = gltf;
  buildEndzoneStands(fieldYards);
}, undefined, (err) => console.error('stadium corner model load failed', err));

for (let ci = 0; ci < CHEERLEADER_COUNT; ci++) {
  const idx = ci;
  new GLTFLoader().load(`/models/cheerleader-${idx + 1}.glb`, (gltf) => {
    cheerleaderTemplates[idx] = gltf.scene;
    buildCheerleaders(fieldYards);
  }, undefined, (err) => console.error(`cheerleader ${idx + 1} model load failed`, err));
}
new GLTFLoader().load('/models/cheer-cheering.glb', (gltf) => {
  cheerCheeringClip = gltf.animations[0];
  buildCheerleaders(fieldYards);
}, undefined, (err) => console.error('cheer animation load failed', err));

new GLTFLoader().load('/models/referee.glb', (gltf) => {
  refereeTemplate = gltf.scene;
  buildReferees(fieldYards);
  buildRunningReferees(fieldYards);
}, undefined, (err) => console.error('referee model load failed', err));

new GLTFLoader().load('/models/cameraman.glb', (gltf) => {
  cameramanTemplate = gltf.scene;
  buildCameraman(fieldYards);
}, undefined, (err) => console.error('cameraman model load failed', err));

new GLTFLoader().load('/models/standing-cameraman.glb', (gltf) => {
  standingCameramanTemplate = gltf.scene;
  buildStandingCameramen(fieldYards);
}, undefined, (err) => console.error('standing cameraman model load failed', err));

['blue', 'red'].forEach((key) => {
  new GLTFLoader().load(`/models/coach-${key}.glb`, (gltf) => {
    coachTemplates[key] = { scene: gltf.scene, clip: gltf.animations[0] };
    buildCoaches(fieldYards);
  }, undefined, (err) => console.error(`${key} coach model load failed`, err));
});

new GLTFLoader().load('/models/sideline-bored.glb', (gltf) => {
  sidelineBoredClip = gltf.animations[0];
  buildSidelinePlayers(fieldYards);
}, undefined, (err) => console.error('sideline bored animation load failed', err));
new GLTFLoader().load('/models/sideline-idle.glb', (gltf) => {
  sidelineIdleClip = gltf.animations[0];
  buildSidelinePlayers(fieldYards);
}, undefined, (err) => console.error('sideline idle animation load failed', err));
new GLTFLoader().load('/models/sideline-looking-around.glb', (gltf) => {
  sidelineLookingAroundClip = gltf.animations[0];
  buildSidelinePlayers(fieldYards);
}, undefined, (err) => console.error('sideline looking-around animation load failed', err));

new GLTFLoader().load('/models/bench.glb', (gltf) => {
  benchTemplate = gltf.scene;
  buildBenches(fieldYards);
}, undefined, (err) => console.error('bench model load failed', err));

new GLTFLoader().load('/models/sitting-talking.glb', (gltf) => {
  sittingTalkingClip = gltf.animations[0];
  buildBenches(fieldYards);
}, undefined, (err) => console.error('sitting-talking animation load failed', err));
new GLTFLoader().load('/models/sitting-angry.glb', (gltf) => {
  sittingAngryClip = gltf.animations[0];
  buildBenches(fieldYards);
}, undefined, (err) => console.error('sitting-angry animation load failed', err));
new GLTFLoader().load('/models/sitting-rubbing-arm.glb', (gltf) => {
  sittingRubbingArmClip = gltf.animations[0];
  buildBenches(fieldYards);
}, undefined, (err) => console.error('sitting-rubbing-arm animation load failed', err));

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
let rightStrafeClip = null; // raw clip, same source as rightStrafeAction's -- reused unbound (own AnimationMixer per instance) by the running referees, see buildRunningReferees()
let leftStrafeClip = null;
let spinLeftAction = null;
let spinRightAction = null;
let jumpCutLeftAction = null;
let jumpCutRightAction = null;
let stopAction = null;
let turn180Action = null;
let fallingDownAction = null; // tackled from the front or side
let fallFlatAction = null; // tackled from behind
let outOfBoundsAction = null; // played (standing, not falling) when he steps out of bounds -- see triggerOutOfBounds(). Same raw clip as blockerSadIdleClip, just bound to the runner's own mixer instead of a blocker's.
const FALL_TIME_SCALE = 3.5; // the raw Mixamo clips (~2.3-2.5s) read as slow for a tackle -- played faster, same idea as SPIN_TIME_SCALE/JUMPCUT_TIME_SCALE
let activeAction = null;
let hipsBone = null;
let hipsBindPos = null;
let hipsBindQuat = null;
let spineBone = null;
let spineBindQuat = null;
let heldBallMesh = null; // 'HeldFootball' node baked into player-kick.glb itself (real skinned geometry, weighted to mixamorig:RightHand) -- hidden until the catch, see the Kickoff sequence section
let runnerKickClip = null; // player-kick.glb's own baked "run-up + kick" clip, already loaded for the runner's mesh but never read until the kickoff sequence needed it -- reused on a defender-model kicker
let catchAction = null; // played once, on the runner's own mixer, the instant the kicked ball arrives
let breathingIdleAction = null; // looped on the runner's own mixer while he waits for the kick/hang to play out -- see startReturn()
let defenderTemplate = null; // the loaded (or null: not ready yet) defender scene -- each defender is its own SkeletonUtils.clone() of this
let defenderRunClip = null; // same AnimationClip object the runner uses, shared across every defender's own AnimationMixer
let defenderPushClip = null; // played by the tackler first, at the moment of impact, before the flex celebration -- see triggerTackle()
let defenderFlexClip = null; // played by whichever defender actually makes the tackle
let defenderVictoryClip = null; // played by every OTHER defender once the play ends -- otherwise they keep looping the run cycle in place, frozen mid-stride, since their position stops updating but their mixer doesn't
let blockerTemplate = null; // the loaded (or null: not ready yet) blocker scene -- same SkeletonUtils.clone() pattern as defenderTemplate
let blockerSadIdleClip = null; // played by every blocker the instant the runner is tackled -- see triggerTackle()

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
// spin, then the team celebration below. The old solo-dance pool
// (DANCE_MODEL_PATHS/danceActions -- 5 random Mixamo dance loops) was
// removed per a direct ask once the team-celebration system below was
// solid enough to just be THE celebration; the old solo models are gone
// from git history if that ever needs resurrecting.

// A TEAM celebration, kept deliberately as its own self-contained unit
// (own spawn/run-in/camera logic) rather than folded into a flat clip
// list, so more team celebrations can be added later without reworking
// this one. First one: Thriller Part 2 only, looped -- user's own Mixamo
// download, retargeted (by them, on mixamo.com) onto a 33-bone reduced
// rig -- same shape as blocker.glb/defender.glb, confirmed via a direct
// bone-count check before conversion, so it plays on blockerTemplate
// clones with no track-filtering needed (unlike the referee-walk-clip
// case elsewhere in this file, where the rigs didn't already match).
// Parts 3/4 were converted and briefly wired up too (chained via
// 'finished' listeners into one long routine), but simplified back down
// to just Part 2 on repeat per a direct ask -- if a multi-part routine
// comes back later, the old chaining approach is in git history.
const THRILLER_MODEL_PATHS = [
  '/models/thriller-part-2.glb',
];
let thrillerActions = []; // 1 action bound to the RUNNER's own shared mixer -- only populated once it loads successfully, see charactersLoaded .then()
let thrillerClips = []; // the raw AnimationClip data for the same clip, rebound onto each teammate's OWN mixer fresh per celebration (see startThrillerCelebration())

// A transient network hiccup on one file shouldn't strand a whole session on
// the placeholder capsules -- retries once (with a short pause) before
// actually giving up. Used for defender.glb specifically: it's by far the
// biggest single asset here (~5MB, loaded alongside a dozen others at once),
// so it's the one most exposed to exactly this kind of one-off failure.
function loadGltfWithRetry(url, retries = 1) {
  return new Promise((resolve) => {
    const attempt = (retriesLeft) => {
      new GLTFLoader().load(url, resolve, undefined, (err) => {
        if (retriesLeft > 0) {
          console.warn(`${url} load failed, retrying...`, err);
          setTimeout(() => attempt(retriesLeft - 1), 500);
        } else {
          console.error(`${url} load failed -- falling back to placeholder capsules`, err);
          resolve(null);
        }
      });
    };
    attempt(retries);
  });
}

// Resolves once every character model/clip/animation this file needs is
// fully loaded AND all the derived state below (defenderTemplate,
// blockerTemplate, every AnimationAction, etc.) has actually been set --
// awaited before the FIRST return of a game starts (see the
// start-return-btn handler) so spawnDefenders()/spawnBlockers() never run
// while defenderTemplate/blockerTemplate are still null. Before this,
// "Start Return" appeared as soon as the (much faster) game-instance API
// call resolved, completely independent of this Promise.all -- a real
// production report of defenders/blockers rendering as their capsule
// placeholder fallback for an entire return traced back to exactly this
// race, a player clicking Start Return before this had actually finished.
const charactersLoaded = Promise.all([
  new Promise((resolve) => new GLTFLoader().load('/models/player-kick.glb', resolve, undefined, (err) => console.error('runner model load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/running.glb', resolve, undefined, (err) => console.error('running animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/running-right-turn.glb', resolve, undefined, (err) => console.error('running-right-turn animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/running-left-turn.glb', resolve, undefined, (err) => console.error('running-left-turn animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/run-to-stop.glb', resolve, undefined, (err) => console.error('run-to-stop animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/running-turn-180.glb', resolve, undefined, (err) => console.error('running-turn-180 animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/right-strafe.glb', resolve, undefined, (err) => console.error('right-strafe animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/left-strafe.glb', resolve, undefined, (err) => console.error('left-strafe animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/falling-down.glb', resolve, undefined, (err) => console.error('falling-down animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/fall-flat.glb', resolve, undefined, (err) => console.error('fall-flat animation load failed', err))),
  fetch('/models/spin-left.json').then((r) => r.json()),
  fetch('/models/spin-right.json').then((r) => r.json()),
  fetch('/models/jump-cut-left.json').then((r) => r.json()),
  fetch('/models/jump-cut-right.json').then((r) => r.json()),
  Promise.all(THRILLER_MODEL_PATHS.map((path) => new Promise((resolve) => new GLTFLoader().load(path, resolve, undefined, (err) => { console.error(`thriller clip load failed: ${path}`, err); resolve(null); })))),
  // Rodin-generated, Mixamo-rigged (33 bones -- a reduced rig, no per-finger
  // articulation beyond one representative digit each hand, but every bone
  // the shared running.glb clip actually drives is present and matches the
  // runner's naming). Same graceful-miss pattern as the dance clips above
  // (resolve(null) on load failure) as a defense-in-depth fallback to plain
  // capsules, not because this is expected to be missing anymore.
  loadGltfWithRetry('/models/defender.glb'),
  new Promise((resolve) => new GLTFLoader().load('/models/flex.glb', resolve, undefined, (err) => console.error('flex animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/victory.glb', resolve, undefined, (err) => console.error('victory animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/push.glb', resolve, undefined, (err) => console.error('push animation load failed', err))),
  loadGltfWithRetry('/models/blocker.glb'),
  new Promise((resolve) => new GLTFLoader().load('/models/sad-idle.glb', resolve, undefined, (err) => console.error('sad-idle animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/catch.glb', resolve, undefined, (err) => console.error('catch animation load failed', err))),
  new Promise((resolve) => new GLTFLoader().load('/models/breathing-idle.glb', resolve, undefined, (err) => console.error('breathing-idle animation load failed', err))),
]).then(([runnerGltf, runGltf, rightTurnGltf, leftTurnGltf, stopGltf, turn180Gltf, rightStrafeGltf, leftStrafeGltf, fallingDownGltf, fallFlatGltf, spinLeftJson, spinRightJson, jumpCutLeftJson, jumpCutRightJson, thrillerGltfs, defenderGltf, flexGltf, victoryGltf, pushGltf, blockerGltf, sadIdleGltf, catchGltf, breathingIdleGltf]) => {
  const model = runnerGltf.scene;
  model.rotation.y = Math.PI;
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  RUNNER_GROUP.add(model);

  model.traverse((o) => {
    if (o.isBone && o.name === 'mixamorigHips') hipsBone = o;
    if (o.isBone && o.name === 'mixamorigSpine') spineBone = o;
    if (o.name === 'HeldFootball') heldBallMesh = o;
  });
  hipsBindPos = hipsBone ? hipsBone.position.clone() : null;
  hipsBindQuat = hipsBone ? hipsBone.quaternion.clone() : null;
  spineBindQuat = spineBone ? spineBone.quaternion.clone() : null;
  if (heldBallMesh) heldBallMesh.visible = false; // only shown from the catch moment on

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
  rightStrafeClip = rightStrafeGltf.animations[0];
  leftStrafeClip = leftStrafeGltf.animations[0];
  fallingDownAction = mixer.clipAction(fallingDownGltf.animations[0]);
  fallFlatAction = mixer.clipAction(fallFlatGltf.animations[0]);
  [fallingDownAction, fallFlatAction].forEach((a) => { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.setEffectiveTimeScale(FALL_TIME_SCALE); });
  catchAction = mixer.clipAction(catchGltf.animations[0]);
  catchAction.setLoop(THREE.LoopOnce);
  catchAction.clampWhenFinished = true;
  breathingIdleAction = mixer.clipAction(breathingIdleGltf.animations[0]);
  breathingIdleAction.setLoop(THREE.LoopRepeat); // actually plays throughout the kickoff/hang wait, unlike the one-shot reaction clips -- see startReturn()
  spinLeftAction = mixer.clipAction(clipFromJson(spinLeftJson));
  spinRightAction = mixer.clipAction(clipFromJson(spinRightJson));
  [spinLeftAction, spinRightAction].forEach((a) => { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.setEffectiveTimeScale(SPIN_TIME_SCALE); });
  // Cascadeur-authored (real performer footage will replace these later) --
  // already captured at normal speed, no coaching-footage slowdown to
  // compensate for like the spin clips need.
  jumpCutLeftAction = mixer.clipAction(clipFromJson(jumpCutLeftJson));
  jumpCutRightAction = mixer.clipAction(clipFromJson(jumpCutRightJson));
  [jumpCutLeftAction, jumpCutRightAction].forEach((a) => { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.setEffectiveTimeScale(JUMPCUT_TIME_SCALE); });
  ONE_SHOT_ACTIONS.add(stopAction).add(turn180Action).add(spinLeftAction).add(spinRightAction).add(jumpCutLeftAction).add(jumpCutRightAction).add(fallingDownAction).add(fallFlatAction).add(catchAction);

  if (thrillerGltfs.every(Boolean)) {
    thrillerClips = thrillerGltfs.map((g) => g.animations[0]);
    thrillerActions = thrillerClips.map((clip) => {
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat); // just loops Part 2 indefinitely -- same as any solo dance
      return a;
    });
  }

  if (defenderGltf) {
    defenderTemplate = defenderGltf.scene;
    defenderTemplate.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }
  defenderRunClip = runGltf.animations[0]; // one AnimationClip, reused across every defender's AND blocker's own mixer
  defenderFlexClip = flexGltf.animations[0];
  defenderVictoryClip = victoryGltf.animations[0];
  defenderPushClip = pushGltf.animations[0];

  if (blockerGltf) {
    blockerTemplate = blockerGltf.scene;
    blockerTemplate.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }
  blockerSadIdleClip = sadIdleGltf.animations[0];
  buildSidelinePlayers(fieldYards); // blockerTemplate is one of its 3 dependencies (the other 2 -- the idle clips -- load independently and may arrive before or after this)
  buildBenches(fieldYards); // blockerTemplate/defenderTemplate are 2 of its 4 dependencies -- without this retry, benches never appear whenever bench.glb/the sitting clips (which load independently, above) happen to resolve before this Promise.all does
  buildRunningReferees(fieldYards); // rightStrafeClip/leftStrafeClip are 2 of its 3 dependencies (the third, refereeTemplate, loads independently -- see its own loader below)
  runnerKickClip = runnerGltf.animations[0]; // player-kick.glb's own baked run-up+kick clip -- applied to a defender-model kicker in spawnKicker()

  // Same raw sad-idle clip the blockers react with on a tackle, bound to
  // the RUNNER's own mixer this time -- reused for stepping out of
  // bounds (see triggerOutOfBounds()), a discouraged "head down, hands
  // on hips" standing reaction rather than the fall clips a real tackle
  // uses.
  outOfBoundsAction = mixer.clipAction(blockerSadIdleClip);
  outOfBoundsAction.setLoop(THREE.LoopRepeat);
  ONE_SHOT_ACTIONS.add(outOfBoundsAction); // starts fresh at frame 0 when activated, same as every other reaction clip here

  // `paused` only stops an action's own time from advancing -- it does NOT
  // stop the action from being evaluated by the mixer, so a "paused" clip
  // still blends its frozen pose into the skeleton alongside whichever
  // clip is actually active. Only `enabled = false` fully removes an
  // action from the blend. Without this, the turn/stop clips' poses were
  // silently bleeding into the straight run the whole time, which is what
  // was actually behind the persistent "running at an angle" report.
  const allActions = [runAction, runRightTurnAction, runLeftTurnAction, rightStrafeAction, leftStrafeAction, spinLeftAction, spinRightAction, jumpCutLeftAction, jumpCutRightAction, fallingDownAction, fallFlatAction, stopAction, turn180Action, catchAction, outOfBoundsAction, breathingIdleAction, ...thrillerActions];
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
  // NOT clamped at the goal line -- a clamped version was tried (holding
  // the camera at z=0 whenever the natural z+CHASE_BACK would be positive)
  // to keep the camera out of the now-painted near end zone, but that
  // freezes the camera in place for the runner's first CHASE_BACK (5.5yd)
  // of movement while he keeps moving -- he visibly pulls away from a
  // stationary camera instead of the camera trailing him at a constant
  // distance, confirmed live as a real regression, worse than the thing it
  // was fixing. Reverted. The camera DOES briefly sit inside the near end
  // zone for the first few yards of every return (CHASE_BACK behind a
  // runner who starts at his own goal line) -- a real, known trade-off,
  // not fixed here.
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
let downReason = 'tackled'; // 'tackled' or 'out of bounds' -- both end the play via the same 'tackled' phase, this just tracks which for the result-panel wording (see finalizeCelebration())
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
// A defender's lunge (DEFENDER_LUNGE_SPEED_MULT, 1.6x its base 7.5yd/s
// speed) can close the DEFENDER_TRIGGER_RANGE gap (2.5yd) faster than a
// spin/jump-cut's own lateral burst can create separation, so pure
// geometry rarely saves him even with good timing -- per user feedback,
// the spin was reading as "tackles me every time even if I am spinning."
// Rather than rebalance lunge speed/tackle radius globally (would also
// soften every straight-running tackle, not just evasive moves), an
// active spin OR jump-cut gets a flat chance to turn what would be a
// tackle into a miss -- see the 'lunging' branch of updateDefenders().
// Shipped at 0.5 first, dropped to 0.3 same week -- 0.5 read as winning
// the evade too often. Applies to both moves, not just spin, per the
// same feedback round.
const EVADE_CHANCE = 0.3;
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
    if (d.state === 'done' || d.state === 'blocked') continue; // held by a blocker -- not a real threat right now
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
const JUMPCUT_LATERAL_SPEED = 17.7; // dialed to land ~2.8yd total (live-measured) at the current JUMPCUT_TIME_SCALE below -- was 15.8 (~2.5yd), scaled up proportionally since distance = SPEED * duration / 2 and duration wasn't changing this time
const JUMPCUT_TIME_SCALE = 1.5; // lowered from 2.5 -- the new v2 clip (0.5s raw) at the old scale played out in ~0.2s, too quick to read as a real move; this stretches it to ~0.33s (~3.3yd total with the speed above, farther than the original clip's own ~3.15yd)
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

// Evenly spaces `count` players across a line, index 0 at -halfSpan and
// index count-1 at +halfSpan -- shared by the defender/blocker pre-snap
// formations (real Dynamic Kickoff lines, not the old random-jitter spawn).
const FORMATION_MARGIN = 2; // yards kept clear of each sideline, same margin already used for the runner's own lateral clamp elsewhere
function evenLineX(index, count, halfSpan) {
  if (count <= 1) return 0;
  return -halfSpan + (index * (2 * halfSpan)) / (count - 1);
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
const DEFENDER_FORMATION_COUNT = 10; // real Dynamic Kickoff formation -- kicking team lines up on the receiving team's 40, evenly spaced, not the old testing-override random count
const DEFENDER_LINE_Z = -40; // yards downfield of the returner's own goal line

let defenders = [];

// ---- Blockers -----------------------------------------------------------
// Return-team players. Keeps the 2D game's one core fairness idea for a
// block -- the held defender's entire approach/lunge machinery stops dead,
// not just a cosmetic tackle-radius reduction -- without porting its
// full complexity (no slide-tackle sub-mechanic, no re-block cooldown
// escalation, no wave-based lateral-slot spawn formation). A blocker with
// no eligible defender nearby just escorts: holds a fixed lead distance
// ahead of the runner, drifting laterally toward his position.
const BLOCKER_COUNT = 9; // real Dynamic Kickoff formation -- the return team's blockers line up on their own 35, evenly spaced, not tied to the difficulty ladder
const BLOCKER_LINE_Z = -35; // yards downfield of the returner's own goal line
const BLOCKER_BASE_SPEED = 8.0; // yd/s -- between the runner's 8.5 and a chasing defender's base 7.5, so a blocker can actually catch a defender that's closing on the runner
const BLOCK_ENGAGE_DISTANCE = 2.75; // yards -- ballpark of the 2D game's own 3.5, tuned down for this game's already-tighter DEFENDER_TRIGGER_RANGE/TACKLE_RADIUS scale
const BLOCK_CONTACT_DISTANCE = 0.9; // yards -- how far apart engaged pair stand once snapped together, close enough to read as actually pushing each other rather than each holding wherever they happened to be (up to BLOCK_ENGAGE_DISTANCE apart) when the engage check passed
const BLOCK_HOLD_MIN = 1.5; // seconds -- how long a block holds a defender, before it resumes chasing. Bumped from 1.0-1.5 to 1.5-2.0, then widened to 1.5-2.5 to spread out when different blocks release relative to each other (a narrower range meant most of them let go in a tight cluster).
const BLOCK_HOLD_MAX = 2.5;
const BLOCKER_MAX_CHASE_DIST = 14; // yards -- beyond this a blocker ignores a defender and escorts instead of committing to a long chase
const BLOCKER_ESCORT_LEAD = 4; // yards ahead of the runner a non-engaged blocker tries to hold
// A released defender and the blocker that just held it are both still
// standing right on top of each other (neither one moved during the
// hold) -- without a cooldown, the very next frame's seeking pass finds
// the same pair back within BLOCK_ENGAGE_DISTANCE and re-engages
// instantly, which pins the defender in a near-permanent blocking loop
// instead of actually giving it a window to resume the chase. Found by
// sampling live state at 0.1s resolution during testing: holdElapsed hit
// holdDuration, flipped to 'seeking' for exactly one frame, then landed
// right back in 'blocking' against the same target on the next.
const BLOCK_COOLDOWN = 1.5; // seconds a just-released defender is immune to being re-blocked by anyone
const BLOCK_RELEASE_LATERAL_RANGE = 5; // yards -- if the runner drifts further than this laterally from where a block is happening, that defender no longer needs to fight through it to reach him, so release immediately rather than waiting out the hold timer

let blockers = [];

function clearBlockers() {
  blockers.forEach((b) => scene.remove(b.group));
  blockers = [];
}

function spawnBlockers(count) {
  clearBlockers();
  for (let i = 0; i < count; i++) {
    const group = new THREE.Group();
    let model, mixer = null, hipsBoneB = null, hipsBindPosB = null;
    if (blockerTemplate) {
      // Same SkeletonUtils.clone() pattern as defenders -- a plain
      // .clone() doesn't correctly duplicate a SkinnedMesh's skeleton.
      model = cloneSkinnedScene(blockerTemplate);
      model.rotation.y = Math.PI; // same base-facing correction as the runner/defender models
      mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(defenderRunClip).play(); // same shared running clip -- same Mixamo rig convention throughout
      mixer.timeScale = 0; // held on frame 0 until the catch -- see the matching defender comment above
      model.traverse((o) => { if (o.isBone && o.name === 'mixamorigHips') hipsBoneB = o; });
      hipsBindPosB = hipsBoneB ? hipsBoneB.position.clone() : null;
    } else {
      // Fallback if blocker.glb hasn't shipped yet or fails to load --
      // blue to read as distinct from the runner's own model and the red
      // defender-fallback capsules.
      model = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2255cc }));
      model.position.y = 1.0;
      model.castShadow = true;
    }
    group.add(model);
    scene.add(group);

    // Real Dynamic Kickoff formation: the return team's blockers line up
    // on their own 35, evenly spaced. `escortOffsetX` is kept as each
    // blocker's own lateral "lane" -- once play begins and a blocker has no
    // eligible defender to engage, it escorts by holding this same lane
    // relative to the runner's current position (see updateBlockers()).
    const escortOffsetX = evenLineX(i, count, FIELD_WIDTH / 2 - FORMATION_MARGIN);
    group.position.set(RUNNER_GROUP.position.x + escortOffsetX, 0, BLOCKER_LINE_Z);

    blockers.push({
      group, mixer, hipsBone: hipsBoneB, hipsBindPos: hipsBindPosB,
      escortOffsetX,
      state: 'seeking', // 'seeking' (find/engage a defender, or escort if none in range) | 'blocking' (holding an engaged defender)
      targetDefender: null,
      holdElapsed: 0, holdDuration: 0, engageRunnerX: 0,
    });
  }
}

// Called right after updateDefenders(dt), same phase === 'play' gating.
// Mixer/root-motion upkeep is separate (updateBlockerAnimations() below,
// called unconditionally) for the same reason defenders split the two.
function updateBlockers(dt) {
  for (const b of blockers) {
    if (b.state === 'blocking') {
      b.holdElapsed += dt;
      // Release if the hold window elapsed, OR the runner has drifted far
      // enough laterally AWAY FROM WHERE HE WAS WHEN THIS BLOCK STARTED
      // that it's no longer in his path (the defender doesn't need to
      // fight through it to reach him anymore -- let it go immediately
      // rather than waiting out the timer), OR the held defender left
      // 'blocked' some other way (e.g. a fresh return reset it) -- any of
      // these and this blocker is done here.
      //
      // Measured against b.engageRunnerX (captured at the moment of
      // engagement below), NOT the block's own x position -- the real
      // Dynamic Kickoff formation spreads blocks across the full ~49yd
      // width while the runner himself usually sits near center field, so
      // comparing to the block's own position made every wing block
      // "already out of play" the instant it engaged (a block at x=-18
      // failed `|0 - (-18)| > 5` immediately), releasing in ~0.02s instead
      // of its assigned 1.0-1.5s hold regardless of whether the runner
      // ever actually moved. Confirmed live before this fix: only blocks
      // that happened to engage within 5yd of a stationary center-field
      // runner ever held their full duration.
      const outOfPlay = Math.abs(RUNNER_GROUP.position.x - b.engageRunnerX) > BLOCK_RELEASE_LATERAL_RANGE;
      if (b.holdElapsed >= b.holdDuration || outOfPlay || !b.targetDefender || b.targetDefender.state !== 'blocked') {
        if (b.targetDefender && b.targetDefender.state === 'blocked') {
          b.targetDefender.state = 'chasing';
          b.targetDefender.blockedByBlocker = null;
          b.targetDefender.blockCooldown = BLOCK_COOLDOWN; // give it a real window to move before it can be re-engaged
          if (b.targetDefender.mixer && defenderRunClip) {
            b.targetDefender.mixer.stopAllAction();
            b.targetDefender.mixer.clipAction(defenderRunClip).setLoop(THREE.LoopRepeat).play();
            b.targetDefender.currentClipName = 'run';
          }
        }
        if (b.mixer && defenderRunClip) {
          b.mixer.stopAllAction();
          b.mixer.clipAction(defenderRunClip).setLoop(THREE.LoopRepeat).play();
        }
        b.state = 'seeking';
        b.targetDefender = null;
      }
      // Position/rotation were snapped to contact distance once, at the
      // moment of engagement (see below) -- neither one moves while
      // 'blocked'/'blocking', so there's nothing to re-hold here every
      // frame.
      continue;
    }

    // 'seeking': find the nearest defender that's actually a threat
    // (chasing/lunging, not already blocked/done) and not already
    // targeted by another blocker.
    let target = null, targetDist = Infinity;
    for (const d of defenders) {
      if (d.state !== 'chasing' && d.state !== 'lunging') continue;
      if (d.blockedByBlocker && d.blockedByBlocker !== b) continue;
      if (d.blockCooldown > 0) continue;
      const dist = Math.hypot(b.group.position.x - d.group.position.x, b.group.position.z - d.group.position.z);
      if (dist < targetDist) { targetDist = dist; target = d; }
    }

    if (target && targetDist <= BLOCKER_MAX_CHASE_DIST) {
      const dx = target.group.position.x - b.group.position.x;
      const dz = target.group.position.z - b.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= BLOCK_ENGAGE_DISTANCE) {
        // Engage: the defender stops dead (mirrors updateDefenders()'s own
        // early-skip for 'blocked'), the blocker holds here. The engage
        // check only guarantees they're within BLOCK_ENGAGE_DISTANCE (up
        // to 2.75yd), which read as each pushing air rather than each
        // other -- snap both to BLOCK_CONTACT_DISTANCE apart, symmetric
        // around wherever contact actually happened, facing each other.
        const ndx = dist > 1e-4 ? dx / dist : 0;
        const ndz = dist > 1e-4 ? dz / dist : 1;
        const midX = (b.group.position.x + target.group.position.x) / 2;
        const midZ = (b.group.position.z + target.group.position.z) / 2;
        const half = BLOCK_CONTACT_DISTANCE / 2;
        b.group.position.set(midX - ndx * half, 0, midZ - ndz * half);
        target.group.position.set(midX + ndx * half, 0, midZ + ndz * half);
        b.group.rotation.y = Math.atan2(ndx, ndz) + Math.PI; // blocker faces the defender
        target.group.rotation.y = Math.atan2(-ndx, -ndz) + Math.PI; // defender faces the blocker

        target.state = 'blocked';
        target.blockedByBlocker = b;
        b.state = 'blocking';
        b.targetDefender = target;
        b.holdElapsed = 0;
        b.holdDuration = BLOCK_HOLD_MIN + Math.random() * (BLOCK_HOLD_MAX - BLOCK_HOLD_MIN);
        b.engageRunnerX = RUNNER_GROUP.position.x; // reference point for the early-release drift check above -- where the RUNNER was, not where this block happened to be

        // Both play the push/shove clip for the duration of the hold
        // (looping -- it's a held struggle, not a one-shot) instead of
        // each just continuing to run in place, which read as two guys
        // jogging past each other rather than actually blocking.
        if (b.mixer && defenderPushClip) {
          b.mixer.stopAllAction();
          b.mixer.clipAction(defenderPushClip).setLoop(THREE.LoopRepeat).play();
        }
        if (target.mixer && defenderPushClip) {
          target.mixer.stopAllAction();
          target.mixer.clipAction(defenderPushClip).setLoop(THREE.LoopRepeat).play();
          target.currentClipName = 'push';
        }
      } else if (dist > 1e-4) {
        b.group.position.x += (dx / dist) * BLOCKER_BASE_SPEED * dt;
        b.group.position.z += (dz / dist) * BLOCKER_BASE_SPEED * dt;
        b.group.rotation.y = Math.atan2(dx, dz) + Math.PI;
      }
    } else {
      // No eligible defender in range -- escort: hold a fixed lead
      // distance ahead of the runner, drifting laterally toward his
      // current X (a simplified version of the 2D game's own
      // seek/escort duality).
      const targetX = RUNNER_GROUP.position.x + b.escortOffsetX;
      const targetZ = RUNNER_GROUP.position.z - BLOCKER_ESCORT_LEAD;
      const dx = targetX - b.group.position.x;
      const dz = targetZ - b.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-4) {
        b.group.position.x += (dx / dist) * BLOCKER_BASE_SPEED * dt;
        b.group.position.z += (dz / dist) * BLOCKER_BASE_SPEED * dt;
        b.group.rotation.y = Math.atan2(dx, dz) + Math.PI;
      }
    }
  }
}

// Mixer/root-motion upkeep for every blocker, called unconditionally every
// frame regardless of phase -- same reasoning as updateDefenderAnimations():
// otherwise a blocker keeps looping its run cycle frozen in place once
// phase leaves 'play'.
function updateBlockerAnimations(dt) {
  for (const b of blockers) {
    if (b.mixer) b.mixer.update(dt);
    if (b.hipsBone && b.hipsBindPos) b.hipsBone.position.copy(b.hipsBindPos);
  }
}

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
      mixer.timeScale = 0; // held on frame 0 until the returner catches the ball -- see the 'catch' -> 'play' transition in tick(), which sets this back to 1. Without this every defender would loop the run cycle in place for the whole pre-snap kickoff/hang/catch sequence, the same "running in place" bug already fixed twice for the post-play freeze.
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

    // Real Dynamic Kickoff formation: the kicking team lines up on the
    // receiving team's 40, evenly spaced across the field -- not staggered
    // downfield with random jitter like the old testing spawn.
    const spawnZ = DEFENDER_LINE_Z;
    const spawnX = evenLineX(i, count, FIELD_WIDTH / 2 - FORMATION_MARGIN);
    group.position.set(spawnX, 0, spawnZ);
    // Face the runner immediately -- otherwise a freshly-spawned defender
    // defaults to rotation.y=0, which (combined with the model's own base
    // Math.PI facing correction, same as the runner's) points him DOWNFIELD,
    // away from the returner, until the first chase-update frame corrects
    // it. Same atan2 formula the 'chasing' state uses every frame after.
    const toRunnerX = RUNNER_GROUP.position.x - spawnX, toRunnerZ = RUNNER_GROUP.position.z - spawnZ;
    group.rotation.y = Math.atan2(toRunnerX, toRunnerZ) + Math.PI;

    defenders.push({
      group, mixer, hipsBone: hipsBoneD, hipsBindPos: hipsBindPosD,
      speed: DEFENDER_BASE_SPEED * speedMultiplier,
      state: 'chasing', // 'chasing' | 'lunging' | 'recovering' | 'blocked' | 'done'
      lungeElapsed: 0, lungeTargetX: 0, lungeTargetZ: 0,
      recoverElapsed: 0,
      blockedByBlocker: null, // set by updateBlockers() while a blocker is holding this defender
      blockCooldown: 0, // seconds of immunity to a new block, set on release -- see BLOCK_COOLDOWN
      currentClipName: 'run', // debug-overlay visibility into push/flex/victory sequencing -- see triggerTackle()
    });
  }
}

// Chase/lunge/tackle state machine -- called once per frame, only while
// phase === 'play' (see the call site, which runs before the touchdown
// check so a same-frame tackle correctly pre-empts it). Animation upkeep
// (mixer/root-motion) is deliberately NOT in here -- see
// updateDefenderAnimations() below, called unconditionally every frame
// regardless of phase, so this function is never called twice in the same
// frame and mixers never advance by more than one dt.
function updateDefenders(dt) {
  for (const d of defenders) {
    if (d.blockCooldown > 0) d.blockCooldown -= dt;
    if (d.state === 'blocked') {
      // Held by a blocker -- see updateBlockers(), which owns the hold
      // timer and releases this back to 'chasing' itself. No movement, no
      // lunge trigger while held; this is what makes a block actually
      // stop the defender dead rather than just cosmetically slow it.
      continue;
    } else if (d.state === 'chasing') {
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
        // An active spin OR jump-cut gets a flat EVADE_CHANCE roll to turn
        // this into a miss instead -- see that constant's own comment.
        if ((spin || jumpCut) && Math.random() < EVADE_CHANCE) {
          d.state = 'recovering';
          d.recoverElapsed = 0;
        } else {
          d.state = 'done';
          triggerTackle(d);
        }
      } else if (d.lungeElapsed >= DEFENDER_LUNGE_DURATION) {
        d.state = 'recovering';
        d.recoverElapsed = 0;
      }
    } else if (d.state === 'recovering') {
      d.recoverElapsed += dt;
      if (d.recoverElapsed >= DEFENDER_RECOVER_DURATION) d.state = 'chasing';
    }
  }
}

// Mixer/root-motion upkeep for every defender, called exactly once per
// frame regardless of game phase -- unlike updateDefenders() above, this
// keeps running through the touchdown/tackled celebration so animations
// don't freeze on their first frame the instant phase leaves 'play'. Most
// importantly the tackling defender's flex (see triggerTackle()), but also
// keeps any still-chasing background defenders' run cycles alive rather
// than statue-freezing mid-stride while the camera holds on the result.
function updateDefenderAnimations(dt) {
  for (const d of defenders) {
    if (d.mixer) d.mixer.update(dt);
    if (d.hipsBone && d.hipsBindPos) d.hipsBone.position.copy(d.hipsBindPos);
  }
}

// ---- Kickoff sequence (kicker, ball flight, camera pan) -------------------
// Real Dynamic Kickoff: a kicker boots it from his own 35 while everyone
// else holds formation, the camera follows the ball toward the returner,
// and only once he catches it does the player-controlled return begin. New
// phases inserted before the existing 'play': 'kickoff' (run-up + kick,
// camera on the kicker) -> 'hang' (ball flight, camera pans then holds on
// the returner) -> 'catch' (catch animation, the carried-ball mesh baked into his own model is revealed) ->
// 'play' (unchanged from here on). See the phase branches in tick().
const KICKOFF_CONTACT_TIME = 0.55; // seconds into the kick clip's OWN timeline where the foot meets the ball -- same clip play-field-goal.js's own kicker uses, same empirically-found mark (see calibrateKickAnimation() there). Checked against the action's own .time, not real elapsed time, so it stays correct regardless of KICKOFF_TIME_SCALE.
const KICKOFF_TIME_SCALE = 0.6; // the raw clip reads as too fast for this run-up+kick to actually register -- played slower, opposite of this file's other *_TIME_SCALE constants (which all speed a slow capture up)
const KICKER_RUNUP_BACK = 3.5; // yards behind the true kick spot the kicker starts -- lets the clip's own baked run-up travel carry him roughly onto the mark by contact (playback speed doesn't change how FAR the root motion travels, just how long it takes). Tuned by eye, not calibrated like the field-goal kicker's variable-distance system: kickoff is always the one fixed distance, nothing to plan ahead for.
const HANG_TIME = 4.0; // seconds the ball is airborne
const CAMERA_PAN_DURATION = 2.8; // seconds -- the camera arrives at the returner well before the ball lands, same idea as a broadcast cutting to the return side early rather than panning for the whole flight
const BALL_PEAK_HEIGHT = 15; // yards -- how high the flight arc peaks
const CATCH_HEIGHT = 1.3; // yards -- roughly chest/hands height, where the ball "arrives" for the catch
const CATCH_ANTICIPATION = 0.85; // seconds before the ball actually arrives that the catch animation starts -- otherwise his hands only start rising AFTER the ball has already "landed" at his position, which read as catching something already in his hands rather than actually catching it. Tuned by feel: 0.6s too late, 1.3s too early, 0.9s slightly early, 0.8s a touch late.

let kicker = null; // THREE.Group, recreated each return -- see spawnKicker()
let kickerMixer = null;
let kickerAction = null; // tracked so tick()'s 'kickoff' branch can check its own clip-internal .time for the contact moment, independent of KICKOFF_TIME_SCALE
let kickerHipsBone = null;
let kickerHipsBindPos = null; // captured BEFORE the kick clip ever plays -- needed once he's promoted into a real defender (see promoteKickerToDefender()), which strips root motion back to this exact pose every frame like every other defender
let kickerSpeedMultiplier = 1; // stashed from spawnKicker()'s own argument, applied once he's promoted to a real defender
let kickerKickSpotZ = 0; // his own 35 -- kept even if the kicker itself failed to load, so the ball still has a sensible launch point (see kickOrigin())

function clearKicker() {
  if (kicker) scene.remove(kicker);
  kicker = null;
  kickerMixer = null;
  kickerAction = null;
  kickerHipsBone = null;
  kickerHipsBindPos = null;
}

// Reuses defenderTemplate (a defender-model kicker, per the user's own
// call) and player-kick.glb's baked run-up+kick clip (loaded for the
// runner's own mesh but its .animations were never read until now) --
// no new asset needed for either. speedMultiplier matches spawnDefenders()'s
// own argument -- stashed for when he's later promoted into a real
// defender (see promoteKickerToDefender()).
function spawnKicker(speedMultiplier) {
  clearKicker();
  kickerSpeedMultiplier = speedMultiplier;
  kickerKickSpotZ = -(fieldYards - 35);
  if (!defenderTemplate || !runnerKickClip) return; // graceful no-op, same fallback philosophy as the capsule placeholders -- just skips the visual kicker rather than showing a broken one; kickOrigin() below still gives the ball a sensible launch point, and tick()'s 'kickoff' branch falls straight through to 'hang' if there's no kickerAction to wait on
  const model = cloneSkinnedScene(defenderTemplate);
  model.rotation.y = Math.PI; // same fixed child-correction every character gets -- what varies is the GROUP's own rotation below
  const group = new THREE.Group();
  group.add(model);
  scene.add(group);
  kicker = group;
  // The kicker faces the OPPOSITE way from everyone else's "forward = -Z":
  // he needs to run/kick TOWARD the returner at z=0, i.e. toward +Z (he's
  // spawned deep at kickerKickSpotZ, a large negative z). Every other
  // character (runner, defenders, blockers) either IS the -Z-forward
  // convention or explicitly faces back toward the runner via its own
  // atan2 computation -- the kicker never got an equivalent correction, so
  // his root motion carried him further AWAY from the returner instead of
  // toward him. A group-level Math.PI on top of the model's own fixed
  // Math.PI cancels out to a net 0 (world-facing +Z), matching the same
  // atan2(dx,dz)+Math.PI convention used everywhere else in this file
  // evaluated for a target straight ahead in +Z.
  group.rotation.y = Math.PI;

  model.traverse((o) => { if (o.isBone && o.name === 'mixamorigHips') kickerHipsBone = o; });
  kickerHipsBindPos = kickerHipsBone ? kickerHipsBone.position.clone() : null; // captured NOW, before any animation plays -- promoteKickerToDefender() needs this exact bind pose to strip root motion later, same as every other defender

  kickerMixer = new THREE.AnimationMixer(model);
  kickerAction = kickerMixer.clipAction(runnerKickClip);
  kickerAction.setLoop(THREE.LoopOnce);
  kickerAction.clampWhenFinished = true;
  kickerAction.setEffectiveTimeScale(KICKOFF_TIME_SCALE);
  kickerAction.play();
  // Root motion is NOT stripped here, unlike defenders'/blockers' run
  // cycle -- this clip's whole point is the run-up travel, same reasoning
  // as why the runner's own tackle-fall clips skip stripRootMotion().

  group.position.set(0, 0, kickerKickSpotZ + KICKER_RUNUP_BACK);
}

// Once he's kicked it, the kicker becomes a real defender -- the last line
// of defense, per the user's own request. Reuses his EXISTING group/mixer
// (no new clone) and simply pushes a defender-shaped object onto the
// shared `defenders` array, so he gets the exact same chase/lunge/tackle
// state machine, the exact same block-interaction eligibility, and the
// exact same freeze-until-the-catch treatment as the other 10 -- nothing
// new to build. Starting ~20-25yd further back than the rest of the
// formation (his own 35 vs. their 40) is what naturally keeps him
// trailing as a last-ditch defender for most of the play, not a slower
// speed -- he moves at the same DEFENDER_BASE_SPEED as everyone else.
function promoteKickerToDefender() {
  if (!kicker || !kickerMixer) return; // no kicker (asset load failure) -- nothing to promote
  kickerMixer.stopAllAction();
  kickerMixer.clipAction(defenderRunClip).setLoop(THREE.LoopRepeat).play();
  kickerMixer.timeScale = 0; // held on frame 0 until the catch, same as every other defender -- see spawnDefenders()'s own comment
  defenders.push({
    group: kicker, mixer: kickerMixer, hipsBone: kickerHipsBone, hipsBindPos: kickerHipsBindPos,
    speed: DEFENDER_BASE_SPEED * kickerSpeedMultiplier,
    state: 'chasing',
    lungeElapsed: 0, lungeTargetX: 0, lungeTargetZ: 0,
    recoverElapsed: 0,
    blockedByBlocker: null,
    blockCooldown: 0,
    currentClipName: 'run',
  });
  // The defenders array now owns this group/mixer/bone (see
  // updateDefenderAnimations()) -- null every kicker-specific tracker so
  // updateKickerAnimation() stops updating the SAME mixer a second time
  // every frame, and nothing else in this file mistakes him for still
  // being "the kicker".
  kickerMixer = null;
  kickerAction = null;
  kicker = null;
  kickerHipsBone = null;
  kickerHipsBindPos = null;
}

// Unconditional per-frame mixer update, same pattern as
// updateDefenderAnimations()/updateBlockerAnimations() -- his
// follow-through keeps settling even after the camera pans away to the
// returner.
function updateKickerAnimation(dt) {
  if (kickerMixer) kickerMixer.update(dt);
}

// World position of the kicker's hips at this instant -- close enough to
// "the ball" for this game's fidelity, and simpler (and more accurate for
// this use) than pre-calibrating a run-up distance table the way
// play-field-goal.js's kicker does: that game needs to plan a run-up for a
// VARIABLE kick distance ahead of time, but a kickoff is always the one
// fixed distance, so there's nothing to plan for -- just read where he
// actually is the moment contact happens.
function kickOrigin() {
  const p = new THREE.Vector3();
  if (kickerHipsBone) kickerHipsBone.getWorldPosition(p);
  else p.set(0, CATCH_HEIGHT, kickerKickSpotZ); // fallback if the kicker itself failed to load
  return p;
}

// Camera framing for the 'kickoff' phase -- over-the-shoulder, same idea as
// snapCamera(), centered on the kicker instead of the runner. Mirrored
// (+/- flipped) from snapCamera()'s own formula because the kicker faces
// the OPPOSITE way (+Z, toward the returner -- see spawnKicker()'s own
// comment): "behind him" is the LOWER z (away from the returner), and
// "ahead of him" (what the camera looks toward) is the HIGHER z (toward
// the returner). Set once (not per-frame): the kicker's root motion is
// bone-local (see spawnKicker()'s comment), so the GROUP's own position,
// and therefore this framing, stays fixed for the whole run-up -- exactly
// how play-field-goal.js's own kick cam already works.
function snapCameraToKicker() {
  const z = kicker ? kicker.position.z : kickerKickSpotZ + KICKER_RUNUP_BACK;
  camera.position.set(0, CHASE_HEIGHT, z - CHASE_BACK - 0.5);
  camTarget.set(0, LOOK_HEIGHT, z + LOOK_AHEAD);
  camera.lookAt(camTarget);
}

let ball = null; // THREE.Mesh, scene-level only during 'hang' (the kick/flight) -- removed at the catch, handing off to heldBallMesh (baked into player-kick.glb itself, see the 'hang' phase branch in tick())
let ballStart = new THREE.Vector3();
let ballEnd = new THREE.Vector3();
let cameraPan = null; // { fromPos, fromTarget, toPos, toTarget } -- captured once at the 'kickoff' -> 'hang' transition, consumed by the 'hang' branch's per-frame lerp
let catchStarted = false; // the catch animation fires CATCH_ANTICIPATION seconds before the ball actually arrives, partway through 'hang' -- this just guards it firing once, see the 'hang' branch below

// A tackle or touchdown ends the carry -- heldBallMesh (rigidly skinned to
// his hand) goes invisible and a plain loose THREE.Mesh takes its place,
// falling to the ground under simple gravity. Same geometry/material as
// the kick-flight ball (SphereGeometry(0.11), scale (1,1,1.5), 0x8a4b26)
// for visual consistency, just not reusing that ball object itself since
// it's already long gone by the time anyone's tackled.
let droppedBall = null; // { mesh, vy, atRest } -- stays non-null (mesh still in-scene, just frozen) once it lands, so startReturn() has something to clean up; only reset to null there
const DROP_GRAVITY = 20; // yards/s^2 -- purely a "looks right" fall speed, not a real-world value
function dropBall() {
  if (!heldBallMesh || !heldBallMesh.visible) return; // already dropped (or never had it) this return -- don't spawn a second one
  const worldPos = new THREE.Vector3();
  heldBallMesh.getWorldPosition(worldPos);
  heldBallMesh.visible = false;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x8a4b26, roughness: 0.5 })
  );
  mesh.scale.set(1, 1, 1.5);
  mesh.castShadow = true;
  mesh.position.copy(worldPos);
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI); // tumbling out of his hand, not landing in some fixed orientation
  scene.add(mesh);
  droppedBall = { mesh, vy: 0, atRest: false };
}
const DROP_GROUND_Y = 0.1; // yards -- rests a hair above the actual turf plane (same reasoning as the kicked ball's own radius) rather than half-sunk into it
function updateDroppedBall(dt) {
  if (!droppedBall || droppedBall.atRest) return;
  droppedBall.vy -= DROP_GRAVITY * dt;
  droppedBall.mesh.position.y += droppedBall.vy * dt;
  droppedBall.mesh.rotation.x += dt * 6;
  droppedBall.mesh.rotation.z += dt * 4;
  if (droppedBall.mesh.position.y <= DROP_GROUND_Y) {
    droppedBall.mesh.position.y = DROP_GROUND_Y;
    droppedBall.atRest = true; // stop paying for per-frame updates -- mesh stays in the scene until startReturn() clears it
  }
}

// Which way he goes down depends on where the hit came from, relative to
// which way he's actually facing/running (RUNNER_GROUP's own local -Z,
// same "forward = -Z" convention as the rest of this file -- see
// getWorldDirection() below). 0deg = hit from directly in front, 180deg =
// hit from directly behind. Front/side (<=90deg, i.e. closer to in-front
// than to behind) gets the more dynamic "Falling Down"; anything past that,
// into the back half, gets tripped-from-behind "Fall Flat".
const TACKLE_ANGLE_FRONT_SIDE_MAX = Math.PI / 2;
function triggerTackle(defender) {
  if (phase !== 'play') return; // already resolved (e.g. reached the goal line the same frame) -- don't double-fire
  phase = 'tackled';
  downReason = 'tackled';
  phaseElapsed = 0;
  spin = null;
  jumpCut = null;

  const toDefender = new THREE.Vector3(defender.group.position.x - RUNNER_GROUP.position.x, 0, defender.group.position.z - RUNNER_GROUP.position.z);
  let fallAction = fallingDownAction; // default if either vector degenerates (defender exactly on top of him) -- front/side reads as the more neutral choice
  if (toDefender.lengthSq() > 1e-6) {
    toDefender.normalize();
    // Object3D.getWorldDirection() returns the world-space direction of the
    // object's local +Z axis -- (0,0,1) at yaw=0, verified empirically, NOT
    // this file's own "forward = -Z" convention (see the field-setup
    // comment near the top). Negate it to actually get his facing/travel
    // direction, or every angle here comes out backwards.
    const forward = RUNNER_GROUP.getWorldDirection(new THREE.Vector3()).negate();
    const angle = Math.acos(THREE.MathUtils.clamp(forward.dot(toDefender), -1, 1));
    fallAction = angle <= TACKLE_ANGLE_FRONT_SIDE_MAX ? fallingDownAction : fallFlatAction;
  }
  setActiveAction(fallAction || stopAction); // fall back to stopAction if either clip somehow failed to load
  if (activeAction) activeAction.paused = false;
  document.getElementById('kr3d-overlay-text').textContent = 'TACKLED';
  dropBall(); // jarred loose by the hit -- falls to the ground right where he was standing

  // The defender that actually made the hit gets his own moment -- swap his
  // mixer off the run cycle, onto the push (the moment of impact), then
  // once that finishes, onto the flex celebration. Only ever touches this
  // one defender's OWN mixer (each has its own, per spawnDefenders()).
  if (defender.mixer && defenderPushClip) {
    defender.mixer.stopAllAction();
    const pushAction = defender.mixer.clipAction(defenderPushClip);
    pushAction.setLoop(THREE.LoopOnce);
    pushAction.clampWhenFinished = true;
    pushAction.time = 0;
    pushAction.play();
    defender.currentClipName = 'push';
    const onPushFinished = (e) => {
      if (e.action !== pushAction) return;
      defender.mixer.removeEventListener('finished', onPushFinished);
      if (defenderFlexClip) {
        defender.mixer.stopAllAction();
        defender.mixer.clipAction(defenderFlexClip).setLoop(THREE.LoopRepeat).play();
        defender.currentClipName = 'flex';
      }
    };
    defender.mixer.addEventListener('finished', onPushFinished);
  } else if (defender.mixer && defenderFlexClip) {
    // Push clip missing for some reason -- fall straight to flex like
    // before rather than leaving him frozen on the run cycle.
    defender.mixer.stopAllAction();
    defender.mixer.clipAction(defenderFlexClip).setLoop(THREE.LoopRepeat).play();
    defender.currentClipName = 'flex';
  }

  // Every OTHER defender's position stops updating the instant phase
  // leaves 'play' (updateDefenders()'s state machine is gated to it), but
  // their mixer doesn't -- left alone they'd keep looping the run cycle
  // frozen in place, stuck mid-stride, which is what read as "running in
  // place." Switch them to the group celebration instead.
  for (const d of defenders) {
    if (d === defender || !d.mixer || !defenderVictoryClip) continue;
    d.mixer.stopAllAction();
    d.mixer.clipAction(defenderVictoryClip).setLoop(THREE.LoopRepeat).play();
    d.currentClipName = 'victory';
  }

  // Blockers didn't win either -- every one of them (mid-block or still
  // escorting) reacts with a sad idle instead of just freezing whatever
  // pose they were in.
  blockers.forEach((b) => {
    if (!b.mixer || !blockerSadIdleClip) return;
    b.mixer.stopAllAction();
    b.mixer.clipAction(blockerSadIdleClip).setLoop(THREE.LoopRepeat).play();
  });
}

// Stepping past the sideline ends the play immediately, same as a tackle
// (down over, yardage locked in, not a touchdown) -- but nobody actually
// hit him, so none of triggerTackle()'s fall/push/flex/victory choreography
// applies. He just pulls up and stands there with a discouraged look
// (outOfBoundsAction, the same sad-idle clip the blockers already react
// with) instead of playing a tackle-fall clip he wasn't tackled into.
// Reuses the exact 'tackled' phase/result-panel flow since mechanically
// it's the same "down ends here, not a touchdown" outcome -- only the
// animation and overlay text differ.
function triggerOutOfBounds() {
  if (phase !== 'play') return;
  phase = 'tackled';
  downReason = 'out of bounds';
  phaseElapsed = 0;
  spin = null;
  jumpCut = null;

  setActiveAction(outOfBoundsAction || stopAction);
  if (activeAction) activeAction.paused = false;
  document.getElementById('kr3d-overlay-text').textContent = 'OUT OF BOUNDS';

  // Same "nobody earned a celebration here" treatment the touchdown path
  // already gives defenders/blockers -- freeze each mixer right where it
  // is rather than playing a tackle reaction nobody actually made.
  defenders.forEach((d) => { if (d.mixer) d.mixer.timeScale = 0; });
  blockers.forEach((b) => { if (b.mixer) b.mixer.timeScale = 0; });
}

function tick(now) {
  // Clamped on BOTH ends: the upper bound guards against a huge dt after a
  // stall/tab-switch, the lower bound (added after a real production bug)
  // guards against a NEGATIVE dt on the very first frame after
  // startReturn() -- the rAF timestamp passed to this callback can land
  // slightly BEFORE the performance.now() reading startReturn() just took
  // for lastFrameAt (a known browser quirk: input-event-adjacent rAF
  // timestamps can predate a performance.now() call made in the same
  // handler), which is harmless for most of this file's own state (a
  // position nudged backward by a microscopic negative dt self-corrects
  // next frame) but is NOT harmless for a LoopOnce+clampWhenFinished
  // AnimationAction started on that exact first frame: three.js's own
  // LoopOnce handling treats time < 0 as "finished" and permanently pauses
  // it via clampWhenFinished, right at time=0 -- which is exactly the
  // kicker's own kick animation, started the instant startReturn() runs.
  // Confirmed live: kickerAction.paused was already true, time still 0, on
  // the very first frame -- a permanent freeze, not a slow one.
  const dt = Math.max(0, Math.min(0.05, (now - lastFrameAt) / 1000));
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
      // Used to clamp WELL inside the sideline (FIELD_WIDTH/2 - 1.5),
      // which meant he could never actually reach it, let alone cross it
      // -- there was no such thing as out of bounds. Now just a generous
      // backstop past the real sideline (FIELD_WIDTH/2): the OOB check
      // below (see triggerOutOfBounds()) ends the play the instant he
      // actually crosses the line, so this rarely even gets used -- it
      // only guards the couple of frames between crossing the line and
      // that check running, keeping him from sailing arbitrarily far into
      // the ground apron before the down ends.
      const lateralLimit = FIELD_WIDTH / 2 + 6;

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

      updateDefenders(dt); // can flip phase to 'tackled' (triggerTackle) -- guard the touchdown check below on phase still being 'play'. Mixer/root-motion upkeep is separate (updateDefenderAnimations(), called unconditionally further down) so it isn't skipped once phase leaves 'play'.
      updateBlockers(dt); // same gating as updateDefenders() -- can flip a defender to 'blocked', which the touchdown/tackle checks below don't need to special-case (a blocked defender just stops like any other 'chasing' one would have)
      updateRunningReferees(dt);

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
        triggerRefereeCelebration();
        dropBall(); // ball's down the instant he crosses the line, same as the real rule -- drops right there rather than waiting for the celebration dance to finish

        // Same "running in place" bug as the tackle path, on the other
        // branch: updateDefenders()'s state machine (movement) is gated to
        // phase === 'play', so every defender's POSITION freezes right here
        // -- but updateDefenderAnimations() (mixer upkeep) runs
        // unconditionally, so left alone they'd keep looping the run cycle
        // in place for the whole endzone/turn/dance celebration. Unlike a
        // tackle, nobody here "won" the play, so freezing each mixer's own
        // clock (whatever pose it happens to be on) reads better than
        // switching them to a celebration they didn't earn.
        defenders.forEach((d) => { if (d.mixer) d.mixer.timeScale = 0; });
        // Same fix, same reason, for blockers.
        blockers.forEach((b) => { if (b.mixer) b.mixer.timeScale = 0; });
      }

      if (phase === 'play' && Math.abs(RUNNER_GROUP.position.x) > FIELD_WIDTH / 2) {
        triggerOutOfBounds();
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
        finalizeCelebration(yardsGained, false, downReason);
      }
    } else if (phase === 'kickoff') {
      // Camera/kicker positioning already set once in startReturn() (see
      // snapCameraToKicker()) -- his root motion is bone-local, so nothing
      // here needs to track a moving group position. Just wait for contact,
      // checked against the ACTION's own clip-internal time (not real
      // elapsed time), so this stays correct under KICKOFF_TIME_SCALE. Falls
      // straight through if there's no kicker at all (asset load failure) --
      // nothing to wait on.
      if (!kickerAction || kickerAction.time >= KICKOFF_CONTACT_TIME) {
        ballStart.copy(kickOrigin());
        ballEnd.set(RUNNER_GROUP.position.x, CATCH_HEIGHT, RUNNER_GROUP.position.z);
        ball = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 16, 12),
          new THREE.MeshStandardMaterial({ color: 0x8a4b26, roughness: 0.5 })
        );
        ball.scale.set(1, 1, 1.5);
        ball.castShadow = true;
        ball.position.copy(ballStart);
        scene.add(ball);

        // Capture the camera's current (kicker) framing as the pan's
        // start, and the runner's normal snapCamera()-equivalent framing
        // (at his still-(0,0,0) position) as its end.
        cameraPan = {
          fromPos: camera.position.clone(),
          fromTarget: camTarget.clone(),
          toPos: new THREE.Vector3(RUNNER_GROUP.position.x, CHASE_HEIGHT, RUNNER_GROUP.position.z + CHASE_BACK),
          toTarget: new THREE.Vector3(RUNNER_GROUP.position.x, LOOK_HEIGHT, RUNNER_GROUP.position.z - LOOK_AHEAD),
        };
        promoteKickerToDefender(); // his job's done -- he's the last line of defense now, same as every other defender
        phase = 'hang';
        phaseElapsed = 0;
      }
    } else if (phase === 'hang') {
      const t = Math.min(1, phaseElapsed / HANG_TIME);
      ball.position.lerpVectors(ballStart, ballEnd, t);
      ball.position.y += BALL_PEAK_HEIGHT * 4 * t * (1 - t);

      // Pan finishes well inside the hang time (see CAMERA_PAN_DURATION's
      // own comment) -- once panT reaches 1 this just keeps re-copying the
      // same end framing every frame, which is harmless.
      const panT = easeOutCubic(Math.min(1, phaseElapsed / CAMERA_PAN_DURATION));
      camera.position.lerpVectors(cameraPan.fromPos, cameraPan.toPos, panT);
      camTarget.lerpVectors(cameraPan.fromTarget, cameraPan.toTarget, panT);
      camera.lookAt(camTarget);

      // Starts the catch animation a beat BEFORE the ball actually arrives
      // -- starting it exactly on arrival (the old behavior) meant his
      // hands only began rising once the ball was already "there", which
      // read as catching something already in his hands rather than
      // actually catching it.
      if (!catchStarted && catchAction && phaseElapsed >= HANG_TIME - CATCH_ANTICIPATION) {
        catchStarted = true;
        setActiveAction(catchAction);
        activeAction.paused = false;
      }

      if (phaseElapsed >= HANG_TIME) {
        // Caught -- the free-flying scene-level ball (used for the kick/
        // hang flight) is removed, and a SEPARATE ball baked directly into
        // player-kick.glb's own mesh takes over: 'HeldFootball', real
        // geometry weight-painted to mixamorig:RightHand alongside the
        // rest of the character (added in Blender, see memory for the
        // build script). This replaces TWO earlier attempts that bone-
        // parented a plain THREE.Mesh prop onto the forearm, then the hand
        // -- both eventually still clipped in the real in-game camera,
        // because a RIGID prop's fixed offset can't account for every
        // bone (wrist, fingers) that might rotate independently. Real
        // skinned geometry deforms WITH the hand's actual skin weights,
        // the same way his glove or jersey sleeve does, so it can't clip
        // against his own hand by construction -- there's no separate
        // "offset" to get wrong anymore.
        scene.remove(ball);
        if (heldBallMesh) heldBallMesh.visible = true;
        phase = 'catch';
        phaseElapsed = 0;
      }
    } else if (phase === 'catch') {
      // Holds until the catch clip itself finishes, then hands off to
      // 'play' -- unfreezing every defender/blocker mixer (see
      // spawnDefenders()/spawnBlockers()'s own timeScale=0 comment) and
      // the camera (celebrationCamFrozen, the same flag the touchdown
      // celebration uses to keep the unconditional runner-follow block at
      // the bottom of this function from fighting a deliberately-set
      // camera). No explicit action-swap needed here -- 'play''s own
      // isMoving/wasMoving logic already leaves activeAction on the caught
      // pose until the player's first input.
      //
      // Checked against the action's own .time (not phaseElapsed) -- the
      // clip actually started CATCH_ANTICIPATION seconds ago, back during
      // 'hang', so phaseElapsed alone would run short of the clip's real
      // remaining length.
      if (!catchAction || catchAction.time >= catchAction.getClip().duration - 1e-3) {
        phase = 'play';
        phaseElapsed = 0;
        celebrationCamFrozen = false;
        defenders.forEach((d) => { if (d.mixer) d.mixer.timeScale = 1; });
        blockers.forEach((b) => { if (b.mixer) b.mixer.timeScale = 1; });
      }
    }
    // 'dance' phase has nothing to drive here -- it just holds until
    // startDancePhase()'s own completion path (a timer for now, a
    // mixer 'finished' listener once real dance clips exist) calls
    // finalizeCelebration().

    updateBlend(dt);
    if (mixer) mixer.update(dt);
    updateDefenderAnimations(dt);
    updateBlockerAnimations(dt);
    updateKickerAnimation(dt);
    updateCheerleaderAnimations(dt);
    updateRefereeAnimations(dt);
    updateCameraman();
    updateCoaches(dt);
    updateSidelinePlayers(dt);
    updateSittingPlayers(dt);
    updateDroppedBall(dt);
    updateTeamDancers(dt);
    // Skipped during 'tackled': the fall clips' own baked root motion is
    // what actually drags him down to the ground -- stripping it every
    // frame like the run cycle needs would hold him rigidly standing
    // through the whole animation, defeating the point of playing it.
    if (phase !== 'tackled') stripRootMotion();
    if (activeAction === runRightTurnAction || activeAction === runLeftTurnAction) dampTurnLean();

    if (phase === 'play') {
      document.getElementById('kr3d-yards').textContent = `${Math.max(0, Math.round(fieldYards - (-RUNNER_GROUP.position.z)))} yards to go`;
    }

    if (debugEl) {
      const clipName = activeAction === runAction ? 'run' : activeAction === runRightTurnAction ? 'rightTurn' : activeAction === runLeftTurnAction ? 'leftTurn' : activeAction === rightStrafeAction ? 'rightStrafe' : activeAction === leftStrafeAction ? 'leftStrafe' : activeAction === spinLeftAction ? 'spinLeft' : activeAction === spinRightAction ? 'spinRight' : activeAction === jumpCutLeftAction ? 'jumpCutLeft' : activeAction === jumpCutRightAction ? 'jumpCutRight' : activeAction === fallingDownAction ? 'fallingDown' : activeAction === fallFlatAction ? 'fallFlat' : activeAction === stopAction ? 'stop' : activeAction === turn180Action ? 'turn180' : activeAction === catchAction ? 'catch' : 'dance';
      const defSummary = defenders.map((d, i) => `${i}:${d.state}/${d.currentClipName}@${Math.hypot(RUNNER_GROUP.position.x - d.group.position.x, RUNNER_GROUP.position.z - d.group.position.z).toFixed(1)}yd`).join(' ');
      const blockerSummary = blockers.map((b, i) => `${i}:${b.state}${b.targetDefender ? '->d' + defenders.indexOf(b.targetDefender) : ''}@${Math.hypot(RUNNER_GROUP.position.x - b.group.position.x, RUNNER_GROUP.position.z - b.group.position.z).toFixed(1)}yd`).join(' ');
      debugEl.textContent = `phase: ${phase}  held: [${[...heldKeys].join(', ')}]\nlateral: ${lateral}  movingForward: ${movingForward}  movingBackward: ${movingBackward}\nyaw: ${RUNNER_GROUP.rotation.y.toFixed(3)}  clip: ${clipName}  hasFocus: ${document.hasFocus()}\nfacingBackward: ${facingBackward}  turningAround: ${turningAround}  spin: ${spin ? spin.dir : '-'}  jumpCut: ${jumpCut ? jumpCut.dir : '-'}\npos: x=${RUNNER_GROUP.position.x.toFixed(3)} z=${RUNNER_GROUP.position.z.toFixed(3)}\ndefenders: ${defSummary || '(none)'}\nblockers: ${blockerSummary || '(none)'}`;
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
    // Not clamped -- see snapCamera()'s own comment on why the clamped
    // version was reverted (it froze the camera for the runner's first
    // few yards instead of trailing him, a worse regression).
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

function idleRenderTick() {
  if (running) return; // startReturn() has taken over via stopLoop()+tick()
  renderer.render(scene, camera);
  animationHandle = requestAnimationFrame(idleRenderTick);
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
  // Reset BEFORE spawning defenders/blockers -- they aim themselves at the
  // runner's position at spawn time (see spawnDefenders()/spawnBlockers()),
  // so this needs to already be his real starting spot, not whatever was
  // left over from the end of the previous return.
  spawnDefenders(DEFENDER_FORMATION_COUNT, returnConfig.defenderSpeed ?? 1); // ?? not || -- a legitimate 0 defenderSpeed shouldn't get silently overridden to 1
  spawnBlockers(BLOCKER_COUNT);
  spawnKicker(returnConfig.defenderSpeed ?? 1); // same speed multiplier as the rest of the defenders -- he's promoted into that same array once he's kicked it (see promoteKickerToDefender())
  if (ball) { if (ball.parent) ball.parent.remove(ball); ball = null; } // clear any leftover flying ball from the previous return
  if (heldBallMesh) heldBallMesh.visible = false; // hide the baked-in carried ball again until this return's own catch
  if (droppedBall) { scene.remove(droppedBall.mesh); droppedBall = null; } // clear any ball dropped during the previous return
  clearTeamDancers(); // clear any teammates from a previous return's Thriller celebration
  cameraPan = null;
  catchStarted = false;
  wasMoving = false;
  heldKeys.clear();
  // Reset directly rather than through setActiveAction() -- that always
  // unpauses whatever it switches to, which would start the run cycle
  // animating before the player has pressed anything.
  const allActions = [runAction, runRightTurnAction, runLeftTurnAction, rightStrafeAction, leftStrafeAction, spinLeftAction, spinRightAction, jumpCutLeftAction, jumpCutRightAction, fallingDownAction, fallFlatAction, stopAction, turn180Action, catchAction, outOfBoundsAction, breathingIdleAction, ...thrillerActions];
  finishBlend();
  spin = null;
  spinCooldown = 0;
  spinQueued = false;
  jumpCut = null;
  jumpCutCooldown = 0;
  jumpCutQueued = false;
  allActions.forEach((a) => { if (a) { a.paused = true; a.enabled = false; a.weight = 1; } });
  // Frame 0 of the run cycle is a mid-stride pose, not a standing one --
  // freezing there for the whole kickoff/hang wait read as him already
  // running in place before the ball even arrives. A first attempt held
  // stopAction's own last frame instead (still a mid-transition lunge,
  // checked directly), then outOfBoundsAction (a real standing-still
  // pose, but blockerSadIdleClip's own head-down posture read as
  // dejected/looking-down per live feedback). breathingIdleAction (the
  // user's own Mixamo "Breathing Idle" download) actually PLAYS here
  // (unpaused, LoopRepeat) rather than freezing a single frame -- unlike
  // the other candidates, this one is meant to loop continuously, so a
  // real idle animation is both correct AND the obvious choice over
  // picking a frame.
  if (breathingIdleAction) { breathingIdleAction.enabled = true; activeAction = breathingIdleAction; breathingIdleAction.time = 0; breathingIdleAction.paused = false; }
  else if (runAction) { runAction.enabled = true; activeAction = runAction; runAction.time = 0; }
  phase = 'kickoff';
  downReason = 'tackled';
  phaseElapsed = 0;
  // The kickoff/hang/catch sequence owns the camera (see snapCameraToKicker()
  // and the 'hang' phase's own pan) -- same escape hatch the touchdown
  // celebration uses to stop the unconditional runner-follow block at the
  // bottom of tick() from fighting a deliberately-set camera. Cleared once
  // 'catch' hands off to 'play'.
  celebrationCamFrozen = true;
  facingBackward = false;
  turningAround = false;
  resizeRenderer();
  snapCameraToKicker();
  renderer.render(scene, camera);

  document.getElementById('return-info').textContent = `Return ${returnConfig.index + 1} of ${returnsPerPlayer}`;
  document.getElementById('kr-result').textContent = '';
  document.getElementById('next-return-btn').style.display = 'none';
  document.getElementById('kr3d-yards').textContent = `${fieldYards} yards to go`;
  // No placeholder "Kickoff..." text/wait -- the real kick/hang/catch
  // sequence now conveys that on its own.
  document.getElementById('kr3d-overlay-text').textContent = '';

  running = true;
  lastFrameAt = performance.now();
  stopLoop();
  animationHandle = requestAnimationFrame(tick);
}

// ---- Team celebration: Thriller --------------------------------------
// Two teammates (blockerTemplate clones -- same team color as the runner)
// spawn up-field and run in to flank him, then all three dance the same
// loop in sync. Kept as its own self-contained unit (own spawn/run-in/
// camera logic) so more team celebrations are easy to add later.
let teamDancers = []; // [{ group, mixer, targetX, targetZ, dancing }] for the 2 teammates -- empty except during this celebration
let teamCelebrationStarted = false; // guards the synced Thriller kickoff (once both teammates arrive) from firing more than once
// Camera is a 60deg-vertical PerspectiveCamera at 16:9 -- half-horizontal-
// FOV works out to ~45.7deg (tan ~1.026), so the visible half-width at
// distance D is roughly D*1.026. The celebration camera sits
// (CELEBRATION_CAM_BACK + THRILLER_CAM_EXTRA_BACK) from the dancers, so
// this offset needs real margin past that, not just "a bit more than the
// visible edge" -- a first attempt at 9yd against an ~8.5yd camera
// distance (visible half-width ~8.7yd) was only marginally outside frame,
// which read as the teammates already being visible at spawn instead of
// running in from off-screen (live feedback: "spawned from like the back
// of the endzone instead of running from outside of the camera view").
// Live feedback, two rounds: (1) a lateral-only run-in (spawn level with the
// runner, slide in sideways) "still running in from behind where the player
// is" -- reads as emerging beside him, not running UP the field; (2) even
// after moving the spawn up-field, still looked like it was coming from the
// side rather than "at the 10 yard line... and run up from there" -- the
// lateral spawn offset was still doing most of the visual work. Fixed by
// dropping the lateral offset entirely: they now spawn at the literal
// 10-yard line (TEAM_DANCER_SPAWN_YARD_LINE), already at their final flank
// X, and run STRAIGHT up-field (Z only) to the celebration spot -- a real
// visible run up the field, not a diagonal or sideways one.
// That spawn point needs to sit in front of the celebration camera (not
// behind it, which pops them into frame already close -- see the git
// history on this file for the exact math this was first gotten wrong by).
// THRILLER_CAM_EXTRA_BACK bumped 4 -> 10 so the camera clears the 10-yard
// line with margin (camera ends up ~16yd up-field of the celebration spot,
// comfortably past the ~11yd-up-field 10-yard-line spawn).
const THRILLER_CAM_EXTRA_BACK = 10; // on top of CELEBRATION_CAM_BACK
const TEAM_DANCER_SPAWN_YARD_LINE = 10; // the actual 10-yard line, measured from the SCORING goal (same convention as kickerKickSpotZ elsewhere in this file)
const TEAM_DANCER_FLANK_OFFSET = 1.7; // yards either side of the runner once in position -- also the spawn X now, since there's no lateral run-in anymore
const TEAM_DANCER_RUNIN_SPEED = FORWARD_SPEED; // match the returner's own run speed, per request

function clearTeamDancers() {
  teamDancers.forEach((d) => scene.remove(d.group));
  teamDancers = [];
  teamCelebrationStarted = false;
  thrillerCamPan = null;
}

// Set once teamCelebrationStarted flips true (see updateTeamDancers() below)
// -- eases the WIDE run-up framing (needs the extra room for the 10-yard-
// line entrance to read) in to a closer final dance shot once they've
// actually arrived and there's no more run-up left to show. Live feedback:
// staying at the wide framing for the whole dance "moved back to the 10
// yard line instead of staying on the 5 yard line" -- the close framing
// below (CELEBRATION_CAM_BACK alone, no extra) lands almost exactly on the
// literal 5-yard line the user described.
let thrillerCamPan = null;
const THRILLER_DANCE_CAM_PAN_DURATION = 1.5; // seconds -- same eased-lerp technique as the kickoff sequence's own camera pan (see CAMERA_PAN_DURATION)

function startThrillerCelebration() {
  const z = RUNNER_GROUP.position.z; // his resting celebration spot -- both teammates run in to this same z
  const runnerX = RUNNER_GROUP.position.x;
  const spawnZ = -(fieldYards - TEAM_DANCER_SPAWN_YARD_LINE);
  [-1, 1].forEach((side) => {
    const model = cloneSkinnedScene(blockerTemplate);
    model.rotation.y = Math.PI; // same base-facing correction every character gets
    // Same hips-bone capture every other moving character in this file uses
    // (blockers/defenders/running referees) -- needed below to strip the
    // Thriller clip's own baked root motion once dancing starts, the same
    // way stripRootMotion() already does for the runner's own mixer (without
    // it, the mesh walks forward inside the clip every loop and snaps back
    // to the start on each repeat -- read as "disappearing and reappearing").
    let hipsBone = null;
    model.traverse((o) => { if (o.isBone && o.name === 'mixamorigHips') hipsBone = o; });
    const hipsBindPos = hipsBone ? hipsBone.position.clone() : null;
    const group = new THREE.Group();
    group.add(model);
    const targetX = runnerX + side * TEAM_DANCER_FLANK_OFFSET;
    group.position.set(targetX, 0, spawnZ); // already at the final flank X -- the run-in is a straight line up-field, not diagonal
    // Faces -Z (up-field, into the endzone -- the direction they're about to
    // run) via this template's usual atan2(dx,dz)+Math.PI convention
    // evaluated for a target straight ahead in -Z (dx=0): resolves to a flat
    // 0, not Math.PI. Snaps to Math.PI (facing the camera) only once arrived
    // -- see updateTeamDancers() below.
    group.rotation.y = 0;
    scene.add(group);
    const dancerMixer = new THREE.AnimationMixer(model);
    dancerMixer.clipAction(defenderRunClip).play(); // run-in clip, same shared one every defender/blocker already uses
    teamDancers.push({ group, mixer: dancerMixer, targetX, targetZ: z, hipsBone, hipsBindPos, dancing: false });
  });

  // Wider/further-back framing than the solo-celebration default -- three
  // dancers side by side (and now a visible run-up from the 10) need more
  // than the single-runner shot freezeCelebrationCamera() already set at
  // the 'endzone' transition.
  camera.position.set(runnerX, CELEBRATION_CAM_HEIGHT + 0.6, z + CELEBRATION_CAM_BACK + THRILLER_CAM_EXTRA_BACK);
  camTarget.set(runnerX, LOOK_HEIGHT + 0.3, z);
  camera.lookAt(camTarget);
}

// Unconditional per-frame upkeep (same pattern as updateDroppedBall etc.)
// -- advances each teammate's run-in, then starts the synced Thriller loop
// (all three mixers, same dt every frame -> stays in lockstep with zero
// manual sync) the instant both have actually arrived.
function updateTeamDancers(dt) {
  if (teamDancers.length === 0) return;
  teamDancers.forEach((d) => {
    if (!d.dancing) {
      // Straight line up-field (X is already at its final flank value, set
      // at spawn) -- a real visible run up the field, not a diagonal or
      // sideways one.
      const dz = d.targetZ - d.group.position.z;
      if (Math.abs(dz) > 0.05) {
        d.group.position.z += Math.sign(dz) * Math.min(Math.abs(dz), TEAM_DANCER_RUNIN_SPEED * dt);
      } else {
        d.group.position.z = d.targetZ;
        // Net 0 after cancelling the model's own PI correction -- faces +Z,
        // the same direction the runner ends his own 'turn' phase facing
        // (see that phase's own comment: spun to face the camera, which
        // reads as away from the cheerleaders, who are stationed deeper in -Z).
        d.group.rotation.y = Math.PI;
        d.dancing = true;
      }
    }
    d.mixer.update(dt);
    // Strips whichever clip's own baked root motion every frame (the
    // run-in clip during the chase up-field, the Thriller clip once
    // dancing), same as stripRootMotion() already does for the runner's
    // own mixer and updateDefenderAnimations() does for every defender --
    // without it the mesh walks forward inside the clip and snaps back to
    // the start on every loop (read live as the teammates "disappearing
    // and reappearing in the endzone").
    if (d.hipsBone && d.hipsBindPos) d.hipsBone.position.copy(d.hipsBindPos);
  });
  if (!teamCelebrationStarted && teamDancers.every((d) => d.dancing)) {
    teamCelebrationStarted = true;
    const runnerThrillerAction = thrillerActions[0];
    runnerThrillerAction.time = 0;
    runnerThrillerAction.enabled = true;
    runnerThrillerAction.paused = false;
    runnerThrillerAction.play();
    activeAction.paused = true;
    activeAction.enabled = false;
    activeAction = runnerThrillerAction;
    teamDancers.forEach((d) => {
      d.mixer.stopAllAction(); // cut cleanly from the run-in clip, no blend into the dance
      const a = d.mixer.clipAction(thrillerClips[0]);
      a.setLoop(THREE.LoopRepeat);
      a.play();
    });
    thrillerCamPan = { fromPos: camera.position.clone(), fromTarget: camTarget.clone(), elapsed: 0 };
  }
  // Eases the wide run-up framing in to the closer final dance shot -- see
  // thrillerCamPan's own comment above. Recomputes the close end-point
  // fresh every frame (cheap) rather than storing it, since the celebration
  // spot/runnerX are already stable by the time this fires.
  if (thrillerCamPan && thrillerCamPan.elapsed < THRILLER_DANCE_CAM_PAN_DURATION) {
    thrillerCamPan.elapsed += dt;
    const t = easeOutCubic(Math.min(1, thrillerCamPan.elapsed / THRILLER_DANCE_CAM_PAN_DURATION));
    const runnerX = RUNNER_GROUP.position.x;
    const z = teamDancers[0].targetZ;
    const toPos = new THREE.Vector3(runnerX, CELEBRATION_CAM_HEIGHT + 0.6, z + CELEBRATION_CAM_BACK);
    const toTarget = new THREE.Vector3(runnerX, LOOK_HEIGHT + 0.3, z);
    camera.position.lerpVectors(thrillerCamPan.fromPos, toPos, t);
    camTarget.lerpVectors(thrillerCamPan.fromTarget, toTarget, t);
    camera.lookAt(camTarget);
  }
}

// Always runs the team celebration now -- the old random pick against a
// pool of solo dances was removed per a direct ask ("just do this thriller
// dance, I'll add more team celebrations as I go"). Once more team
// celebrations exist, this is where a random pick among THEM would go.
// If the team celebration isn't ready yet (assets still loading), skips
// straight to finalizing -- the 'turn' phase's about-face is still a
// complete-feeling celebration on its own.
function startDancePhase() {
  const teamCelebrationReady = thrillerActions.length === THRILLER_MODEL_PATHS.length && blockerTemplate && defenderRunClip;
  if (!teamCelebrationReady) {
    finalizeCelebration(fieldYards, true);
    return;
  }
  startThrillerCelebration();
  // Gives the run-in and the first few synced beats time to actually read
  // before the result panel shows up, since the dance only starts looking
  // like "a celebration" once both teammates have arrived.
  wait(2600).then(() => finalizeCelebration(fieldYards, true));
}

// Takes the actual outcome now instead of assuming a touchdown -- the
// 'tackled' phase branch above calls this too, with wherever he actually
// got to and touchdown: false. Both paths share the same submit/result-panel
// plumbing; only the reported outcome and the result text differ.
async function finalizeCelebration(yardsGained, touchdown, downReasonLabel = 'tackled') {
  // Deliberately does NOT stopLoop()/set running=false -- if a dance is
  // playing it keeps looping behind the result panel; the loop only
  // actually stops when startReturn() resets things for the next attempt.

  // "TOUCHDOWN!"/"TACKLED" stays up through the whole celebration now -- it
  // only gets overwritten when the next return's "Kickoff..." message shows
  // (see startReturn()), not cleared here.

  try {
    const { outcome } = await api('POST', `/api/game-instances/${instanceId}/kickoff-return/submit`, { memberId, yardsGained, touchdown });
    const resultEl = document.getElementById('kr-result');
    const nonTouchdownLabel = downReasonLabel === 'out of bounds' ? 'Out of bounds after' : 'Tackled after';
    resultEl.textContent = outcome.touchdown
      ? `Touchdown! ${outcome.yardsGained} yards — +${outcome.points.toFixed(1)} points`
      : `${nonTouchdownLabel} ${outcome.yardsGained} yards — +${outcome.points.toFixed(1)} points`;
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
  // A wider, higher establishing shot for the idle "about to start" screen
  // rather than reusing snapCamera()'s own tight over-the-shoulder chase
  // framing -- that framing looks toward -Z from right behind the
  // returner's start, which puts the entire near-end stand (behind him,
  // at positive Z) out of frame entirely, so the idle screen showed empty
  // field/sky with no stadium visible at all. This sits further back and
  // higher, still on the field side of the near stand, so the stand shows
  // in frame above/behind the returner while still looking down the
  // field.
  camera.position.set(0, 10, 12);
  camera.lookAt(0, 3, -50);
  // A persistent per-frame render, not a one-shot renderer.render() call --
  // the stadium's own GLTF models load asynchronously well after this
  // point, and a one-shot render can easily fire before either finishes,
  // permanently freezing the idle screen on a stadium-less frame (nothing
  // else repaints it until Start Return kicks off the real game loop).
  // This mirrors tick()'s own rAF chain (same animationHandle/stopLoop(),
  // so starting a real return cleanly cancels it) but does nothing except
  // redraw the current (idle) camera/scene every frame until `running`
  // flips true -- cheap, since nothing here is animating, and it means
  // the idle screen just naturally shows whatever finished loading by
  // the next real paint frame instead of needing every future
  // async-loaded piece of scenery to remember to trigger its own render.
  idleRenderTick();

  // Don't show (or act on) "Start Return" until the character models are
  // actually ready -- see charactersLoaded's own comment for the race this
  // closes. The idle screen keeps rendering (idleRenderTick(), already
  // running) while this awaits, so there's no dead/frozen moment -- just
  // a beat before the button appears, instead of a button that can start
  // a return still missing its defenders/blockers.
  await charactersLoaded;

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
