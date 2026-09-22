// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
// Import motion settings only; source images, masks and rig topology stay local.
const motionControls={capture_yaw_gain:'captureYawGain',capture_pitch_gain:'capturePitchGain',capture_roll_gain:'captureRollGain',capture_mouth_gain:'captureMouthGain',capture_brow_gain:'captureBrowGain',neck_yaw_degrees:'neckYaw',neck_pitch_degrees:'neckPitch',neck_sway:'neckSway',neck_sway_degrees:'neckAmount',head_motion_amount:'headAmount',gaze_motion_amount:'gazeAmount',duration_seconds:'duration',motion_intensity:'motionIntensity',motion_speed:'motionSpeed',expression:'expression',auto_blink:'autoBlink',auto_expression:'autoExpression',eye_open:'eyeOpenTest',manual_eye_open:'manualEyeOpen',mouth_open:'mouthOpenTest',manual_mouth_open:'manualMouthOpen',head_random:'headRandom',head_circle:'headCircle',head_x:'headX',head_y:'headY',gaze_x:'gazeX',gaze_y:'gazeY',show_seams:'showSeams'};
const motionRanges={capture_yaw_gain:[0,3],capture_pitch_gain:[0,3],capture_roll_gain:[0,3],capture_mouth_gain:[.5,8],capture_brow_gain:[.5,4],neck_yaw_degrees:[0,30],neck_pitch_degrees:[0,25],neck_sway_degrees:[0,15],head_motion_amount:[0,4],gaze_motion_amount:[0,4],duration_seconds:[1,60],motion_intensity:[0,5],motion_speed:[.1,5],expression:[0,1],eye_open:[0,1],mouth_open:[0,1],head_x:[-1,1],head_y:[-1,1],gaze_x:[-1,1],gaze_y:[-1,1]};
function stableRigJSON(value){
  if(Array.isArray(value))return '['+value.map(stableRigJSON).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableRigJSON(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function rigWithoutMotion(value){const copy=structuredClone(value);delete copy.motion;return copy}
function checkedMotion(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${label}の動きが不正です`);
  const allowed=['rot_deg','x_px','y_px','scale_x_pct','scale_y_pct','phase','freq'];
  for(const [key,n] of Object.entries(value)){
    if(!allowed.includes(key)||typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>1e6)throw Error(`${label}.${key}の数値が不正です`);
    if(key==='freq'&&n<=0||['scale_x_pct','scale_y_pct'].includes(key)&&n<=-100)throw Error(`${label}.${key}の範囲が不正です`);
  }
  return structuredClone(value);
}
function expandMotionPreset(data){
  if(data?.format!=='chibirigkit.motion')return data;
  if(data.version!==1||!PROJECT.motion_layout_signature||data.layout_signature!==PROJECT.motion_layout_signature)throw Error('このキャラ用の動きJSONを選んでください');
  const full=structuredClone(PROJECT);
  for(const key of ['parts','groups']){
    const current=PROJECT[key]||{},motions=data[key];
    if(!motions||typeof motions!=='object'||Array.isArray(motions)||stableRigJSON(Object.keys(motions).sort())!==stableRigJSON(Object.keys(current).sort()))throw Error(`${key}の構成が一致しません`);
    for(const id of Object.keys(current))full[key][id].motion=motions[id];
  }
  full.settings=data.settings;
  if(data.head_pose)full.head_pose=data.head_pose;
  else if(full.head_pose&&headDraft&&headDirty)full.head_pose.poses[headDirection]=structuredClone(headDraft);
  return full;
}
function validateMotionProject(data){
  data=expandMotionPreset(data);
  const fail=()=>{throw Error('このキャラと画像・パーツ構成が一致する全体JSONを選んでください')};
  if(!data||data.version!==PROJECT.version||stableRigJSON(data.canvas)!==stableRigJSON(PROJECT.canvas)||stableRigJSON(data.draw_order)!==stableRigJSON(PROJECT.draw_order))fail();
  const parts=data.parts,groups=data.groups||{},currentGroups=PROJECT.groups||{};
  if(!parts||stableRigJSON(Object.keys(parts).sort())!==stableRigJSON(Object.keys(PROJECT.parts).sort())||stableRigJSON(Object.keys(groups).sort())!==stableRigJSON(Object.keys(currentGroups).sort()))fail();
  const candidate={parts:{},groups:{},settings:structuredClone(initialSettings)};
  for(const [id,current] of Object.entries(PROJECT.parts)){
    if(stableRigJSON(rigWithoutMotion(parts[id]))!==stableRigJSON(rigWithoutMotion(current)))fail();
    candidate.parts[id]=checkedMotion(parts[id].motion||{},id);
  }
  for(const [id,current] of Object.entries(currentGroups)){
    if(stableRigJSON(rigWithoutMotion(groups[id]))!==stableRigJSON(rigWithoutMotion(current)))fail();
    candidate.groups[id]=checkedMotion(groups[id].motion||{},id);
  }
  if(data.settings!=null&&(typeof data.settings!=='object'||Array.isArray(data.settings)))throw Error('全体設定が不正です');
  for(const [key,value] of Object.entries(data.settings||{})){
    if(key in motionRanges){const [min,max]=motionRanges[key];if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(`${key}は${min}〜${max}で指定してください`);candidate.settings[key]=value}
    else if(Object.hasOwn(motionControls,key)){if(typeof value!=='boolean')throw Error(`${key}はtrue/falseで指定してください`);candidate.settings[key]=value}
  }
  if(candidate.settings.head_random&&candidate.settings.head_circle)throw Error('ランダム顔向きと円運動は同時に指定できません');
  if(data.settings?.blink){
    const blink=data.settings.blink,a=blink.closed_eye_swap_start??.92,b=blink.closed_eye_swap_end??.995;
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||a>=b||b>1)throw Error('瞬きの切替値が不正です');
    candidate.settings.blink={closed_eye_swap_start:a,closed_eye_swap_end:b};
  }
  if(Boolean(data.head_pose)!==Boolean(PROJECT.head_pose))fail();
  if(data.head_pose){validateHeadConfig(data.head_pose);candidate.head_pose=structuredClone(data.head_pose)}
  return candidate;
}
function collectMotionProject(){
  if(PROJECT.head_pose)flushHeadDraft();
  const data=structuredClone(PROJECT);
  data.settings=data.settings||{};
  for(const [key,id] of Object.entries(motionControls)){const control=$(id);data.settings[key]=control.type==='checkbox'?control.checked:Number(control.value)}
  return data;
}
function collectMotionPreset(){
  const full=collectMotionProject();
  const preset={format:'chibirigkit.motion',version:1,layout_signature:PROJECT.motion_layout_signature,settings:full.settings,
    parts:Object.fromEntries(Object.entries(full.parts).map(([id,p])=>[id,p.motion||{}])),
    groups:Object.fromEntries(Object.entries(full.groups||{}).map(([id,g])=>[id,g.motion||{}]))};
  if(full.head_pose)preset.head_pose=full.head_pose;
  return preset;
}
function applyMotionProject(data){
  // Validation completes before changing any live data or controls.
  const candidate=validateMotionProject(data);
  clearCaptureMotion();
  for(const [id,motion] of Object.entries(candidate.parts))PROJECT.parts[id].motion=motion;
  for(const [id,motion] of Object.entries(candidate.groups))PROJECT.groups[id].motion=motion;
  PROJECT.settings=candidate.settings;
  controls.headEdit.checked=false;
  if(candidate.head_pose){PROJECT.head_pose=candidate.head_pose;headDraft=null;headDirty=false;selectHeadDirection('center')}
  const defaults={capture_yaw_gain:1,capture_pitch_gain:1,capture_roll_gain:1,capture_mouth_gain:1,capture_brow_gain:2,neck_yaw_degrees:12,neck_pitch_degrees:8,neck_sway:true,neck_sway_degrees:6,head_motion_amount:1.5,gaze_motion_amount:1.5,motion_speed:1,expression:0,auto_blink:true,auto_expression:false,eye_open:1,manual_eye_open:false,mouth_open:1,manual_mouth_open:false,head_random:false,head_circle:false,head_x:0,head_y:0,gaze_x:0,gaze_y:0,show_seams:true};
  for(const [key,id] of Object.entries(motionControls)){
    const control=$(id),value=candidate.settings[key]??defaults[key];
    if(value===undefined)continue;
    if(control.type==='checkbox')control.checked=value;else control.value=value;
  }
  resetRandomHead();start=performance.now();pausedAt=0;running=true;$('pause').textContent='一時停止';
  updateLabels();syncSelected();render(0);
}
function initMotionIO(){
  for(const [key,id] of Object.entries(motionControls)){const control=$(id),value=initialSettings[key];if(value===undefined)continue;if(control.type==='checkbox')control.checked=value;else control.value=value;}
  updateLabels();
  $('exportJson').onclick=()=>{try{
    const blob=new Blob([JSON.stringify(collectMotionPreset(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='motion.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('motionIOStatus').textContent='全体の動きと顔配置をJSONに書き出しました';
  }catch(e){$('motionIOStatus').textContent=`書き出せません：${e.message}`}};
  $('importJson').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{applyMotionProject(JSON.parse(await file.text()));$('motionIOStatus').textContent=`${file.name}：全体の動きと顔配置を読み込みました`}
    catch(error){$('motionIOStatus').textContent=`読み込めません：${error.message}`}
    finally{e.target.value=''}
  };
}
