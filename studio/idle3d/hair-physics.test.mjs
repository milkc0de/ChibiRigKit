// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Bone, Object3D, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack} from 'three';
import {controlledRotation, createHairRig, hairPhysicsVersion, hairPlayback} from './hair-physics.js';

function fixture() {
  const scene = new Object3D();
  function joint(name, parent, y, flip = false) {
    const b = new Bone(); b.name = name; b.position.y = y;
    if (flip) b.rotation.z = Math.PI;
    parent.add(b); return b;
  }
  const chest = joint('chest',scene,.40), head = joint('head',chest,.18);
  const upper = joint('hair_upper.L',head,.16,true);
  const mid = joint('hair_mid.L',upper,.19), lower = joint('hair_lower.L',mid,.16);
  const z = new Vector3(0,0,1), q = new Quaternion();
  const times = [0,.4,.58,.75,1.6,2,3];
  const angles = [0,0,.12,.33,.33,0,0];
  const headTrack = new QuaternionKeyframeTrack('head', times, angles.flatMap(a=>q.setFromAxisAngle(z,a).toArray()));
  const chestTrack = new VectorKeyframeTrack('chest',[0,.4,.7,1.6,2,3], [0,.4,0, 0,.4,0, .02,.4,0, .02,.4,0, 0,.4,0, 0,.4,0]);
  const tracks = new Map([[head,{quaternion:headTrack}], [chest,{position:chestTrack}]]);
  return {scene, chest, head, upper, mid, lower, tracks, duration:3};
}
const angle = (values, index, base) => new Quaternion().fromArray(values,index*4).angleTo(base);

test('absolute directions replace sampled head rotation, and neck controls scale only the selected axis', () => {
  const neutral=new Quaternion(), target=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4);
  const neck=controlledRotation('neck',neutral,neutral),head=controlledRotation('head',neutral,neutral);
  const neckQ=new Quaternion(),headQ=new Quaternion();
  const direction={yaw:25,pitch:0,roll:0};
  for(const [drive,out] of [[neck,neckQ],[head,headQ]])drive(target,1,{},direction,out);
  const forward=new Vector3(0,0,1).applyQuaternion(neckQ.multiply(headQ));
  assert.ok(Math.abs(Math.atan2(forward.x,forward.z)-25*Math.PI/180)<1e-6);
  neck(target,1,{neckGains:{yaw:0,roll:2,pitch:2}},null,neckQ);
  assert.ok(neckQ.angleTo(neutral)<1e-6);
  neck(target,1,{neckGains:{yaw:1,pitch:1,roll:1}},null,neckQ);
  assert.ok(neckQ.angleTo(target)<1e-6);
});

test('translation and rotation drive bounded, delayed, periodic secondary motion', () => {
  const f = fixture(), rig = createHairRig(f.scene,f.duration,f.tracks,true);
  const independent = createHairRig(f.scene,f.duration,new Map([[f.chest,f.tracks.get(f.chest)]]),true);
  assert.equal(rig.strands.length,3);
  const table = rig.simulate();
  const translationOnly = independent.simulate();
  const fast = rig.simulate({playbackRate:2});
  for (const b of rig.strands) {
    const current = table.rotations[b.slot];
    assert.deepEqual(current.subarray(0,4),current.subarray(-4));
    const angles = Array.from({length:table.count},(_,i)=>angle(current,i,b.bind));
    assert.ok(Math.max(...angles) > .025 && Math.max(...angles) < b.limit+.001);
    assert.ok(angle(translationOnly.rotations[b.slot],19,b.bind) > .004);
    assert.ok(new Quaternion().fromArray(current,26*4).angleTo(new Quaternion().fromArray(fast.rotations[b.slot],26*4)) > .005);
  }
  const peaks = rig.strands.map(b => {
    const angles = Array.from({length:34},(_,i)=>angle(table.rotations[b.slot],i,b.bind));
    return angles.indexOf(Math.max(...angles));
  });
  assert.ok(peaks[0] < peaks[1] && peaks[1] < peaks[2], 'A rapid head turn travels down the strand');
  const frozen = rig.simulate({intensity:0});
  for (const b of rig.strands) {
    assert.ok(angle(frozen.rotations[b.slot],26,b.bind) < .001);
  }
  assert.deepEqual(rig.simulate().rotations,table.rotations);
});

test('baked playback and live sampling agree, scrubbing is reversible and zero strength restores bind', () => {
  const f = fixture(), rig = createHairRig(f.scene,f.duration,f.tracks,true), table = rig.simulate();
  const times = Float32Array.from({length:table.count},(_,i)=>i*table.frameStep);
  for (const b of rig.strands) {
    f.tracks.set(b.object, {quaternion:new QuaternionKeyframeTrack(b.name,times,table.rotations[b.slot])});
  }
  // A baked track is an output of the spring. Feeding it back in as a driver
  // would double the displacement the next time non-default controls are used.
  const live = hairPlayback(rig,f.tracks,f.duration,undefined);
  const baked = hairPlayback(rig,f.tracks,f.duration,hairPhysicsVersion);
  function pose(player, time, options={}) {
    player.apply(time,options); return rig.strands.map(b=>b.object.quaternion.clone());
  }
  function compare(actual, expected) {
    for (let i=0; i<actual.length; i++) assert.ok(actual[i].angleTo(expected[i]) < 2e-6);
  }
  const direct = pose(live,.826);
  compare(pose(baked,.826),direct);
  pose(baked,2.75,{headAmount:2.1}); pose(baked,.37,{playbackRate:1.5});
  compare(pose(baked,.826),direct);
  compare(pose(live,.826),direct);
  compare(pose(baked,.826,{hairPhysicsAmount:0}),rig.strands.map(b=>b.bind));
  compare(pose(baked,.826,{hairPhysicsAmount:.5}),direct.map((q,i)=>rig.strands[i].bind.clone().slerp(q,.5)));
  compare(pose(baked,.826,{intensity:0}),rig.strands.map(b=>b.bind));
  assert.equal(createHairRig(new Object3D(),3,new Map(),true),null);
});
