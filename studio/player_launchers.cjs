// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
const fs=require('node:fs'),path=require('node:path');
const LAUNCHER_NAMES=['START_SERVER.ps1','START_SERVER.cmd','START_SERVER.command','START_SERVER.sh','PLAYER_SERVER.py'];
function launcherFiles(template=path.resolve(__dirname,'../template/workspace')){
 return Object.fromEntries(LAUNCHER_NAMES.map(name=>[name,fs.readFileSync(path.join(template,'launchers',name),'utf8')]));
}
module.exports={LAUNCHER_NAMES,launcherFiles};
