// SPDX-License-Identifier: Apache-2.0
import {
  Float32BufferAttribute, OrthographicCamera, PropertyBinding, TextureLoader, Vector3,
  WebGLRenderer, sRGBEncoding
} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {controlledRotation, createHairRig, driverGain, hairPlayback} from './hair-physics.js';
import {createRigOverlay} from './rig-overlay.js';

function embeddedModel(encoded) {
  let bytes;
  if (typeof Uint8Array.fromBase64 === 'function') {
    bytes = Uint8Array.fromBase64(encoded);
  } else {
    const decoded = atob(encoded);
    bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  }
  const header = new DataView(bytes.buffer);
  if (bytes.length < 20 || header.getUint32(0, true) !== 0x46546c67 ||
      header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.length) {
    throw new Error('待機モデルのGLBを読み込めません');
  }
  const jsonLength = header.getUint32(12, true);
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  if ([...(manifest.buffers || []), ...(manifest.images || [])].some(item => item.uri)) {
    throw new Error('待機モデルのテクスチャとバッファはGLBに内蔵してください');
  }
  return bytes.buffer;
}

function motionGain(bone, options) {
  if (bone.startsWith('hair_') || bone === 'bow_tail.L') {
    return (options.intensity ?? 1) * (options.hairPhysicsAmount ?? 1);
  }
  return driverGain(bone, options);
}

const capturedExpressionShapes = new Set(['MouthOpen', 'MouthNarrow', 'BrowUp', 'BrowDown']);
const clampWeight = v => Math.max(0,Math.min(1,v));
function eyeSide(node) {
  for (let part=node;part;part=part.parent) {
    const match=/^Eyes[._]?([LR])(?:_|$)/.exec(part.userData.name || part.name);
    if (match) return match[1] === 'L' ? 'Left' : 'Right';
  }
  return null;
}

// The original body has bilateral brow shapes and a narrowing mouth shape.
// Keep those authored targets intact. A signed correction on anatomical left
// separates the brows, and the horizontal component of MouthNarrow purses the
// lips without closing them. Both corrections are zero throughout native idle.
function prepareFaceTracking(node, dictionary, cache) {
  const geometry = node.geometry, morphs = geometry?.morphAttributes.position;
  if (!morphs || !geometry.morphTargetsRelative || Object.keys(geometry.morphAttributes).length !== 1) return null;
  let targets = cache.get(geometry);
  if (!targets) {
    const position = geometry.attributes.position, brows = [];
    function addShape(name, sourceIndex, pucker) {
      const source = morphs[sourceIndex];
      const data = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        if (pucker) {
          data[i*3] = source.getX(i);
        } else if (position.getX(i) > 0) {
          data[i*3] = source.getX(i);
          data[i*3+1] = source.getY(i);
          data[i*3+2] = source.getZ(i);
        }
      }
      const attribute = new Float32BufferAttribute(data,3);
      attribute.name = name;
      return morphs.push(attribute) - 1;
    }
    for (const [name, sign] of [['BrowUp',1],['BrowDown',-1]]) {
      const base = dictionary[name];
      if (base !== undefined) brows.push({base,sign,extra:addShape(name+'LeftCorrection',base,false)});
    }
    const narrow = dictionary.MouthNarrow;
    targets = {brows,narrow,pucker:narrow === undefined ? null : addShape('Pucker',narrow,true)};
    cache.set(geometry,targets);
  }
  while (node.morphTargetInfluences.length < morphs.length) node.morphTargetInfluences.push(0);
  return options => {
    const weights = node.morphTargetInfluences;
    for (const {base, sign, extra} of targets.brows) {
      const native = weights[base];
      const left = options.browLeft == null ? native : clampWeight(sign * options.browLeft);
      const right = options.browRight == null ? native : clampWeight(sign * options.browRight);
      weights[base] = right;
      weights[extra] = left - right;
    }
    if (targets.pucker != null) weights[targets.pucker] = clampWeight(-(options.mouthShape ?? 0)) * (1 - .5 * weights[targets.narrow]);
  };
}

// The drawn lid swaps depth with the open drawing during the last 8% of closure.
function closedArt(blink) {
  const s=clampWeight((blink-.92)/(.995-.92));
  return s*s*(3-2*s);
}

