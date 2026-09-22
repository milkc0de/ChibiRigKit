const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..'),CHARACTER=path.join(ROOT,'characters/milkc0de'),RUNTIME=path.join(ROOT,'template/workspace/runtime');
const {renderProject}=require('../../studio/render_player.cjs');
module.exports={ROOT,CHARACTER,RUNTIME,playerHTML:(project)=>renderProject(CHARACTER,project?{project}:{})};
