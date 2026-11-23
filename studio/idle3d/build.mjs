// SPDX-License-Identifier: Apache-2.0
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('./', import.meta.url));
const license = await readFile(new URL('./node_modules/three/LICENSE', import.meta.url), 'utf8');
await build({
  absWorkingDir: root, entryPoints: ['renderer.js'], outfile: 'idle-renderer.min.js',
  bundle: true, format: 'iife', globalName: 'ChibiRigIdle3D', platform: 'browser', target: 'es2020',
  minify: true, legalComments: 'inline', banner: {js: '/*! three.js — ' + license.trim() + ' */'}
});