function clipSampler(scene, clip, idlePoseAtFirstFrame, bakeVersion) {
  // Sample the same authored channels for playback, manual seeking and recording.
  const tracksByObject = new Map();
  const faceTargets = new WeakMap();
  const bindings = clip.tracks.map(track => {
    const binding = PropertyBinding.parseTrackName(track.name);
    const node = PropertyBinding.findNode(scene, binding.nodeName);
    if (!node) throw new Error('待機モーションのボーンが見つかりません');
    const property = binding.propertyName;
    if (!tracksByObject.has(node)) tracksByObject.set(node, {});
    tracksByObject.get(node)[property] = track;
    return {node, property, track};
  });
  const hair = hairPlayback(createHairRig(scene, clip.duration, tracksByObject, idlePoseAtFirstFrame),
    tracksByObject, clip.duration, bakeVersion);
  const tracks = bindings.filter(({node,property}) => property !== 'quaternion' || !hair?.bones.has(node))
  .map(({node, property, track}) => {
    const evaluate = track.createInterpolant();
    if (property === 'morphTargetInfluences') {
      const dictionary = node.morphTargetDictionary || {};
      const shapes = Object.entries(dictionary);
      const side = eyeSide(node);
      const trackFace = side ? null : prepareFaceTracking(node,dictionary,faceTargets);
      const firstWeights = idlePoseAtFirstFrame ? evaluate.evaluate(0).slice() : null;
      return (t, options) => {
        const values = evaluate.evaluate(t);
        const nativeBlink = dictionary.Blink === undefined ? 0 : values[dictionary.Blink];
        const manualOpen = (side && options['eyeOpen'+side]) ?? options.eyeOpen;
        const automaticBlink = options.autoBlink === false ? 0 : nativeBlink;
        const blink = manualOpen != null ? 1-clampWeight(manualOpen) : Math.max(automaticBlink,options.expression ?? 0);
        const open = 1-blink;
        const gazeGain = (options.gazeAmount ?? 1.5) / 1.5;
        function gazeAxis(positive, negative, trim = 0, tracked) {
          if (tracked != null) return open * Math.max(-1,Math.min(1,tracked));
          const automatic = options.autoGaze === false ? 0 :
            ((values[dictionary[positive]] || 0) - (values[dictionary[negative]] || 0)) / Math.max(.001,1-nativeBlink);
          return open * Math.max(-1, Math.min(1, trim + (1 - Math.abs(trim)) * automatic * gazeGain));
        }
        const horizontal = gazeAxis('LookRight', 'LookLeft', options.gazeX, options.trackedGazeX);
        const vertical = gazeAxis('LookDown', 'LookUp', options.gazeY, options.trackedGazeY);
        const brow = side ? options['brow'+side] : undefined;
        for (const [name, index] of shapes) {
          let value = values[index];
          if (name === 'Blink') {
            value = blink;
          } else if (name === 'ClosedEyeArt') {
            if (manualOpen != null || blink > automaticBlink) value = closedArt(blink);
            else if (options.autoBlink === false) value = 0;
          } else if (name === 'Smile' && options.mouthShape != null) {
            value = Math.max(0,options.mouthShape);
          } else if ((name === 'BrowUp' || name === 'BrowDown') && brow != null) {
            value = name === 'BrowUp' ? brow : -brow;
          } else if (name === 'Smile' && options.expression != null) {
            value = options.expression;
          } else if (options.mouthOpen != null && (name === 'MouthOpen' || name === 'MouthNarrow')) {
            // The base illustration is parted. The two opposing morphs span
            // the closed slit, neutral illustration and fully open mouth.
            const aperture=2*clampWeight(options.mouthOpen)-1;
            value=name === 'MouthOpen' ? Math.max(0,aperture) : Math.max(0,-aperture);
          } else if (name === 'LookLeft' || name === 'LookRight') {
            value = name === 'LookRight' ? horizontal : -horizontal;
          } else if (name === 'LookDown' || name === 'LookUp') {
            value = name === 'LookDown' ? vertical : -vertical;
          } else if (name === 'Gaze') {
            value *= gazeGain;
          } else if (name === 'Smile' || (firstWeights && capturedExpressionShapes.has(name))) {
            const restingWeight = firstWeights?.[index] ?? 0;
            value = restingWeight + (value - restingWeight) * (options.intensity ?? 1);
          }
          node.morphTargetInfluences[index] = clampWeight(value);
        }
        trackFace?.(options);
      };
    }
    const rest = node[property].clone();
    // Idle clips can begin in a deliberately relaxed pose while retaining the
    // original A-pose as the editable skeleton's bind pose.
    if (idlePoseAtFirstFrame) {
      rest.fromArray(evaluate.evaluate(0));
      if (property === 'quaternion') rest.normalize();
    }
    const sample = rest.clone();
    const name = node.userData.name || node.name;
    if (property === 'quaternion') {
      const rotate = controlledRotation(name,node.quaternion.clone(),rest);
      const head = name === 'neck' || name === 'head';
      const torso = name === 'spine' || name === 'chest';
      return (t, options) => {
        sample.fromArray(evaluate.evaluate(t));
        rotate(sample,motionGain(name,options),options,options.headPose,node.quaternion,
          head ? options.trackedHeadPose : torso ? options.bodyPose : null);
      };
    }
    const spineHeight = name === 'spine' && property === 'position' ? node.position.y : null;
    return (t, options) => {
      sample.fromArray(evaluate.evaluate(t));
      node[property].lerpVectors(rest, sample, motionGain(name, options));
      if (spineHeight != null && options.breath != null) node.position.y = spineHeight * (1 + .076 * clampWeight(options.breath));
    };
  });
  return (time, options) => {
    const t = ((time % clip.duration) + clip.duration) % clip.duration;
    for (const sample of tracks) sample(t, options);
    hair?.apply(t, options);
  };
}

