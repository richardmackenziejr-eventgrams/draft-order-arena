// Characters for Two-Minute Drill: loads the player models and animation clips we already have
// (the same Mixamo-rigged models used in Kickoff Return and Field Goal Kick), and wraps each
// player in a small Actor that blends between clips (idle / run / strafe / stance / push / catch /
// fall / ...) and drives them around the field.
//
// Everything is a Mixamo skeleton whose raw model faces +Z, so a player at yaw 0 faces +Z (toward
// his own goal line) and yaw PI faces -Z (downfield).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const MODEL_SCALE = 1.12; // same as the kicker in Field Goal Kick, so everyone is the same size across games

const MODEL_URLS = {
  qb: '/models/player-kick.glb',   // the blue #1 -- the player's own quarterback
  wr: '/models/blocker.glb',       // blue teammates (receivers, running back)
  ol: '/models/lineman.glb',       // blue offensive line
  dl: '/models/dlineman.glb',      // red defensive line
  db: '/models/defender.glb',      // red linebackers and defensive backs
};
const CLIP_URLS = {
  run: 'running', idle: 'breathing-idle', stance: 'football-stance', push: 'push', catch: 'catch',
  fall: 'falling-down', strafeL: 'left-strafe', strafeR: 'right-strafe', victory: 'victory', flex: 'flex', sad: 'sad-idle',
};
// Clips that lower the body (a crouch, a diving catch, a fall): their hips motion is applied as an
// offset from the clip's first frame so the player sinks without sliding off his mark. Every other
// clip has its hips pinned (movement is driven by code, not baked root motion).
const HIPS_OFFSET_CLIPS = ['stance', 'fall', 'catch'];
const OPTIONAL_CLIPS = { throw: '/models/qb-throw.glb' }; // a real Mixamo "Quarterback Pass", if one has been added

const loadGltf = (url) => new Promise((resolve) => {
  new GLTFLoader().load(url, resolve, undefined, (err) => { console.error(`${url} failed to load`, err); resolve(null); });
});

// Resolves to { tpl: {qb, wr, ol, dl, db}, clips: {...}, hipsOffset: {...} } once every file is in.
// A missing model/clip comes back null; the game checks tpl before it starts.
export async function loadDrillAssets() {
  const tplKeys = Object.keys(MODEL_URLS), clipKeys = Object.keys(CLIP_URLS);
  const [tplGltfs, clipGltfs, optional] = await Promise.all([
    Promise.all(tplKeys.map((k) => loadGltf(MODEL_URLS[k]))),
    Promise.all(clipKeys.map((k) => loadGltf(`/models/${CLIP_URLS[k]}.glb`))),
    Promise.all(Object.entries(OPTIONAL_CLIPS).map(async ([k, url]) => {
      try { const head = await fetch(url, { method: 'HEAD' }); if (!head.ok) return [k, null]; } catch (e) { return [k, null]; }
      const g = await loadGltf(url); return [k, g && g.animations[0] ? g.animations[0] : null];
    })),
  ]);
  const tpl = {}, clips = {}, hipsOffset = {};
  tplKeys.forEach((k, i) => {
    const g = tplGltfs[i];
    tpl[k] = g ? g.scene : null;
    if (g) g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } if (o.name === 'HeldFootball') o.visible = false; });
  });
  clipKeys.forEach((k, i) => { clips[k] = clipGltfs[i] && clipGltfs[i].animations[0] ? clipGltfs[i].animations[0] : null; });
  optional.forEach(([k, clip]) => { if (clip) clips[k] = clip; });
  HIPS_OFFSET_CLIPS.forEach((k) => {
    const clip = clips[k];
    const track = clip && clip.tracks.find((t) => t.name === 'mixamorigHips.position');
    if (track) { const interp = track.createInterpolant(); hipsOffset[k] = { interp, first: Array.from(interp.evaluate(0)), duration: clip.duration }; }
  });
  return { tpl, clips, hipsOffset };
}

// Drops animation tracks whose bone doesn't exist on this rig so three.js doesn't warn per track.
const clipCache = new Map();
function clipFor(model, key, clip) {
  const cacheKey = key + '|' + clip.uuid;
  let c = clipCache.get(cacheKey);
  if (!c) {
    c = new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((t) => model.getObjectByName(t.name.split('.')[0])));
    clipCache.set(cacheKey, c);
  }
  return c;
}

const ONE_SHOTS = new Set(['catch', 'fall', 'victory', 'flex', 'throw']);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerpAngle = (a, b, k) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; };

