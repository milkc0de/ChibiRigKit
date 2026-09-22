// Shared standalone-function fixture inputs for the capture-aware runtime.
import fs from 'node:fs';
import vm from 'node:vm';
export function installCaptureInputs(context,controls){
 for(const [key,value] of Object.entries({headX:0,headY:0,headAmount:1,gazeAmount:1,motionSpeed:1,motionIntensity:1}))controls[key]??={value};
 controls.neckSway??={checked:false};
 vm.runInContext(fs.readFileSync(new URL('../template/workspace/runtime/capture_player.js',import.meta.url),'utf8'),context);
 vm.runInContext('let hairFrame=new Map();function hairDeformedPoint(_p,_source,dest){return dest}',context);
}
