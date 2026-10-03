// The line of scrimmage for Field Goal Kick:
//   * 7 offensive linemen (blue) and 7 defensive linemen (red) set facing each
//     other 7 yards in front of the ball. They never break through.
//   * Two "original" red players (the defender model) at the ends of the
//     defensive line, and two "original" blue players (the blocker model)
//     standing behind the offensive line toward its outside ends.
//
//   * A holder (the original blue model) kneeling beside the ball's spot, frozen at the
//     start of the Football Hike clip until the ball is snapped to him; he catches it,
//     sets it down on its spot, and holds that final pose through the kick. The ball sits
//     on the ground at the line of scrimmage until the hike, then flies back to him.
//
// On the hike the linemen stand up and push; each red edge player rises and
// charges the outside end of the line while the blue player behind it runs up
// to meet him, and the two lock up in a block. They stay engaged until ONE of
// the reds (alternating end each kick) breaks free at BREAK_FREE_AT -- the
// beaten blocker goes down, the red swings wide and reaches the ball just after
// a kick finished at the block deadline would be struck. The other pair stays
// locked up. If the kick is struck before the break, that red never breaks
// free: the block simply holds. After arriving, the breaker celebrates if the
// kick was blocked (Flex) or hangs his head if not (Sad Idle).
//
// Everything is a pure function of `hikeT` (seconds since the hike, or null
// before it), so a page reload mid-play drops straight back into the right
// moment instead of replaying from the start.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const LOS_YARDS_AHEAD = 7; // line of scrimmage sits this far in front of the ball (the holder's depth)
const LINEMEN_PER_SIDE = 7;
const LINEMEN_SPACING = 1.2;      // yards between neighbors
const LINE_HALF_GAP = 0.45;       // each line stands this far to its side of the LOS (so ~0.9yd between the two lines)
const MODEL_SCALE = 1.12;         // same scale as the kicker model, so everyone reads the same size

const RISE_DURATION = 0.9;        // seconds for a lineman to stand up out of his stance
const PUSH_BLEND = 0.25;          // seconds to crossfade from standing into pushing
const RUN_SPEED = 7.5;            // yards/second, for the charge into the block

// Edge players
const RED_START_X = 4.8;          // yards off center -- just outside the end of the defensive line
const BLUE_START_X = 3.7;         // behind the offensive line, toward its outside end
const BLUE_START_BEHIND = 3.0;    // yards behind the LOS (the ball is 7 back)
const ENGAGE_X = 4.7;             // where each pair locks up: just outside the end of the offensive line...
const ENGAGE_AHEAD = 1.7;         // ...this far on the kicker's side of the LOS
const CONTACT_HALF = 0.45;        // each stands this far from the contact point (~0.9yd apart)
const RED_DELAY = 0.05;           // seconds after the hike before the reds react
const RED_RISE = 0.45;            // seconds for a red to come up out of his stance
const SHED_DURATION = 0.3;        // seconds the breaker spends throwing off the blocker before he runs
const WAYPOINT_X = 6.0;           // the breaker swings wide of the line...
const WAYPOINT_AHEAD = 3.5;       // ...to this far past the LOS before cutting in at the ball
const END_SHORT = 0.55;           // stops this far from the ball

const FADE = 0.2; // seconds for a weight to swing between clips

// Holder / snap. The Mixamo Football Hike clip is ~3.3s of mocap; played at HIKE_SPEED
// it's a believable ~1.4s from snap to the ball being set down.
const HIKE_SPEED = 2.4;
const HIKE_CATCH_CLIP_T = 1.35;   // clip-seconds at which his hands close on the ball
const HIKE_PLACE_CLIP_T = 2.1;    // clip-seconds by which the ball is down
const SNAP_AT = 0.05;             // seconds after the hike the ball leaves the center
const BALL_PRE_Y = 0.115;         // ball lying on the ground at the LOS
export const BALL_REST_Y = 0.19;  // ball set down on its spot (upright, a hair off the turf under the holder's fingers)

// Moment (seconds after the hike) the breaking red gets free. Deliberately a bit
// before the block deadline: the beaten blocker goes down, the red runs a wide arc,
// and reaches the ball just after contact of a kick finished at the deadline.
export function breakFreeAt(blockTimeSec) { return blockTimeSec - 0.8; }
// A kick resolved exactly at the deadline makes contact ~0.66s later (see
// PLAYBACK_DURATION_MS * CONTACT/SEQUENCE_END in play-field-goal.js); he arrives just after.
export function arriveAt(blockTimeSec, contactDelaySec = 0.66) { return blockTimeSec + contactDelaySec + 0.15; }

