// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
let detector=null;
self.onmessage=async({data})=>{
 if(data.type==='init'){
  try{
   importScripts('../vendor/mediapipe/vision_bundle.js');
   const files=await Vision.FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm',self.location.href).href);
   const options={baseOptions:{modelAssetPath:new URL('../vendor/mediapipe/models/face_landmarker.task',self.location.href).href,delegate:'GPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true,minFaceDetectionConfidence:.6,minTrackingConfidence:.6};
   try{detector=await Vision.FaceLandmarker.createFromOptions(files,options)}catch{options.baseOptions.delegate='CPU';detector=await Vision.FaceLandmarker.createFromOptions(files,options)}
   self.postMessage({type:'ready',delegate:options.baseOptions.delegate});
  }catch(error){self.postMessage({type:'error',message:error.message})}
 }else if(data.type==='frame'){
  try{self.postMessage({type:'result',result:detector.detectForVideo(data.image,data.time),time:data.time})}
  catch(error){self.postMessage({type:'error',message:error.message})}
  finally{data.image.close()}
 }
};
