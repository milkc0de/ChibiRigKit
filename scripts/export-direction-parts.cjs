#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// node scripts/export-direction-parts.cjs [--character DIR] [--player index.html] [--output FILE.zip]
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID,createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const {createZip}=require('../studio/player_bundle.cjs');
const {renderProject}=require('../studio/render_player.cjs');

function argument(name,fallback){
  const index=process.argv.indexOf(name);
  if(index<0)return fallback;
  if(!process.argv[index+1]||process.argv[index+1].startsWith('--'))throw Error('Missing value for '+name);
  return process.argv[index+1];
}

// These two functions run inside the shipped player, in its native coordinate
// system. Isolate layers through draw_order so clipping and master warps use
// exactly the same path as normal playback.
function initializePlayer(){
  clearCaptureMotion();
  running=false;
  controls.motionIntensity.value=0;controls.expression.value=0;
  controls.autoBlink.checked=false;controls.autoExpression.checked=false;
  controls.manualEyeOpen.checked=true;controls.manualMouthOpen.checked=true;
  controls.headEdit.checked=false;controls.showBaseOnly.checked=false;
  controls.showPivots.checked=false;controls.showMesh.checked=false;controls.showHeadMesh.checked=false;
  $('gazeX').value=0;$('gazeY').value=0;
  backgroundState={...backgroundState,mode:'transparent'};
  const idle3D=$('idle3D');
  if(idle3D?.checked){
    idle3D.checked=false;
    render(0); // Enable the 2D pose controls before selecting the first direction.
  }
  const parts={};
  for(const id of PROJECT.draw_order){
    const p=PROJECT.parts[id];
    if(isBackgroundPart(p))continue;
    const eye=['eye_open','eye_sclera','eye_iris','eye_line'].includes(p.kind)?'open':
      ['eye_closed','drawn_eye_closed'].includes(p.kind)?'closed':'any';
    const mouth={mouth_closed:'closed',mouth_open:'open',mouth_smile:'smile'}[p.kind]??'any';
    const head=PROJECT.neck_sway?.part_ids.includes(id)??false;
    parts[id]={sourceId:id,sourceFile:p.file,kind:p.kind,role:p.role,group:p.parent??null,
      sourceRect:{x:p.x,y:p.y,width:p.w,height:p.h},transformOwner:transformOwner(p).name,
      clipTo:p.clip_to??null,sourceMesh:p.mesh??null,eye,mouth,
      visibleInOpenPose:eye!=='closed'&&mouth!=='closed'&&mouth!=='smile',
      localHeadMesh:headPoseActive(p)?id:null,headMaster:head?'head':null,
      bodyMaster:PROJECT.neck_sway?.surface?.body_turn?'body':null};
  }
  const head=PROJECT.neck_sway?.mesh,body=bodyTurnMesh(1,0);
  const local={};
  for(const id of Object.keys(parts))if(parts[id].localHeadMesh)local[id]=headGrid(PROJECT.parts[id]);
  return {character:PROJECT.name,canvas:{width:canvas.width,height:canvas.height},
    parts,drawOrder:PROJECT.draw_order.filter(id=>Object.hasOwn(parts,id)),directions:Object.keys(HEAD_DIRECTIONS),
    topology:{head:head?{points:head.points,triangles:head.triangles}:null,
      body:body?{points:body.source,triangles:body.triangles}:null,localHead:local},
    license:$('licenseData').textContent,mediaNotice:$('mediaNoticeData').textContent};
}

