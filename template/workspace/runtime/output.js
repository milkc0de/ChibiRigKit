// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
const outputCanvas=document.createElement('canvas');outputCanvas.width=1280;outputCanvas.height=720;
const outputState={crop:{x:0,y:0,w:canvas.width,h:canvas.height},drag:null,selecting:false,session:null};
async function studioSession(){if(outputState.session)return outputState.session;const r=await fetch('/api/session');if(!r.ok)throw Error('親フォルダで npm run player を実行して開いてください');return outputState.session=await r.json()}
async function studioRequest(path,data){const session=await studioSession(),r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-ChibiRig-Token':session.token},body:JSON.stringify(data||{})});const result=await r.json();if(!r.ok)throw Error(result.error||'操作に失敗しました');return result}
function validOutputCrop(r){if(!r||!['x','y','w','h'].every(k=>Number.isFinite(r[k]))||r.w<32||r.h<32||r.x<0||r.y<0||r.x+r.w>canvas.width+.01||r.y+r.h>canvas.height+.01)throw Error('出力範囲が不正です');return {...r}}
function cropPointer(e){const b=$('cropOverlay').getBoundingClientRect();return [Math.max(0,Math.min(canvas.width,(e.clientX-b.left)/b.width*canvas.width)),Math.max(0,Math.min(canvas.height,(e.clientY-b.top)/b.height*canvas.height))]}
function cropFromDrag(d,q){
 const [x,y]=q,a=d.rect;
 if(d.mode==='move')return {...a,x:Math.max(0,Math.min(canvas.width-a.w,a.x+x-d.start[0])),y:Math.max(0,Math.min(canvas.height-a.h,a.y+y-d.start[1]))};
 const anchor=d.anchor||d.start;return {x:Math.min(anchor[0],x),y:Math.min(anchor[1],y),w:Math.abs(x-anchor[0]),h:Math.abs(y-anchor[1])};
}
function drawCropOverlay(){const overlay=$('cropOverlay'),c=overlay.getContext('2d'),r=outputState.crop;c.clearRect(0,0,overlay.width,overlay.height);if(!outputState.selecting)return;c.fillStyle='#0008';c.beginPath();c.rect(0,0,canvas.width,canvas.height);c.rect(r.x,r.y,r.w,r.h);c.fill('evenodd');c.strokeStyle='#65e4fa';c.lineWidth=3;c.strokeRect(r.x,r.y,r.w,r.h);c.fillStyle='#65e4fa';for(const [x,y] of [[r.x,r.y],[r.x+r.w,r.y],[r.x,r.y+r.h],[r.x+r.w,r.y+r.h]])c.fillRect(x-7,y-7,14,14)}
function updateOutputCrop(r){outputState.crop=validOutputCrop(r);$('cropInfo').textContent=`${Math.round(r.w)} × ${Math.round(r.h)} px`;drawCropOverlay();requestRender();try{localStorage.setItem('chibirig.output.v1',JSON.stringify(r))}catch{}}
function renderOutput(){
 displayCanvas.getContext('2d').drawImage(canvas,0,0);
 if(!recordingActive)return;
 const c=outputCanvas.getContext('2d'),r=outputState.crop;c.fillStyle=$('outputColor')?.value||'#202020';c.fillRect(0,0,outputCanvas.width,outputCanvas.height);
 const scale=Math.min(outputCanvas.width/r.w,outputCanvas.height/r.h),w=r.w*scale,h=r.h*scale;c.drawImage(canvas,r.x,r.y,r.w,r.h,(outputCanvas.width-w)/2,(outputCanvas.height-h)/2,w,h);
}
function initOutput(){
 const overlay=$('cropOverlay');overlay.width=canvas.width;overlay.height=canvas.height;
 $('cropSelect').onclick=()=>{outputState.selecting=!outputState.selecting;overlay.hidden=!outputState.selecting;controls.headEdit.checked=false;$('cropSelect').textContent=outputState.selecting?'範囲指定を完了':'ドラッグで録画範囲を指定';drawCropOverlay()};
 $('cropReset').onclick=()=>updateOutputCrop({x:0,y:0,w:canvas.width,h:canvas.height});
 overlay.onpointerdown=e=>{if(e.button!==0)return;const q=cropPointer(e),r=outputState.crop,corners=[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]],threshold=18*canvas.width/overlay.getBoundingClientRect().width;let mode='new',anchor;for(let i=0;i<4;i++)if(Math.hypot(q[0]-corners[i][0],q[1]-corners[i][1])<threshold){mode='resize';anchor=corners[(i+2)%4];break}if(mode==='new'&&!e.shiftKey&&q[0]>r.x&&q[0]<r.x+r.w&&q[1]>r.y&&q[1]<r.y+r.h)mode='move';outputState.drag={start:q,rect:{...r},mode,anchor};overlay.setPointerCapture(e.pointerId);e.preventDefault()};
 overlay.onpointermove=e=>{if(!outputState.drag)return;const r=cropFromDrag(outputState.drag,cropPointer(e));if(r.w>=32&&r.h>=32){outputState.crop=r;drawCropOverlay();requestRender()}};
 const finish=e=>{if(outputState.drag){outputState.drag=null;updateOutputCrop(outputState.crop);if(overlay.hasPointerCapture(e.pointerId))overlay.releasePointerCapture(e.pointerId)}};overlay.onpointerup=finish;overlay.onpointercancel=finish;
 for(const axis of ['Yaw','Pitch','Roll']){const el=$('capture'+axis+'Gain');el.oninput=()=>{$('capture'+axis+'GainOut').textContent=Number(el.value).toFixed(2)+'×';requestRender()}}
 try{const saved=localStorage.getItem('chibirig.output.v1');if(saved)updateOutputCrop(JSON.parse(saved))}catch{};
}
