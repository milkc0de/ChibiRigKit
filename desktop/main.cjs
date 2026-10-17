// SPDX-License-Identifier: Apache-2.0
const {app, BrowserWindow, Menu, dialog, clipboard, ipcMain, powerSaveBlocker, powerMonitor, systemPreferences} = require('electron');
const fs = require('node:fs'), path = require('node:path');
const {createStudio} = require('../studio/server.cjs');
const {isPlayerURL, allowMedia, capturePower} = require('./policy.cjs');
const KIT = path.resolve(__dirname, '..');
const option = (name, fallback) => { const index = process.argv.indexOf('--' + name); return index < 0 ? fallback : process.argv[index + 1]; };
// Keep Chromium's GPU acceleration and the renderer running behind OBS or when minimized.
for (const flag of ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(flag);
app.setName('ChibiRigKit');
let window, studio, origin, closing = false;
const power = capturePower(powerSaveBlocker);
function trusted(event) { return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && isPlayerURL(event.senderFrame.url, origin); }
ipcMain.on('chibirig:capture', (event, active) => { if (trusted(event)) power.set(active === true); });

async function start() {
  powerMonitor.on('resume', () => { if (window && !window.isDestroyed()) window.webContents.send('chibirig:resume'); });
  const embedded = path.join(KIT, 'player');
  const player = option('player', app.isPackaged ? embedded : null);
  const root = path.resolve(player || option('character', path.join(KIT, 'characters/milkc0de')));
  if (!fs.existsSync(path.join(root, player ? 'index.html' : 'rig.project.json'))) throw Error('キャラクターが見つかりません：' + root);
  const serverOptions = {root, port: Number(option('port', '5510')), indexFile: player ? path.join(root, 'index.html') : undefined,
    distRoot: app.isPackaged ? path.join(app.getPath('downloads'), 'ChibiRigKit') : undefined};
  studio = createStudio(serverOptions);
  try { await studio.listen(); }
  catch (error) {
    if (error.code !== 'EADDRINUSE' || process.argv.includes('--port')) throw error;
    studio = createStudio({...serverOptions, port: 0});
    await studio.listen();
  }
  origin = `http://127.0.0.1:${studio.server.address().port}`;
  window = new BrowserWindow({width: 1440, height: 1000, minWidth: 850, minHeight: 600, title: 'ChibiRigKit',
    show: !process.argv.includes('--smoke-test'), backgroundColor: '#151820',
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true, webgl: true, backgroundThrottling: false}});
  const contents = window.webContents, session = contents.session;
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    webContents === contents && allowMedia(permission, details?.requestingUrl || requestingOrigin, origin, details));
  session.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    if (webContents !== contents || !allowMedia(permission, details.requestingUrl, origin, details)) return callback(false);
    try {
      if (process.platform === 'darwin') for (const type of details.mediaTypes || []) {
        if (!await systemPreferences.askForMediaAccess(type === 'video' ? 'camera' : 'microphone')) return callback(false);
      }
      callback(true);
    } catch { callback(false); }
  });
  contents.setWindowOpenHandler(() => ({action: 'deny'}));
  contents.on('will-navigate', (event, url) => { if (!isPlayerURL(url, origin)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!isPlayerURL(url, origin)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) power.set(false); });
  contents.on('render-process-gone', () => power.set(false));
  window.on('closed', () => { power.set(false); window = null; app.quit(); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{label: 'ChibiRigKit', submenu: [{role: 'about'}, {type: 'separator'}, {role: 'quit'}]}] : []),
    {label: 'ファイル', submenu: [{label: 'OBS用URLをコピー', click: () => clipboard.writeText(origin + '/obs')}, {type: 'separator'}, {role: 'quit'}]},
    {label: '編集', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'}]},
    {label: '表示', submenu: [{role: 'togglefullscreen'}, {label: 'GPUの状態', click: () => dialog.showMessageBox(window, {type: 'info', title: 'GPUの状態', message: '描画機能の状態', detail: JSON.stringify(app.getGPUFeatureStatus(), null, 2)})}, {role: 'toggleDevTools'}]}
  ]));
  await window.loadURL(origin + '/');
}
app.whenReady().then(start).catch(error => {
  dialog.showErrorBox('ChibiRigKitを起動できません', error.code === 'EADDRINUSE' ? 'ポート5510が使用中です。既存のプレイヤーを終了するか --port 5511 で起動してください。' : error.message);
  app.quit();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  power.set(false);
  if (studio && !closing) { event.preventDefault(); closing = true; studio.close().finally(() => app.quit()); }
});