async function extractDirection({direction,parts,order}){
  const fullOrder=PROJECT.draw_order,entries={},localHead={};
  const width=canvas.width,height=canvas.height,composite=document.createElement('canvas');
  composite.width=width;composite.height=height;
  const assembled=composite.getContext('2d');
  document.querySelector('[data-head-direction="'+direction+'"]').click();
  controls.eyeOpenTest.value=1;controls.mouthOpenTest.value=1;controls.expression.value=0;
  render(0);
  const reference=ctx.getImageData(0,0,width,height).data;
  const body=bodyTurnFrame,head=PROJECT.neck_sway?.mesh?neckMasterMesh(0,0):null;
  const topology=body??bodyTurnMesh(1,0);
  const bodyTriangles=topology?.triangles.map(ids=>{
    const points=ids.map(i=>(body?body.dest:topology.source)[i]),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const edges=points.map(([x,y],i)=>{
      const [nextX,nextY]=points[(i+1)%3],dx=nextX-x,dy=nextY-y;
      return {x,y,dx,dy,margin:.85*Math.hypot(dx,dy)};
    });
    return {left:Math.floor(Math.min(...xs))-1,right:Math.ceil(Math.max(...xs))+1,
      top:Math.floor(Math.min(...ys))-1,bottom:Math.ceil(Math.max(...ys))+1,edges};
  });
  function coversInk(triangle,pixels,left,top,right,bottom){
    const endX=Math.min(right,triangle.right),endY=Math.min(bottom,triangle.bottom);
    const startX=Math.max(left,triangle.left);
    for(let y=Math.max(top,triangle.top);y<=endY;y++)for(let x=startX;x<=endX;x++){
      if(!pixels[(y*width+x)*4+3])continue;
      if(triangle.edges.every(e=>e.dx*(y+.5-e.y)-e.dy*(x+.5-e.x)>=-e.margin))return true;
    }
    return false;
  }
  for(const id of order)if(parts[id].localHeadMesh){
    const p=PROJECT.parts[id];localHead[id]=headDest(p,currentHeadSetting(p));
  }
  try{
    for(const id of order){
      const part=parts[id];
      controls.eyeOpenTest.value=part.eye==='closed'?0:1;
      controls.mouthOpenTest.value=part.mouth==='closed'?0:1;
      controls.expression.value=part.mouth==='smile'?1:0;
      PROJECT.draw_order=[id];render(0);
      const pixels=ctx.getImageData(0,0,width,height).data;
      let left=width,top=height,right=-1,bottom=-1,alphaPixels=0;
      for(let y=0;y<height;y++)for(let x=0,i=(y*width)*4+3;x<width;x++,i+=4){
        if(!pixels[i])continue;
        alphaPixels++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=y;
      }
      if(!alphaPixels)throw Error(direction+'/'+id+' rendered empty in its visible expression');
      const crop=document.createElement('canvas');
      crop.width=right-left+1;crop.height=bottom-top+1;
      crop.getContext('2d').drawImage(canvas,left,top,crop.width,crop.height,0,0,crop.width,crop.height);
      const url=crop.toDataURL('image/png');
      if(part.visibleInOpenPose){
        const png=new Image();png.src=url;await png.decode();
        assembled.drawImage(png,left,top);
      }
      const bodyTriangleIds=bodyTriangles?.flatMap((triangle,i)=>coversInk(triangle,pixels,left,top,right,bottom)?[i]:[]);
      if(bodyTriangles&&!bodyTriangleIds.length)throw Error(direction+'/'+id+' has no supporting body triangle');
      entries[id]={x:left,y:top,width:crop.width,height:crop.height,alphaPixels,bodyTriangleIds,bytes:url.split(',')[1]};
    }
  }finally{PROJECT.draw_order=fullOrder}
  // Resampling a composited edge and compositing separately resampled edges
  // differ at subpixel boundaries. Compare premultiplied RGBA so invisible
  // RGB never counts as a mismatch, and normalize over the actual foreground.
  const rebuilt=assembled.getImageData(0,0,width,height).data;
  let foregroundPixels=0,differentOver24=0,absoluteError=0,maxChannelError=0;
  for(let i=0;i<reference.length;i+=4){
    const a=reference[i+3],b=rebuilt[i+3];
    if(!a&&!b)continue;
    foregroundPixels++;
    let worst=Math.abs(a-b);absoluteError+=worst;
    for(let c=0;c<3;c++){
      const error=Math.abs(reference[i+c]*a-rebuilt[i+c]*b)/255;
      absoluteError+=error;worst=Math.max(worst,error);
    }
    maxChannelError=Math.max(maxChannelError,worst);
    if(worst>24)differentOver24++;
  }
  const meanAbsoluteError=absoluteError/(4*foregroundPixels),fractionOver24=differentOver24/foregroundPixels;
  if(!foregroundPixels||meanAbsoluteError>.35||fractionOver24>.003)
    throw Error(direction+' failed foreground reconstruction: '+JSON.stringify({meanAbsoluteError,fractionOver24}));
  return {axes:HEAD_DIRECTIONS[direction],angles:{yaw:neckCurrentAngles.yaw,pitch:neckCurrentAngles.pitch},
    entries,meshPose:{body:body?.dest??null,head:head?.dest??null,localHead},
    reconstruction:{foregroundPixels,meanAbsoluteError,differentOver24,maxChannelError}};
}

