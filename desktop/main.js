// openLedMapper desktop app: the interface in its own window, with the Art-Net bridge (openledmapper.py) running
// inside the app. The bridge is started here with --embedded: it prints "READY <address>" once it listens, and
// stops when this app quits, because its stdin closes then (even if the app crashes).
//
//   npm start      runs it from the source, with python3 ../openledmapper.py as the bridge
//   npm run dist   builds the app; the packed bridge (PyInstaller, ../dist/openledmapper-bridge) must exist first
'use strict';

const { app, BrowserWindow, Menu, desktopCapturer, dialog, powerSaveBlocker, session, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_FILE = path.join(os.homedir(), '.openledmapper', 'openledmapper.log');

// Keep rendering and sending when the window is minimised, covered or in the background, as the
// switches openledmapper.py gives Chrome do.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let win = null;
let bridge = null;
let quitting = false;

// One copy at a time: opening the app again brings its window to the front.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(start);
}

function bridgeCommand() {
  if (app.isPackaged) {
    const exe = process.platform === 'win32' ? 'openledmapper-bridge.exe' : 'openledmapper-bridge';
    return [path.join(process.resourcesPath, 'bridge', exe), []];
  }
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  return [python, [path.join(__dirname, '..', 'openledmapper.py')]];
}

// Starts the bridge and resolves with the interface address it prints.
function startBridge() {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const log = fs.createWriteStream(LOG_FILE);
    const [cmd, pre] = bridgeCommand();
    // The bridge's network options can be given to the app too, written --option=value (e.g. --bind-ip=2.0.0.10).
    const passed = process.argv.filter(a => /^--(bind-ip|bind-port|port|host)=/.test(a));
    const args = pre.concat(['--embedded', `--parent-pid=${process.pid}`], passed);
    bridge = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    bridge.stdout.on('data', chunk => {
      log.write(chunk);
      if (out === null) return;
      out += chunk.toString();
      const m = out.match(/^READY (\S+)/m);
      if (m) { out = null; resolve(m[1]); }
    });
    bridge.stderr.on('data', chunk => { log.write(chunk); if (out !== null) out += chunk.toString(); });
    bridge.on('error', e => reject(new Error(`Could not start the Art-Net bridge (${cmd}): ${e.message}`)));
    bridge.on('exit', code => {
      bridge = null;
      if (out !== null) {
        const last = out.trim().split('\n').filter(Boolean).pop() || `exit code ${code}`;
        reject(new Error(`The Art-Net bridge stopped while starting: ${last}`));
      } else if (!quitting) {
        dialog.showErrorBox('openLedMapper', `The Art-Net bridge stopped unexpectedly. openLedMapper will close.\n\nDetails are in ${LOG_FILE}`);
        app.quit();
      }
    });
  });
}

function stopBridge() {
  if (!bridge) return;
  try { bridge.stdin.end(); } catch (e) { /* already gone */ }
  const b = bridge;
  setTimeout(() => { try { b.kill(); } catch (e) { /* already gone */ } }, 3000).unref();
}

async function start() {
  let url;
  try {
    url = await startBridge();
  } catch (e) {
    dialog.showErrorBox('openLedMapper', `${e.message}\n\nDetails are in ${LOG_FILE}`);
    quitting = true;
    stopBridge();
    app.quit();
    return;
  }

  // Stops macOS App Nap from slowing the app down when its window isn't visible.
  powerSaveBlocker.start('prevent-app-suspension');
  setUpScreenCapture();
  setUpMenu();

  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'openLedMapper',
    backgroundColor: '#0d1420',
    show: false,
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'icons', 'openledmapper-256.png'),  // packed: the app's own icon
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  const wc = win.webContents;
  // Links leave the app for the default browser; the interface itself stays on the bridge's address. The MIDI
  // window, which the page draws itself, is a window of the app.
  wc.setWindowOpenHandler(({ url: target, frameName }) => {
    if (frameName === 'olm-midi' && (target === '' || target === 'about:blank')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1180, height: 760, minWidth: 720, minHeight: 420, title: 'MIDI', backgroundColor: '#0d1420', autoHideMenuBar: true } };
    }
    openOutside(target);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, target) => { if (!target.startsWith(url)) { e.preventDefault(); openOutside(target); } });
  // The page asks before closing while Art-Net is on. In Chrome the browser shows that question; here the app does.
  wc.on('will-prevent-unload', e => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Close', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Art-Net output is on.', detail: 'Closing openLedMapper stops the output to your LEDs.',
    });
    if (choice === 0) e.preventDefault();  // preventDefault here means: close anyway
  });
  // Right-click in a text field: cut, copy and paste. The interface has its own menus for everything else.
  wc.on('context-menu', (e, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' },
    ]).popup({ window: win });
  });
  // Project files and the patch list are downloads: ask where to save them.
  session.defaultSession.on('will-download', (e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
  });

  win.loadURL(url);
}

function openOutside(target) {
  if (/^https?:\/\//.test(target)) shell.openExternal(target);
}

// Screen / window capture (getDisplayMedia). macOS 15 and newer show the system's own picker; elsewhere a small
// window lists the screens and windows to choose from.
function setUpScreenCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
      const chosen = await pickSource(sources.filter(s => s.name !== 'openLedMapper'));
      callback(chosen ? { video: chosen } : {});
    } catch (e) {
      callback({});
    }
  }, { useSystemPicker: true });
}

function pickSource(sources) {
  return new Promise(resolve => {
    const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const items = sources.map(s => `<button onclick="location.hash='${encodeURIComponent(s.id)}'"><img src="${s.thumbnail.toDataURL()}"><span>${esc(s.name)}</span></button>`).join('');
    const html = `<!doctype html><meta charset="utf-8"><title>Choose what to capture</title><style>
      body{margin:0;padding:16px;background:#0d1420;color:#dbe4f0;font:14px system-ui,sans-serif}
      h1{font-size:15px;margin:0 0 12px} .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
      button{background:#16202f;border:1px solid #2a3a52;border-radius:8px;color:inherit;padding:8px;cursor:pointer;text-align:left}
      button:hover{border-color:#22d3ee} img{width:100%;display:block;border-radius:4px;margin-bottom:6px;background:#000}
      span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style>
      <h1>Choose a screen or window to capture</h1><div class="grid">${items}</div>`;
    const picker = new BrowserWindow({
      parent: win, modal: process.platform !== 'darwin', width: 760, height: 520, title: 'Choose what to capture',
      backgroundColor: '#0d1420', autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, javascript: true },
    });
    let done = false;
    const finish = id => { if (done) return; done = true; resolve(sources.find(s => s.id === id) || null); if (!picker.isDestroyed()) picker.close(); };
    picker.webContents.on('did-navigate-in-page', (e, target) => finish(decodeURIComponent(new URL(target).hash.slice(1))));
    picker.on('closed', () => finish(null));
    picker.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

function setUpMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'openLedMapper on GitHub', click: () => shell.openExternal('https://github.com/nouled-studio/openLEDmapper') },
      { label: 'Show log file', click: () => shell.showItemInFolder(LOG_FILE) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One window is the whole app: closing it quits, on macOS too.
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', stopBridge);
