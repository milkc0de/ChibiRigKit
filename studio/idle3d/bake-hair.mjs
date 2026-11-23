// SPDX-License-Identifier: Apache-2.0
// node studio/idle3d/bake-hair.mjs INPUT.glb OUTPUT.glb
import {readFile, rename, writeFile} from 'node:fs/promises';
import {Bone, Object3D, QuaternionKeyframeTrack, VectorKeyframeTrack, InterpolateDiscrete, InterpolateLinear} from 'three';
import {createHairRig, hairPhysicsVersion} from './hair-physics.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node bake-hair.mjs INPUT.glb OUTPUT.glb');
const file = await readFile(input);
if (file.toString('ascii',0,4) !== 'glTF' || file.readUInt32LE(4) !== 2 || file.readUInt32LE(8) !== file.length) {
  throw new Error('Expected a GLB 2.0 file');
}
const end = 20 + file.readUInt32LE(12);
if (file.toString('ascii',end+4,end+8) !== 'BIN\0') throw new Error('Expected embedded binary data');
const doc = JSON.parse(file.toString('utf8',20,end));
const bin = file.subarray(end+8, end+8+doc.buffers[0].byteLength);
const animation = doc.animations.find(a => a.name === 'VTuber Idle') || doc.animations[0];
const skinJoints = new Set((doc.skins || []).flatMap(s => s.joints));
const objects = doc.nodes.map((n, index) => {
  const object = skinJoints.has(index) ? new Bone() : new Object3D(); object.name = n.name || '';
  if (n.translation) object.position.fromArray(n.translation);
  if (n.rotation) object.quaternion.fromArray(n.rotation);
  if (n.scale) object.scale.fromArray(n.scale);
  if (n.matrix) object.matrix.fromArray(n.matrix).decompose(object.position,object.quaternion,object.scale);
  return object;
});
for (let i=0; i<objects.length; i++) for (const child of doc.nodes[i].children || []) objects[i].add(objects[child]);
const scene = new Object3D();
for (const root of doc.scenes[doc.scene || 0].nodes) scene.add(objects[root]);

function floats(index) {
  const accessor = doc.accessors[index], view = doc.bufferViews[accessor.bufferView];
  const width = {SCALAR:1,VEC3:3,VEC4:4}[accessor.type];
  if (!width || !view || view.buffer !== 0 || view.byteStride || accessor.componentType !== 5126 || accessor.sparse) {
    throw new Error('Unsupported animation accessor ' + index);
  }
  return new Float32Array(bin.buffer, bin.byteOffset+(view.byteOffset || 0)+(accessor.byteOffset || 0), width*accessor.count);
}
const tracks = new Map(); let duration = 0;
for (const {sampler,target} of animation.channels) {
  const s = animation.samplers[sampler], times = floats(s.input);
  duration = Math.max(duration,times.at(-1));
  const property = {rotation:'quaternion', translation:'position', scale:'scale'}[target.path];
  if (!property) continue;
  const object = objects[target.node];
  if (s.interpolation && !['LINEAR','STEP'].includes(s.interpolation)) throw new Error('Unsupported driver interpolation ' + s.interpolation);
  const Track = property === 'quaternion' ? QuaternionKeyframeTrack : VectorKeyframeTrack;
  const track = new Track(property, times, floats(s.output), s.interpolation === 'STEP' ? InterpolateDiscrete : InterpolateLinear);
  if (!tracks.has(object)) tracks.set(object, {});
  tracks.get(object)[property] = track;
}
const rig = createHairRig(scene, duration, tracks, animation.extras?.idlePoseAtFirstFrame === true);
if (!rig) throw new Error('No weighted secondary hair chains found');
const baked = rig.simulate();
let byteLength = bin.length;
const pieces = [bin];
function append(data, type, bounds = {}) {
  const padding = (-byteLength) & 3;
  if (padding) { pieces.push(Buffer.alloc(padding)); byteLength += padding; }
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const bufferView = doc.bufferViews.push({buffer:0, byteOffset:byteLength, byteLength:bytes.length}) - 1;
  pieces.push(bytes); byteLength += bytes.length;
  return doc.accessors.push({bufferView, componentType:5126, count:baked.count, type, ...bounds}) - 1;
}
const times = Float32Array.from({length:baked.count}, (_,i) => i*baked.frameStep);
const sameTimes = animation.samplers.find(s => {
  const old = floats(s.input);
  return old.length === times.length && times.every((t,i) => t === old[i]);
});
const timeAccessor = sameTimes?.input ?? append(times,'SCALAR',{min:[0],max:[duration]});
for (const bone of rig.strands) {
  const node = objects.indexOf(bone.object);
  let channel = animation.channels.find(c => c.target.node===node && c.target.path==='rotation');
  const data = baked.rotations[bone.slot];
  const existing = channel && animation.samplers[channel.sampler];
  // Accessors in an input asset can also serve unrelated animation tracks or
  // meshes. Append on first bake. On a repeat bake only reuse our own outputs.
  const previousBake = existing?.extras?.hairSpringOutput === true && doc.accessors[existing.output].count === baked.count;
  const outputAccessor = previousBake ? existing.output : append(data,'VEC4');
  if (previousBake) floats(outputAccessor).set(data);
  // Also isolate a shared sampler even if the target accessor was unique.
  const sampler = {input:timeAccessor, output:outputAccessor, interpolation:'LINEAR', extras:{hairSpringOutput:true}};
  if (channel && animation.channels.filter(c=>c.sampler===channel.sampler).length===1) animation.samplers[channel.sampler] = sampler;
  else {
    const index = animation.samplers.push(sampler)-1;
    if (channel) channel.sampler = index;
    else animation.channels.push({sampler:index,target:{node,path:'rotation'}});
  }
}
animation.extras = {...animation.extras, hairSpringVersion:hairPhysicsVersion};
doc.buffers[0].byteLength = byteLength;
const writtenJSON = Buffer.from(JSON.stringify(doc));
const jsonPadding = (-writtenJSON.length)&3, binPadding = (-byteLength)&3;
const head = Buffer.alloc(20), binHead = Buffer.alloc(8);
head.write('glTF'); head.writeUInt32LE(2,4); head.writeUInt32LE(28+writtenJSON.length+jsonPadding+byteLength+binPadding,8);
head.writeUInt32LE(writtenJSON.length+jsonPadding,12); head.write('JSON',16);
binHead.writeUInt32LE(byteLength+binPadding); binHead.write('BIN\0',4);
await writeFile(output+'.partial',Buffer.concat([head,writtenJSON,Buffer.alloc(jsonPadding,32),binHead,...pieces,Buffer.alloc(binPadding)]));
await rename(output+'.partial',output);
console.log('Baked',rig.strands.length,'weighted strands and accessory joints,',baked.count,'samples over',duration,'seconds.');
