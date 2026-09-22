// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
// Nine authored directions; all coordinates are in the registered canvas.
const HEAD_DIRECTIONS={up_left:[-1,-1],up:[0,-1],up_right:[1,-1],left:[-1,0],center:[0,0],right:[1,0],down_left:[-1,1],down:[0,1],down_right:[1,1]};
const HEAD_LABELS={center:'正面',left:'左',right:'右',up:'上',down:'下',up_left:'左上',up_right:'右上',down_left:'左下',down_right:'右下'};
const headFrameCache=new Map(),headBuffers=new Map();
const initialHeadPose=PROJECT.head_pose?structuredClone(PROJECT.head_pose):null;
let headRandomSeed=crypto.getRandomValues(new Uint32Array(1))[0],headRandomStart=0,headRandomFrom=[0,0];
let headDirection='center',headDraft=null,headDirty=false,headDrag=null,headAngle=[0,0];
const headKey=PROJECT.head_pose?`ChibiRigKit:headpose:1:${PROJECT.head_pose.layout_signature}`:null;
function headWeights(x,y){return Object.fromEntries(Object.entries(HEAD_DIRECTIONS).map(([name,[dx,dy]])=>[name,Math.max(0,1-Math.abs(x-dx))*Math.max(0,1-Math.abs(y-dy))]))}
function neutralHeadSetting(){return {x:0,y:0,rotation:0,scale_x:1,scale_y:1,vertices:Array.from({length:(PROJECT.head_pose.columns+1)*(PROJECT.head_pose.rows+1)},()=>[0,0])}}
function headSetting(p,pose){
  const direct=pose.parts[p.name];
  if(direct)return {...neutralHeadSetting(),...direct};
  // Closed art follows its open endpoint unless explicitly authored separately.
  if(p.transform_from&&PROJECT.head_pose.part_ids.includes(p.transform_from))return headSetting(PROJECT.parts[p.transform_from],pose);
  return neutralHeadSetting();
}
function mixedHeadSetting(p,x,y,config=PROJECT.head_pose){
  const result=neutralHeadSetting();result.scale_x=0;result.scale_y=0;
  for(const [name,weight] of Object.entries(headWeights(x,y))){
    if(!weight)continue;
    const pose=controls.headEdit.checked&&headDraft&&name===headDirection?headDraft:config.poses[name];
    const v=headSetting(p,pose);
    for(const key of ['x','y','rotation','scale_x','scale_y'])result[key]+=v[key]*weight;
    result.vertices=result.vertices.map(([dx,dy],i)=>[dx+v.vertices[i][0]*weight,dy+v.vertices[i][1]*weight]);
  }
  return result;
}
function headGrid(p){
  const h=PROJECT.head_pose,b=p.head_bounds,points=[],triangles=[];
  for(let r=0;r<=h.rows;r++)for(let c=0;c<=h.columns;c++)points.push([b.x+b.w*c/h.columns,b.y+b.h*r/h.rows]);
  for(let r=0;r<h.rows;r++)for(let c=0;c<h.columns;c++){
    const a=r*(h.columns+1)+c,b=a+1,d=a+h.columns+1,e=d+1;triangles.push([a,b,e],[a,e,d]);
  }
  return {points,triangles};
}
function headDest(p,setting){
  const g=headGrid(p),pivot=transformOwner(p).pivot;
  const m=around(pivot,setting.rotation,setting.x,setting.y,setting.scale_x,setting.scale_y);
  return g.points.map(([x,y],i)=>{x+=setting.vertices[i][0];y+=setting.vertices[i][1];return [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]});
}
function validHeadMesh(p,setting){
  const dest=headDest(p,setting);return headGrid(p).triangles.every(([i,j,k])=>{
    const a=dest[i],b=dest[j],c=dest[k];return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>.0001;
  });
}
function validateHeadConfig(config){
  const expected=PROJECT.head_pose;
  if(!config||config.version!==1||config.layout_signature!==expected.layout_signature||config.columns!==expected.columns||config.rows!==expected.rows||JSON.stringify(config.part_ids)!==JSON.stringify(expected.part_ids))throw Error('このキャラのパーツ構成と保存データが一致しません');
  if(!config.poses||Object.keys(config.poses).length!==9)throw Error('正面＋8方向のデータが必要です');
  const count=(config.columns+1)*(config.rows+1);
  for(const name of Object.keys(HEAD_DIRECTIONS)){
    const pose=config.poses[name];if(!pose||!pose.parts||typeof pose.parts!=='object')throw Error('方向データが不正です');
    for(const [pid,s] of Object.entries(pose.parts)){
      if(!config.part_ids.includes(pid)||!s||typeof s!=='object')throw Error('未知のパーツです');
      if(Object.keys(s).some(k=>!['x','y','rotation','scale_x','scale_y','vertices'].includes(k)))throw Error('未知の配置項目です');
      for(const k of ['x','y','rotation','scale_x','scale_y'])if(k in s&&(typeof s[k]!=='number'||!Number.isFinite(s[k])))throw Error('数値が不正です');
      if(Math.abs(s.rotation??0)>45||['scale_x','scale_y'].some(k=>(s[k]??1)<.3||(s[k]??1)>2))throw Error('角度または倍率が範囲外です');
      if(s.vertices&&(!Array.isArray(s.vertices)||s.vertices.length!==count||s.vertices.some(v=>!Array.isArray(v)||v.length!==2||!v.every(Number.isFinite))))throw Error('メッシュの頂点数または座標が不正です');
      if(!validHeadMesh(PROJECT.parts[pid],{...neutralHeadSetting(),...s}))throw Error('メッシュが折り返しています');
    }
  }
  // Test interpolation as well as endpoints; exact live frames have another guard.
  const wasEdit=controls.headEdit.checked;controls.headEdit.checked=false;
  try{for(let y=-1;y<=1;y+=.25)for(let x=-1;x<=1;x+=.25)for(const pid of config.part_ids){if(!validHeadMesh(PROJECT.parts[pid],mixedHeadSetting(PROJECT.parts[pid],x,y,config)))throw Error('方向の間でメッシュが折り返します')}}finally{controls.headEdit.checked=wasEdit}
  return true;
}
function headBuffer(key,width=canvas.width,height=canvas.height){
  if(!headBuffers.has(key)){const c=document.createElement('canvas');c.width=width;c.height=height;headBuffers.set(key,c)}
  const surface=headBuffers.get(key),context=surface.getContext('2d');context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,surface.width,surface.height);return [surface,context];
}
function headPoseActive(p){return PROJECT.head_pose?.part_ids.includes(p.name)}
function irisGazeOffset(owner){
  const manual=[Number($('gazeX').value),Number($('gazeY').value)];
  const automatic=!controls.headEdit.checked&&(controls.headRandom.checked||controls.headCircle.checked);
  const amount=Number(controls.gazeAmount?.value??1),limit=automatic?Math.max(1,amount):1;
  const gaze=manual.map((v,i)=>Math.max(-limit,Math.min(limit,v+(automatic?headAngle[i]*.9*amount:0))));
  return [gaze[0]*owner.w*(owner.mesh?.gaze_x_ratio??.10),gaze[1]*owner.h*(owner.mesh?.gaze_y_ratio??.08)];
}
function drawSplitEye(im,p,t,intensity,eyeOpen,target){
  const owner=PROJECT.parts[p.clip_to];
  const [surface,c]=headBuffer(`eye:${p.name}`);
  const iris=p.kind==='eye_iris';
  const gaze=irisGazeOffset(owner);
  c.drawImage(im,p.x+(iris?gaze[0]:0),p.y+(iris?gaze[1]:0));
  const [local,lc]=headBuffer(`crop:${p.name}`,owner.w,owner.h);lc.drawImage(surface,-owner.x,-owner.y);
  drawBlinkEye(local,owner,eyeOpen,target);
}
function amplifiedHeadSetting(p,setting,amount){
  // Scale the movement around the authored center, preserving its adjustments.
  const center=headSetting(p,PROJECT.head_pose.poses.center),result={...setting};
  for(const key of ['x','y','rotation','scale_x','scale_y'])result[key]=center[key]+(setting[key]-center[key])*amount;
  result.scale_x=Math.max(.3,Math.min(2,result.scale_x));result.scale_y=Math.max(.3,Math.min(2,result.scale_y));
  result.rotation=Math.max(-45,Math.min(45,result.rotation));
  result.vertices=setting.vertices.map((v,i)=>v.map((n,k)=>center.vertices[i][k]+(n-center.vertices[i][k])*amount));
  return result;
}
function currentHeadSetting(p){
  const setting=mixedHeadSetting(p,...headAngle);
  const result=!controls.headEdit.checked&&(controls.headRandom.checked||controls.headCircle.checked)?amplifiedHeadSetting(p,setting,Number(controls.headAmount?.value??1)):setting;
  const n=PROJECT.neck_sway;
  if(n?.poses&&controls.neckSway?.checked&&!controls.headEdit.checked){
    const weights=headWeights(neckCurrentAngles.yaw/n.yaw_extent,neckCurrentAngles.pitch/n.pitch_extent),owner=transformOwner(p);
    for(const [name,w] of Object.entries(weights)){
      const s=n.poses[name].parts[owner.name];if(!w||!s)continue;
      for(const key of ['x','y','rotation'])result[key]+=(s[key]||0)*w;
      for(const key of ['scale_x','scale_y'])result[key]+=((s[key]??1)-1)*w;
    }
  }
  return result;
}
// Apply one rigid rotation to every head layer, after its existing local motion.
// The anchor follows its body group, so the neck remains attached during sway.
function randomNeckAngle(t,seed){
  const step=Math.max(0,t)/3.2,index=Math.floor(step),phase=step-index;
  const target=i=>i===0?0:(i%2?1:-1)*(headNoise(0,seed)<.5?-1:1)*(.45+.55*headNoise(i,seed));
  const hold=.04+.12*headNoise(index+701,seed),end=.84+.12*headNoise(index+1701,seed);
  const u=Math.max(0,Math.min(1,(phase-hold)/(end-hold))),blend=u*u*u*(u*(u*6-15)+10);
  return target(index)+(target(index+1)-target(index))*blend;
}
function neckSwayAngles(t,intensity){
  if(!controls.neckSway?.checked||controls.headEdit.checked)return {yaw:0,pitch:0,roll:0};
  const time=Math.max(0,t)*Number(controls.motionSpeed.value),gain=Math.min(1,Math.max(0,intensity));
  return {
    yaw:randomNeckAngle(time*.83,headRandomSeed^0x13a9f27b)*Number(controls.neckYaw?.value??0)*gain,
    pitch:randomNeckAngle(time*.71,headRandomSeed^0x37b1e5a9)*Number(controls.neckPitch?.value??0)*gain,
    roll:randomNeckAngle(time,headRandomSeed^0x51a7c3d9)*Number(controls.neckAmount.value)*gain
  };
}
function neckSwayAngle(t,intensity){return neckSwayAngles(t,intensity).roll}
function neckProjectionMatrix(pivot,{yaw,pitch,roll}){
  // Orthographic projection of a shallow head plane in 3D, anchored at the neck.
  // Authored face poses supply the additional turning detail absent from one image.
  const d=Math.PI/180,cy=Math.cos(yaw*d),sy=Math.sin(yaw*d),cx=Math.cos(pitch*d),sx=-Math.sin(pitch*d),depth=.25;
  const projected=[cy,sx*sy,-sy*depth,cx+sx*cy*depth,0,0];
  const m=mul(around({x:0,y:0},roll,0,0),projected);
  m[4]=pivot.x-m[0]*pivot.x-m[2]*pivot.y;m[5]=pivot.y-m[1]*pivot.x-m[3]*pivot.y;return m;
}
function neckSwayMatrix(p,t,intensity){
  const config=PROJECT.neck_sway;
  if(!config||!config.part_ids.includes(p.name))return [1,0,0,1,0,0];
  const angles=neckSwayAngles(t,intensity);if(!angles.yaw&&!angles.pitch&&!angles.roll)return [1,0,0,1,0,0];
  const anchor=PROJECT.parts[config.anchor_part],g=groupMatrix(anchor.parent,t,intensity),v=config.pivot;
  const pivot={x:g[0]*v.x+g[2]*v.y+g[4],y:g[1]*v.x+g[3]*v.y+g[5]};
  return neckProjectionMatrix(pivot,angles);
}
let neckMasterFrame=null,neckCurrentAngles={yaw:0,pitch:0,roll:0};
function neckMasterMesh(t,intensity){
  if(neckMasterFrame)return neckMasterFrame;
  const n=PROJECT.neck_sway,a=neckSwayAngles(t,intensity),weights=headWeights(a.yaw/n.yaw_extent,a.pitch/n.pitch_extent);
  const group=groupMatrix(PROJECT.parts[n.anchor_part].parent,t,intensity),roll=around(n.pivot,a.roll,0,0);
  const map=(p,m)=>[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]];
  const source=n.mesh.points.map(p=>map(p,group));
  const dest=n.mesh.points.map((p,i)=>{const v=[0,0];for(const [name,w] of Object.entries(weights)){if(w){v[0]+=n.poses[name].vertices[i][0]*w;v[1]+=n.poses[name].vertices[i][1]*w}}return map(map(v,roll),group)});
  return neckMasterFrame={source,dest,triangles:n.mesh.triangles,angles:a};
}
function mapNeckMasterPoint(point,mesh){
  for(const [i,j,k] of mesh.triangles){
    const [a,b,c]=[i,j,k].map(index=>mesh.source[index]);
    const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    const u=((b[1]-c[1])*(point[0]-c[0])+(c[0]-b[0])*(point[1]-c[1]))/det;
    const v=((c[1]-a[1])*(point[0]-c[0])+(a[0]-c[0])*(point[1]-c[1]))/det,w=1-u-v;
    if(u>=-1e-7&&v>=-1e-7&&w>=-1e-7)return [0,1].map(axis=>mesh.dest[i][axis]*u+mesh.dest[j][axis]*v+mesh.dest[k][axis]*w);
  }
  return [...point];
}
function neckEyeMatrix(owner,t,intensity,mesh){
  let center=[owner.x+owner.w/2,owner.y+owner.h/2];
  if(headPoseActive(owner))center=headMapPoint(owner,center,currentHeadSetting(owner));
  const base=partMatrix(owner,t,intensity,false);center=[base[0]*center[0]+base[2]*center[1]+base[4],base[1]*center[0]+base[3]*center[1]+base[5]];
  const q=mapNeckMasterPoint(center,mesh),span=Math.max(20,owner.w*.3);
  const x0=mapNeckMasterPoint([center[0]-span,center[1]],mesh),x1=mapNeckMasterPoint([center[0]+span,center[1]],mesh);
  const y0=mapNeckMasterPoint([center[0],center[1]-span],mesh),y1=mapNeckMasterPoint([center[0],center[1]+span],mesh);
  const sx=Math.max(.93,Math.min(1.04,Math.hypot(x1[0]-x0[0],x1[1]-x0[1])/(2*span)));
  const sy=Math.max(.97,Math.min(1.04,Math.hypot(y1[0]-y0[0],y1[1]-y0[1])/(2*span)));
  // Position follows the parent; eye art keeps its shape without yaw/pitch shear.
  const n=PROJECT.neck_sway,diagonal=Math.min(1,Math.abs(mesh.angles.yaw/n.yaw_extent)*Math.abs(mesh.angles.pitch/n.pitch_extent));
  return around({x:center[0],y:center[1]},mesh.angles.roll,q[0]-center[0],q[1]-center[1],sx+(1-sx)*diagonal,sy+(1-sy)*diagonal);
}
function drawNeckVolume(target,source,p,t,intensity){
  const n=PROJECT.neck_sway,a=neckSwayAngles(t,intensity);
  if(!n?.part_ids.includes(p.name)||(!a.yaw&&!a.pitch&&!a.roll)){target.drawImage(source,0,0);return}
  if(!n.mesh){target.save();target.setTransform(...neckSwayMatrix(p,t,intensity));target.drawImage(source,0,0);target.restore();return}
  const mesh=neckMasterMesh(t,intensity),owner=transformOwner(p);
  if(owner.role==='eye'){target.save();target.setTransform(...neckEyeMatrix(owner,t,intensity,mesh));target.drawImage(source,0,0);target.restore();return}
  const b=owner.head_bounds||{x:owner.x,y:owner.y,w:owner.w,h:owner.h},matrix=partMatrix(p,t,intensity,false);
  const points=[[b.x,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.h],[b.x,b.y+b.h]];
  if(headPoseActive(p))points.push(...headDest(p,currentHeadSetting(p)));
  const world=points.map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]),pad=64+Math.abs(p.mesh?.amp_px||0)*intensity;
  const left=Math.min(...world.map(v=>v[0]))-pad,right=Math.max(...world.map(v=>v[0]))+pad,top=Math.min(...world.map(v=>v[1]))-pad,bottom=Math.max(...world.map(v=>v[1]))+pad;
  for(const ids of mesh.triangles){
    const src=ids.map(i=>mesh.source[i]);if(Math.max(...src.map(v=>v[0]))<left||Math.min(...src.map(v=>v[0]))>right||Math.max(...src.map(v=>v[1]))<top||Math.min(...src.map(v=>v[1]))>bottom)continue;
    drawEyeTriangle(target,source,src,ids.map(i=>mesh.dest[i]));
  }
}
function drawNeckMasterOverlay(t,intensity){
  if(!(controls.showMesh.checked||controls.showHeadMesh?.checked)||!PROJECT.neck_sway?.mesh||controls.headEdit.checked)return;
  const mesh=neckMasterMesh(t,intensity);ctx.save();ctx.strokeStyle='#00cce0';ctx.lineWidth=.6;ctx.globalAlpha=.45;
  for(const ids of mesh.triangles){ctx.beginPath();ids.forEach((i,k)=>k?ctx.lineTo(...mesh.dest[i]):ctx.moveTo(...mesh.dest[i]));ctx.closePath();ctx.stroke()}
  ctx.restore();
}
function renderHeadSurface(p,t,intensity,eyeOpen,variant="part"){
  const key=p.name+":"+variant;
  if(headFrameCache.has(key))return headFrameCache.get(key);
  const [content,c]=headBuffer(`content:${key}`),im=images[variant==="seam"?p.seam.file:p.file];
  drawPart(im,p,t*Number(controls.motionSpeed.value),intensity,eyeOpen,c);
  let drawing=content;
  if(headPoseActive(p)){
    let setting=currentHeadSetting(p);
    if(!validHeadMesh(p,setting)){setting=neutralHeadSetting();$('headStatus').textContent='折り返す配置を検出したため、このパーツを正面配置に戻しています'}
    const changed=['x','y','rotation'].some(k=>Math.abs(setting[k])>1e-10)||['scale_x','scale_y'].some(k=>Math.abs(setting[k]-1)>1e-10)||setting.vertices.some(v=>Math.abs(v[0])+Math.abs(v[1])>1e-10);
    if(changed){
      const [warped,w]=headBuffer(`warped:${key}`);
      if(setting.vertices.every(v=>Math.abs(v[0])+Math.abs(v[1])<1e-10)){
        w.save();w.setTransform(...around(transformOwner(p).pivot,setting.rotation,setting.x,setting.y,setting.scale_x,setting.scale_y));w.drawImage(content,0,0);w.restore();
      }else{
        const grid=headGrid(p),dest=headDest(p,setting);
        for(const tri of grid.triangles)drawEyeTriangle(w,content,tri.map(i=>grid.points[i]),tri.map(i=>dest[i]));
      }
      drawing=warped;
    }
  }
  const [base,bc]=headBuffer(`base:${key}`);bc.save();bc.setTransform(...partMatrix(p,t,intensity,false));bc.drawImage(drawing,0,0);bc.restore();
  const [world,w]=headBuffer(`world:${key}`);drawNeckVolume(w,base,p,t,intensity);
  if(p.kind==='eye_iris'){
    const sclera=renderHeadSurface(PROJECT.parts[p.clip_to],t,intensity,eyeOpen);
    w.save();w.globalCompositeOperation='destination-in';w.drawImage(sclera,0,0);w.restore();
  }
  headFrameCache.set(key,world);return world;
}
function beginHeadFrame(t){
  headFrameCache.clear();neckMasterFrame=null;neckCurrentAngles=neckSwayAngles(t,Number(controls.motionIntensity.value));
  if(!PROJECT.head_pose)return;
  if(controls.headEdit.checked)headAngle=HEAD_DIRECTIONS[headDirection];
  else if(controls.headRandom.checked){
    const speed=Number(controls.motionSpeed.value),amount=Math.min(1,Math.max(0,Number(controls.motionIntensity.value)));
    headAngle=randomHeadAngle(Math.max(0,t-headRandomStart)*speed,headRandomSeed,headRandomFrom).map(v=>v*amount);
  }
  else if(controls.headCircle.checked){const a=t*Number(controls.motionSpeed.value)*2*Math.PI/4;headAngle=[Math.sin(a),-Math.cos(a)]}
  else headAngle=[Number(controls.headX.value),Number(controls.headY.value)];
  if(!controls.headEdit.checked&&controls.neckSway?.checked){const angles=neckSwayAngles(t,Number(controls.motionIntensity.value));headAngle=[headAngle[0]+angles.yaw/30,headAngle[1]+angles.pitch/20].map(v=>Math.max(-1,Math.min(1,v)))}
  $('headXOut').textContent=headAngle[0].toFixed(2);$('headYOut').textContent=headAngle[1].toFixed(2);
}
function drawHeadOverlay(){
  if(!PROJECT.head_pose||!controls.headEdit.checked)return;
  const p=PROJECT.parts[$('headPart').value];if(!p)return;
  const setting=headSetting(p,headDraft),grid=headGrid(p),dest=headDest(p,setting),selected=Number($('headVertex').value);
  ctx.save();ctx.strokeStyle='#00d9ff';ctx.lineWidth=.7;
  for(const tri of grid.triangles){ctx.beginPath();tri.forEach((i,k)=>k?ctx.lineTo(...dest[i]):ctx.moveTo(...dest[i]));ctx.closePath();ctx.stroke()}
  dest.forEach(([x,y],i)=>{ctx.beginPath();ctx.arc(x,y,i===selected?4:2.5,0,Math.PI*2);ctx.fillStyle=i===selected?'#ffff40':'#00d9ff';ctx.fill()});ctx.restore();
}
function headMessage(text){$('headStatus').textContent=text}
function headMarkDirty(){headDirty=true;headMessage(`${HEAD_LABELS[headDirection]}：未保存の調整`)}
function syncHeadEditor(){
  const p=PROJECT.parts[$('headPart').value];if(!p||!headDraft)return;
  const s=headSetting(p,headDraft),v=s.vertices[Number($('headVertex').value)||0];
  for(const [id,key] of [['poseX','x'],['poseY','y'],['poseRotation','rotation'],['poseScaleX','scale_x'],['poseScaleY','scale_y']])$(id).value=s[key];
  $('vertexX').value=v[0];$('vertexY').value=v[1];
  for(const id of ['poseX','poseY','poseRotation','poseScaleX','poseScaleY','vertexX','vertexY'])$(id+'Out').textContent=Number($(id).value).toFixed(2);
}
function flushHeadDraft(){
  if(!headDraft)return;
  const candidate=structuredClone(PROJECT.head_pose);candidate.poses[headDirection]=structuredClone(headDraft);
  validateHeadConfig(candidate);PROJECT.head_pose=candidate;headDirty=false;
}
function resetHeadPoses(all=false){
  if(!initialHeadPose)return;
  const direction=all?'center':headDirection;
  const candidate=all?structuredClone(initialHeadPose):structuredClone(PROJECT.head_pose);
  if(!all)candidate.poses[direction]=structuredClone(initialHeadPose.poses[direction]);
  validateHeadConfig(candidate);
  // Discard the old draft before selectHeadDirection can flush it back.
  headDraft=null;headDirty=false;PROJECT.head_pose=candidate;
  $('gazeX').value=0;$('gazeY').value=0;
  selectHeadDirection(direction);
  const message=all?'9方向すべてを初期値に戻しました':'この方向を初期値に戻しました';
  try{localStorage.setItem(headKey,JSON.stringify(candidate));headMessage(message+'（このブラウザ）')}
  catch(e){headMessage(message+'。ブラウザ内に保存できないため、JSONを書き出してください')}
}
function saveHeadPoses(){
  if(headDraft)headDraft.status='authored';
  flushHeadDraft();
  try{localStorage.setItem(headKey,JSON.stringify(PROJECT.head_pose));headMessage(`${HEAD_LABELS[headDirection]}を保存しました（このブラウザ）。JSONでも書き出せます`)}
  catch(e){headMessage('ブラウザ内に保存できません。JSONを書き出して保存してください')}
}
function selectHeadDirection(name){
  // Keep unsaved work in the session when switching directions.
  if(headDraft)flushHeadDraft();
  headDirection=name;headDraft=structuredClone(PROJECT.head_pose.poses[name]);
  controls.headRandom.checked=false;controls.headCircle.checked=false;[controls.headX.value,controls.headY.value]=HEAD_DIRECTIONS[name];
  document.querySelectorAll('[data-head-direction]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.headDirection===name)));
  headMessage(`${HEAD_LABELS[name]}：${headDraft.status==='authored'?'保存済み':'たたき台'}。編集をONにして調整できます`);syncHeadEditor();
}
function editHeadSetting(edit){
  if(!controls.headEdit.checked){controls.headEdit.checked=true;controls.headRandom.checked=false;controls.headCircle.checked=false}
  const p=PROJECT.parts[$('headPart').value],s=structuredClone(headSetting(p,headDraft));edit(s);
  if(!validHeadMesh(p,s)){headMessage('メッシュが折り返すため、その移動は適用しません');syncHeadEditor();return}
  headDraft.parts[p.name]=s;headMarkDirty();syncHeadEditor();
}
function downloadHeadPoses(){flushHeadDraft();const blob=new Blob([JSON.stringify(PROJECT.head_pose,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='head-poses.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function initHeadEditor(){
  if(!PROJECT.head_pose){$('headPanel').hidden=true;return}
  try{const saved=localStorage.getItem(headKey);if(saved){const data=JSON.parse(saved);validateHeadConfig(data);PROJECT.head_pose=data;headMessage('保存済みの9方向を復元しました')}}catch(e){headMessage(`保存データを復元できません：${e.message}`)}
  for(const [name,label] of Object.entries(HEAD_LABELS)){
    const b=document.querySelector(`[data-head-direction="${name}"]`);b.textContent=label;b.onclick=()=>{try{selectHeadDirection(name)}catch(e){headMessage(e.message)}};
  }
  for(const pid of PROJECT.head_pose.part_ids){const o=document.createElement('option');o.value=pid;o.textContent=pid;$('headPart').append(o)}
  for(let r=0;r<=PROJECT.head_pose.rows;r++)for(let c=0;c<=PROJECT.head_pose.columns;c++){const o=document.createElement('option');o.value=r*(PROJECT.head_pose.columns+1)+c;o.textContent=`頂点 ${r+1}行 ${c+1}列`;$('headVertex').append(o)}
  for(const id of ['poseX','vertexX']){$(id).min=-canvas.width*.5;$(id).max=canvas.width*.5}
  for(const id of ['poseY','vertexY']){$(id).min=-canvas.height*.5;$(id).max=canvas.height*.5}
  $('headPart').onchange=syncHeadEditor;$('headVertex').onchange=syncHeadEditor;
  for(const [id,key] of [['poseX','x'],['poseY','y'],['poseRotation','rotation'],['poseScaleX','scale_x'],['poseScaleY','scale_y']])$(id).addEventListener('input',()=>editHeadSetting(s=>s[key]=Number($(id).value)));
  for(const [id,index] of [['vertexX',0],['vertexY',1]])$(id).addEventListener('input',()=>editHeadSetting(s=>s.vertices[Number($('headVertex').value)][index]=Number($(id).value)));
  controls.headEdit.addEventListener('change',()=>{if(controls.headEdit.checked){controls.headRandom.checked=false;controls.headCircle.checked=false}else{try{flushHeadDraft()}catch(e){controls.headEdit.checked=true;headMessage(e.message)}}});
  controls.headCircle.addEventListener('change',()=>{if(controls.headCircle.checked){try{flushHeadDraft();controls.headEdit.checked=false;controls.headRandom.checked=false}catch(e){controls.headCircle.checked=false;headMessage(e.message)}}});
  for(const c of [controls.headX,controls.headY])c.addEventListener('input',()=>{try{flushHeadDraft();controls.headEdit.checked=false;controls.headRandom.checked=false;controls.headCircle.checked=false}catch(e){headMessage(e.message)}});
  controls.headRandom.addEventListener('change',()=>{if(controls.headRandom.checked)try{flushHeadDraft();controls.headEdit.checked=false;controls.headCircle.checked=false;resetRandomHead(headAngle,running?(performance.now()-start)/1000:pausedAt)}catch(e){controls.headRandom.checked=false;headMessage(e.message)}});
  $('saveHeadPose').onclick=()=>{try{saveHeadPoses()}catch(e){headMessage(e.message)}};
  $('resetHeadPose').onclick=()=>{try{resetHeadPoses(false)}catch(e){headMessage(e.message)}};
  $('resetAllHeadPoses').onclick=()=>{try{resetHeadPoses(true)}catch(e){headMessage(e.message)}};
  $('exportHeadPose').onclick=()=>{try{downloadHeadPoses()}catch(e){headMessage(e.message)}};
  $('importHeadPose').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{
    const data=JSON.parse(await file.text());validateHeadConfig(data);PROJECT.head_pose=data;headDraft=null;selectHeadDirection('center');saveHeadPoses();
  }catch(error){headMessage(`読み込めません：${error.message}`)}finally{e.target.value=''}};
  const autoplay=controls.headRandom.checked;selectHeadDirection('center');controls.headRandom.checked=autoplay;
  canvas.addEventListener('pointerdown',e=>{
    if(!controls.headEdit.checked)return;
    const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)*canvas.width/rect.width,y=(e.clientY-rect.top)*canvas.height/rect.height;
    const p=PROJECT.parts[$('headPart').value],dest=headDest(p,headSetting(p,headDraft));let best=-1,distance=12*canvas.width/rect.width;
    dest.forEach(([px,py],i)=>{const d=Math.hypot(px-x,py-y);if(d<distance){best=i;distance=d}});
    if(best<0)return;$('headVertex').value=best;headDrag={x,y};canvas.setPointerCapture(e.pointerId);syncHeadEditor();e.preventDefault();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!headDrag)return;
    const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)*canvas.width/rect.width,y=(e.clientY-rect.top)*canvas.height/rect.height,dx=x-headDrag.x,dy=y-headDrag.y;
    editHeadSetting(s=>{const a=s.rotation*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),v=s.vertices[Number($('headVertex').value)];v[0]+=(c*dx+sn*dy)/s.scale_x;v[1]+=(-sn*dx+c*dy)/s.scale_y});headDrag={x,y};
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>headDrag=null);
}

