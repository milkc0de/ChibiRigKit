// SPDX-License-Identifier: Apache-2.0
import {Euler, Quaternion, Vector3} from 'three';

export const hairPhysicsVersion = 1;
const framesPerSecond = 30;
const worldDown = new Vector3(0, -1, 0);
const localUp = new Vector3(0, 1, 0);

// The bind shape already includes the weight of the curls. Gravity below acts
// on changes from that shape. Softer distal joints continue moving after the
// roots turn. Bend limits keep curls close to their painted silhouette.
const springTypes = {
  upper: {frequency: 2.55, damping: .84, gravity: .15, limit: 12},
  mid:   {frequency: 1.95, damping: .75, gravity: .22, limit: 17},
  lower: {frequency: 1.55, damping: .72, gravity: .28, limit: 20},
  cowlick: {frequency: 3.05, damping: .66, gravity: .06, limit: 17},
  ribbon:  {frequency: 2.10, damping: .72, gravity: .18, limit: 20}
};
function springType(name) {
  if (name === 'cowlick') return springTypes.cowlick;
  if (name === 'bow_tail.L') return springTypes.ribbon;
  const match = /^hair_(upper|mid|lower)\.[LRB]$/.exec(name);
  return match ? springTypes[match[1]] : undefined;
}
export function driverGain(name, options) {
  const intensity = options.intensity ?? 1;
  if (name === 'neck' && options.neckSway === false) return 0;
  if (name === 'head' || name === 'neck') return intensity * (options.headAmount ?? 1.5) / 1.5;
  return intensity;
}

// Use the same local bone rotations for displayed skin and simulated hair attachments.
export function controlledRotation(name, bind, first) {
  const head = name === 'head', neck = name === 'neck';
  const angles = new Euler(0,0,0,'YXZ'), relative = new Quaternion();
  const radians = Math.PI / 180, inverseFirst = first.clone().invert(), inverseBind = bind.clone().invert(), identity = new Quaternion();
  const fraction = head ? .4 : neck ? .6 : name === 'spine' ? .45 : .55;
  return (value, gain, options, pose, out, tracked) => {
    const scales = options.neckGains;
    if ((neck || head) && pose) {
      angles.set((pose.pitch || 0)*radians,(pose.yaw || 0)*radians,-(pose.roll || 0)*radians,'YXZ');
      relative.setFromEuler(angles);
      out.slerpQuaternions(identity,relative,fraction).multiply(bind).normalize();
    } else if (neck && scales && (scales.yaw !== 1 || scales.pitch !== 1 || scales.roll !== 1)) {
      relative.multiplyQuaternions(inverseFirst,value);
      angles.setFromQuaternion(relative,'YXZ');
      angles.set(angles.x*(scales.pitch ?? 1), angles.y*(scales.yaw ?? 1), angles.z*(scales.roll ?? 1),'YXZ');
      relative.setFromEuler(angles).premultiply(first);
      out.slerpQuaternions(first,relative,gain).normalize();
    } else {
      out.slerpQuaternions(first,value,gain).normalize();
    }
    if (tracked) {
      // A sparse capture frame replaces only measured axes of the displayed
      // pose. The original neck/head and spine/chest bind rotations remain.
      relative.multiplyQuaternions(out,inverseBind);
      angles.setFromQuaternion(relative,'YXZ');
      if (tracked.yaw != null) angles.y = tracked.yaw * radians * fraction;
      if (tracked.pitch != null) angles.x = tracked.pitch * radians * fraction;
      if (tracked.roll != null) angles.z = -tracked.roll * radians * fraction;
      out.setFromEuler(angles).multiply(bind).normalize();
    }
  };
}

function drivenProperty(object, property, track, idleAtZero) {
  if (!track) return null;
  const at = track.createInterpolant();
  const first = object[property].clone();
  if (idleAtZero) first.fromArray(at.evaluate(0));
  const value = first.clone();
  const rotate = property === 'quaternion' ? controlledRotation(object.userData.name || object.name,object.quaternion.clone(),first) : null;
  return (t, gain, out, options, pose) => {
    value.fromArray(at.evaluate(t));
    if (rotate) rotate(value,gain,options,pose,out);
    else out.lerpVectors(first, value, gain);
  };
}

// Integrate the damped spring analytically while its attachment moves between
// samples. Partial drag relative to the attachment leaves inertia in world
// space instead of treating the strand as fixed to the head on translation.
function coefficients(settings, dt) {
  const w = 2 * Math.PI * settings.frequency;
  const drag = settings.damping * w;
  const wd = Math.sqrt(w*w - drag*drag);
  const decay = Math.exp(-drag*dt);
  const b = decay * Math.sin(wd*dt) / wd;
  const cos = decay * Math.cos(wd*dt);
  return {a: cos + drag*b, b, c: -w*w*b, d: cos - drag*b, lag: 2*drag/(w*w) * .64};
}

