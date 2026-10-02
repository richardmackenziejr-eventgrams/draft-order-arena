// Cheerleaders and photographers for the far (-Z) end of a stadium.js field --
// ported from the Kickoff Return game's own sideline crew (same models, same
// spots), minus everything behind a kick cam looking at that end: only the
// far endzone, its two sidelines and the far half-field are populated.
//
//   * Two cheer squads (two staggered rows each) in the grass strip behind the
//     back-of-endzone line, one either side of the goalpost.
//   * A single cheer row along EACH sideline from the 35-yard line down through
//     the endzone to its back line (facing the field).
//   * Two kneeling photographers at the back corners, plus standing
//     photographers at the 10 and 25-yard lines on both sidelines.
//   * Every photographer turns in place to follow whatever you pass to update().
//
// Everything is added to `root` (stadium.js's field frame: -Z is the far end,
// opponent goal line at z=-lengthYards), so it moves with the field.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedScene } from 'three/addons/utils/SkeletonUtils.js';
import { FIELD_WIDTH, ENDZONE_DEPTH, SIDELINE_INSET } from '/js/stadium.js';

const CHEERLEADER_COUNT = 4;

function evenLineX(index, count, halfSpan) {
  if (count <= 1) return 0;
  return -halfSpan + (index * (2 * halfSpan)) / (count - 1);
}

export function createSidelineCrew(root, { lengthYards = 100 } = {}) {
  const cheerTemplates = [null, null, null, null];
  let cheerClip = null;
  let cameramanTemplate = null;
  let standingCameramanTemplate = null;

  const cheerGroup = new THREE.Group();
  const cameramanGroup = new THREE.Group();
  root.add(cheerGroup, cameramanGroup);
  let cheerMixers = [];
  let cameramen = [];

  function buildCheerleaders() {
    cheerGroup.clear();
    cheerMixers = [];
    if (!cheerClip) return; // a T-posed cheerleader frozen in place would look broken -- wait for the clip too

    const addCheerleader = (i, x, z, rotationY) => {
      const template = cheerTemplates[i % CHEERLEADER_COUNT];
      if (!template) return;
      const model = cloneSkinnedScene(template);
      model.rotation.y = rotationY;
      model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(cheerClip).play();
      mixer.setTime(Math.random() * cheerClip.duration); // stagger so they don't cheer in lockstep
      model.position.set(x, 0, z);
      cheerGroup.add(model);
      cheerMixers.push(mixer);
    };

    // Squads behind the endzone: raw Mixamo orientation already faces +Z (back at the field).
    const CHEER_ROW_SETBACKS = [12, 17]; // yd past the goal line -- clear grass between the back line and the stands
    const CHEER_GROUP_CENTER_X = 13;
    const CHEER_FRONT_ROW_COUNT = 8;
    const CHEER_ROW_GAP = 2;
    [1, -1].forEach((side) => {
      CHEER_ROW_SETBACKS.forEach((setback, rowIndex) => {
        const z = -(lengthYards + setback);
        const staggered = rowIndex === 1; // one extra body so the back row lands between the front row's
        const rowCount = staggered ? CHEER_FRONT_ROW_COUNT + 1 : CHEER_FRONT_ROW_COUNT;
        const halfSpread = (CHEER_ROW_GAP * (rowCount - 1)) / 2;
        for (let i = 0; i < rowCount; i++) {
          addCheerleader(i, side * (CHEER_GROUP_CENTER_X + evenLineX(i, rowCount, halfSpread)), z, 0);
        }
      });
    });

    // Sideline rows, 35-yard line to the back of the endzone, turned to face the field.
    const SIDELINE_X = FIELD_WIDTH / 2 + 2.3;
    const startZ = -(lengthYards - 35);
    const endZ = -(lengthYards + ENDZONE_DEPTH);
    const GAP = 2;
    const count = Math.round(Math.abs(endZ - startZ) / GAP) + 1;
    [-1, 1].forEach((sign) => {
      const facingY = sign < 0 ? Math.PI / 2 : -Math.PI / 2;
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        addCheerleader(i, sign * SIDELINE_X, startZ + (endZ - startZ) * t, facingY);
      }
    });
  }

  function buildCameramen() {
    cameramanGroup.clear();
    cameramen = [];
    const place = (template, x, z) => {
      const model = template.clone();
      model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      model.position.set(x, 0, z);
      cameramanGroup.add(model);
      cameramen.push(model);
    };

    if (cameramanTemplate) {
      // Kneeling: at each back corner, pulled back off the back line. (Kickoff Return also has one
      // by the near upright, but the field goal's post-kick camera sits right behind it, so it's left out.)
      place(cameramanTemplate, FIELD_WIDTH / 2 - SIDELINE_INSET - 2, -(lengthYards + ENDZONE_DEPTH + 3));
      place(cameramanTemplate, -(FIELD_WIDTH / 2 - SIDELINE_INSET - 2), -(lengthYards + ENDZONE_DEPTH + 3));
    }
    if (standingCameramanTemplate) {
      // Standing: 10 and 25-yard lines of the far half, both sidelines, just behind the sideline.
      [10, 25].forEach((yard) => {
        [-1, 1].forEach((sign) => {
          place(standingCameramanTemplate, sign * (FIELD_WIDTH / 2 + 1), -(lengthYards - yard));
        });
      });
    }
  }

  const loadFail = (what) => (err) => console.error(`${what} failed to load`, err);
  for (let i = 0; i < CHEERLEADER_COUNT; i++) {
    new GLTFLoader().load(`/models/cheerleader-${i + 1}.glb`, (gltf) => {
      cheerTemplates[i] = gltf.scene;
      buildCheerleaders();
    }, undefined, loadFail(`cheerleader ${i + 1} model`));
  }
  new GLTFLoader().load('/models/cheer-cheering.glb', (gltf) => {
    cheerClip = gltf.animations[0];
    buildCheerleaders();
  }, undefined, loadFail('cheer animation'));
  new GLTFLoader().load('/models/cameraman.glb', (gltf) => {
    cameramanTemplate = gltf.scene;
    buildCameramen();
  }, undefined, loadFail('cameraman model'));
  new GLTFLoader().load('/models/standing-cameraman.glb', (gltf) => {
    standingCameramanTemplate = gltf.scene;
    buildCameramen();
  }, undefined, loadFail('standing cameraman model'));

  const local = new THREE.Vector3();
  return {
    // dt: seconds since the last frame. target: world-space point the photographers should follow.
    update(dt, target) {
      for (const m of cheerMixers) m.update(dt);
      if (!target) return;
      local.copy(target);
      root.worldToLocal(local);
      for (const model of cameramen) {
        const dx = local.x - model.position.x;
        const dz = local.z - model.position.z;
        if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) model.rotation.y = Math.atan2(dx, dz); // models' raw orientation faces +Z
      }
    },
  };
}
