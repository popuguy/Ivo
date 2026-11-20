import { BrowserWindow, ipcMain, screen } from 'electron';
import { PANEL_LABELS } from '../src/domain/workspace/panels.js';

const known = (kind) => Object.hasOwn(PANEL_LABELS, kind);

/** One modeless window per panel. Only a document can own the editing target.
 * The palette has no document preload, storage bridge, or writer lease. */
export function installFloatingPalettes({ owner, preload, url, session, documents, onMenuChange }) {
  const windows = new Map(),
    bounds = new Map();
  let target = null,
    epoch = 0;
  const usable = (record) => record?.vault && !record.window.isDestroyed();
  function tell(record) {
    if (usable(record))
      record.window.webContents.send('ivo:palette-configuration', {
        epoch,
        kinds: [...windows.keys()],
        active: record === target,
        passive: !!target && record !== target,
      });
  }
  function configure() {
    for (const record of documents()) tell(record);
  }
  function activate(record) {
    record = usable(record) ? record : null;
    if (record === target) return;
    target = record;
    epoch++;
    for (const palette of windows.values()) {
      palette.revision = null;
      palette.view = null;
      if (palette.subscribed)
        palette.window.webContents.send('ivo:palette-view', null, palette.kind);
    }
    configure();
  }
  function fromPalette(event) {
    if (event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== url) return null;
    return [...windows.values()].find((item) => item.window.webContents === event.sender);
  }
  function focused() {
    const window = BrowserWindow.getFocusedWindow();
    return [...windows.values()].find((item) => item.window === window);
  }
  function open(record, kind, point) {
    if (!known(kind) || !usable(record) || !record.group.lease.canWrite(record)) return false;
    activate(record);
    const existing = windows.get(kind);
    if (existing) {
      existing.window.show();
      return true;
    }
    const origin = record.window.getBounds();
    const remembered = bounds.get(kind);
    const atPointer = Number.isFinite(point?.x) && Number.isFinite(point?.y);
    const x = Math.round(
      atPointer ? point.x - 30 : (remembered?.x ?? origin.x + origin.width - 280),
    );
    const y = Math.round(atPointer ? point.y - 12 : (remembered?.y ?? origin.y + 68));
    const area = screen.getDisplayNearestPoint({ x, y }).workArea;
    const width = Math.min(remembered?.width ?? 288, area.width);
    const height = Math.min(remembered?.height ?? 480, area.height);
    const window = new BrowserWindow({
      title: PANEL_LABELS[kind],
      width,
      height,
      x: Math.max(area.x, Math.min(x, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(y, area.y + area.height - height)),
      minWidth: 190,
      minHeight: 150,
      show: false,
      skipTaskbar: true,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      webPreferences: {
        preload,
        session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const palette = { window, kind, view: null, revision: null };
    windows.set(kind, palette);
    window.setMenu(null);
    window.on('focus', () => onMenuChange());

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.on('close', () => bounds.set(kind, window.getBounds()));
    window.on('closed', () => {
      windows.delete(kind);
      configure();
    });
    window.once('ready-to-show', () => window.showInactive());
    window.loadURL(url).catch(() => {
      if (!window.isDestroyed()) window.destroy();
    });
    configure();
    return true;
  }
  ipcMain.handle('ivo:palette-open', (event, kind, point) => open(owner(event), kind, point));
  ipcMain.on('ivo:palette-ready', (event) => {
    const palette = fromPalette(event);
    if (!palette) return;
    palette.subscribed = true;
    event.sender.send('ivo:palette-view', palette.view, palette.kind);
  });
  ipcMain.handle('ivo:palette-initial', (event) => {
    const palette = fromPalette(event);
    return palette ? { kind: palette.kind, view: palette.view } : null;
  });
  ipcMain.on('ivo:palette-field', (event, editing) => {
    const palette = fromPalette(event);
    if (!palette || !!palette.editing === (editing === true)) return;
    palette.editing = editing === true;
    if (palette === focused()) onMenuChange();
  });
  ipcMain.on('ivo:palette-dialog', (event) => {
    let source;
    try {
      source = owner(event);
    } catch {
      return;
    }
    if (source === target && focused()) source.window.focus();
  });
  ipcMain.on('ivo:palette-close', (event) => fromPalette(event)?.window.close());
  ipcMain.on('ivo:palette-publish', (event, value) => {
    let source;
    try {
      source = owner(event);
    } catch {
      return;
    }
    const palette = windows.get(value?.kind);
    if (source !== target || value?.epoch !== epoch || !palette) return;
    const view = value.view;
    if (
      view &&
      (typeof view.revision !== 'string' ||
        (typeof view.html !== 'string' && !(view.html === undefined && palette.view)))
    )
      return;
    palette.view = view ? { ...palette.view, ...view } : null;
    palette.revision = view?.revision;
    if (palette.subscribed) palette.window.webContents.send('ivo:palette-view', view, palette.kind);
  });
  ipcMain.on('ivo:palette-action', (event, value) => {
    const palette = fromPalette(event);
    if (
      !palette ||
      !usable(target) ||
      !target.group.lease.canWrite(target) ||
      target.nativeDialogOpen ||
      !palette.revision ||
      value?.revision !== palette.revision
    )
      return;
    target.window.webContents.send('ivo:palette-dispatch', { ...value, kind: palette.kind, epoch });
  });
  return {
    activate(record) {
      activate(record);
      if (record?.vault)
        for (const { window } of windows.values()) if (window.isVisible()) window.moveTop();
    },
    focused,
    // ready/lease notifications may follow the native focus change.
    refresh(record) {
      tell(record);
    },
    forWindow(window) {
      return [...windows.values()].some((item) => item.window === window) ? target : null;
    },
    release(record, remaining) {
      if (!remaining.length) {
        activate(null);
        for (const item of windows.values()) item.window.close();
        return;
      }
      if (record !== target) return;
      activate(
        remaining.find((item) => item.window.isFocused()) ||
          remaining
            .filter((item) => item.ready)
            .sort((a, b) => (b.focusedAt || 0) - (a.focusedAt || 0))[0],
      );
      if (!target) for (const item of windows.values()) item.window.close();
    },
  };
}