function headMapPoint(p,point,setting){
  const h=PROJECT.head_pose,b=p.head_bounds,d=headDest(p,setting);
  const u=Math.max(0,Math.min(h.columns,(point[0]-b.x)/b.w*h.columns)),v=Math.max(0,Math.min(h.rows,(point[1]-b.y)/b.h*h.rows));
  const c=Math.min(h.columns-1,Math.floor(u)),r=Math.min(h.rows-1,Math.floor(v)),x=u-c,y=v-r,a=r*(h.columns+1)+c,e=a+h.columns+2;
  const ids=x>=y?[a,a+1,e]:[a,e,a+h.columns+1],weights=x>=y?[1-x,x-y,y]:[1-y,x,y-x];
  return [0,1].map(axis=>ids.reduce((sum,i,k)=>sum+d[i][axis]*weights[k],0));
}

// Smooth random targets with quiet pauses. Stateless sampling makes seeking and
// recording reproducible within a session, without frame-dependent jitter.
function headNoise(index,seed){
  let n=(Math.imul(index+1,0x9e3779b1)^seed)>>>0;
  n=Math.imul(n^(n>>>16),0x21f0aaad);n=Math.imul(n^(n>>>15),0x735a2d97);
  return ((n^(n>>>15))>>>0)/4294967296;
}
function randomHeadTarget(index,seed,initial){
  if(index===0)return initial;
  if(headNoise(index*3,seed)<.28)return [0,0];
  const angle=headNoise(index*3+1,seed)*Math.PI*2,radius=.3+.65*headNoise(index*3+2,seed);
  return [Math.cos(angle)*radius,Math.sin(angle)*radius*.8];
}
function randomHeadAngle(t,seed,initial=[0,0]){
  const step=Math.max(0,t)/4.8,index=Math.floor(step),phase=step-index;
  const a=randomHeadTarget(index,seed,initial),b=randomHeadTarget(index+1,seed,initial);
  const u=Math.max(0,Math.min(1,(phase-.12)/.76)),mix=u*u*u*(u*(u*6-15)+10);
  return a.map((v,i)=>v+(b[i]-v)*mix);
}
function resetRandomHead(from=[0,0],time=0){headRandomFrom=[...from];headRandomStart=time;}
