// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
function zipCRC32(bytes){let crc=0xffffffff;for(const value of bytes){crc^=value;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
// Create a standard UTF-8 ZIP without network access or dependencies.
function createZip(files){
  const encoder=new TextEncoder(),chunks=[],directory=[];let offset=0;
  for(const [name,content] of Object.entries(files)){
    if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(x=>x==='..'||x==='.'||!x))throw Error('ZIPのファイル名が不正です');
    const filename=encoder.encode(name),bytes=typeof content==='string'?encoder.encode(content):content;
    if(filename.length>65535||bytes.length>0xffffffff)throw Error('ZIPに入れるファイルが大きすぎます');
    const crc=zipCRC32(bytes),local=new Uint8Array(30+filename.length),l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,bytes.length,true);l.setUint32(22,bytes.length,true);l.setUint16(26,filename.length,true);local.set(filename,30);
    const central=new Uint8Array(46+filename.length),c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,0x314,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,filename.length,true);c.setUint32(38,((/\.(sh|command)$/.test(name)?0o100755:0o100644)<<16)>>>0,true);c.setUint32(42,offset,true);central.set(filename,46);
    chunks.push(local,bytes);directory.push(central);offset+=local.length+bytes.length;
  }
  const count=directory.length,size=directory.reduce((sum,d)=>sum+d.length,0);
  if(count>65535||offset+size>0xffffffff)throw Error('ZIPの上限を超えています');
  const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,count,true);e.setUint16(10,count,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  return new Blob([...chunks,...directory,end],{type:'application/zip'});
}
function exportCapture(){
  if(!captureMotion||!$('bundleIncludeMotion')?.checked)return null;
  const clip=MotionClip.parse(captureMotion.source);
  return {source:{format:'ChibiRigMotion',version:1,timeUnit:'seconds',duration:clip.duration,loop:clip.loop,channels:clip.channels,frames:clip.frames},name:'同梱モーション',loop:$('captureLoop').checked};
}
function sanitizeExportPage(page){
  page.querySelector('#playerSyncConfig')?.remove();page.removeAttribute?.('data-player-view');
  if(page.querySelector('#playerSyncStatus'))page.querySelector('#playerSyncStatus').textContent='START_SERVERで起動すると、OBSと設定を共有できます。';
  for(const [id,label] of [['cameraDevice','カメラ'],['microphoneDevice','マイク']]){
    const option=document.createElement('option');option.value='';option.textContent='既定の'+label;
    page.querySelector('#'+id).replaceChildren(option);
  }
  for(const id of ['headPart','headVertex','partSelect'])page.querySelector('#'+id).replaceChildren();
  for(const id of ['audioStatus','trackingStatus','takeStatus','captureStatus','backgroundStatus','headStatus','motionIOStatus','loadStatus','recordStatus','bundleStatus']){const node=page.querySelector('#'+id);if(node)node.textContent='';}
  page.querySelector('#trackingStatus').textContent='開始を押すまでカメラ・マイクは使いません。映像と音声はこの端末で処理します。';
  page.querySelector('#cameraPreview').hidden=true;
  page.querySelector('#cameraVideo').removeAttribute('src');
  page.querySelector('#audioMeter').setAttribute('value','0');
  page.querySelector('#bundleIncludeMotion').removeAttribute('checked');
  for(const input of page.querySelectorAll('input[type="file"]'))input.removeAttribute('value');
}
function bundleFiles(){
  const project=collectMotionProject(),preset=collectMotionPreset(),page=document.documentElement.cloneNode(true);
  // Include live settings without altering the page being edited.
  page.querySelector('#projectData').textContent=JSON.stringify(project).replace(/</g,'\\u003c');
  const background={...backgroundState,image:backgroundState.mode==='image'?backgroundState.image:null,name:backgroundState.mode==='image'?'背景画像':''};
  const snapshot={motion:preset,background,seed:headRandomSeed,output:{crop:outputState.crop,color:$('outputColor').value},capture:exportCapture()};
  const existing=page.querySelector('#bundleSnapshot');if(existing)existing.remove();
  const embedded=document.createElement('script');embedded.id='bundleSnapshot';embedded.type='application/json';embedded.textContent=JSON.stringify(snapshot).replace(/</g,'\\u003c');page.querySelector('body').append(embedded);
  sanitizeExportPage(page);
  for(const control of page.querySelectorAll('input,button,select'))control.removeAttribute('disabled');
  page.querySelector('#recordCancel').hidden=true;page.querySelector('#record').textContent='WebM録画';page.querySelector('#bundle').textContent='完成品をdistに保存';page.querySelector('#recordStatus').textContent='';page.querySelector('#bundleStatus').textContent='';page.querySelector('#recordProgress').hidden=true;
  const launchers=JSON.parse(document.getElementById('playerLaunchers').textContent);
  const launcherFiles=Object.fromEntries(['START_SERVER.ps1','START_SERVER.cmd','START_SERVER.command','START_SERVER.sh','PLAYER_SERVER.py'].map(name=>{if(typeof launchers[name]!=='string')throw Error('起動ファイルがありません。画面を再読み込みしてください');return [name,launchers[name]]}));
  return {...launcherFiles,'index.html':'<!DOCTYPE html>\n'+page.outerHTML,
    'LICENSE.txt':document.getElementById('licenseData').textContent,
    'MEDIA_NOTICE.txt':document.getElementById('mediaNoticeData').textContent};
}
async function restoreBundleSnapshot(){
  const element=$('bundleSnapshot');if(!element)return;
  const data=JSON.parse(element.textContent);applyMotionProject(data.motion);if(Number.isInteger(data.seed))headRandomSeed=data.seed;
  backgroundState=validBackground(data.background);backgroundImage=backgroundState.image?await loadImage(backgroundState.image):null;syncBackground();backgroundMessage('完成品セットの背景を復元しました');
  if(data.output){updateOutputCrop(data.output.crop);if(/^#[a-f0-9]{6}$/i.test(data.output.color))$('outputColor').value=data.output.color;}
  if(data.capture){loadCaptureMotion(data.capture.source,data.capture.name);$('captureLoop').checked=data.capture.loop;}
}
$('bundle').onclick=async()=>{
  const button=$('bundle');button.disabled=true;$('bundleStatus').textContent='完成品をZIPにまとめています…';
  try{await new Promise(resolve=>setTimeout(resolve,0));const files=bundleFiles(),blob=createZip(files),zip=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('ZIPを準備できません'));reader.readAsDataURL(blob)});const saved=await studioRequest('/api/player/export',{html:files['index.html'],zip});$('bundleStatus').textContent=`保存しました：${saved.directory} ／ ${saved.zip}`}
  catch(error){$('bundleStatus').textContent=`保存できません：${error.message}`}
  finally{button.disabled=false}
};