const smooth = (x) => x * x * (3 - 2 * x);
const lerpAngle = (a, b, k) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
};

// Drops animation tracks whose bone doesn't exist on this rig (the 33-bone
// player rigs vs. a 41-bone clip) so three.js doesn't log a warning per track.
const clipCache = new Map();
function clipFor(model, templateKey, clip) {
  const key = templateKey + '|' + clip.uuid;
  let c = clipCache.get(key);
  if (!c) {
    const tracks = clip.tracks.filter((t) => model.getObjectByName(t.name.split('.')[0]));
    c = new THREE.AnimationClip(clip.name, clip.duration, tracks);
    clipCache.set(key, c);
  }
  return c;
}

// Interpolant over a clip's hips translation, plus its first frame, so a pose can
// be applied as an OFFSET from where the clip began (lowers the body into a
// crouch/fall without shifting it off its mark).
function hipsOffsetOf(clip) {
  const track = clip.tracks.find((t) => t.name === 'mixamorigHips.position');
  if (!track) return null;
  const interp = track.createInterpolant();
  return { interp, first: Array.from(interp.evaluate(0)) };
}

export function createFieldGoalLine(scene, { blockTimeSec = 5.0 } = {}) {
  const loader = (url) => new Promise((res) => new GLTFLoader().load(url, res, undefined, (err) => { console.error(url + ' failed to load', err); res(null); }));
  const group = new THREE.Group();
  scene.add(group);

  let assets = null;
  let chars = [];
  let spot = { x: 0, z: 0 };
  let breakerSide = 1;       // which end (+1 / -1 in x) has the red who breaks free this kick
  let rushOutcome = null;    // null | 'blocked' | 'late'
  let breakCancelled = false; // kick struck before the break: the block just holds
  let pairs = {};            // per side: start/engagement points and the breaker's route
  let holderChar = null;
  let holderEnd = { x: 0, z: 0 }; // where his left hand ends up when he's at the origin facing -Z (used to put his hand over the ball's spot)
  let ballObj = null;        // the game's football, moved here until the kick is struck
  let ballControlled = true;
  const BREAK_AT = breakFreeAt(blockTimeSec);
  const ARRIVE_AT = arriveAt(blockTimeSec);

  const loadedPromise = Promise.all([
    loader('/models/lineman.glb'), loader('/models/dlineman.glb'),
    loader('/models/defender.glb'), loader('/models/blocker.glb'),
    loader('/models/football-stance.glb'), loader('/models/push.glb'), loader('/models/running.glb'),
    loader('/models/flex.glb'), loader('/models/sad-idle.glb'),
    loader('/models/breathing-idle.glb'), loader('/models/falling-down.glb'), loader('/models/football-hike.glb'),
  ]).then(([ol, dl, red, blue, stance, push, run, flex, sad, idle, fall, hike]) => {
    if (![ol, dl, red, blue, stance, push, run, flex, sad, idle, fall, hike].every(Boolean)) return; // a missing piece just means no line -- the kick still plays
    assets = {
      ol: ol.scene, dl: dl.scene, red: red.scene, blue: blue.scene,
      stance: stance.animations[0], push: push.animations[0], run: run.animations[0],
      flex: flex.animations[0], sad: sad.animations[0], idle: idle.animations[0], fall: fall.animations[0],
      hike: hike.animations[0],
    };
    assets.stanceOffset = hipsOffsetOf(assets.stance);
    assets.fallOffset = hipsOffsetOf(assets.fall);
    [assets.ol, assets.dl, assets.red, assets.blue].forEach((t) => t.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } }));
    build();
  }).catch((err) => console.error('field goal line failed to build', err));

  function makeChar(templateKey, template, clipNames, loops) {
    const model = cloneSkinned(template);
    model.scale.setScalar(MODEL_SCALE);
    const holder = new THREE.Group();
    holder.add(model);
    group.add(holder);

    let hips = null;
    model.traverse((o) => { if (o.isBone && o.name === 'mixamorigHips') hips = o; });
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const name of clipNames) {
      const a = mixer.clipAction(clipFor(model, templateKey, assets[name]));
      a.setLoop(loops[name] || THREE.LoopRepeat);
      if (loops[name] === THREE.LoopOnce) a.clampWhenFinished = true;
      a.play();
      a.enabled = false;
      actions[name] = a;
    }
    if (actions.stance) actions.stance.paused = true; // its time is set by hand every frame
    if (actions.fall) actions.fall.timeScale = 3; // the raw clip is slow for a block that's just been beaten
    const ch = {
      holder, model, mixer, hips, actions, hipsBind: hips ? hips.position.clone() : null,
      weights: {}, active: null, delay: 0, stanceTime: assets.stance.duration, yaw: 0,
    };
    Object.keys(actions).forEach((k) => { ch.weights[k] = 0; });
    return ch;
  }

  function build() {
    chars.forEach((c) => group.remove(c.holder));
    chars = [];
    const rand = (i) => ((i * 7919) % 13) / 13; // stable pseudo-random, so a given lineman always reacts a hair differently
    const lineClips = ['stance', 'push'];
    for (let i = 0; i < LINEMEN_PER_SIDE; i++) {
      const ol = makeChar('ol', assets.ol, lineClips, {});
      Object.assign(ol, { role: 'ol', index: i, delay: rand(i) * 0.1, baseYaw: Math.PI }); // faces -Z, toward the posts
      const dl = makeChar('dl', assets.dl, lineClips, {});
      Object.assign(dl, { role: 'dl', index: i, delay: rand(i + 5) * 0.1, baseYaw: 0 });   // faces +Z, toward the kicker
      chars.push(ol, dl);
    }
    const redLoops = { stance: THREE.LoopOnce, flex: THREE.LoopOnce };
    const blueLoops = { fall: THREE.LoopOnce };
    [1, -1].forEach((s) => {
      const red = makeChar('red', assets.red, ['stance', 'push', 'run', 'flex', 'sad'], redLoops);
      Object.assign(red, { role: 'red', side: s });
      const blue = makeChar('blue', assets.blue, ['idle', 'run', 'push', 'fall'], blueLoops);
      Object.assign(blue, { role: 'blue', side: s });
      chars.push(red, blue);
    });
    holderChar = makeChar('blue', assets.blue, ['hike'], { hike: THREE.LoopOnce });
    Object.assign(holderChar, { role: 'holder' });
    holderChar.actions.hike.paused = true; // its time is set by hand: frozen at 0 until the hike, then driven by hikeT
    holderChar.holder.rotation.y = Math.PI; // faces -Z, toward the line, to take the snap
    holderChar.yaw = Math.PI;
    chars.push(holderChar);
    measureHolder();
    layout();
    applyFrame(0, null);
  }

  // With the holder at the origin in his final pose, where is his left hand (the one
  // that ends up over the ball)? layout() then slides him so that point sits on the ball's spot.
  function measureHolder() {
    const c = holderChar;
    c.holder.position.set(0, 0, 0);
    c.holder.rotation.y = Math.PI;
    c.actions.hike.enabled = true;
    c.actions.hike.setEffectiveWeight(1);
    c.actions.hike.time = assets.hike.duration;
    c.mixer.update(0);
    c.holder.updateMatrixWorld(true);
    const lh = boneOf(c, 'mixamorigLeftHand');
    const v = new THREE.Vector3();
    if (lh) lh.getWorldPosition(v);
    holderEnd = { x: v.x, z: v.z };
  }

  function boneOf(c, name) {
    if (!c.boneCache) c.boneCache = {};
    if (!(name in c.boneCache)) { let b = null; c.model.traverse((o) => { if (o.name === name) b = o; }); c.boneCache[name] = b; }
    return c.boneCache[name];
  }

  function layout() {
    if (!assets) return;
    const losZ = spot.z - LOS_YARDS_AHEAD;
    chars.forEach((c) => {
      if (c.role === 'ol' || c.role === 'dl') {
        const x = spot.x + (c.index - (LINEMEN_PER_SIDE - 1) / 2) * LINEMEN_SPACING;
        c.holder.position.set(x, 0, c.role === 'ol' ? losZ + LINE_HALF_GAP : losZ - LINE_HALF_GAP);
      }
    });
    if (holderChar) holderChar.holder.position.set(spot.x - holderEnd.x, 0, spot.z - holderEnd.z);
    pairs = {};
    [1, -1].forEach((s) => {
      const redStart = new THREE.Vector3(spot.x + s * RED_START_X, 0, losZ - LINE_HALF_GAP);
      const blueStart = new THREE.Vector3(spot.x + s * BLUE_START_X, 0, losZ + BLUE_START_BEHIND);
      const engR = new THREE.Vector3(spot.x + s * ENGAGE_X, 0, losZ + ENGAGE_AHEAD - CONTACT_HALF);
      const engB = new THREE.Vector3(spot.x + s * ENGAGE_X, 0, losZ + ENGAGE_AHEAD + CONTACT_HALF);
      const way = new THREE.Vector3(spot.x + s * WAYPOINT_X, 0, losZ + WAYPOINT_AHEAD);
      const end = new THREE.Vector3(spot.x + s * END_SHORT, 0, spot.z - END_SHORT);
      // Charge-in timing: the red comes up out of his stance and runs to the contact
      // point; the blue leaves his spot so both arrive together.
      const redRun = redStart.distanceTo(engR) / RUN_SPEED;
      const engageT = RED_DELAY + RED_RISE + redRun;
      const blueRun = blueStart.distanceTo(engB) / RUN_SPEED;
      // The breaker's escape route: eng -> wide waypoint -> ball, paced to arrive on time.
      const segs = [];
      let len = 0;
      [[engR, way], [way, end]].forEach(([a, b]) => { const l = a.distanceTo(b); segs.push({ a, b, len: l, from: len }); len += l; });
      pairs[s] = {
        redStart, blueStart, engR, engB, end, segs, pathLen: len,
        redRun, engageT, blueRun, blueRunStart: engageT - blueRun,
        escapeStart: BREAK_AT + SHED_DURATION,
        escapeSpeed: len / Math.max(0.2, ARRIVE_AT - (BREAK_AT + SHED_DURATION)),
      };
    });
  }

  // ---- per-frame ------------------------------------------------------------
  function setTarget(c, name) {
    if (c.active !== name) {
      c.active = name;
      const a = c.actions[name];
      if (a && (name === 'flex' || name === 'fall')) a.reset(); // one-shots start fresh when first selected
    }
  }

  function stepWeights(c, dt, fade) {
    for (const k of Object.keys(c.weights)) {
      const target = c.active === k ? 1 : 0;
      const w = c.weights[k];
      const step = dt === 0 ? 1 : dt / fade; // dt 0 = snap straight to the target (initial placement)
      c.weights[k] = w + Math.max(-step, Math.min(step, target - w));
      const a = c.actions[k];
      a.enabled = c.weights[k] > 0.001;
      a.setEffectiveWeight(c.weights[k]);
    }
  }

  // Root motion is thrown away (movement is driven by code) apart from the
  // stance's crouch and the fall's drop, applied as offsets from each clip's first frame.
  function finishChar(c) {
    if (!c.hips) return;
    if (c.role === 'holder') return; // his kneel IS the hips height -- keep the clip's own hips motion
    c.hips.position.copy(c.hipsBind);
    const add = (off, time, w) => {
      if (!off || !(w > 0)) return;
      const v = off.interp.evaluate(time);
      c.hips.position.x += (v[0] - off.first[0]) * w;
      c.hips.position.y += (v[1] - off.first[1]) * w;
      c.hips.position.z += (v[2] - off.first[2]) * w;
    };
    if (c.actions.stance) add(assets.stanceOffset, c.stanceTime, c.weights.stance);
    if (c.actions.fall) add(assets.fallOffset, c.actions.fall.time, c.weights.fall);
  }

  const place = (c, v, yaw, dt, snap) => {
    c.holder.position.copy(v);
    c.yaw = snap || dt === 0 ? yaw : lerpAngle(c.yaw, yaw, 1 - Math.exp(-dt * 14));
    c.holder.rotation.y = c.yaw;
  };
  const lerpV = (a, b, f) => new THREE.Vector3().lerpVectors(a, b, Math.max(0, Math.min(1, f)));
  const heading = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);

  function updateLineman(c, dt, hikeT) {
    const dur = assets.stance.duration;
    const t = hikeT == null ? -1 : hikeT - c.delay;
    if (t < 0) { c.stanceTime = dur; setTarget(c, 'stance'); }
    else if (t < RISE_DURATION) { c.stanceTime = dur * (1 - smooth(t / RISE_DURATION)); setTarget(c, 'stance'); }
    else { c.stanceTime = 0; setTarget(c, 'push'); }
    c.actions.stance.time = c.stanceTime;
    c.holder.rotation.y = c.baseYaw;
    stepWeights(c, dt, t < RISE_DURATION ? 0.001 : PUSH_BLEND); // standing -> pushing is a short crossfade; the rest is a held pose
  }

  function updateRed(c, dt, hikeT) {
    const P = pairs[c.side];
    const dur = assets.stance.duration;
    const isBreaker = c.side === breakerSide && !breakCancelled;
    const t = hikeT == null ? -1 : hikeT;
    let fade = 0.001;
    if (hikeT == null || t < RED_DELAY) {
      c.stanceTime = dur; setTarget(c, 'stance'); place(c, P.redStart, 0, dt, true);
    } else if (t < RED_DELAY + RED_RISE) {
      c.stanceTime = dur * (1 - smooth((t - RED_DELAY) / RED_RISE)); setTarget(c, 'stance'); place(c, P.redStart, 0, dt, true);
    } else if (t < P.engageT) {
      c.stanceTime = 0; setTarget(c, 'run'); fade = 0.12;
      place(c, lerpV(P.redStart, P.engR, (t - RED_DELAY - RED_RISE) / P.redRun), heading(P.redStart, P.engR), dt, false);
    } else if (!isBreaker || t < BREAK_AT + SHED_DURATION) {
      // Locked up with his blocker. (The breaker spends SHED_DURATION still in contact,
      // throwing the blocker off, before he runs.)
      c.stanceTime = 0; setTarget(c, 'push'); fade = 0.15;
      place(c, P.engR, 0, dt, false);
    } else if (t < ARRIVE_AT) {
      c.stanceTime = 0; setTarget(c, 'run'); fade = 0.12;
      const s = Math.min(P.pathLen, (t - P.escapeStart) * P.escapeSpeed);
      const seg = P.segs.find((g) => s <= g.from + g.len) || P.segs[P.segs.length - 1];
      place(c, lerpV(seg.a, seg.b, seg.len > 0 ? (s - seg.from) / seg.len : 1), heading(seg.a, seg.b), dt, false);
    } else {
      // Arrived: face the ball and react to how the kick went.
      c.stanceTime = 0;
      setTarget(c, rushOutcome === 'blocked' ? 'flex' : 'sad'); fade = FADE;
      place(c, P.end, Math.atan2(spot.x - P.end.x, spot.z - P.end.z), dt, false);
    }
    c.actions.stance.time = c.stanceTime;
    stepWeights(c, dt, fade);
  }

  function updateBlue(c, dt, hikeT) {
    const P = pairs[c.side];
    const beaten = c.side === breakerSide && !breakCancelled && hikeT != null && hikeT >= BREAK_AT;
    const t = hikeT == null ? -1 : hikeT;
    let fade = 0.001;
    if (hikeT == null || t < P.blueRunStart) {
      setTarget(c, 'idle'); place(c, P.blueStart, Math.PI, dt, true); // standing behind the line, facing the action
    } else if (t < P.engageT) {
      setTarget(c, 'run'); fade = 0.12;
      place(c, lerpV(P.blueStart, P.engB, (t - P.blueRunStart) / P.blueRun), heading(P.blueStart, P.engB), dt, false);
    } else if (!beaten) {
      setTarget(c, 'push'); fade = 0.15;
      place(c, P.engB, Math.PI, dt, false);
    } else {
      setTarget(c, 'fall'); fade = 0.1;
      place(c, P.engB, Math.PI, dt, false);
    }
    stepWeights(c, dt, fade);
  }

  function updateHolder(c, dt, hikeT) {
    const dur = assets.hike.duration;
    c.actions.hike.time = hikeT == null ? 0 : Math.min(dur, Math.max(0, hikeT) * HIKE_SPEED); // frozen at the start until the hike, frozen at the end after it
    setTarget(c, 'hike');
    stepWeights(c, dt, 0.001);
  }

  const bz = (a, b, c2, t) => { const u = 1 - t; return new THREE.Vector3(u * u * a.x + 2 * u * t * b.x + t * t * c2.x, u * u * a.y + 2 * u * t * b.y + t * t * c2.y, u * u * a.z + 2 * u * t * b.z + t * t * c2.z); };
  const _hl = new THREE.Vector3(), _hr = new THREE.Vector3();
  // The ball: on the ground at the LOS until the hike, flies back to the holder's hands, rides
  // them down, and ends upright on its spot.
  function driveBall(hikeT) {
    if (!ballObj || !ballControlled || !holderChar) return;
    const losZ = spot.z - LOS_YARDS_AHEAD;
    const pre = new THREE.Vector3(spot.x, BALL_PRE_Y, losZ + 0.02);
    const rest = new THREE.Vector3(spot.x, BALL_REST_Y, spot.z);
    const catchT = HIKE_CATCH_CLIP_T / HIKE_SPEED;
    const placeT = HIKE_PLACE_CLIP_T / HIKE_SPEED;
    if (hikeT == null || hikeT < SNAP_AT) { ballObj.position.copy(pre); ballObj.rotation.set(0, 0, 0); return; }
    if (hikeT >= placeT) { ballObj.position.copy(rest); ballObj.rotation.set(Math.PI / 2, 0, 0); return; }
    holderChar.holder.updateMatrixWorld(true);
    const lh = boneOf(holderChar, 'mixamorigLeftHand'), rh = boneOf(holderChar, 'mixamorigRightHand');
    if (lh) lh.getWorldPosition(_hl);
    if (rh) rh.getWorldPosition(_hr);
    const hands = new THREE.Vector3().addVectors(_hl, _hr).multiplyScalar(0.5);
    if (hikeT < catchT) {
      const f = (hikeT - SNAP_AT) / (catchT - SNAP_AT); // the snap back
      const mid = new THREE.Vector3().addVectors(pre, hands).multiplyScalar(0.5); mid.y += 0.7;
      ballObj.position.copy(bz(pre, mid, hands, f));
      ballObj.rotation.set(0, 0, 0);
    } else {
      const g = smooth((hikeT - catchT) / (placeT - catchT)); // carried down onto its spot
      ballObj.position.lerpVectors(hands, rest, g);
      ballObj.rotation.set((Math.PI / 2) * g, 0, 0);
    }
  }

  function applyFrame(dt, hikeT) {
    if (!assets) return;
    for (const c of chars) {
      if (c.role === 'red') updateRed(c, dt, hikeT);
      else if (c.role === 'blue') updateBlue(c, dt, hikeT);
      else if (c.role === 'holder') updateHolder(c, dt, hikeT);
      else updateLineman(c, dt, hikeT);
      c.mixer.update(dt);
      finishChar(c);
    }
    driveBall(hikeT);
  }

  return {
    // Positions the whole formation for a kick whose ball sits at (x, z); `side` picks which end's red breaks free.
    setSpot(x, z, side = 1) {
      spot = { x, z };
      breakerSide = side;
      layout();
    },
    // The football the line moves until the kick is struck (the game owns it afterwards).
    setBall(b) { ballObj = b; },
    releaseBall() { ballControlled = false; },
    // Put the ball where it belongs for this moment of the play right now (e.g. after the game reset it).
    syncBall(hikeT) { driveBall(hikeT); },
    // Seconds after the hike by which the holder has the ball set down -- the kicker waits for this.
    get holderDoneAt() { return assets ? assets.hike.duration / HIKE_SPEED : 0; },
    // Back to the pre-snap look: everyone set, nobody committed to a break.
    reset() {
      rushOutcome = null;
      breakCancelled = false;
      ballControlled = true;
      if (assets) { layout(); applyFrame(0, null); }
    },
    // hikeT = seconds since the hike (null before it). dt = frame time in seconds.
    update(dt, hikeT) { applyFrame(dt, hikeT); },
    setRushOutcome(kind) { rushOutcome = kind; },
    // The kick was struck without being blocked: if the red hasn't broken free yet, he never does -- the block holds.
    cancelRushIfNotStarted(hikeT) {
      if (!assets) return;
      if (hikeT == null || hikeT < BREAK_AT) breakCancelled = true;
    },
    loaded: loadedPromise, // resolves once every model/clip is in (or something failed)
    arriveAt: ARRIVE_AT,
    breakAt: BREAK_AT,
    get ready() { return !!assets; },
  };
}
