#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';
const require = createRequire(import.meta.url), env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.CHIBIRIG_DESKTOP_EXECUTABLE || require('electron');
const seconds = Math.max(3, Math.min(120, Number(process.env.CHIBIRIG_DESKTOP_TEST_SECONDS) || 15));
const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  ...(process.env.CHIBIRIG_DESKTOP_EXECUTABLE ? [] : [fileURLToPath(new URL('../desktop/main.cjs', import.meta.url))]),
  '--smoke-test', '--port', '0'];
const desktop = await _electron.launch({executablePath, args, env, timeout: 60000});
let page;
try {
  page = await desktop.firstWindow();
  await page.waitForFunction(() => document.getElementById('loadStatus')?.textContent === '読み込み完了');
  const initial = await desktop.evaluate(({app, BrowserWindow}) => ({
    electron: process.versions.electron, gpu: app.getGPUFeatureStatus(),
    backgroundThrottling: BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling(),
    preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  }));
  assert.equal(initial.backgroundThrottling, false);
  assert.equal(initial.preferences.nodeIntegration, false);
  assert.equal(initial.preferences.contextIsolation, true);
  assert.equal(initial.preferences.sandbox, true);
  await page.selectOption('#trackingInput', 'both');
  await page.click('#cameraStart', {force: true});
  await page.waitForFunction(() => trackingState.active && trackingState.lastResult > 0, null, {timeout: 60000});
  const before = await page.evaluate(() => ({result: trackingState.lastResult, context: trackingState.audio.context.state}));
  assert.equal(before.context, 'running');
  await page.evaluate(() => startMotionTake());
  await desktop.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].minimize());
  await page.waitForFunction(({since, seconds}) => trackingState.lastResult > since + seconds * 1000 && trackingState.audio.context.state === 'running', {since: before.result, seconds}, {timeout: (seconds + 30) * 1000});
  const background = await page.evaluate(() => ({active: trackingState.active, elapsed: trackingState.lastResult, trackingDelegate: trackingState.delegate, status: document.getElementById('trackingStatus')?.textContent}));
  const origin = new URL(page.url()).origin;
  const obs = await fetch(origin + '/obs');
  assert.equal(obs.status, 200);
  assert.match(await obs.text(), /"role":"view"/);
  await desktop.evaluate(({BrowserWindow}) => {const window = BrowserWindow.getAllWindows()[0]; window.restore(); window.show();});
  await fs.mkdir(new URL('../work/', import.meta.url), {recursive: true});
  await page.evaluate(() => stopMotionTake());
  const takeFile = fileURLToPath(new URL('../work/desktop-test-take.json', import.meta.url));
  await desktop.evaluate(({BrowserWindow}, destination) => {
    globalThis.chibiTestDownload = null;
    BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => {
      item.setSavePath(destination);
      item.once('done', (_event, state) => { globalThis.chibiTestDownload = state; });
    });
  }, takeFile);
  await page.click('#takeSave');
  const downloadDeadline = Date.now() + 15000;
  while (!await desktop.evaluate(() => globalThis.chibiTestDownload)) {
    if (Date.now() > downloadDeadline) throw Error('Electronのモーション保存が完了しません');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await desktop.evaluate(() => globalThis.chibiTestDownload), 'completed');
  const take = JSON.parse(await fs.readFile(takeFile, 'utf8'));
  assert.equal(take.format, 'ChibiRigMotion');
  assert.ok(take.frames.length > 3);
  await fs.rm(takeFile);
  await page.evaluate(() => stopTracking());
  assert.equal(await page.evaluate(() => trackingState.active), false);
  assert.equal(await page.evaluate(() => trackingState.stream), null);
  for (const name of ['head_checks', 'neck_checks', 'motion_io_checks', 'runtime_checks'])
    await page.addScriptTag({path: fileURLToPath(new URL(`../template/workspace/toolbox/${name}.js`, import.meta.url))});
  const checks = await page.evaluate(() => window.runRigChecks());
  const {png, ...runtimeReport} = checks;
  if (png) await fs.writeFile(new URL('../work/desktop-runtime-sheet.png', import.meta.url), Buffer.from(png, 'base64'));
  for (const key of ['neck', 'head']) if (runtimeReport[key]?.png) delete runtimeReport[key].png;
  await fs.writeFile(new URL('../work/desktop-runtime-check.json', import.meta.url), JSON.stringify(runtimeReport, null, 2) + '\n');
  for (const [name, yaw, pitch, roll] of [['front', 0, 0, 0], ['right', 25, -15, 10], ['left', -25, 25, -10]]) {
    await page.evaluate(({yaw, pitch, roll}) => {
      controls.headRandom.checked = false; controls.neckSway.checked = true; controls.autoBlink.checked = false;
      const values = [yaw, pitch, roll, yaw * .24, pitch * .18, roll * .22, 1, 1, .3];
      loadCaptureMotion({format:'ChibiRigMotion', version:1, timeUnit:'seconds', duration:1, loop:false,
        channels:['headYaw','headPitch','headRoll','bodyYaw','bodyPitch','bodyRoll','eyeLeft','eyeRight','mouthOpen'], frames:[[0,...values],[1,...values]]}, '確認');
      seekCaptureMotion(0); render(0);
    }, {yaw, pitch, roll});
    await page.locator('#c').screenshot({path: fileURLToPath(new URL(`../work/desktop-${name}.png`, import.meta.url))});
  }
  const report = {fakeDevices: true, packaged: Boolean(process.env.CHIBIRIG_DESKTOP_EXECUTABLE), ...initial,
    background, minimizedSeconds: seconds, motionFrames: take.frames.length,
    runtimeChecks: {combinations: checks.combinations, motionFrames: checks.motionFrames, trailCheck: checks.trailCheck},
    checked: ['player boot', 'GPU feature status', 'sandbox', 'synthetic camera and microphone', 'minimized capture', 'OBS route', 'motion recording and download', 'explicit stop', 'browser rendering checks', 'three representative poses'],
    physicalDevicesTested: false};
  delete report.preferences;
  await fs.writeFile(new URL('../work/desktop-check.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page) console.error(await page.evaluate(() => ({status: document.getElementById('trackingStatus')?.textContent,
    audio: document.getElementById('audioStatus')?.textContent, active: trackingState.active, starting: trackingState.starting,
    worker: Boolean(trackingState.worker), video: {time: document.getElementById('cameraVideo')?.currentTime, ready: document.getElementById('cameraVideo')?.readyState},
    lastResult: trackingState.lastResult})).catch(() => ({})));
  throw error;
} finally { await desktop.close(); }
