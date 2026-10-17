// SPDX-License-Identifier: Apache-2.0
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('chibiDesktop', Object.freeze({
  setCaptureActive: active => ipcRenderer.send('chibirig:capture', active === true),
  onResume(callback) {
    const listener = () => callback();
    ipcRenderer.on('chibirig:resume', listener);
    return () => ipcRenderer.removeListener('chibirig:resume', listener);
  }
}));
