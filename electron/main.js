'use strict';
/**
 * Electron 主进程：窗口 + IPC 路由。
 * 所有耗时工作都在主进程里跑，通过 dd:event 把日志 / 进度 / 工具状态推给界面。
 */
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

/* ------------------------------------------------------------ 启动日志
 * 目的：程序启动失败时，用户双击只会看到窗口一闪而过、完全不知道发生了什么。
 * 这里把启动的每一步以及任何异常都写进项目根目录的「启动日志.txt」；
 * 打包后项目目录是只读的 asar，则自动退回到用户数据目录。
 */
function resolveLogFile() {
  const list = [];
  try {
    list.push(path.join(__dirname, '..', '启动日志.txt'));
  } catch {}
  try {
    list.push(path.join(app.getPath('userData'), '启动日志.txt'));
  } catch {}
  for (const f of list) {
    try {
      fs.appendFileSync(f, '');
      return f;
    } catch {
      /* 换下一个 */
    }
  }
  return null;
}
let LOG_FILE = resolveLogFile();
try {
  if (LOG_FILE) fs.writeFileSync(LOG_FILE, '');
} catch {}
function logLine(msg) {
  const line = '[' + new Date().toLocaleString('zh-CN') + '] ' + msg;
  try {
    console.log(line);
  } catch {}
  if (!LOG_FILE) LOG_FILE = resolveLogFile();
  if (LOG_FILE) {
    try {
      fs.appendFileSync(LOG_FILE, line + '\n');
    } catch {}
  }
}
function errBox(title, content) {
  logLine('!! ' + title + ' :: ' + content);
  try {
    dialog.showErrorBox(title, content);
  } catch {}
}

