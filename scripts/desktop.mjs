#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url), env = {...process.env};
// Codex/VS Code can export this variable; a desktop app must run as Electron.
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [fileURLToPath(new URL('../desktop/main.cjs', import.meta.url)), ...process.argv.slice(2)], {stdio: 'inherit', env});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
