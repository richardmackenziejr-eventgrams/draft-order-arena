// Shared stadium/field for games that want the Kickoff Return look: the
// striped grass field with yard lines, hash marks, sidelines, painted yard
// numbers, navy "HOME" endzones, pylons, goalposts, and the Rodin crowd
// stands (straight tiles + curved corners on a concrete riser) all the way
// around.
//
// Ported from public/js/play-kickoff-return-3d.js (field/endzone/stand code),
// which keeps its own copy -- that file also hangs referees, cameramen, coaches,
// benches and cheerleaders off the same constants, so it was left untouched.
// If the field's look changes, change both.
//
// Built in the field's own frame (same as Kickoff Return): forward = -Z,
// lateral = X, "own" goal line at z=0, opponent goal line at z=-lengthYards,
// endzones ENDZONE_DEPTH beyond each. createStadium() puts that frame in a
// root Group shifted so the OPPONENT goal line lands on `goalLineZ`, so a
// game can drop the field into its own world coordinates (1 unit = 1 yard).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const FIELD_WIDTH = 53.3;
export const ENDZONE_DEPTH = 10;
export const SIDELINE_INSET = 1;
export const UPRIGHT_HALF_SPAN = 2.82;
export const CROSSBAR_Y = 3.05;
export const UPRIGHT_TOP_Y = 8.5;
const GOALPOST_LINE_CLEARANCE = 0.5;
// Distance from a goal line back to the goalpost (which sits just behind the
// back-of-endzone line).
export const GOALPOST_SETBACK = ENDZONE_DEPTH + GOALPOST_LINE_CLEARANCE;

const ENDZONE_FILL_COLOR = 0x0a2f6b;
const ENDZONE_TEXT_FILL = 0x1c4fa8;
const PYLON_COLOR = 0xff4400;
const PYLON_WIDTH = 0.15;
const PYLON_HEIGHT = 0.5;
const YARD_NUMBER_X = FIELD_WIDTH / 2 - SIDELINE_INSET - 13;
const YARD_NUMBER_PLANE_W = 5.5;
const YARD_NUMBER_PLANE_H = YARD_NUMBER_PLANE_W * (280 / 640);
const YARD_NUMBER_LINE_OFFSET = 2.6;

// ---- Stands (see the matching section of play-kickoff-return-3d.js for the
// long history of why each of these numbers is what it is) -----------------
const STAND_HEIGHT = 8;
const STAND_MODEL_BBOX = { w: 1.8945350050926208, h: 0.5554050207138062, d: 0.9296950101852417 };
const STAND_MODEL_SCALE = STAND_HEIGHT / STAND_MODEL_BBOX.h;
const STAND_MODEL_TILE_LEN = STAND_MODEL_BBOX.w * STAND_MODEL_SCALE;
const STAND_MODEL_FRONT_LOCAL_Z = 0.4630330204963684;
const STAND_MODEL_FRONT_OFFSET = STAND_MODEL_FRONT_LOCAL_Z * STAND_MODEL_SCALE;
const CORNER_BBOX_H = 0.6803219318389893;
const CORNER_SCALE = STAND_HEIGHT / CORNER_BBOX_H;
const CORNER_FRONT_OFFSET = 11.17;
const SIDELINE_RUNOFF = 5;
const STAND_WIDTH_DELTA = (FIELD_WIDTH / 2) - 15 + SIDELINE_RUNOFF;
const STAND_ELEVATION = 2;
const ENDZONE_STAND_SETBACK = 20 * (2 / 3) + 5;

const RISER_MAT = new THREE.MeshStandardMaterial({ color: 0x8c8c8a, roughness: 0.95 });
const RISER_CAP_MAT = new THREE.MeshStandardMaterial({ color: 0xb0b0ac, roughness: 0.8 });
const RISER_BASE_MAT = new THREE.MeshStandardMaterial({ color: 0x2e2e2c, roughness: 0.95 });
const RISER_CAP_HEIGHT = 0.25;
const RISER_CAP_OVERHANG = 0.4;
const RISER_BASE_HEIGHT = 0.35;

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

// Painted numerals: glyph top points toward midfield, every number but the 50
// carries a small triangle pointing at the nearer goal line.
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

