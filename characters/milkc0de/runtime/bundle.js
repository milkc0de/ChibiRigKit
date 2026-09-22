// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
function zipCRC32(bytes){let crc=0xffffffff;for(const value of bytes){crc^=value;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
// Store PNG/WebP bytes unchanged in a standard UTF-8 ZIP; no network or dependency.
function createZip(files){
  const encoder=new TextEncoder(),chunks=[],directory=[];let offset=0;
  for(const [name,content] of Object.entries(files)){
    if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(x=>x==='..'||x==='.'||!x))throw Error('ZIPのファイル名が不正です');
    const filename=encoder.encode(name),bytes=typeof content==='string'?encoder.encode(content):content;
    if(filename.length>65535||bytes.length>0xffffffff)throw Error('ZIPに入れるファイルが大きすぎます');
    const crc=zipCRC32(bytes),local=new Uint8Array(30+filename.length),l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,bytes.length,true);l.setUint32(22,bytes.length,true);l.setUint16(26,filename.length,true);local.set(filename,30);
    const central=new Uint8Array(46+filename.length),c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);central.set(filename,46);
    chunks.push(local,bytes);directory.push(central);offset+=local.length+bytes.length;
  }
  const count=directory.length,size=directory.reduce((sum,d)=>sum+d.length,0);
  if(count>65535||offset+size>0xffffffff)throw Error('ZIPの上限を超えています');
  const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,count,true);e.setUint16(10,count,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  return new Blob([...chunks,...directory,end],{type:'application/zip'});
}
function bundleFiles(){
  const project=collectMotionProject(),preset=collectMotionPreset(),page=document.documentElement.cloneNode(true),json=value=>JSON.stringify(value,null,2)+'\n';
  // Include live settings without altering the page being edited.
  page.querySelector('#projectData').textContent=JSON.stringify(project).replace(/</g,'\\u003c');
  const snapshot={motion:preset,background:backgroundState,seed:headRandomSeed};
  const existing=page.querySelector('#bundleSnapshot');if(existing)existing.remove();
  const embedded=document.createElement('script');embedded.id='bundleSnapshot';embedded.type='application/json';embedded.textContent=JSON.stringify(snapshot).replace(/</g,'\\u003c');page.querySelector('body').append(embedded);
  for(const id of ['headPart','headVertex','partSelect'])page.querySelector('#'+id).replaceChildren();
  for(const control of page.querySelectorAll('input,button,select'))control.removeAttribute('disabled');
  page.querySelector('#recordCancel').hidden=true;page.querySelector('#record').textContent='WebM録画';page.querySelector('#bundle').textContent='完成品一式をダウンロード';page.querySelector('#recordStatus').textContent='';page.querySelector('#bundleStatus').textContent='';page.querySelector('#recordProgress').hidden=true;
  const files={'index.html':'<!DOCTYPE html>\n'+page.outerHTML,'rig.project.json':json(project),'motion.json':json(preset),'background.json':json(backgroundState),
    'README.txt':'ChibiRigKit 完成品セット\n\n1. ZIPを展開します。\n2. index.htmlをChromeなどのブラウザで開きます。\n3. 保存時の動き・顔配置・背景が復元されます。\n\nmotion.jsonは同じキャラの「全体の動きJSONを読み込む」で再利用できます。\nassets/には描画用画像を保存しています。HTMLにも画像を内蔵しています。\n制作途中の入力・マスク・AI作業履歴・Pythonツールは含みません。再制作には元のキャラフォルダを保管してください。\n\nツール作者: milkc0de\n予定URL: https://github.com/milkc0de/ChibiRigKit\nツールのコード: MIT License（LICENSE.txt参照）\nキャラクター画像の権利は各権利者に帰属します。\n',
    'LICENSE.txt':document.getElementById('licenseData').textContent};
  if(project.head_pose)files['head-poses.json']=json(project.head_pose);
  const addImage=(path,url)=>{if(!url?.startsWith('data:image/'))throw Error(`画像を同梱できません：${path}`);files[path]=Uint8Array.from(atob(url.split(',')[1]),ch=>ch.charCodeAt(0))};
  for(const part of Object.values(project.parts)){addImage(part.file,part.image_data_url);if(part.seam)addImage(part.seam.file,part.seam.data_url)}
  return files;
}
async function restoreBundleSnapshot(){
  const element=$('bundleSnapshot');if(!element)return;
  const data=JSON.parse(element.textContent);applyMotionProject(data.motion);if(Number.isInteger(data.seed))headRandomSeed=data.seed;
  backgroundState=validBackground(data.background);backgroundImage=backgroundState.image?await loadImage(backgroundState.image):null;syncBackground();backgroundMessage('完成品セットの背景を復元しました');
}
$('bundle').onclick=async()=>{
  const button=$('bundle');button.disabled=true;$('bundleStatus').textContent='完成品をZIPにまとめています…';
  try{await new Promise(resolve=>setTimeout(resolve,0));const files=bundleFiles();downloadBlob(createZip(files),'ChibiRigKit-character.zip');$('bundleStatus').textContent=`完成品 ${Object.keys(files).length}ファイルをZIPに保存しました`}
  catch(error){$('bundleStatus').textContent=`保存できません：${error.message}`}
  finally{button.disabled=false}
};
