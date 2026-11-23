// SPDX-License-Identifier: Apache-2.0
import {BufferGeometry, MeshBasicMaterial, Vector3} from 'three';

function headGeometry(mesh) {
  const source=mesh.geometry, skin=source.getAttribute('skinIndex'), weights=source.getAttribute('skinWeight');
  if (!mesh.isSkinnedMesh || !skin || !weights) return null;
  const belongs=mesh.skeleton.bones.map(bone=>{
    for(let p=bone;p;p=p.parent) if ((p.userData.name || p.name)==='head' || (p.userData.name || p.name)==='neck') return true;
    return false;
  });
  const weight=new Float32Array(skin.count);
  for(let i=0;i<skin.count;i++) {
    weight[i]=(belongs[skin.getX(i)] ? weights.getX(i) : 0) +
      (belongs[skin.getY(i)] ? weights.getY(i) : 0) +
      (belongs[skin.getZ(i)] ? weights.getZ(i) : 0) +
      (belongs[skin.getW(i)] ? weights.getW(i) : 0);
  }
  const index=source.index, count=index?.count ?? skin.count, indices=[];
  for(let n=0;n<count;n+=3) {
    const a=index ? index.getX(n) : n,b=index ? index.getX(n+1) : n+1,c=index ? index.getX(n+2) : n+2;
    if (weight[a]+weight[b]+weight[c]>1.5) indices.push(a,b,c);
  }
  if (!indices.length) return null;
  if (indices.length===count) return source;
  const geometry=new BufferGeometry();
  for(const [name,value] of Object.entries(source.attributes)) geometry.setAttribute(name,value);
  geometry.morphAttributes=source.morphAttributes;
  geometry.morphTargetsRelative=source.morphTargetsRelative;
  geometry.setIndex(indices);
  return geometry;
}

export function createRigOverlay(scene) {
  const meshes=[],bones=[];
  scene.traverse(obj=>{
    if (obj.isMesh) meshes.push(obj);
    if (obj.isBone) bones.push(obj);
  });
  const headMeshes=new Map(), point=new Vector3();
  const material=new MeshBasicMaterial({color:0x81dbff,wireframe:true,transparent:true,opacity:.53,depthWrite:false});
  function meshLines(renderer,camera,headOnly) {
    const previousClear=renderer.autoClear,saved=[];
    for(const mesh of meshes) {
      saved.push([mesh,mesh.geometry,mesh.material,mesh.visible]);
      mesh.material=material;
      if (headOnly) {
        if (!headMeshes.has(mesh)) headMeshes.set(mesh,headGeometry(mesh));
        const selected=headMeshes.get(mesh);
        if(selected) mesh.geometry=selected;
        else mesh.visible=false;
      }
    }
    renderer.autoClear=false;
    try { renderer.render(scene,camera); }
    finally {
      renderer.autoClear=previousClear;
      for(const [mesh,geometry,originalMaterial,visible] of saved) {
        mesh.geometry=geometry;mesh.material=originalMaterial;mesh.visible=visible;
      }
    }
  }
  function pivots(ctx,camera) {
    const {width,height}=ctx.canvas;
    ctx.save();ctx.fillStyle='#ff536c';ctx.strokeStyle='#49333d';ctx.lineWidth=1.2;
    const radius=Math.max(2,height/310);
    for(const bone of bones) {
      point.setFromMatrixPosition(bone.matrixWorld).project(camera);
      if(point.z < -1 || point.z > 1) continue;
      ctx.beginPath();ctx.arc((point.x+1)*width/2,(1-point.y)*height/2,radius,0,Math.PI*2);ctx.fill();ctx.stroke();
    }
    ctx.restore();
  }
  function dispose() {
    for(const [mesh,geometry] of headMeshes) if (geometry && geometry!==mesh.geometry) {
      // The subset owns only its index buffer. Vertex and morph buffers are shared.
      geometry.attributes={};geometry.morphAttributes={};geometry.dispose();
    }
    material.dispose();
  }
  return {meshLines,pivots,dispose};
}