// scene: THREE.Scene (or any Object3D) to add the stadium to.
// lengthYards: goal line to goal line (100 for a real field).
// goalLineZ: world Z where the OPPONENT (-Z end) goal line should land.
// Returns { root, goalpostZ } -- goalpostZ is the world Z of the -Z goalpost.
export function createStadium(scene, { lengthYards = 100, goalLineZ = -lengthYards } = {}) {
  const root = new THREE.Group();
  root.position.z = goalLineZ + lengthYards; // local opponent goal line (z=-lengthYards) -> goalLineZ
  scene.add(root);

  // ---- Field ----------------------------------------------------------------
  const groundApron = new THREE.Mesh(
    new THREE.PlaneGeometry(300, lengthYards + 120),
    new THREE.MeshStandardMaterial({ color: 0x2f6b3f, roughness: 0.95 })
  );
  groundApron.rotation.x = -Math.PI / 2;
  groundApron.position.set(0, -0.05, -lengthYards / 2);
  groundApron.receiveShadow = true;
  root.add(groundApron);

  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_WIDTH, lengthYards + 20),
    new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.95 })
  );
  field.rotation.x = -Math.PI / 2;
  field.position.set(0, 0, -lengthYards / 2);
  field.receiveShadow = true;
  root.add(field);

  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let z = 0; z > -lengthYards; z -= 5) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_WIDTH - 2, 0.15), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.01, z);
    root.add(line);
  }
  const goalLine = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_WIDTH - 2, 0.3), lineMat);
  goalLine.rotation.x = -Math.PI / 2;
  goalLine.position.set(0, 0.011, -lengthYards);
  root.add(goalLine);

  [-(lengthYards + ENDZONE_DEPTH), ENDZONE_DEPTH].forEach((z) => {
    const backLine = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_WIDTH - 2, 0.3), lineMat);
    backLine.rotation.x = -Math.PI / 2;
    backLine.position.set(0, 0.011, z);
    root.add(backLine);
  });

  const sidelineGeo = new THREE.PlaneGeometry(0.3, lengthYards + ENDZONE_DEPTH * 2);
  [-1, 1].forEach((side) => {
    const sideline = new THREE.Mesh(sidelineGeo, lineMat);
    sideline.rotation.x = -Math.PI / 2;
    sideline.position.set(side * (FIELD_WIDTH / 2 - SIDELINE_INSET), 0.01, -lengthYards / 2);
    root.add(sideline);
  });

  // Hash marks: one InstancedMesh for the whole field (a tick every yard, both sides).
  const HASH_OFFSET = 3.1;
  const hashMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.15, 0.7), lineMat, Math.floor(lengthYards) * 2);
  hashMesh.rotation.x = -Math.PI / 2;
  const m = new THREE.Matrix4();
  let idx = 0;
  for (let z = 0; z > -lengthYards; z -= 1) {
    for (const x of [-HASH_OFFSET, HASH_OFFSET]) {
      m.makeTranslation(x, -z, 0.01); // instance transforms live in the mesh's own unrotated XY plane
      hashMesh.setMatrixAt(idx++, m);
    }
  }
  root.add(hashMesh);

  // ---- Yard numbers -----------------------------------------------------------
  {
    const texCache = {};
    const getTex = (text, arrow) => (texCache[text + '|' + arrow] ||= yardNumberTexture(text, arrow));
    const geo = new THREE.PlaneGeometry(YARD_NUMBER_PLANE_W, YARD_NUMBER_PLANE_H);
    for (let yd = 10; yd < lengthYards; yd += 10) {
      const label = Math.min(yd, lengthYards - yd);
      const isMid = yd * 2 === lengthYards;
      const lineZ = -yd;
      const goalDir = isMid ? 0 : (yd < lengthYards / 2 ? 1 : -1); // world-z direction toward the nearer goal line
      [-1, 1].forEach((side) => {
        const textRightDir = side < 0 ? 1 : -1;
        const arrow = isMid ? null : (textRightDir === goalDir ? 'right' : 'left');
        const mat = new THREE.MeshBasicMaterial({ map: getTex(String(label), arrow), transparent: true });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        const holder = new THREE.Group();
        holder.add(mesh);
        holder.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
        holder.position.set(side * YARD_NUMBER_X, 0.012, lineZ + -goalDir * (isMid ? 0 : YARD_NUMBER_LINE_OFFSET));
        root.add(holder);
      });
    }
  }

  // ---- Endzone fill + "HOME" lettering -----------------------------------------
  {
    const fillMat = new THREE.MeshStandardMaterial({ color: ENDZONE_FILL_COLOR, roughness: 0.95 });
    const textTex = endzoneTextTexture('HOME', `#${ENDZONE_TEXT_FILL.toString(16).padStart(6, '0')}`, '#ffffff');
    const textMat = new THREE.MeshBasicMaterial({ map: textTex, transparent: true });
    [-(lengthYards + ENDZONE_DEPTH / 2), ENDZONE_DEPTH / 2].forEach((z) => {
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_WIDTH - SIDELINE_INSET * 2, ENDZONE_DEPTH), fillMat);
      fill.rotation.x = -Math.PI / 2;
      fill.position.set(0, 0.005, z);
      fill.receiveShadow = true;
      root.add(fill);

      const TEXT_WIDTH = ENDZONE_DEPTH * 3.2;
      const TEXT_HEIGHT = TEXT_WIDTH * (220 / 1024);
      const text = new THREE.Mesh(new THREE.PlaneGeometry(TEXT_WIDTH, TEXT_HEIGHT), textMat);
      text.rotation.x = -Math.PI / 2;
      text.position.set(0, 0.006, z);
      root.add(text);
    });
  }

  // ---- Pylons ---------------------------------------------------------------------
  {
    const pylonMat = new THREE.MeshStandardMaterial({ color: PYLON_COLOR, roughness: 0.5 });
    const pylonGeo = new THREE.BoxGeometry(PYLON_WIDTH, PYLON_HEIGHT, PYLON_WIDTH);
    const sidelineX = FIELD_WIDTH / 2 - SIDELINE_INSET;
    [0, ENDZONE_DEPTH, -lengthYards, -(lengthYards + ENDZONE_DEPTH)].forEach((z) => {
      [-1, 1].forEach((side) => {
        const pylon = new THREE.Mesh(pylonGeo, pylonMat);
        pylon.position.set(side * sidelineX, PYLON_HEIGHT / 2, z);
        pylon.castShadow = true;
        root.add(pylon);
      });
    });
  }

  // ---- Goalposts ------------------------------------------------------------------
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffd400, roughness: 0.4, metalness: 0.2 });
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
    root.add(post);
  }
  addGoalpost(GOALPOST_SETBACK);
  addGoalpost(-(lengthYards + GOALPOST_SETBACK));

  // ---- Stands -----------------------------------------------------------------------
  const standGroup = new THREE.Group();
  root.add(standGroup);
  let straightGltf = null;
  let cornerGltf = null;

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

  function addStandStraightTile(x, z, rotationY) {
    const tile = straightGltf.scene.clone();
    tile.scale.setScalar(STAND_MODEL_SCALE);
    tile.rotation.y = rotationY;
    tile.position.set(x, STAND_ELEVATION, z);
    standGroup.add(tile);
    addRiser(x, z, STAND_MODEL_TILE_LEN, STAND_MODEL_BBOX.d * STAND_MODEL_SCALE, rotationY);
  }

  // `flip` turns the whole corner 180 so the near end's corners face back toward the field.
  function addStandCornerTile(x, z, mirror, flip) {
    const tile = cornerGltf.scene.clone();
    tile.scale.set(CORNER_SCALE * mirror, CORNER_SCALE, CORNER_SCALE);
    addRiser(x, z, CORNER_FRONT_OFFSET * 2.2, CORNER_FRONT_OFFSET * 2.2);
    if (flip) tile.rotation.y = Math.PI;
    if (mirror < 0) {
      // The corner is a single right-handed L, so the left one needs a real mirror (negative X
      // scale). That flips winding order, so the copy needs double-sided materials.
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

  function buildStands() {
    if (!straightGltf || !cornerGltf) return;
    standGroup.clear();

    const CORNER_X = 12.8 + STAND_WIDTH_DELTA;
    const SIDELINE_ANCHOR_X = 16 + STAND_WIDTH_DELTA;

    // Far (-Z) end
    const farFrontZ = -(lengthYards + ENDZONE_STAND_SETBACK);
    const farBackZ = farFrontZ - STAND_MODEL_FRONT_OFFSET;
    const farCornerZ = farFrontZ - CORNER_FRONT_OFFSET;
    addStandStraightTile(0, farBackZ, 0);
    addBackStandFlankingTiles(farBackZ, 0, CORNER_X);
    addStandCornerTile(CORNER_X, farCornerZ, 1, false);
    addStandCornerTile(-CORNER_X, farCornerZ, -1, false);

    // Near (+Z) end: the same assembly turned 180, left/right mirror signs swapped to compensate.
    const nearFrontZ = ENDZONE_STAND_SETBACK;
    const nearBackZ = nearFrontZ + STAND_MODEL_FRONT_OFFSET;
    const nearCornerZ = nearFrontZ + CORNER_FRONT_OFFSET;
    addStandStraightTile(0, nearBackZ, Math.PI);
    addBackStandFlankingTiles(nearBackZ, Math.PI, CORNER_X);
    addStandCornerTile(CORNER_X, nearCornerZ, -1, true);
    addStandCornerTile(-CORNER_X, nearCornerZ, 1, true);

    // One long straight-tile chain per sideline between the two ends' corners.
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

  new GLTFLoader().load('/models/stadium-stand.glb', (gltf) => {
    straightGltf = gltf;
    buildStands();
  }, undefined, (err) => console.error('stadium stand model load failed', err));
  new GLTFLoader().load('/models/stadium-corner.glb', (gltf) => {
    cornerGltf = gltf;
    buildStands();
  }, undefined, (err) => console.error('stadium corner model load failed', err));

  return { root, goalpostZ: goalLineZ - GOALPOST_SETBACK };
}