export async function create(encoded) {
  const data = embeddedModel(encoded);
  const renderer = new WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'});
  let asset, overlay;
  function dispose() {
    overlay?.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
    asset?.scene.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      if (node.skeleton) skeletons.add(node.skeleton);
      for (const m of [].concat(node.material || [])) {
        materials.add(m);
        for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const item of [...skeletons, ...textures, ...materials, ...geometries]) item.dispose();
    renderer.dispose();
  }
  try {
    const loader = new GLTFLoader();
    // Embedded PNGs use <img src="blob:…"> so local and offline players can keep
    // their existing network policy, including browsers with ImageBitmap support.
    loader.register(parser => {
      parser.textureLoader = new TextureLoader(parser.options.manager);
      return {name: 'EmbeddedIdleTextures'};
    });
    asset = await loader.parseAsync(data, '');
    const idleIndex = asset.animations.findIndex(animation => animation.name === 'VTuber Idle');
    const clipIndex = idleIndex < 0 ? 0 : idleIndex;
    const clip = asset.animations[clipIndex];
    if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) throw new Error('待機モーションがありません');
    // GLTFLoader preserves manifest order in asset.animations and exposes the
    // original JSON on its parser, including animation extras that AnimationClip omits.
    const clipExtras = asset.parser.json.animations?.[clipIndex]?.extras;
    const sample = clipSampler(asset.scene, clip, clipExtras?.idlePoseAtFirstFrame === true, clipExtras?.hairSpringVersion);
    overlay = createRigOverlay(asset.scene);
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = sRGBEncoding;
    const viewHeight = 1.056;
    const camera = new OrthographicCamera(-1, 1, viewHeight / 2, -viewHeight / 2, .01, 10);
    const center = new Vector3(0, .508, -.035);
    camera.position.copy(center);
    camera.position.z += 3.2;
    camera.lookAt(center);
    return {
      draw(ctx, seconds, options = {}) {
        if (renderer.getContext().isContextLost() || !Number.isFinite(seconds)) return false;
        const {width, height} = ctx.canvas;
        if (!width || !height) return false;
        if (renderer.domElement.width !== width || renderer.domElement.height !== height) {
          renderer.setSize(width, height, false);
          camera.right = viewHeight * width / height / 2;
          camera.left = -camera.right;
          camera.updateProjectionMatrix();
        }
        sample(seconds, options);
        renderer.render(asset.scene, camera);
        if (options.showMesh || options.showHeadMesh) overlay.meshLines(renderer,camera,!options.showMesh);
        ctx.drawImage(renderer.domElement, 0, 0);
        if (options.showPivots) overlay.pivots(ctx,camera);
        return true;
      },
      dispose
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
