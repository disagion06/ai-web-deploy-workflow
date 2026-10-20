'use strict';
/**
 * 预加载脚本：把主进程能力以 window.dd 暴露给渲染层。
 * 严格遵循 docs/IPC_CONTRACT.md，渲染层不接触任何 Node / fs / child_process。
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENT = 'dd:event';
const handlers = new Map(); // type -> Set<fn>

ipcRenderer.on(EVENT, (_e, payload) => {
  if (!payload || !payload.type) return;
  const set = handlers.get(payload.type);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (err) {
      // 渲染层自己的异常不应该影响主进程
      console.error('[dd] 事件处理出错', err);
    }
  }
});

function on(type, handler) {
  if (typeof handler !== 'function') return () => {};
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(handler);
  return () => handlers.get(type).delete(handler);
}

const call = (channel) => (payload) => ipcRenderer.invoke(channel, payload);

const bootstrap = (() => {
  try {
    return ipcRenderer.sendSync('dd:paths') || {};
  } catch {
    return {};
  }
})();

contextBridge.exposeInMainWorld('dd', {
  app: {
    version: bootstrap.version || '1.0.0',
    paths: { userData: bootstrap.userData || '', workspaces: bootstrap.workspaces || '' }
  },
  dialog: {
    pickFolder: call('dd:pickFolder'),
    pickFiles: call('dd:pickFiles')
  },
  file: {
    /** 拖拽进来的 File → 真实磁盘路径 */
    pathForFile: (file) => {
      try {
        if (webUtils && typeof webUtils.getPathForFile === 'function') return webUtils.getPathForFile(file) || '';
      } catch {
        /* 旧版本 Electron 回退 */
      }
      return (file && file.path) || '';
    }
  },
  scan: call('dd:scan'),
  generate: call('dd:generate'),
  llmProviders: call('dd:llmProviders'),
  assetsScan: call('dd:assetsScan'),
  selfcheck: call('dd:selfcheck'),
  tools: {
    status: call('dd:toolsStatus'),
    setup: call('dd:toolsSetup'),
    loginGithub: call('dd:loginGithub'),
    loginWithToken: call('dd:loginWithToken')
  },
  build: call('dd:build'),
  preview: {
    start: call('dd:previewStart'),
    stop: call('dd:previewStop')
  },
  deploy: call('dd:deploy'),
  shell: {
    openExternal: call('dd:openExternal'),
    openPath: call('dd:openPath')
  },
  clipboard: {
    write: call('dd:clipboardWrite')
  },
  on
});