export class Actor {
  // kind: 'qb' | 'wr' | 'ol' | 'dl' | 'db'. clipNames: which of the loaded clips this player needs.
  constructor(assets, kind, scene, clipNames) {
    this.kind = kind;
    this.assets = assets;
    this.group = new THREE.Group();
    this.model = cloneSkinned(assets.tpl[kind]);
    this.model.scale.setScalar(MODEL_SCALE);
    this.group.add(this.model);
    scene.add(this.group);
    this.pos = this.group.position;

    let hips = null, rightArm = null, rightFore = null;
    this.model.traverse((o) => {
      if (o.isBone && o.name === 'mixamorigHips') hips = o;
      if (o.isBone && o.name === 'mixamorigRightArm') rightArm = o;
      if (o.isBone && o.name === 'mixamorigRightForeArm') rightFore = o;
    });
    this.hips = hips;
    this.hipsBind = hips ? hips.position.clone() : null;
    this.rightArm = rightArm; this.rightFore = rightFore;
    this.armBind = rightArm ? rightArm.rotation.clone() : null;
    this.foreBind = rightFore ? rightFore.rotation.clone() : null;

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    this.weights = {};
    for (const name of clipNames) {
      const clip = assets.clips[name];
      if (!clip) continue;
      const a = this.mixer.clipAction(clipFor(this.model, kind, clip));
      a.setLoop(ONE_SHOTS.has(name) ? THREE.LoopOnce : THREE.LoopRepeat);
      if (ONE_SHOTS.has(name)) a.clampWhenFinished = true;
      a.play();
      a.enabled = false;
      this.actions[name] = a;
      this.weights[name] = 0;
    }
    if (this.actions.stance) this.actions.stance.paused = true; // held by hand: stanceT sets its time
    this.stanceT = assets.hipsOffset.stance ? assets.hipsOffset.stance.duration : 0;

    this.active = this.actions.idle ? 'idle' : null;
    this.override = null;   // a named clip forced on (stance, push, catch, fall, ...), or null = locomotion
    this.overrideFade = 0.15;
    this.yaw = 0;
    this.speed = 0;         // current ground speed (yd/s), set by whoever moves this player
    this.back = false;      // moving backward while facing forward
    this.strafe = 0;        // -1 left, +1 right, 0 none (facing forward)
    this.throwU = -1;       // procedural throw pose progress (0..1), -1 = off
    this.fade = 0.15;
    this.snapNext = true;   // first frame: jump straight to the target weights
  }

  place(x, z, yaw) {
    this.pos.set(x, 0, z);
    if (yaw != null) { this.yaw = yaw; this.group.rotation.y = yaw; }
    this.speed = 0; this.back = false; this.strafe = 0;
  }

  // Smoothly turn to face a direction (a yaw in radians), k = how quickly.
  turnTo(yaw, dt, rate = 12) { this.yaw = lerpAngle(this.yaw, yaw, 1 - Math.exp(-rate * dt)); this.group.rotation.y = this.yaw; }
  faceXZ(x, z, dt, rate) { this.turnTo(Math.atan2(x - this.pos.x, z - this.pos.z), dt, rate); }

  play(name, { fade = 0.12, timeScale = 1, restart = true } = {}) {
    const a = this.actions[name];
    if (!a) return;
    this.override = name;
    this.overrideFade = fade;
    a.timeScale = timeScale;
    if (restart) a.reset();
  }
  clearOverride() { this.override = null; }

  step(dt) {
    // 1. which clip should be on?
    let target = this.override;
    if (!target) {
      if (this.speed > 0.5 && this.actions.run) target = this.strafe !== 0 && this.actions[this.strafe < 0 ? 'strafeL' : 'strafeR'] ? (this.strafe < 0 ? 'strafeL' : 'strafeR') : 'run';
      else target = this.actions.idle ? 'idle' : null;
    }
    this.active = target;
    const fade = this.override ? this.overrideFade : this.fade;

    // 2. clip speeds follow how fast the player is really moving
    if (this.actions.run) this.actions.run.timeScale = (this.back ? -1 : 1) * clamp(this.speed / 8.5, 0.35, 1.5);
    if (this.actions.strafeL) this.actions.strafeL.timeScale = clamp(this.speed / 5, 0.5, 1.4);
    if (this.actions.strafeR) this.actions.strafeR.timeScale = clamp(this.speed / 5, 0.5, 1.4);
    if (this.actions.stance) this.actions.stance.time = this.stanceT;

    // 3. blend weights toward the target
    for (const k of Object.keys(this.weights)) {
      const goal = k === target ? 1 : 0;
      const w = this.weights[k];
      const step = this.snapNext ? 1 : dt / fade;
      this.weights[k] = w + clamp(goal - w, -step, step);
      const a = this.actions[k];
      a.enabled = this.weights[k] > 0.001;
      a.setEffectiveWeight(this.weights[k]);
    }
    this.snapNext = false;

    this.mixer.update(dt);

    // 4. hips: pinned to the bind pose, plus the crouch/fall/catch offsets
    if (this.hips) {
      this.hips.position.copy(this.hipsBind);
      for (const k of HIPS_OFFSET_CLIPS) {
        const w = this.weights[k], off = this.assets.hipsOffset[k];
        if (!off || !(w > 0.001)) continue;
        const t = k === 'stance' ? this.stanceT : this.actions[k].time;
        const v = off.interp.evaluate(clamp(t, 0, off.duration));
        this.hips.position.x += (v[0] - off.first[0]) * w;
        this.hips.position.y += (v[1] - off.first[1]) * w;
        this.hips.position.z += (v[2] - off.first[2]) * w;
      }
    }

    // 5. the quarterback's throwing arm, when no real throw clip is loaded: cock back, then whip forward
    if (this.throwU >= 0 && this.rightArm && !this.actions.throw) {
      const u = clamp(this.throwU, 0, 1);
      const cock = u < 0.55 ? u / 0.55 : 1;                       // arm goes up and back
      const swing = u < 0.55 ? 0 : (u - 0.55) / 0.45;             // then swings forward and down
      this.rightArm.rotation.set(this.armBind.x - 2.3 * cock + 1.5 * swing, this.armBind.y, this.armBind.z - 0.5 * cock * (1 - swing));
      if (this.rightFore) this.rightFore.rotation.set(this.foreBind.x, this.foreBind.y, this.foreBind.z + (-1.2 * cock + 1.2 * swing));
    }
  }
}
