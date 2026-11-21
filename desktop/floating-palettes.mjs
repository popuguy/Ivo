import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import { PANEL_LABELS } from '../src/domain/workspace/panels.js';
import { draggedPalettePosition, palettePosition } from '../src/domain/workspace/panel-drag.js';

const known = (kind) => Object.hasOwn(PANEL_LABELS, kind);

/** One modeless window per panel. Only a document can own the editing target.
 * The palette has no document preload, storage bridge, or writer lease. */
export function installFloatingPalettes({ owner, preload, url, session, documents, onMenuChange }) {
  const windows = new Map(),
    bounds = new Map();
  let target = null,
    epoch = 0,
    applicationActive = process.platform !== 'darwin' || app.isActive(),
    drag = null,
    pendingDrop = null;
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
    stopDrag(true);
    pendingDrop = null;
    target = record;
    epoch++;
    for (const palette of windows.values()) {
      palette.visibleInView = false;
      syncWindow(palette);
      palette.window.setParentWindow(record?.window ?? null);
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
  function finishLift(palette) {
    if (!palette.liftSource) return;
    dockPointer(palette.liftSource, 'lifted', palette.kind, null, palette.liftId);
    palette.liftSource = null;
  }
  function syncWindow(palette) {
    if (palette.window.isDestroyed()) return;
    if (
      !palette.visibleInView ||
      !usable(target) ||
      !applicationActive ||
      target.window.isMinimized()
    ) {
      if (palette.window.isVisible()) palette.window.hide();
      return;
    }
    if (!palette.readyToShow || (palette.waitForControls && !palette.painted)) return;
    if (!palette.window.isVisible()) palette.window.showInactive();
    finishLift(palette);
  }
  if (process.platform === 'darwin') {
    for (const [event, active] of [
      ['did-become-active', true],
      ['did-resign-active', false],
    ]) {
      app.on(event, () => {
        applicationActive = active;
        for (const palette of windows.values()) syncWindow(palette);
      });
    }
  }
  function open(record, kind, point, grip = { x: 30, y: 12 }, waitForControls = false) {
    if (!known(kind) || !usable(record) || !record.group.lease.canWrite(record)) return false;
    activate(record);
    const existing = windows.get(kind);
    if (existing) {
      syncWindow(existing);
      return true;
    }
    const origin = record.window.getBounds();
    const remembered = bounds.get(kind);
    const atPointer = Number.isFinite(point?.x) && Number.isFinite(point?.y);
    const anchor = atPointer
      ? point
      : {
          x: remembered?.x ?? origin.x + origin.width - 280,
          y: remembered?.y ?? origin.y + 68,
        };
    const area = screen.getDisplayNearestPoint({
      x: Math.round(anchor.x),
      y: Math.round(anchor.y),
    }).workArea;
    const width = Math.min(remembered?.width ?? 252, area.width);
    const height = Math.min(remembered?.height ?? (kind === 'text-wrap' ? 306 : 480), area.height);
    const window = new BrowserWindow({
      title: PANEL_LABELS[kind],
      width,
      height,
      ...palettePosition(anchor, atPointer ? grip : { x: 0, y: 0 }, { width, height }, area),
      frame: false,
      parent: record.window,
      roundedCorners: false,
      hasShadow: false,
      transparent: process.platform === 'darwin',
      backgroundColor: process.platform === 'darwin' ? '#00000000' : '#f0f0f0',
      minWidth: 190,
      minHeight: 150,
      show: false,
      skipTaskbar: true,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      webPreferences: {
        preload,
        session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const palette = { window, kind, view: null, revision: null, waitForControls };
    windows.set(kind, palette);
    window.setMenu(null);
    window.on('focus', () => onMenuChange());

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('render-process-gone', () => {
      if (!window.isDestroyed()) window.destroy();
    });
    window.on('close', () => {
      const rect = window.getBounds();
      if (palette.expandedHeight) rect.height = palette.expandedHeight;
      bounds.set(kind, rect);
    });
    window.on('closed', () => {
      finishLift(palette);
      if (drag?.palette === palette) stopDrag(false);
      if (pendingDrop?.palette === palette) pendingDrop = null;
      windows.delete(kind);
      configure();
    });
    window.once('ready-to-show', () => {
      palette.readyToShow = true;
      syncWindow(palette);
    });
    window.loadURL(url).catch(() => {
      if (!window.isDestroyed()) window.destroy();
    });
    configure();
    return true;
  }
  ipcMain.handle('ivo:palette-open', (event, kind, point) => open(owner(event), kind, point));
  function dockPointer(record, action, kind, point, id) {
    if (!usable(record)) return;
    const origin = record.window.getContentBounds();
    const zoom = record.window.webContents.getZoomFactor();
    record.window.webContents.send('ivo:palette-dock-pointer', {
      action,
      kind,
      id,
      x: point && (point.x - origin.x) / zoom,
      y: point && (point.y - origin.y) / zoom,
    });
  }
  function stopDrag(cancel) {
    if (!drag) return;
    const { palette, created, original, record } = drag;
    drag = null;
    dockPointer(record, 'clear', palette.kind);
    if (palette.window.isDestroyed()) return;
    if (palette.hovered) {
      palette.window.setOpacity(1);
      palette.hovered = false;
    }
    if (created) palette.window.setIgnoreMouseEvents(false);
    if (cancel) {
      if (created) palette.window.close();
      else palette.window.setBounds(original);
    }
  }
  ipcMain.on('ivo:palette-drag', (event, value) => {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      typeof value?.id !== 'string' ||
      value.id.length > 80
    )
      return;
    const { phase, id } = value;
    if (phase === 'cancel') {
      if (drag?.sender === event.sender && drag.id === id) stopDrag(true);
      return;
    }
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
    const point = { x: Math.round(value.x), y: Math.round(value.y) };
    if (phase === 'start') {
      let palette = fromPalette(event);
      const created = !palette;
      let record = target;
      const grip = { x: value.gripX, y: value.gripY };
      if (![grip.x, grip.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 4096)) return;
      if (created) {
        try {
          record = owner(event);
        } catch {
          return;
        }
      }
      if (!usable(record)) return;
      stopDrag(true);
      pendingDrop = null;
      if (created) {
        let opened = false;
        try {
          opened = !windows.has(value.kind) && open(record, value.kind, point, grip, true);
        } catch (error) {
          console.error('Unable to create floating panel:', error.message);
        }
        if (!opened) {
          dockPointer(record, 'lifted', value.kind, null, id);
          dockPointer(record, 'failed', value.kind, null, id);
          return;
        }
        palette = windows.get(value.kind);
        palette.liftSource = record;
        palette.liftId = id;
        // The document keeps the original pointer capture through the native handoff.
        palette.window.setIgnoreMouseEvents(true);
      }
      drag = {
        id,
        sender: event.sender,
        palette,
        created,
        record,
        grip,
        original: palette.window.getBounds(),
      };
    }
    if (
      !drag ||
      drag.sender !== event.sender ||
      drag.id !== id ||
      !['start', 'move', 'drop'].includes(phase)
    )
      return;
    const { palette, grip, record } = drag;
    const position = draggedPalettePosition(point, grip);
    palette.window.setPosition(position.x, position.y, false);
    if (phase === 'drop') {
      stopDrag(false);
      pendingDrop = { id, record, palette };
      dockPointer(record, 'drop', palette.kind, point, id);
    } else dockPointer(record, 'preview', palette.kind, point, id);
  });
  ipcMain.on('ivo:palette-dock-hover', (event, id, over) => {
    if (
      !drag ||
      drag.id !== id ||
      event.senderFrame !== event.sender.mainFrame ||
      drag.record.window.webContents !== event.sender ||
      typeof over !== 'boolean' ||
      !!drag.palette.hovered === over
    )
      return;
    drag.palette.hovered = over;
    drag.palette.window.setOpacity(over ? 0.75 : 1);
  });
  ipcMain.on('ivo:palette-drop-result', (event, id, accepted) => {
    if (
      !pendingDrop ||
      pendingDrop.id !== id ||
      event.senderFrame !== event.sender.mainFrame ||
      pendingDrop.record.window.webContents !== event.sender
    )
      return;
    const { palette } = pendingDrop;
    pendingDrop = null;
    if (accepted === true && !palette.window.isDestroyed()) palette.window.close();
  });
  ipcMain.on('ivo:palette-collapse', (event, collapsed) => {
    const palette = fromPalette(event);
    if (!palette || typeof collapsed !== 'boolean' || collapsed === !!palette.expandedHeight)
      return;
    const win = palette.window;
    const [width, height] = win.getSize();
    const nextHeight = collapsed ? 42 : palette.expandedHeight;
    palette.expandedHeight = collapsed ? height : null;
    win.setMinimumSize(190, collapsed ? 42 : 150);
    win.setSize(width, nextHeight, false);
  });
  function hidePalette(palette) {
    if (!palette || palette.window.isDestroyed()) return;
    dockPointer(target, 'hide', palette.kind);
    palette.window.close();
  }
  ipcMain.on('ivo:palette-hide', (event) => hidePalette(fromPalette(event)));
  ipcMain.handle('ivo:palette-menu', (event, x, y) => {
    const palette = fromPalette(event);
    if (!palette || !Number.isInteger(x) || !Number.isInteger(y)) return;
    const menu = Menu.buildFromTemplate([
      { id: 'dock-panel', label: 'Dock panel', click: () => palette.window.close() },
      { id: 'close-panel', label: 'Close panel', click: () => hidePalette(palette) },
    ]);
    return new Promise((resolve) =>
      menu.popup({ window: palette.window, x, y, callback: resolve }),
    );
  });
  ipcMain.on('ivo:palette-ready', (event) => {
    const palette = fromPalette(event);
    if (!palette) return;
    palette.subscribed = true;
    event.sender.send('ivo:palette-view', palette.view, palette.kind, !!palette.published);
  });
  ipcMain.on('ivo:palette-painted', (event) => {
    const palette = fromPalette(event);
    if (palette && !palette.painted) {
      palette.painted = true;
      syncWindow(palette);
    }
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
    palette.visibleInView = value.visible === true;
    palette.view = view ? { ...palette.view, ...view } : null;
    palette.revision = view?.revision;
    palette.published = true;
    if (palette.subscribed)
      palette.window.webContents.send('ivo:palette-view', view, palette.kind, true);
    syncWindow(palette);
  });
  ipcMain.on('ivo:palette-action', (event, value) => {
    const palette = fromPalette(event);
    if (
      !palette ||
      !usable(target) ||
      !palette.visibleInView ||
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
      for (const palette of windows.values()) syncWindow(palette);
    },
    beforeOwnerCloses(record) {
      for (const { window } of windows.values())
        if (!window.isDestroyed() && window.getParentWindow() === record.window)
          window.setParentWindow(null);
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