async function main(){
  const kit=path.resolve(__dirname,'..');
  const character=path.resolve(argument('--character',path.join(kit,'characters/milkc0de')));
  const player=argument('--player',null),scratch=await fs.mkdtemp(path.join(os.tmpdir(),'chibirig-parts-'));
  let browser,staging;
  try{
    const html=player?path.resolve(player):path.join(scratch,'index.html');
    if(!player)await fs.writeFile(html,renderProject(character));
    const launch=process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chrome'};
    browser=await chromium.launch({headless:true,...launch});
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{window.requestAnimationFrame=()=>0});
    await page.goto(pathToFileURL(html).href);await page.evaluate(()=>window.rigReady);
    const setup=await page.evaluate(initializePlayer),files=Object.create(null);
    const manifest={format:'ChibiRigDirectionParts',version:1,character:setup.character,canvas:setup.canvas,
      coordinateSpace:'Source canvas pixels; origin at top left. Draw PNGs at (x,y) in drawOrder using source-over.',
      partMesh:'bodyTriangleIds index meshes.body.triangles. Use meshes.directions[direction].body for posed vertices. Subtract the PNG x/y to convert vertices into crop coordinates.',
      poseFrame:{timeSeconds:0,motionIntensity:0,background:'transparent',gazeTrim:[0,0]},
      topology:'meshes.json',playerSha256:createHash('sha256').update(await fs.readFile(html)).digest('hex'),
      parts:setup.parts,drawOrder:setup.drawOrder,directions:{}};
    const meshes={...setup.topology,directions:{}};
    for(const direction of setup.directions){
      const result=await page.evaluate(extractDirection,{direction,parts:setup.parts,order:setup.drawOrder});
      const layers={};
      for(const id of setup.drawOrder){
        const {bytes,...placement}=result.entries[id],file=direction+'/'+id+'.png';
        files[file]=Buffer.from(bytes,'base64');
        if(files[file].readUInt32BE(16)!==placement.width||files[file].readUInt32BE(20)!==placement.height)
          throw Error('Decoded crop dimensions differ for '+file);
        layers[id]={file,...placement};
      }
      const pose=result.meshPose;
      if(!pose.body&&meshes.body)pose.body=meshes.body.points;
      meshes.directions[direction]=pose;
      manifest.directions[direction]={axes:result.axes,angles:result.angles,layers,reconstruction:result.reconstruction};
      console.log(direction+' '+setup.drawOrder.length+' parts; foreground MAE '+result.reconstruction.meanAbsoluteError.toFixed(4));
    }
    if(errors.length)throw Error(errors.join('\n'));
    files['manifest.json']=JSON.stringify(manifest,null,2)+'\n';
    files['meshes.json']=JSON.stringify(meshes)+'\n';
    files['LICENSE.txt']=setup.license;files['MEDIA_NOTICE.txt']=setup.mediaNotice;
    const output=path.resolve(argument('--output',path.join(kit,'dist',path.basename(character)+'-direction-parts.zip')));
    await fs.mkdir(path.dirname(output),{recursive:true});
    staging=output+'.'+randomUUID()+'.tmp';await fs.writeFile(staging,createZip(files),{flag:'wx'});
    await fs.rename(staging,output);staging=null;
    console.log(JSON.stringify({output,directions:setup.directions.length,parts:setup.drawOrder.length,
      pngs:setup.directions.length*setup.drawOrder.length}));
  }finally{
    await browser?.close();
    if(staging)await fs.rm(staging,{force:true});
    await fs.rm(scratch,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