// All solver state belongs to a clip, never to the last displayed frame. Only
// the driven ancestors and the 11 weighted secondary bones are sampled.
export function createHairRig(scene, duration, tracksByObject, idleAtZero) {
  const selected = new Set();
  scene.traverse(object => {
    if (!object.isBone || !springType(object.userData.name || object.name)) return;
    for (let p = object; p; p = p.parent) selected.add(p);
  });
  if (!selected.size) return null;
  const frames = [], byObject = new Map(), strands = [];
  scene.traverse(object => {
    if (!selected.has(object)) return;
    const parent = byObject.get(object.parent);
    const name = object.userData.name || object.name;
    const settings = object.isBone && springType(name);
    const tracks = tracksByObject.get(object) || {};
    const frame = {
      object, parent, name, settings, position: object.position.clone(), rotation: object.quaternion.clone(), scale: object.scale.clone(),
      worldPosition: new Vector3(), worldRotation: new Quaternion(), worldScale: new Vector3(),
      move: drivenProperty(object, 'position', tracks.position, idleAtZero),
      turn: settings ? null : drivenProperty(object, 'quaternion', tracks.quaternion, idleAtZero),
      resize: drivenProperty(object, 'scale', tracks.scale, idleAtZero)
    };
    // Transform the equilibrium gravity vector into this bone's bind basis.
    worldFrame(frame);
    if (settings) {
      const next = object.children.find(child => child.isBone && springType(child.userData.name || child.name));
      let length = next?.position.length() || object.position.length() * .72;
      if (name === 'cowlick') length = object.position.length() * .14;
      const tangent = next ? next.position.clone().normalize() : localUp.clone();
      const equilibriumGravity = worldDown.clone().applyQuaternion(frame.worldRotation.clone().invert());
      Object.assign(frame, {tangent, length: Math.max(.001, length), equilibriumGravity,
        tip: new Vector3(), velocity: new Vector3(), lastTarget: new Vector3(), bind: object.quaternion.clone(),
        limit: settings.limit * Math.PI / 180, slot: strands.length});
      strands.push(frame);
    }
    frames.push(frame); byObject.set(object, frame);
  });

  function worldFrame(bone) {
    const p = bone.parent;
    if (p) {
      bone.worldPosition.copy(bone.position).multiply(p.worldScale).applyQuaternion(p.worldRotation).add(p.worldPosition);
      bone.worldRotation.multiplyQuaternions(p.worldRotation, bone.rotation);
      bone.worldScale.copy(p.worldScale).multiply(bone.scale);
    } else {
      bone.worldPosition.copy(bone.position); bone.worldRotation.copy(bone.rotation); bone.worldScale.copy(bone.scale);
    }
  }
  function simulate(options = {}) {
    const n = Math.max(2, Math.ceil(duration * framesPerSecond - 1e-5));
    const frameStep = duration / n;
    const speed = Math.max(.05, options.playbackRate ?? 1);
    const dt = frameStep / (2 * speed);
    const output = strands.map(() => new Float32Array((n+1)*4));
    const params = strands.map(bone => coefficients(bone.settings, dt));
    const gains = frames.map(bone => driverGain(bone.name, options));
    const target = new Vector3(), velTarget = new Vector3(), displacement = new Vector3(), relativeVelocity = new Vector3();
    const tangent = new Vector3(), gravity = new Vector3(), predicted = new Vector3(), local = new Vector3();
    const turn = new Quaternion(), inverse = new Quaternion(), identity = new Quaternion();
    function step(t, initialize) {
      const pose = options.headPoseAt ? options.headPoseAt(t) : options.headPose;
      for (let index=0; index<frames.length; index++) {
        const bone = frames[index];
        bone.move?.(t, gains[index], bone.position);
        bone.turn?.(t, gains[index], bone.rotation, options, pose);
        bone.resize?.(t, gains[index], bone.scale);
        if (bone.settings) bone.rotation.copy(bone.bind);
        worldFrame(bone);
        if (!bone.settings) continue;
        tangent.copy(bone.tangent).multiply(bone.worldScale);
        const length = tangent.length() * bone.length;
        tangent.normalize().applyQuaternion(bone.worldRotation);
        gravity.copy(bone.equilibriumGravity).applyQuaternion(bone.worldRotation);
        target.copy(tangent).addScaledVector(worldDown, bone.settings.gravity).addScaledVector(gravity, -bone.settings.gravity)
          .normalize().multiplyScalar(length).add(bone.worldPosition);
        if (initialize) {
          bone.tip.copy(target); bone.velocity.set(0,0,0);
        } else {
          const p = params[bone.slot];
          velTarget.subVectors(target, bone.lastTarget).multiplyScalar(1/dt);
          displacement.subVectors(bone.tip, bone.lastTarget).addScaledVector(velTarget, p.lag);
          relativeVelocity.subVectors(bone.velocity, velTarget);
          predicted.copy(target).addScaledVector(velTarget, -p.lag).addScaledVector(displacement, p.a).addScaledVector(relativeVelocity, p.b);
          bone.velocity.copy(velTarget).addScaledVector(displacement, p.c).addScaledVector(relativeVelocity, p.d);
          local.subVectors(predicted, bone.worldPosition).normalize().applyQuaternion(inverse.copy(bone.worldRotation).invert());
          turn.setFromUnitVectors(bone.tangent, local);
          const angle = identity.angleTo(turn);
          if (angle > bone.limit) turn.slerpQuaternions(identity, inverse.copy(turn), bone.limit/angle);
          bone.rotation.multiply(turn); worldFrame(bone);
          bone.tip.copy(bone.tangent).applyQuaternion(bone.worldRotation).multiplyScalar(length).add(bone.worldPosition);
          bone.velocity.addScaledVector(local.subVectors(bone.tip, predicted), 1/dt);
        }
        bone.lastTarget.copy(target);
      }
    }
    // Warm the periodic solution across the previous loop before frame zero.
    // Four real-time seconds covers even the slowest strand's settling time.
    const warm = Math.ceil(4 * speed / (frameStep/2));
    for (let sample=-warm; sample<=2*n-2; sample++) {
      const phase = ((sample % (2*n)) + 2*n) % (2*n);
      step(phase * frameStep/2, sample === -warm);
      if (sample >= 0 && sample % 2 === 0) {
        for (const b of strands) b.rotation.toArray(output[b.slot], sample*2);
      }
    }
    for (const values of output) values.set(values.subarray(0,4), n*4);
    return {count: n + 1, frameStep, rotations: output};
  }
  return {strands, simulate};
}

