// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
let detector=null,files=null,options=null,lastTimestamp=-1;
async function useCPU(){
 try{detector?.close()}catch{}
 detector=null;options.baseOptions.delegate='CPU';
 detector=await Vision.FaceLandmarker.createFromOptions(files,options);
}
self.onmessage=async({data})=>{
 if(data.type==='init'){
  try{
   importScripts('../vendor/mediapipe/vision_bundle.js');
   files=await Vision.FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm',self.location.href).href);
   options={baseOptions:{modelAssetPath:new URL('../vendor/mediapipe/models/face_landmarker.task',self.location.href).href,delegate:'GPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true,minFaceDetectionConfidence:.6,minTrackingConfidence:.6};
   try{detector=await Vision.FaceLandmarker.createFromOptions(files,options)}catch{await useCPU()}
   self.postMessage({type:'ready',delegate:options.baseOptions.delegate});
  }catch(error){self.postMessage({type:'error',message:error.message})}
 }else if(data.type==='frame'){
  try{
   if(!detector)throw Error('追跡モデルの準備ができていません');
   const time=Math.max(lastTimestamp+.001,Number.isFinite(data.time)?data.time:lastTimestamp+1);lastTimestamp=time;
   let result;
   try{result=detector.detectForVideo(data.image,time)}catch(error){
    // A GPU context can be lost after sleep. Keep this capture session alive on CPU.
    if(options.baseOptions.delegate!=='GPU')throw error;
    await useCPU();result=detector.detectForVideo(data.image,time);
   }
   self.postMessage({type:'result',result,time,delegate:options.baseOptions.delegate});
  }
  catch(error){self.postMessage({type:'error',message:error.message})}
  finally{data.image?.close()}
 }
};