function isAdmin() {
  try {
    cp.execSync('net session', { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const scanner = require('../lib/scanner');
const redactor = require('../lib/redactor');
const deployLib = require('../lib/deploy');
const toolLib = require('../lib/tools');
const previewLib = require('../lib/preview');
const generateLib = require('../lib/generate');
const assetsLib = require('../lib/assets');
const llmLib = require('../lib/llm');
const selfcheckLib = require('../lib/selfcheck');
const { ensureDir } = require('../lib/util');

logLine('=== 设计稿上线助手启动 ===');
logLine('Electron ' + process.versions.electron + ' / Node ' + process.versions.node + ' / Chromium ' + process.versions.chrome);
logLine('可执行文件：' + process.execPath);
logLine('参数：' + JSON.stringify(process.argv.slice(1)));
try {
  logLine('是否管理员身份：' + isAdmin());
} catch {}

// 单实例锁：以前这里获取失败就 app.quit()，用户看到的就是「窗口闪一下就没了」。
// 现在改成：就算锁没拿到也照常把界面开出来（顶多两个窗口），绝不静默退出。
if (app.requestSingleInstanceLock()) logLine('单实例锁：已获取');
else logLine('单实例锁：未获取（可能已有实例在运行），本次仍会打开新窗口');

const paths = {
  userData: '',
  workspaces: '',
  tools: ''
};

let win = null;

/* ------------------------------------------------------------ 事件推送 */

function send(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('dd:event', payload);
}

function makeLog(scope) {
  return (level, message) => {
    const msg = String(message == null ? '' : message);
    if (!msg.trim()) return;
    send({ type: 'log', scope, level, message: msg, ts: Date.now() });
  };
}

function makeProgress(scope) {
  return (percent, label) => send({ type: 'progress', scope, percent: percent == null ? null : Math.max(0, Math.min(100, percent)), label: label || '' });
}

let lastTools = null;
let toolsTimer = null;

async function refreshTools(scope = 'tools') {
  try {
    lastTools = await toolLib.status({ toolsDir: paths.tools });
    send({ type: 'tools', ...lastTools });
  } catch (e) {
    send({ type: 'log', scope, level: 'warn', message: '环境检查失败：' + e.message, ts: Date.now() });
  }
  return lastTools;
}

/* ------------------------------------------------------------ 窗口 */

function createWindow() {
  const entry = path.join(__dirname, '..', 'src', 'index.html');
  logLine('创建窗口，入口文件：' + entry + '，存在：' + fs.existsSync(entry));
  win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 660,
    backgroundColor: '#12151c',
    title: '设计稿上线助手',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  // 视觉上等页面画好再显示；但最多等 3 秒就强制显示，
  // 避免「页面没画出来 → 窗口永远不出现 → 用户以为闪退了」。
  let shown = false;
  const showNow = (why) => {
    if (shown || !win || win.isDestroyed()) return;
    shown = true;
    logLine('显示窗口（' + why + '）');
    try {
      win.show();
      win.focus();
    } catch (e) {
      logLine('显示窗口失败：' + e.message);
    }
  };
  win.once('ready-to-show', () => showNow('ready-to-show'));
  setTimeout(() => showNow('兜底计时器'), 3000);

  win.loadFile(entry).catch((e) => {
    logLine('加载页面失败：' + e.message);
    errBox('页面加载失败', '无法加载界面文件：\n' + entry + '\n\n' + e.message + '\n\n日志：' + LOG_FILE);
    showNow('加载失败后兜底');
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logLine('did-fail-load：' + code + ' ' + desc + ' ' + url);
    errBox('界面加载失败', '错误码 ' + code + '：' + desc + '\n' + url + '\n\n日志：' + LOG_FILE);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    logLine('渲染进程结束：' + JSON.stringify(details));
    errBox('界面进程异常退出', JSON.stringify(details) + '\n\n可以把「启动日志.txt」发给我定位问题。');
  });
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) logLine('界面控制台[' + level + '] ' + message + ' @' + source + ':' + line);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.on('closed', () => {
    logLine('窗口已关闭');
    win = null;
  });
}

/* ------------------------------------------------------------ IPC */

function ok(data) {
  return { ok: true, ...data };
}
function fail(code, message, tip, detail) {
  return { ok: false, error: { code, message, tip, detail } };
}

function registerIpc() {
  ipcMain.on('dd:paths', (e) => {
    e.returnValue = { version: app.getVersion(), userData: paths.userData, workspaces: paths.workspaces };
  });

  ipcMain.handle('dd:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择设计稿文件夹（里面要有 index.html）',
      properties: ['openDirectory'],
      buttonLabel: '就用这个文件夹'
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dd:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择设计稿入口文件（index.html）',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '网页文件', extensions: ['html', 'htm'] },
        { name: '全部文件', extensions: ['*'] }
      ],
      buttonLabel: '导入'
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('dd:scan', async (_e, payload = {}) => {
    const log = makeLog('scan');
    const progress = makeProgress('scan');
    try {
      const root = payload.root;
      if (!root) return fail('E_BAD_INPUT', '没有拿到文件夹路径');
      progress(null, '正在扫描…');
      const res = await scanner.scan({
        root,
        customKeywords: payload.customKeywords || [],
        largeFileThresholdMB: payload.largeFileThresholdMB || 50,
        onLog: log
      });
      if (!res || res.ok === false) return res && res.error ? res : fail('E_UNKNOWN', '扫描失败');
      log(
        'ok',
        '扫描完成：' +
          res.findings.length +
          ' 项文本敏感信息、' +
          res.images.length +
          ' 张图片' +
          (res.stats ? '，共 ' + res.stats.files + ' 个文件' : '')
      );
      progress(100, '扫描完成');
      return res;
    } catch (e) {
      log('error', '扫描失败：' + e.message);
      return fail(e.code || 'E_UNKNOWN', '扫描失败：' + e.message, e.code === 'E_NOT_FOUND' ? '请确认文件夹还在，且里面有 index.html' : null);
    }
  });

  /* ---------------------------------------------------------- 网页制作 */

  ipcMain.handle('dd:llmProviders', async () => {
    try {
      return ok({ providers: llmLib.listProviders(), styles: generateLib.STYLE_PRESETS });
    } catch (e) {
      return fail('E_UNKNOWN', '读取模型列表失败：' + e.message);
    }
  });

  ipcMain.handle('dd:generate', async (_e, payload = {}) => {
    const log = makeLog('make');
    const progress = makeProgress('make');
    try {
      const brief = String(payload.brief || '').trim();
      if (!brief) return fail('E_BAD_INPUT', '请先描述你想做的网页');

      progress(1, '准备生成…');
      const res = await generateLib.generateSite({
        brief,
        sourceDir: payload.sourceDir || null,
        outDir: payload.outDir || paths.workspaces,
        style: payload.style || generateLib.DEFAULT_STYLE,
        animations: payload.animations || 'level1',
        review: !!payload.review,
        provider: payload.provider || undefined,
        model: payload.model || undefined,
        withAssets: payload.withAssets !== false,
        onProgress: (ev) => progress(ev.pct, ev.message)
      });

      log('ok', '生成完成：' + res.outDir);
      progress(100, '生成完成');
      return ok({
        outDir: res.outDir,
        entry: res.entry,
        style: res.style,
        animations: res.animations,
        plan: res.plan,
        blocks: res.blocks,
        assets: res.assets,
        review: res.review,
        usage: res.usage
      });
    } catch (e) {
      log('error', '生成失败：' + e.message);
      return fail('E_UNKNOWN', '生成失败：' + e.message, '可以先不填 API key，用默认的 mock 模型跑通流程');
    }
  });

  ipcMain.handle('dd:assetsScan', async (_e, payload = {}) => {
    const log = makeLog('make');
    try {
      const dir = payload.dir;
      if (!dir) return fail('E_BAD_INPUT', '没有拿到素材目录');
      const scan = await assetsLib.scanSources(dir);
      const plan = assetsLib.planAssets(scan, { outName: 'assets' });
      log('ok', '素材预检完成：' + plan.stats.willCopy + ' 个文件待规整');
      return ok({ scan, plan, text: assetsLib.formatScan(scan) + '\n\n' + assetsLib.formatPlan(plan) });
    } catch (e) {
      return fail('E_UNKNOWN', '素材预检失败：' + e.message);
    }
  });

  ipcMain.handle('dd:selfcheck', async (_e, payload = {}) => {
    const log = makeLog('check');
    const progress = makeProgress('check');
    try {
      const dir = payload.dir;
      if (!dir) return fail('E_BAD_INPUT', '没有拿到站点目录');
      progress(null, '正在截图自检…');
      const report = await selfcheckLib.checkSite({
        dir,
        shotsDir: payload.shotsDir || undefined,
        fullPage: payload.fullPage !== false
      });
      log(report.ok ? 'ok' : 'warn', '自检完成：' + report.summary.errors + ' 项错误、' + report.summary.warnings + ' 项提醒');
      progress(100, '自检完成');
      return ok({ report, text: selfcheckLib.formatReport(report) });
    } catch (e) {
      log('error', '自检失败：' + e.message);
      return fail('E_UNKNOWN', '自检失败：' + e.message);
    }
  });

  ipcMain.handle('dd:toolsStatus', async () => {
    const tools = await refreshTools('tools');
    return ok({ tools });
  });

  let setupRunning = null;
  ipcMain.handle('dd:toolsSetup', async (_e, payload = {}) => {
    if (setupRunning) return setupRunning;
    const log = makeLog('tools');
    const progress = makeProgress('tools');
    log('info', '开始检查 / 安装所需组件…');
    setupRunning = (async () => {
      try {
        const res = await toolLib.setup({
          toolsDir: paths.tools,
          wantSharp: payload.wantSharp !== false,
          onLog: log,
          onProgress: (p, l) => {
            progress(p, l);
            refreshTools('tools');
          }
        });
        await refreshTools('tools');
        log(res.ok ? 'ok' : 'warn', res.ok ? '所需组件已全部就绪' : '有组件未就绪，部分功能会降级使用');
        return ok({ tools: res.tools, installed: res.installed, failed: res.failed });
      } catch (e) {
        log('error', '环境准备失败：' + e.message);
        return fail('E_UNKNOWN', '环境准备失败：' + e.message);
      } finally {
        setupRunning = null;
      }
    })();
    return setupRunning;
  });

  ipcMain.handle('dd:loginGithub', async () => {
    const log = makeLog('tools');
    const progress = makeProgress('tools');
    try {
      const res = await toolLib.loginGithub({
        toolsDir: paths.tools,
        onLog: log,
        onProgress: (p, l) => {
          progress(p, l);
          refreshTools('tools');
        }
      });
      await refreshTools('tools');
      return res.ok ? ok({ user: res.user, scopes: res.scopes, already: res.already }) : res;
    } catch (e) {
      return fail('E_AUTH', '登录失败：' + e.message);
    }
  });

  ipcMain.handle('dd:loginWithToken', async (_e, payload = {}) => {
    const log = makeLog('tools');
    try {
      const res = await toolLib.loginWithToken(payload.token, { toolsDir: paths.tools, onLog: log });
      await refreshTools('tools');
      return res.ok ? ok({ user: res.user }) : res;
    } catch (e) {
      return fail('E_AUTH', '令牌登录失败：' + e.message);
    }
  });

  ipcMain.handle('dd:build', async (_e, payload = {}) => {
    const log = makeLog('build');
    const progress = makeProgress('build');
    try {
      const res = await redactor.build({
        root: payload.root,
        decisions: payload.decisions || {},
        imageDecisions: payload.imageDecisions || {},
        exclude: payload.exclude || [],
        extraDecisions: payload.extraDecisions || {},
        scanResult: payload.scanResult || null,
        options: {
          workDir: paths.workspaces,
          toolsDir: paths.tools,
          stripExif: payload.options && payload.options.stripExif !== false,
          siteTitle: (payload.options && payload.options.siteTitle) || null,
          addNotice: !!(payload.options && payload.options.addNotice),
          customKeywords: (payload.options && payload.options.customKeywords) || []
        },
        onLog: log,
        onProgress: progress
      });
      if (!res.ok) return res;
      return res;
    } catch (e) {
      log('error', '生成失败：' + e.message);
      return fail('E_UNKNOWN', '生成失败：' + e.message, null, e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : null);
    }
  });

  ipcMain.handle('dd:previewStart', async (_e, payload = {}) => {
    const log = makeLog('preview');
    const res = await previewLib.start({ dir: payload.dir, onLog: log });
    if (!res.ok) return res;
    // 顺手用系统浏览器打开
    try {
      await shell.openExternal(res.url);
    } catch {
      /* 打不开就算了，界面上还有链接 */
    }
    return res;
  });

  ipcMain.handle('dd:previewStop', async () => {
    await previewLib.stop();
    return ok({});
  });

  ipcMain.handle('dd:deploy', async (_e, payload = {}) => {
    const log = makeLog('deploy');
    const progress = makeProgress('deploy');
    try {
      const res = await deployLib.deploy({
        dir: payload.dir,
        repoName: payload.repoName,
        description: payload.description,
        siteType: payload.siteType,
        visibility: payload.visibility,
        reuse: !!payload.reuse,
        commitMessage: payload.commitMessage,
        toolsDir: paths.tools,
        forbiddenValues: payload.forbiddenValues || [],
        reportPath: payload.reportPath,
        onLog: log,
        onProgress: progress
      });
      return res;
    } catch (e) {
      log('error', '上线失败：' + e.message);
      return fail('E_UNKNOWN', '上线失败：' + e.message, null, e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : null);
    }
  });

  ipcMain.handle('dd:openExternal', async (_e, url) => {
    if (!url || !/^https?:\/\//i.test(url)) return fail('E_BAD_INPUT', '只能打开 http/https 链接');
    await shell.openExternal(url);
    return ok({});
  });

  ipcMain.handle('dd:openPath', async (_e, target) => {
    if (!target) return fail('E_BAD_INPUT', '路径为空');
    const err = await shell.openPath(target);
    if (err) return fail('E_NOT_FOUND', '打开失败：' + err);
    return ok({});
  });

  ipcMain.handle('dd:clipboardWrite', async (_e, text) => {
    clipboard.writeText(String(text == null ? '' : text));
    return ok({});
  });
}

/* ------------------------------------------------------------ 启动 */

app.whenReady().then(async () => {
  try {
    logLine('app ready，开始初始化');
    paths.userData = app.getPath('userData');
    paths.workspaces = path.join(paths.userData, 'workspaces');
    paths.tools = path.join(paths.userData, 'tools');
    logLine('userData：' + paths.userData);
    await ensureDir(paths.workspaces).catch((e) => logLine('创建 workspaces 失败：' + e.message));
    await ensureDir(paths.tools).catch((e) => logLine('创建 tools 失败：' + e.message));

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '文件',
        submenu: [
          { label: '打开工作区目录', click: () => shell.openPath(paths.workspaces) },
          { label: '打开插件目录', click: () => shell.openPath(paths.tools) },
          { type: 'separator' },
          { role: 'quit', label: '退出' }
        ]
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新加载' },
          { role: 'toggleDevTools', label: '开发者工具' },
          { type: 'separator' },
          { role: 'resetZoom', label: '重置缩放' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { role: 'togglefullscreen', label: '全屏' }
        ]
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '使用说明（README）',
            click: () => shell.openPath(path.join(__dirname, '..', 'README.md'))
          },
          {
            label: '打开 GitHub Pages 帮助',
            click: () => shell.openExternal('https://docs.github.com/zh/pages')
          }
        ]
      }
    ])
  );

  registerIpc();
  logLine('IPC 已注册');
  createWindow();
  await refreshTools();
  logLine('环境自检完成');
  // 后台每隔 20 秒刷新一次工具状态（例如用户在终端里手动登录了 GitHub）
  toolsTimer = setInterval(() => refreshTools('tools'), 20000);
  toolsTimer.unref && toolsTimer.unref();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (e) {
    logLine('启动过程出错：' + (e && e.stack ? e.stack : e));
    errBox('程序启动出错', (e && e.message ? e.message : String(e)) + '\n\n日志文件：' + LOG_FILE);
  }
});

app.on('second-instance', () => {
  logLine('收到 second-instance 事件（用户又启动了一次）');
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.on('child-process-gone', (_e, details) => {
  logLine('子进程结束：' + JSON.stringify(details));
});

app.on('window-all-closed', async () => {
  logLine('所有窗口已关闭，退出程序');
  if (toolsTimer) clearInterval(toolsTimer);
  await previewLib.stop().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (e) => {
  const text = e && e.stack ? e.stack : String(e);
  logLine('未捕获异常：' + text);
  send({ type: 'log', scope: 'main', level: 'error', message: '主进程异常：' + (e && e.message), ts: Date.now() });
  errBox('程序遇到未处理的错误', String((e && e.message) || e) + '\n\n日志文件：' + LOG_FILE);
});
process.on('unhandledRejection', (e) => {
  logLine('未处理的异步错误：' + ((e && e.stack) || String(e)));
  send({ type: 'log', scope: 'main', level: 'error', message: '未处理的异步错误：' + (e && e.message), ts: Date.now() });
});
