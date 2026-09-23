// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
// Background selection is local to this browser; source layers remain immutable.
const backgroundDefaults={version:1,mode:'original',color:'#e9dfd3',fit:'cover',image:null,name:''};
let backgroundState={...backgroundDefaults},backgroundImage=null,backgroundRevision=0;
const backgroundKey=`ChibiRigKit:background:1:${PROJECT.name}:${canvas.width}x${canvas.height}`;
function isBackgroundPart(p){return p.role==='background'||(p.name==='background'&&p.kind==='static')}
function customBackgroundActive(){return backgroundState.mode!=='original'&&!controls.showBaseOnly.checked}
function backgroundRect(width,height,targetWidth,targetHeight,fit){
  const scale=(fit==='contain'?Math.min:Math.max)(targetWidth/width,targetHeight/height);
  const w=width*scale,h=height*scale;return [(targetWidth-w)/2,(targetHeight-h)/2,w,h];
}
function drawBackground(){
  if(!customBackgroundActive()||backgroundState.mode==='transparent')return;
  ctx.save();ctx.fillStyle=backgroundState.color;ctx.fillRect(0,0,canvas.width,canvas.height);
  if(backgroundState.mode==='image'&&backgroundImage)ctx.drawImage(backgroundImage,...backgroundRect(backgroundImage.width,backgroundImage.height,canvas.width,canvas.height,backgroundState.fit));
  ctx.restore();
}
function validBackground(data){
  if(!data||data.version!==1||!['original','color','image','transparent'].includes(data.mode)||!/^#[0-9a-f]{6}$/i.test(data.color)||!['cover','contain'].includes(data.fit))throw Error('背景の保存データが不正です');
  if(data.image!==null&&(typeof data.image!=='string'||data.image.length>12000000||!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(data.image)))throw Error('背景画像の保存データが不正です');
  if(data.mode==='image'&&!data.image)throw Error('背景画像を選んでください');
  return {version:1,mode:data.mode,color:data.color,fit:data.fit,image:data.image,name:typeof data.name==='string'?data.name.slice(0,200):''};
}
function syncBackground(){
  $('backgroundMode').value=backgroundState.mode;$('backgroundColor').value=backgroundState.color;$('backgroundFit').value=backgroundState.fit;
  $('backgroundFit').disabled=backgroundState.mode!=='image';
}
function backgroundMessage(message){$('backgroundStatus').textContent=message}
function persistBackground(){
  try{localStorage.setItem(backgroundKey,JSON.stringify(backgroundState));backgroundMessage(backgroundState.mode==='image'?`${backgroundState.name}（このブラウザに保存済み）`:'このブラウザに保存しました')}
  catch(e){backgroundMessage('表示には反映しましたが、保存容量が足りないため再読み込み後には残りません')}
}
function setBackground(data,image=backgroundImage){backgroundState=validBackground(data);backgroundImage=image;syncBackground();persistBackground();if(typeof requestRender==='function')requestRender()}
async function chooseBackgroundFile(file){
  const revision=++backgroundRevision;
  try{
    if(!/\.(png|jpe?g|webp)$/i.test(file.name)||file.size>20*1024*1024)throw Error('20MB以下のPNG・JPEG・WebPを選んでください');
    const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('画像を読み込めません'));reader.readAsDataURL(file)});
    const original=await loadImage(url);if(revision!==backgroundRevision)return;
    const scale=Math.min(1,1600/original.width,1600/original.height),surface=document.createElement('canvas');
    surface.width=Math.max(1,Math.round(original.width*scale));surface.height=Math.max(1,Math.round(original.height*scale));surface.getContext('2d').drawImage(original,0,0,surface.width,surface.height);
    const image=surface.toDataURL('image/webp',.92),decoded=await loadImage(image);if(revision!==backgroundRevision)return;
    setBackground({...backgroundState,mode:'image',image,name:file.name},decoded);
  }catch(error){if(revision===backgroundRevision)backgroundMessage(error.message||'画像を読み込めません。前の背景を保持しています')}
}
async function initBackground(){
  $('backgroundMode').onchange=()=>{backgroundRevision++;try{setBackground({...backgroundState,mode:$('backgroundMode').value})}catch(e){syncBackground();backgroundMessage(e.message)}};
  $('backgroundColor').oninput=()=>{backgroundRevision++;setBackground({...backgroundState,mode:'color',color:$('backgroundColor').value})};
  $('backgroundFit').onchange=()=>{backgroundRevision++;setBackground({...backgroundState,fit:$('backgroundFit').value})};
  $('backgroundFile').onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)chooseBackgroundFile(file)};
  $('resetBackground').onclick=()=>{backgroundRevision++;backgroundState={...backgroundDefaults};backgroundImage=null;syncBackground();try{localStorage.removeItem(backgroundKey);backgroundMessage('元の背景に戻しました')}catch(e){persistBackground()}};
  const revision=++backgroundRevision;
  try{
    const saved=localStorage.getItem(backgroundKey);
    if(saved){const data=validBackground(JSON.parse(saved)),image=data.image?await loadImage(data.image):null;if(revision!==backgroundRevision)return;backgroundState=data;backgroundImage=image;backgroundMessage('保存した背景を復元しました')}
  }catch(e){backgroundMessage('保存した背景を復元できないため、元の背景を表示しています')}
  syncBackground();
}