export function hairPlayback(rig, tracksByObject, duration, bakeVersion) {
  if (!rig) return null;
  const baked = rig.strands.map(b => tracksByObject.get(b.object)?.quaternion?.createInterpolant());
  const hasBake = bakeVersion === hairPhysicsVersion && baked.every(Boolean);
  const bones = new Set(rig.strands.map(b => b.object));
  const value = new Quaternion(), interpolated = new Float32Array(4);
  let table, settingsKey;
  function apply(t, options) {
    const amount = Math.max(0, options.hairPhysicsAmount ?? 1);
    if (!amount) {
      for (const b of rig.strands) b.object.quaternion.copy(b.bind);
      return;
    }
    const intensity = options.intensity ?? 1, head = options.headAmount ?? 1.5, speed = options.playbackRate ?? 1;
    const neck = options.neckSway !== false;
    const gains = options.neckGains;
    const neckKey = [gains?.yaw ?? 1,gains?.pitch ?? 1,gains?.roll ?? 1].join('/');
    const customPose = !!options.headPose;
    const useBake = hasBake && intensity === 1 && head === 1.5 && speed === 1 && neck && !customPose && neckKey === '1/1/1';
    if (!useBake) {
      const key = [intensity,head,speed,neck,neckKey,customPose,options.headPoseKey ?? ''].join('/');
      if (settingsKey !== key) {
        // An unkeyed input is a live pose. Its current angle already propagates
        // to every strand through the skeleton; cache the remaining body drive.
        table = rig.simulate(customPose && options.headPoseKey == null ?
          {...options,headPose:{yaw:0,pitch:0,roll:0},headPoseAt:null} : options);
        settingsKey = key;
      }
    }
    const frame = useBake ? 0 : (t/duration) * (table.count-1);
    const left = Math.min(Math.floor(frame), (table?.count ?? 2)-2);
    for (const b of rig.strands) {
      if (useBake) value.fromArray(baked[b.slot].evaluate(t));
      else {
        const data = table.rotations[b.slot];
        Quaternion.slerpFlat(interpolated, 0, data, left*4, data, (left+1)*4, frame-left);
        value.fromArray(interpolated);
      }
      b.object.quaternion.slerpQuaternions(b.bind, value, amount).normalize();
    }
  }
  return {bones, apply};
}
