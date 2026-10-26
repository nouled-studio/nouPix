// nouPix desktop app: the interface in its own window, with the Art-Net bridge (noupix.py) running
// inside the app. The bridge is started here with --embedded: it prints "READY <address>" once it listens, and
// stops when this app quits, because its stdin closes then (even if the app crashes).
//
//   npm start      runs it from the source, with python3 ../noupix.py as the bridge
//   npm run dist   builds the app; the packed bridge (PyInstaller, ../dist/noupix-bridge) must exist first
'use strict';

const { app, BrowserWindow, Menu, desktopCapturer, dialog, powerSaveBlocker, session, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_FILE = path.join(os.homedir(), '.noupix', 'noupix.log');

// The app was called openLedMapper: what it kept (the window's storage, with the project) carries over, once, before
// anything uses the new folder
try {
  const was = path.join(app.getPath('appData'), 'openLedMapper');
  if (!fs.existsSync(app.getPath('userData')) && fs.existsSync(was)) fs.renameSync(was, app.getPath('userData'));
} catch (e) { /* the old folder in use, or none: start afresh */ }

// Keep rendering and sending when the window is minimised, covered or in the background, as the
// switches noupix.py gives Chrome do.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let win = null;
let bridge = null;
let quitting = false;
// The MIDI and Scenes windows (the page draws into them), by their names: 'olm-midi', 'olm-scenes'
const popups = new Map();
// Brings one of them to the front, also from minimised; or asks the page to open it
function raisePopup(name) {
  const w = popups.get(name);
  if (w && !w.isDestroyed()) {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  } else if (win) {
    win.webContents.executeJavaScript(name === 'olm-midi' ? 'openMidiWindow()' : 'openScenesWindow()', true).catch(() => {});
  }
}

// Project files and packages opened from the Finder or Explorer (a double-click, Open with, one dropped on the app's
// icon): given to the page once it is there, which has the bridge read them (openPath in project-io.js). macOS tells
// the app with open-file, also before it is ready; Windows and Linux start it with the file as an argument, or pass
// it to the copy already running.
const toOpen = [];
let pageReady = false;
const isProjectPath = a => /\.(noupix|noupixpkg)$/i.test(a) && fs.existsSync(a);
process.argv.slice(1).filter(isProjectPath).forEach(p => toOpen.push(path.resolve(p)));
function openFile(p) { toOpen.push(p); openFiles(); }
function openFiles() {
  if (!win || !pageReady) return;
  while (toOpen.length) win.webContents.executeJavaScript(`openPath(${JSON.stringify(toOpen.shift())})`).catch(() => {});
}
app.on('open-file', (e, p) => { e.preventDefault(); openFile(p); });

// One copy at a time: opening the app again brings its window to the front, with the file it was asked to open.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', (e, argv, cwd) => {
    argv.slice(1).map(a => path.resolve(cwd || '', a)).filter(isProjectPath).forEach(openFile);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(start);
}

function bridgeCommand() {
  if (app.isPackaged) {
    const exe = process.platform === 'win32' ? 'noupix-bridge.exe' : 'noupix-bridge';
    return [path.join(process.resourcesPath, 'bridge', exe), []];
  }
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  return [python, [path.join(__dirname, '..', 'noupix.py')]];
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
        dialog.showErrorBox('nouPix', `The Art-Net bridge stopped unexpectedly. nouPix will close.\n\nDetails are in ${LOG_FILE}`);
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
    dialog.showErrorBox('nouPix', `${e.message}\n\nDetails are in ${LOG_FILE}`);
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
    title: 'nouPix',
    backgroundColor: '#000000',
    show: false,
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'icons', 'noupix-256.png'),  // packed: the app's own icon
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.webContents.on('did-finish-load', () => { pageReady = true; openFiles(); });

  const wc = win.webContents;
  // Links leave the app for the default browser; the interface itself stays on the bridge's address. The MIDI
  // and Scenes windows, which the page draws itself, are windows of the app.
  wc.setWindowOpenHandler(({ url: target, frameName }) => {
    if (frameName === 'olm-midi' && (target === '' || target === 'about:blank')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1180, height: 760, minWidth: 720, minHeight: 420, title: 'MIDI', backgroundColor: '#000000', autoHideMenuBar: true } };
    }
    if (frameName === 'olm-scenes' && (target === '' || target === 'about:blank')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1180, height: 460, minWidth: 520, minHeight: 220, title: 'Scenes', backgroundColor: '#000000', autoHideMenuBar: true } };
    }
    openOutside(target);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, target) => { if (!target.startsWith(url)) { e.preventDefault(); openOutside(target); } });
  // The page can't restore a minimised window, nor always bring one to the front: it asks by setting the window's
  // address to #raise… (an in-page move, which the page's drawing doesn't notice), and the app does it.
  wc.on('did-create-window', (child, { frameName }) => {
    if (frameName !== 'olm-midi' && frameName !== 'olm-scenes') return;
    popups.set(frameName, child);
    child.on('closed', () => { if (popups.get(frameName) === child) popups.delete(frameName); });
    child.webContents.on('did-navigate-in-page', (e, target) => { if (/#raise/.test(target)) raisePopup(frameName); });
  });
  // The page asks before closing while Art-Net is on. In Chrome the browser shows that question; here the app does.
  wc.on('will-prevent-unload', e => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Close', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Art-Net output is on.', detail: 'Closing nouPix stops the output to your LEDs.',
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
    // a project saved: the page learns its file, so the next Save (Ctrl S) writes it without asking
    item.once('done', (ev, state) => {
      const p = item.getSavePath();
      if (state === 'completed' && win && /\.noupix$/i.test(p)) win.webContents.executeJavaScript(`savedToPath(${JSON.stringify(p)})`).catch(() => {});
    });
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
      const chosen = await pickSource(sources.filter(s => s.name !== 'nouPix'));
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
      body{margin:0;padding:16px;background:#000;color:#f0f0f0;font:14px system-ui,sans-serif}
      h1{font-size:15px;margin:0 0 12px} .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
      button{background:#111;border:1px solid #2c2c2c;border-radius:0;color:inherit;padding:8px;cursor:pointer;text-align:left}
      button:hover{border-color:#ff3b3b} img{width:100%;display:block;margin-bottom:6px;background:#000}
      span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style>
      <h1>Choose a screen or window to capture</h1><div class="grid">${items}</div>`;
    const picker = new BrowserWindow({
      parent: win, modal: process.platform !== 'darwin', width: 760, height: 520, title: 'Choose what to capture',
      backgroundColor: '#000000', autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, javascript: true },
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
    { label: 'Window', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' },
      // the MIDI and Scenes windows, from here too: also minimised, or behind the main window
      { label: 'MIDI window', accelerator: 'CmdOrCtrl+Shift+M', click: () => raisePopup('olm-midi') },
      { label: 'Scenes window', click: () => raisePopup('olm-scenes') },
      { label: 'Main window', click: () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } } },
      { type: 'separator' }, { role: 'close' },
    ] },
    { role: 'help', submenu: [
      { label: 'nouPix on GitHub', click: () => shell.openExternal('https://github.com/nouled-studio/openLEDmapper') },
      { label: 'Show log file', click: () => shell.showItemInFolder(LOG_FILE) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One window is the whole app: closing it quits, on macOS too.
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', stopBridge);
