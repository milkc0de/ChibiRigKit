#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {packager} from '@electron/packager';
const require = createRequire(import.meta.url), kit = fileURLToPath(new URL('../', import.meta.url));
const arg = (name, fallback) => { const index = process.argv.indexOf('--' + name); return index < 0 ? fallback : process.argv[index + 1]; };
const character = path.resolve(arg('character', path.join(kit, 'characters/milkc0de')));
const localPython = path.join(kit, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.PYTHON || (await fs.stat(localPython).then(() => true, () => false) ? localPython : process.platform === 'win32' ? 'python' : 'python3');
// Re-export through the current runtime, without rebuilding the authored rig.
const result = spawnSync(python, [path.join(kit, 'scripts/export-player.py'), '--character', character], {cwd: kit, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
if (result.status !== 0) throw Error(result.stderr || result.stdout || '完成品の書き出しに失敗しました');
const exported = JSON.parse(result.stdout.trim());
await fs.mkdir(path.join(kit, 'work'), {recursive: true});
const stage = await fs.mkdtemp(path.join(kit, 'work/desktop-stage-'));
try {
  const pkg = JSON.parse(await fs.readFile(path.join(kit, 'package.json'), 'utf8'));
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({name: 'chibirigkit-desktop', productName: 'ChibiRigKit', version: pkg.version, main: 'desktop/main.cjs', license: pkg.license}));
  for (const name of ['desktop', 'studio', 'template/workspace/runtime', 'template/workspace/launchers', 'template/workspace/licenses', 'vendor', 'LICENSE'])
    await fs.cp(path.join(kit, name), path.join(stage, name), {recursive: true});
  await fs.mkdir(path.join(stage, 'player'));
  for (const name of ['index.html', 'LICENSE.txt', 'MEDIA_NOTICE.txt']) await fs.copyFile(path.join(exported.directory, name), path.join(stage, 'player', name));
  const paths = await packager({dir: stage, out: path.join(kit, 'dist/desktop'), name: 'ChibiRigKit',
    platform: arg('platform', process.platform), arch: arg('arch', process.arch), overwrite: true, asar: true,
    electronVersion: pkg.devDependencies.electron, appBundleId: 'io.github.milkc0de.chibirigkit',
    appCategoryType: 'public.app-category.graphics-design',
    extendInfo: {NSCameraUsageDescription: 'キャラクターの顔・目・頭をカメラに合わせて動かします。', NSMicrophoneUsageDescription: 'マイクの音量に合わせてキャラクターの口を動かします。', NSAppSleepDisabled: true}});
  console.log(JSON.stringify({applications: paths, player: exported.directory}));
} finally { await fs.rm(stage, {recursive: true, force: true}); }
