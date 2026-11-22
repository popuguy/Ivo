import { endnoteCommands } from '../src/domain/documents/endnotes.js';
import { CASE_COMMANDS } from '../src/domain/text/change-case.js';
import { LIST_COMMANDS } from '../src/domain/text/list-numbering.js';
import { ARRANGE_COMMANDS } from '../src/domain/documents/arrange.js';
import { editorMenuState } from '../src/domain/workspace/editor-commands.js';
import { PANEL_LABELS } from '../src/domain/workspace/panels.js';
import { WORKSPACE_FEATURES } from '../src/domain/workspace/features.js';
import { configureTextInput } from './text-input-policy.mjs';
import {
  NATIVE_TEXT_COMMANDS,
  INSERT_CHARACTERS,
  CHARACTER_MENUS,
  textCommandEnabled,
  NATIVE_TEXT_ACCELERATORS,
  nativeTextMenuState,
} from '../src/domain/text/native-commands.js';
import { installFloatingPalettes } from './floating-palettes.mjs';
import { createDocumentClipboard } from './document-clipboard.mjs';
import { createSystemFonts } from './system-fonts.mjs';
import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  shell,
  dialog,
  Menu,
  screen,
  session,
  clipboard,
  ClipboardItem,
  systemPreferences,
} from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  writeFile,
  rename,
  unlink,
  mkdir,
  stat,
  readFile,
  realpath,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { openVault } from './vault.mjs';
import { openVaultRegistry } from './vault-registry.mjs';
import { renderPDF, pdfRendererOwner } from './pdf-export.mjs';
import { createTextComposition } from './text-composition.mjs';
import { installTextCompositionBridge } from './text-composition-bridge.mjs';
import { buildNativeText } from '../scripts/build-native-text.mjs';
import {
  createWindowLease,
  workspaceWindowBounds,
  navigationMenuItems,
} from './workspace-windows.mjs';
import { normalizeWorkspace } from '../src/domain/workspace/state.js';
const documentClipboard = createDocumentClipboard({ clipboard, ClipboardItem });
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  systemFonts = createSystemFonts(
    app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked/desktop/native/bin/ivo-fonts')
      : path.join(project, 'desktop/native/bin/ivo-fonts'),
  ),
  webRoot = path.join(project, 'dist'),
  origin = 'ivo://app',
  pageURL = origin + '/index.html';
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
if (process.env.IVO_USER_DATA_DIR)
  app.setPath('userData', path.resolve(process.env.IVO_USER_DATA_DIR));
app.setName('Ivo');
const records = new Map(),
  vaultWindows = new Map(),
  vaultGroups = new Map(),
  creating = new Map(),
  opening = new Map(),
  forgetting = new Set(),
  servedSessions = new WeakSet(),
  windowAcks = new Map(),
  lateWindowAcks = new Map();
let registry,
  manager,
  resourceHandler,
  palettes,
  textCompositionBridge,
  quitting = false;
const activeRecord = () =>
  records.get(BrowserWindow.getFocusedWindow()?.webContents.id) ||
  palettes?.forWindow(BrowserWindow.getFocusedWindow()) ||
  [...records.values()]
    .filter((r) => !r.window.isDestroyed())
    .sort((a, b) => (b.focusedAt || 0) - (a.focusedAt || 0))[0];
function owner(event) {
  const record = records.get(event.sender.id);
  if (
    !record ||
    event.sender !== record.window.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url.split('#')[0] !== pageURL
  )
    throw new Error('Invalid Ivo window request.');
  return record;
}
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('will-quit', () => textCompositionBridge?.close());
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('second-instance', () => {
    const record = activeRecord();
    showWindow(record);
  });
  app
    .whenReady()
    .then(async () => {
      configureTextInput(systemPreferences);
      registry = await openVaultRegistry(path.join(app.getPath('userData'), 'vaults.json'));
      resourceHandler = async (request) => {
        const url = new URL(request.url),
          pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
          target = path.resolve(webRoot, '.' + pathname);
        if (
          url.host !== 'app' ||
          !target.startsWith(webRoot + path.sep) ||
          pathname.split('/').some((part) => part.startsWith('.'))
        )
          return new Response('Forbidden', { status: 403 });
        const result = await net.fetch(pathToFileURL(target).href),
          headers = new Headers(result.headers);
        headers.set(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; object-src 'self' data: blob:; frame-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'",
        );
        return new Response(result.body, { status: result.status, headers });
      };
      const paletteSession = session.fromPartition('ivo-palettes');
      paletteSession.protocol.handle('ivo', resourceHandler);
      paletteSession.setPermissionRequestHandler((_contents, _permission, done) => done(false));
      paletteSession.setPermissionCheckHandler(() => false);
      palettes = installFloatingPalettes({
        owner,
        preload: path.join(project, 'desktop/palette-preload.cjs'),
        url: origin + '/palette.html',
        session: paletteSession,
        documents: () => records.values(),
        onMenuChange: installMenu,
      });
      const methods = new Set([
        'loadDocuments',
        'saveDocument',
        'loadAssets',
        'saveAsset',
        'loadAsset',
        'getMeta',
        'putMeta',
        'saveImport',
        'changeLibrary',
      ]);
      textCompositionBridge = installTextCompositionBridge({
        ipcMain,
        authorize(event) {
          try {
            return owner(event);
          } catch {
            return pdfRendererOwner(event);
          }
        },
        async createService() {
          const executable = app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked/desktop/native/bin/ivo-text')
            : await buildNativeText();
          if (!executable)
            throw new Error('Native text composition is unavailable on this platform.');
          return createTextComposition(executable);
        },
      });
      ipcMain.handle('ivo:fonts', async (event, action, value) => {
        owner(event);
        if (action === 'list')
          return process.platform === 'darwin' ? systemFonts.list(value === true) : [];
        if (action === 'read') return systemFonts.read(value);
        throw new Error('Unknown font request.');
      });
      ipcMain.handle('ivo:store', async (event, method, args) => {
        const record = owner(event);
        if (!record.vault || !methods.has(method) || !Array.isArray(args) || args.length > 2)
          throw new Error('Invalid vault operation.');
        args = [...args];
        const metadata = method === 'getMeta' || method === 'putMeta',
          viewOnly = metadata && args[0] === 'workspace:1';
        if (
          metadata &&
          typeof args[0] === 'string' &&
          (args[0].startsWith('workspace-window:') || args[0] === 'workspace-windows:1')
        )
          throw new Error('Workspace metadata belongs to its native window.');
        if (viewOnly) args[0] = workspaceKey(record);
        const mutation =
          method.startsWith('save') || method === 'putMeta' || method === 'changeLibrary';
        if (mutation && !viewOnly && (!record.group.lease.canWrite(record) || record.closingIntent))
          throw new Error('This workspace is read-only while another window is editing.');
        const result = await record.vault[method](...args);
        if (mutation && !viewOnly)
          for (const peer of record.group.windows)
            if (peer !== record && peer.ready && !peer.window.isDestroyed())
              peer.window.webContents.send('ivo:store-changed', {
                method,
                id: method === 'putMeta' ? args[0] : args[0]?.id || null,
              });
        return result;
      });
      ipcMain.on('ivo:window-ack', (event, token, success) => {
        let record;
        try {
          record = owner(event);
        } catch {
          return;
        }
        const pending = windowAcks.get(token);
        if (!pending) {
          if (lateWindowAcks.get(token) !== record) return;
          lateWindowAcks.delete(token);
          if (
            record.group.lease.canWrite(record) &&
            ![...windowAcks.values()].some(
              (value) => value.record === record && value.channel === 'ivo:prepare-window-release',
            )
          )
            record.window.webContents.send('ivo:window-state', { active: true });
          return;
        }
        if (pending.record !== record) return;
        windowAcks.delete(token);
        clearTimeout(pending.timer);
        success === true || (pending.channel === 'ivo:tab-transfer' && pending.phase === 'probe')
          ? pending.resolve(success === true)
          : pending.reject(new Error('The workspace could not finish its window transition.'));
      });
      ipcMain.handle('ivo:windows', async (event, action, value) => {
        const record = owner(event);
        if (action === 'failed') {
          record.startupFailed = true;
          record.presentable = true;
          record.ready = false;
          record.rejectReady?.(new Error('The workspace could not finish opening.'));
          record.resolveReady = null;
          showWindow(record);
          return true;
        }
        if (action === 'ready') {
          record.startupFailed = false;
          if (record.vault) {
            record.group.lease.ready(record);
            if (!record.silent || record.focusOnReady) await record.group.lease.request(record);
          } else record.ready = true;
          record.presentable = true;
          palettes.refresh(record);
          showWindow(record, { inactive: record.silent && !record.focusOnReady });
          record.resolveReady?.();
          record.resolveReady = null;
          if (record.restoreOwner)
            void restoreWorkspaceWindows(record.group).catch((error) => report(record, error));
          return windowInfo(record);
        }
        if (action === 'close') {
          record.window.close();
          return true;
        }
        if (!record.vault) throw new Error('No vault is open.');
        if (action === 'info') return windowInfo(record);
        if (action === 'open') return openWorkspaceWindow(record, value);
        throw new Error('Invalid workspace window operation.');
      });
      ipcMain.on('ivo:window-drag', (event, phase, value) => {
        try {
          const record = owner(event);
          if (record.vault) updateDragPreview(record, phase, value);
        } catch {}
      });
      ipcMain.handle('ivo:navigation-menu', (event, items) => {
        const record = owner(event);
        if (!record.vault) throw new Error('No vault is open.');
        const values = navigationMenuItems(items);
        return new Promise((resolve) => {
          let selected = null;
          const build = (list) =>
            list.map((item) =>
              item.submenu
                ? { ...item, submenu: build(item.submenu) }
                : item.type === 'separator'
                  ? item
                  : {
                      ...item,
                      click: () => {
                        selected = item.id;
                      },
                    },
            );
          Menu.buildFromTemplate(build(values)).popup({
            window: record.window,
            callback: () => resolve(selected),
          });
        });
      });
      ipcMain.handle('ivo:document-file', async (event, action, id, kind) => {
        const record = owner(event),
          value = await documentFileInfo(record, id);
        if (action === 'info') return value;
        if (action === 'reveal') {
          shell.showItemInFolder(value.absolutePath);
          return true;
        }
        if (action === 'copy-path' && ['relative', 'absolute'].includes(kind)) {
          await documentClipboard.copyPath(value, kind);
          return true;
        }
        if (action === 'copy-link') {
          const doc = (await record.vault.loadDocuments()).find((doc) => doc.id === id);
          if (!doc) throw new Error('This document is no longer available.');
          await documentClipboard.copyLink(doc);
          return true;
        }
        throw new Error('Invalid document file operation.');
      });
      ipcMain.handle('ivo:document-preview', async (event, snapshot) => {
        const record = owner(event);
        if (!record.vault || record.exportingPDF)
          throw new Error('PDF rendering is already running.');
        record.exportingPDF = true;
        let directory;
        try {
          const { bytes, manifest } = await renderPDF(snapshot, {
            project,
            compositionPDF: (contents, token) => textCompositionBridge.readPDF(contents, token),
          });
          directory = await mkdtemp(path.join(app.getPath('temp'), 'ivo-preview-'));
          const name =
              String(snapshot?.title || 'Document')
                // eslint-disable-next-line no-control-regex -- Reject control characters at the data boundary.
                .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
                .slice(0, 100) || 'Document',
            file = path.join(directory, name + '.pdf');
          await writeFile(file, bytes, { mode: 0o600 });
          const failure = await shell.openPath(file);
          if (failure) throw new Error(failure);
          return { pages: manifest.pages.length, warnings: manifest.warnings };
        } catch (error) {
          if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
          throw error;
        } finally {
          record.exportingPDF = false;
          if (record.closeAfterPDF) {
            record.closeAfterPDF = false;
            record.window.close();
          }
        }
      });
      ipcMain.handle('ivo:vaults', async (event, action, value) => {
        const record = owner(event);
        if (
          ![
            'info',
            'list',
            'open',
            'choose',
            'create',
            'forget',
            'manager',
            'menu',
            'show',
          ].includes(action)
        )
          throw new Error('Invalid vault request.');
        if (action === 'info')
          return record.entry
            ? {
                id: record.entry.id,
                name: record.entry.name,
                directory: record.vault.directory,
                manager: false,
              }
            : { manager: true };
        if (action === 'list')
          return registry.list().map((entry) => ({ ...entry, open: vaultWindows.has(entry.id) }));
        if (action === 'manager') {
          showManager();
          return true;
        }
        if (action === 'menu') {
          const items = registry.list().map((entry) => ({
            label: entry.name,
            type: 'checkbox',
            checked: entry.id === record.entry?.id,
            click: () => openRegistered(entry.id).catch((error) => report(record, error)),
          }));
          items.push({ type: 'separator' }, { label: 'Manage vaults…', click: showManager });
          return new Promise((resolve) =>
            Menu.buildFromTemplate(items).popup({
              window: record.window,
              callback: () => resolve(true),
            }),
          );
        }
        if (action === 'open') {
          if (typeof value !== 'string') throw new Error('Choose a registered vault.');
          return info(await openRegistered(value));
        }
        if (action === 'show') {
          const entry = registry.entry(value || record.entry?.id);
          if (!entry) throw new Error('Choose a registered vault.');
          return shell.openPath(entry.path);
        }
        if (action === 'forget') {
          if (
            typeof value !== 'string' ||
            vaultWindows.has(value) ||
            opening.has(value) ||
            forgetting.has(value)
          )
            throw new Error('Close this vault before removing it from the list.');
          forgetting.add(value);
          try {
            await registry.setOpen(value, false);
            await registry.forget(value);
            notifyVaults();
            return true;
          } finally {
            forgetting.delete(value);
          }
        }
        if (record.nativeDialogOpen) throw new Error('Finish the open folder dialog first.');
        record.nativeDialogOpen = true;
        installMenu();
        try {
          if (
            action === 'create' &&
            (typeof value !== 'string' ||
              !value.trim() ||
              value.length > 80 ||
              // eslint-disable-next-line no-control-regex -- Reject control characters at the data boundary.
              /[\\/:\x00-\x1f]/.test(value) ||
              ['.', '..'].includes(value.trim()))
          )
            throw new Error('Enter a valid vault name.');
          const choice = await dialog.showOpenDialog(record.window, {
            title:
              action === 'create'
                ? 'Choose location for ' + value.trim()
                : 'Open folder as Ivo vault',
            buttonLabel: action === 'create' ? 'Create here' : 'Open vault',
            properties: ['openDirectory', 'createDirectory'],
            defaultPath: record.entry?.parent || app.getPath('documents'),
          });
          if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
          let directory = choice.filePaths[0];
          if (action === 'create') {
            directory = path.join(directory, value.trim());
            try {
              await mkdir(directory);
            } catch (error) {
              if (error.code === 'EEXIST')
                throw new Error(
                  'A folder with this name already exists. Open it as a vault or choose another name.',
                  { cause: error },
                );
              throw error;
            }
          }
          const canonical = await realpath(directory),
            knownEntry = registry.list().find((entry) => entry.path === canonical),
            vault =
              (knownEntry && vaultWindows.get(knownEntry.id)?.vault) ||
              (await openVault(canonical)),
            entry = await registry.remember(vault.directory);
          return { ...info(await openEntry(entry, vault)), canceled: false };
        } finally {
          record.nativeDialogOpen = false;
          installMenu();
        }
      });
      ipcMain.handle('ivo:show-folder', (event) => {
        const record = owner(event);
        if (!record.vault) throw new Error('No vault is open.');
        return shell.openPath(record.vault.directory);
      });
      ipcMain.handle('ivo:export-pdf', async (event, snapshot) => {
        const record = owner(event);
        if (!record.vault || record.exportingPDF) throw new Error('PDF export is already running.');
        record.exportingPDF = true;
        try {
          const name =
            String(snapshot?.title || 'Untitled')
              // eslint-disable-next-line no-control-regex -- Reject control characters at the data boundary.
              .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
              .slice(0, 160) || 'Untitled';
          let choice;
          record.nativeDialogOpen = true;
          installMenu();
          try {
            choice = await dialog.showSaveDialog(record.window, {
              title: 'Export PDF',
              defaultPath: name + '.pdf',
              filters: [{ name: 'PDF document', extensions: ['pdf'] }],
            });
          } finally {
            record.nativeDialogOpen = false;
            installMenu();
          }
          if (choice.canceled || !choice.filePath) return { canceled: true };
          const { bytes, manifest } = await renderPDF(snapshot, {
              project,
              compositionPDF: (contents, token) => textCompositionBridge.readPDF(contents, token),
            }),
            temporary = path.join(
              path.dirname(choice.filePath),
              '.ivo-pdf-' + crypto.randomUUID() + '.tmp',
            );
          try {
            await writeFile(temporary, bytes, { flag: 'wx' });
            await rename(temporary, choice.filePath);
          } finally {
            await unlink(temporary).catch(() => {});
          }
          return { canceled: false, pages: manifest.pages.length, warnings: manifest.warnings };
        } finally {
          record.exportingPDF = false;
          if (record.closeAfterPDF) {
            record.closeAfterPDF = false;
            record.window.close();
          }
        }
      });
      ipcMain.on('ivo:history-state', (event, state) => {
        let record;
        try {
          record = owner(event);
        } catch {
          return;
        }
        if (
          !state ||
          typeof state.canUndo !== 'boolean' ||
          typeof state.canRedo !== 'boolean' ||
          !['undoLabel', 'redoLabel'].every(
            (key) => typeof state[key] === 'string' && state[key].length <= 60,
          )
        )
          return;
        record.history = {
          canUndo: state.canUndo,
          canRedo: state.canRedo,
          undoLabel: state.undoLabel,
          redoLabel: state.redoLabel,
          canGoBack: state.canGoBack === true,
          canGoForward: state.canGoForward === true,
          ...nativeTextMenuState(state),
          ...editorMenuState(state),
        };
        if (record === activeRecord() && !record.nativeDialogOpen) applyHistory(record);
      });
      ipcMain.handle('ivo:context-menu', (event, context) => {
        const record = owner(event);
        if (
          !record.vault ||
          !context ||
          typeof context.selected !== 'boolean' ||
          typeof context.textEditing !== 'boolean'
        )
          throw new Error('Invalid context request.');
        const send = (name) => record.window.webContents.send('ivo:command', name),
          items = [
            { label: 'Insert Document Link…', click: () => send('link') },
            { label: 'Insert Table…', click: () => send('insert-table') },
            ...(context.table === true
              ? [{ label: 'Table Options…', click: () => send('table-options') }]
              : []),
            { label: 'Insert Page Link…', click: () => send('page-link') },
            { label: 'New Cross-Reference…', click: () => send('new-cross-reference') },
            ...(context.textEditing
              ? Object.entries(endnoteCommands).map(([id, label]) => ({
                  label,
                  click: () => send(id),
                }))
              : []),
            { type: 'separator' },
          ];
        if (context.textEditing)
          items.push(
            ...characterMenuItems(true),
            textActionMenu(true, 'Bulleted & Numbered Lists', LIST_COMMANDS),
            ...(record.history?.canChangeCase
              ? [textActionMenu(true, 'Change Case', CASE_COMMANDS)]
              : []),
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { type: 'separator' },
          );
        items.push(
          { label: 'Duplicate', enabled: context.selected, click: () => send('duplicate') },
          { label: 'Delete', enabled: context.selected, click: () => send('delete') },
          { type: 'separator' },
          { label: 'Select All', click: () => send('select-all') },
          { label: 'Deselect', click: () => send('deselect') },
        );
        return new Promise((resolve) =>
          Menu.buildFromTemplate(items).popup({
            window: record.window,
            callback: () => resolve(true),
          }),
        );
      });
      ipcMain.on('ivo:close-ready', async (event, success) => {
        let record;
        try {
          record = owner(event);
        } catch {
          return;
        }
        if (!record.preparingClose) return;
        if (success !== true) {
          record.preparingClose = false;
          quitting = false;
          await dialog.showMessageBox(record.window, {
            type: 'error',
            message: 'Your latest edits could not be saved.',
            detail: 'Keep this vault open and export a backup before closing it.',
            buttons: ['Keep editing'],
          });
          return;
        }
        try {
          await record.vault.flush();
          record.closingIntent = true;
          if (
            !quitting &&
            ![...record.group.windows].some(
              (peer) => !peer.closingIntent && !peer.window.isDestroyed(),
            )
          )
            await registry.setOpen(record.entry.id, false);
          await persistWorkspaceWindows(record.group, record);
          record.mayClose = true;
          record.window.close();
        } catch (error) {
          record.preparingClose = false;
          record.closingIntent = false;
          quitting = false;
          await registry.setOpen(record.entry.id, true).catch(() => {});
          await dialog.showMessageBox(record.window, {
            type: 'error',
            message: 'This vault could not finish closing.',
            detail: error.message,
            buttons: ['Keep editing'],
          });
        }
      });
      if (process.env.IVO_ATLAS_DIR) {
        const vault = await openVault(process.env.IVO_ATLAS_DIR);
        await openEntry(await registry.remember(vault.directory), vault);
      } else {
        const entries = registry.list(),
          restore = entries.filter((entry) => entry.open);
        if (!entries.length) {
          const vault = await openVault(path.join(app.getPath('documents'), 'Ivo Atlas'));
          await openEntry(await registry.remember(vault.directory), vault);
        } else {
          for (const entry of restore.length ? [...restore].reverse() : entries.slice(0, 1))
            try {
              await openRegistered(entry.id);
            } catch (error) {
              await dialog.showMessageBox({
                type: 'error',
                message: 'This vault could not be opened.',
                detail: entry.path + '\n' + error.message,
                buttons: ['Manage vaults'],
              });
            }
          if (!vaultWindows.size) showManager();
        }
      }
      app.on('activate', () => {
        if (!records.size) showManager();
      });
      installMenu();
    })
    .catch((error) => {
      dialog.showErrorBox('Ivo could not open your vault', error.message);
      app.exit(1);
    });
}
function info(record) {
  return { id: record.entry.id, name: record.entry.name, directory: record.vault.directory };
}
function report(record, error) {
  if (record.window.isDestroyed()) return;
  dialog.showMessageBox(record.window, {
    type: 'error',
    message: 'The workspace could not complete this action.',
    detail: error.message,
    buttons: ['OK'],
  });
}
async function openRegistered(id) {
  if (forgetting.has(id))
    throw new Error('The vault list is being updated. Try opening this vault again.');
  const entry = registry.entry(id);
  if (!entry) throw new Error('This vault is no longer in the list.');
  if (vaultWindows.has(id)) {
    const record = vaultWindows.get(id);
    showWindow(record);
    await registry.setOpen(id, true);
    return record;
  }
  if (opening.has(id)) return opening.get(id);
  const pending = (async () => {
    if (!(await stat(entry.path)).isDirectory())
      throw new Error('The vault folder is unavailable.');
    const vault = await openVault(entry.path);
    await registry.setOpen(id, true);
    return openEntry(entry, vault);
  })();
  opening.set(id, pending);
  try {
    return await pending;
  } finally {
    opening.delete(id);
  }
}
async function openEntry(entry, vault) {
  if (vaultWindows.has(entry.id)) {
    const known = vaultWindows.get(entry.id);
    showWindow(known);
    return known;
  }
  if (creating.has(entry.id)) return creating.get(entry.id);
  const pending = (async () => {
    const descriptors = (await vault.getMeta('workspace-windows:1'))?.value || [],
      group = {
        entry,
        vault,
        windows: new Set(),
        descriptors: new Map(descriptors.map((value) => [value.id, value])),
        restored: false,
        openQueue: Promise.resolve(),
      };
    group.lease = createWindowLease({
      release: (record) => askWindow(record, 'ivo:prepare-window-release'),
      snapshot: async () => {
        await vault.flush();
        return { documents: await vault.loadDocuments(), assets: await vault.loadAssets() };
      },
      grant: (record, state) => askWindow(record, 'ivo:window-state', { active: true, ...state }),
      passive: (record) => {
        if (!record.window.isDestroyed())
          record.window.webContents.send('ivo:window-state', { active: false });
      },
    });
    vaultGroups.set(entry.id, group);
    const saved =
        descriptors.find((value) => value.id === 'main' && value.open) ||
        descriptors.find((value) => value.open),
      windowId = saved?.id || 'main',
      area = saved
        ? screen.getDisplayNearestPoint({ x: saved.bounds?.x || 0, y: saved.bounds?.y || 0 })
            .workArea
        : null,
      record = createWindow(entry, vault, {
        group,
        main: windowId === 'main',
        windowId,
        bounds: saved ? workspaceWindowBounds(saved.bounds, area) : undefined,
        initialWriter: true,
        restoreOwner: true,
      });
    vaultWindows.set(entry.id, record);
    notifyVaults();
    return record;
  })();
  creating.set(entry.id, pending);
  try {
    return await pending;
  } finally {
    creating.delete(entry.id);
  }
}
function notifyVaults() {
  if (quitting) return;
  for (const record of records.values())
    if (!record.vault && !record.window.isDestroyed())
      record.window.webContents.send('ivo:vault-list-changed');
}
function showManager() {
  if (manager && !manager.window.isDestroyed()) {
    showWindow(manager);
    return;
  }
  manager = createWindow(null, null);
}
/** Existing-window requests cannot expose a blank initial renderer. */
function showWindow(record, { inactive = false } = {}) {
  if (!record || record.window.isDestroyed()) return;
  if (!record.presentable) {
    record.focusOnReady ||= !inactive;
    return;
  }
  if (inactive) record.window.showInactive();
  else {
    record.window.show();
    record.window.focus();
  }
}
function createWindow(
  entry,
  vault,
  {
    group,
    main = false,
    windowId = main ? 'main' : 'window-' + crypto.randomUUID(),
    bounds,
    silent = false,
    initialWriter = main,
    restoreOwner = false,
  } = {},
) {
  const window = new BrowserWindow({
      width: entry ? 1440 : 900,
      height: entry ? 960 : 600,
      ...bounds,
      show: false,
      paintWhenInitiallyHidden: true,
      minWidth: entry ? 600 : 640,
      minHeight: entry ? 450 : 450,
      title: entry ? entry.name + ' — Ivo' : 'Ivo vaults',
      backgroundColor: '#f5f5f6',
      ...(entry ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } } : {}),
      webPreferences: {
        preload: path.join(project, 'desktop/preload.cjs'),
        partition: 'persist:ivo-' + (entry?.id || 'vault-manager'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }),
    record = {
      window,
      entry,
      vault,
      group,
      windowId,
      main,
      restoreOwner,
      ready: false,
      silent,
      mayClose: !vault,
      preparingClose: false,
      exportingPDF: false,
      nativeDialogOpen: false,
      presentable: false,
      startupFailed: false,
      focusOnReady: false,
      history: null,
    };
  const contentsId = window.webContents.id;
  record.readyPromise = new Promise((resolve, reject) => {
    record.resolveReady = resolve;
    record.rejectReady = reject;
  });
  record.readyPromise.catch(() => {});
  records.set(contentsId, record);
  if (group) {
    group.windows.add(record);
    group.lease.add(record, { initial: initialWriter });
  }
  if (!servedSessions.has(window.webContents.session)) {
    window.webContents.session.protocol.handle('ivo', resourceHandler);
    servedSessions.add(window.webContents.session);
  }
  window.webContents.session.setPermissionRequestHandler((_c, _p, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== pageURL) event.preventDefault();
  });
  window.on('focus', () => {
    record.focusedAt = Date.now();
    palettes.activate(record);
    installMenu();
    if (entry) {
      registry.setOpen(entry.id, true).catch(() => {});
      if (record.ready)
        group.lease
          .request(record)
          .then(() => {
            palettes.refresh(record);
            if (record === activeRecord() && !record.nativeDialogOpen) applyHistory(record);
          })
          .catch((error) => report(record, error));
    }
  });
  window.on('blur', () => closeDragPreview(record));
  let boundsTimer;
  const rememberBounds = () => {
    if (!entry) return;
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(
      () => persistWorkspaceWindows(group).catch((error) => report(record, error)),
      150,
    );
  };
  window.on('move', rememberBounds);
  window.on('resize', rememberBounds);
  window.on('close', (event) => {
    if (record.mayClose || record.startupFailed) {
      palettes.beforeOwnerCloses(record);
      return;
    }
    event.preventDefault();
    if (record.exportingPDF) {
      record.closeAfterPDF = true;
      return;
    }
    if (!record.preparingClose) {
      record.preparingClose = true;
      window.webContents.send('ivo:prepare-close');
    }
  });
  window.on('closed', () => {
    clearTimeout(boundsTimer);
    closeDragPreview(record);
    record.rejectReady?.(new Error('The workspace window closed before it was ready.'));
    for (const [token, pending] of windowAcks)
      if (pending.record === record) {
        windowAcks.delete(token);
        clearTimeout(pending.timer);
        pending.reject(new Error('The workspace window closed during its transition.'));
      }
    for (const [token, pending] of lateWindowAcks)
      if (pending === record) lateWindowAcks.delete(token);
    records.delete(contentsId);
    palettes.release(
      record,
      [...records.values()].filter((other) => other.vault && !other.window.isDestroyed()),
    );
    if (entry) {
      group.lease.remove(record);
      group.windows.delete(record);
      {
        const descriptor = group.descriptors.get(windowId);
        if (descriptor && !quitting) descriptor.open = false;
      }
      const remaining = [...group.windows].filter((value) => !value.window.isDestroyed());
      if (remaining.length) {
        vaultWindows.set(entry.id, remaining.find((value) => value.main) || remaining[0]);
        const next =
          remaining.find((value) => value.window.isFocused() && value.ready) ||
          remaining.find((value) => value.ready);
        if (next) group.lease.request(next).catch((error) => report(next, error));
        persistWorkspaceWindows(group).catch(() => {});
      } else {
        vaultWindows.delete(entry.id);
        vaultGroups.delete(entry.id);
      }
    } else manager = null;
    notifyVaults();
    installMenu();
  });
  window.loadURL(pageURL + (entry ? '' : '#vault-manager')).catch((error) => {
    record.startupFailed = true;
    record.presentable = true;
    record.rejectReady?.(error);
    showWindow(record);
  });
  return record;
}
function workspaceKey(record) {
  return record.main ? 'workspace:1' : 'workspace-window:' + record.windowId;
}
function windowInfo(record) {
  return {
    windowId: record.windowId,
    main: record.main,
    ready: record.ready && record.presentable,
    active: record.group ? record.group.lease.canWrite(record) : true,
  };
}
function askWindow(record, channel, payload = {}) {
  if (record.window.isDestroyed() || !record.ready)
    return Promise.reject(new Error('This workspace window is unavailable.'));
  const token = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      windowAcks.delete(token);
      if (channel === 'ivo:prepare-window-release') {
        lateWindowAcks.set(token, record);
        while (lateWindowAcks.size > 64) lateWindowAcks.delete(lateWindowAcks.keys().next().value);
      }
      reject(new Error('The other window did not finish saving. Keep it open and try again.'));
    }, 15000);
    windowAcks.set(token, { record, channel, phase: payload.phase, resolve, reject, timer });
    record.window.webContents.send(channel, { ...payload, token });
  });
}
function waitWindowReady(record) {
  return Promise.race([
    record.readyPromise,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The new workspace window did not finish opening.')),
        20000,
      );
      record.readyPromise.finally(() => clearTimeout(timer)).catch(() => {});
    }),
  ]);
}
async function persistWorkspaceWindows(group, closing = null) {
  for (const record of group.windows)
    if (!record.window.isDestroyed())
      group.descriptors.set(record.windowId, {
        id: record.windowId,
        bounds: record.window.getBounds(),
        open: quitting || !(record === closing || record.closingIntent),
      });
  while (group.descriptors.size > 8) {
    const closed = [...group.descriptors].find(([, value]) => !value.open);
    if (!closed) break;
    group.descriptors.delete(closed[0]);
  }
  await group.vault.putMeta('workspace-windows:1', [...group.descriptors.values()]);
}
function openWorkspaceWindow(source, value) {
  const group = source.group,
    pending = group.openQueue.then(() => createWorkspaceWindow(source, value));
  group.openQueue = pending.catch(() => {});
  return pending;
}
async function createWorkspaceWindow(source, value) {
  if (quitting) throw new Error('The app is finishing closing.');
  if (
    !value ||
    typeof value !== 'object' ||
    !value.tab ||
    typeof value.tab !== 'object' ||
    JSON.stringify(value.tab).length > 250000
  )
    throw new Error('Choose a tab to open in another window.');
  const group = source.group;
  // Only an actual tear-off gesture can target another existing window. Menu commands
  // still create a window, and a different vault can never receive this tab.
  const dropPoint = value.position;
  if (
    value.move === true &&
    Number.isSafeInteger(dropPoint?.dragId) &&
    dropPoint.dragId > 0 &&
    [dropPoint.screenX, dropPoint.screenY].every(Number.isFinite)
  ) {
    const candidates = [...group.windows]
      .filter((record) => {
        if (
          record === source ||
          !record.ready ||
          record.closingIntent ||
          record.window.isDestroyed() ||
          !record.window.isVisible() ||
          record.window.isMinimized()
        )
          return false;
        const bounds = record.window.getContentBounds();
        return (
          dropPoint.screenX >= bounds.x &&
          dropPoint.screenX <= bounds.x + bounds.width &&
          dropPoint.screenY >= bounds.y &&
          dropPoint.screenY <= bounds.y + bounds.height
        );
      })
      .sort(
        (a, b) =>
          Number(b.window.isFocused()) - Number(a.window.isFocused()) ||
          (b.focusedAt || 0) - (a.focusedAt || 0),
      );
    const target = candidates[0];
    if (target) {
      const bounds = target.window.getContentBounds(),
        drop = { x: dropPoint.screenX - bounds.x, y: dropPoint.screenY - bounds.y };
      if (await askWindow(target, 'ivo:tab-transfer', { phase: 'probe', drop })) {
        try {
          if (!(await group.lease.request(target)))
            throw new Error('The destination window is unavailable.');
          await askWindow(target, 'ivo:tab-transfer', { phase: 'receive', drop, tab: value.tab });
          showWindow(target);
          return { ...windowInfo(target), transferred: true };
        } catch (error) {
          await group.lease.request(source).catch(() => {});
          throw error;
        }
      }
    }
  }
  if (group.windows.size >= 8) throw new Error('Use up to eight windows for one vault.');
  const documents = await group.vault.loadDocuments(),
    workspace = normalizeWorkspace(
      { version: 1, tabs: [value.tab], active: value.tab.id },
      documents,
    );
  if (value.tab.kind === 'document' && !documents.some((doc) => doc.id === value.tab.docId))
    throw new Error('This document is no longer available.');
  const windowId = 'window-' + crypto.randomUUID(),
    point = value.position || {},
    fallback = source.window.getBounds(),
    x =
      Number.isFinite(point.screenX) && Math.abs(point.screenX) < 1e6
        ? point.screenX - 150
        : fallback.x + 48,
    y =
      Number.isFinite(point.screenY) && Math.abs(point.screenY) < 1e6
        ? point.screenY - 20
        : fallback.y + 48,
    area = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea,
    bounds = workspaceWindowBounds(
      { x, y, width: Math.min(1200, fallback.width), height: Math.min(850, fallback.height) },
      area,
    );
  await group.vault.putMeta('workspace-window:' + windowId, workspace);
  if (group.windows.size >= 8) throw new Error('Use up to eight windows for one vault.');
  const record = createWindow(group.entry, group.vault, {
    group,
    windowId,
    bounds,
  });
  group.descriptors.set(windowId, { id: windowId, bounds, open: true });
  try {
    await persistWorkspaceWindows(group);
    await waitWindowReady(record);
    await group.lease.request(record);
    showWindow(record);
    return windowInfo(record);
  } catch (error) {
    record.mayClose = true;
    record.window.destroy();
    throw error;
  }
}
async function restoreWorkspaceWindows(group) {
  if (group.restored) return;
  group.restored = true;
  const descriptors = [...group.descriptors.values()];
  for (const descriptor of descriptors.filter((value) => value.open).slice(0, 8)) {
    if (group.windows.size >= 8) break;
    if ([...group.windows].some((record) => record.windowId === descriptor.id)) continue;
    const area = screen.getDisplayNearestPoint({
        x: descriptor.bounds?.x || 0,
        y: descriptor.bounds?.y || 0,
      }).workArea,
      record = createWindow(group.entry, group.vault, {
        group,
        main: descriptor.id === 'main',
        windowId: descriptor.id,
        bounds: workspaceWindowBounds(descriptor.bounds, area),
        silent: true,
      });
    try {
      await waitWindowReady(record);
    } catch {
      record.mayClose = true;
      record.window.destroy();
    }
  }
  await persistWorkspaceWindows(group);
}
async function documentFileInfo(record, id) {
  if (!record.vault || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(id))
    throw new Error('Choose an existing document.');
  await record.vault.flush();
  const manifest = JSON.parse(
      await readFile(path.join(record.vault.directory, 'atlas.json'), 'utf8'),
    ),
    entry = manifest.documents?.[id];
  if (
    !entry ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    entry.file !== `documents/${id}-${entry.sha256}.json`
  )
    throw new Error('This document is no longer available.');
  return { relativePath: entry.file, absolutePath: path.join(record.vault.directory, entry.file) };
}
function closeDragPreview(record) {
  const drag = record.drag;
  record.drag = null;
  if (drag?.window && !drag.window.isDestroyed()) drag.window.destroy();
}
function updateDragPreview(record, phase, value) {
  if (['end', 'cancel'].includes(phase)) {
    closeDragPreview(record);
    return;
  }
  if (!['start', 'move'].includes(phase) || !value || typeof value !== 'object') return;
  if (phase === 'start') {
    closeDragPreview(record);
    const drag = {
      title: String(value.title || value.label || 'Document')
        // eslint-disable-next-line no-control-regex -- Reject control characters at the data boundary.
        .replace(/[\x00-\x1f]/g, ' ')
        .slice(0, 180),
      outside: false,
      image: null,
      window: null,
    };
    record.drag = drag;
    record.window.webContents
      .capturePage()
      .then((image) => {
        if (record.drag !== drag) return;
        drag.image = image.resize({ width: 520 }).toDataURL();
        if (drag.outside) showDragPreview(record);
      })
      .catch(() => {});
  }
  const drag = record.drag;
  if (!drag) return;
  drag.outside = value.outside === true;
  const cursor = screen.getCursorScreenPoint();
  drag.x =
    Number.isFinite(value.screenX) && Math.abs(value.screenX) < 1e6 ? value.screenX : cursor.x;
  drag.y =
    Number.isFinite(value.screenY) && Math.abs(value.screenY) < 1e6 ? value.screenY : cursor.y;
  if (drag.outside) showDragPreview(record);
  else drag.window?.hide();
}
function showDragPreview(record) {
  const drag = record.drag;
  if (!drag || !drag.outside || !drag.image) return;
  if (!drag.window) {
    const preview = new BrowserWindow({
      width: 280,
      height: 205,
      frame: false,
      transparent: true,
      show: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    drag.window = preview;
    preview.setIgnoreMouseEvents(true);
    const escape = (value) =>
      value.replace(
        /[&<>"]/g,
        (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char],
      );
    const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>html,body{margin:0;background:transparent;font:12px -apple-system,BlinkMacSystemFont,sans-serif}.preview{margin:6px;border:1px solid #b5bac2;border-radius:9px;overflow:hidden;background:#f7f8fa;box-shadow:0 3px 6px #0004}.title{padding:10px 12px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}img{display:block;width:100%;height:151px;object-fit:cover;object-position:top}</style><div class="preview"><div class="title">${escape(drag.title)}</div><img src="${drag.image}"></div>`;
    preview
      .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      .then(() => {
        if (record.drag === drag && drag.outside) preview.showInactive();
      })
      .catch(() => {});
  }
  const area = screen.getDisplayNearestPoint({
    x: Math.round(drag.x),
    y: Math.round(drag.y),
  }).workArea;
  drag.window.setPosition(
    Math.round(Math.max(area.x, Math.min(area.x + area.width - 280, drag.x + 16))),
    Math.round(Math.max(area.y, Math.min(area.y + area.height - 205, drag.y + 16))),
  );
  if (!drag.window.webContents.isLoading()) drag.window.showInactive();
}

function sendCommand(name) {
  if (name === 'close-tab' && palettes?.focused()) {
    palettes.focused().window.close();
    return;
  }
  const record = activeRecord();
  if (!record) return;
  if (record.nativeDialogOpen) {
    const selector = { undo: 'undo:', redo: 'redo:', 'select-all': 'selectAll:' }[name];
    if (selector) Menu.sendActionToFirstResponder(selector);
    return;
  }
  if (!record.vault && name === 'close-tab') return record.window.close();
  record.window.webContents.send('ivo:command', name);
}
function textActionMenu(contextMenu, label, commands) {
  return {
    label,
    submenu: Object.entries(commands).map(([name, label]) => ({
      ...(contextMenu ? {} : { id: 'type-' + name, enabled: false }),
      label,
      click: () => sendTextCommand(name),
    })),
  };
}
function characterMenuItems(contextMenu) {
  return CHARACTER_MENUS.map(({ path, commands }) => {
    const items = Object.entries(commands).map(([name, item]) => ({
      label: item.label,
      ...(contextMenu
        ? {}
        : { id: 'type-' + name, enabled: false, accelerator: NATIVE_TEXT_ACCELERATORS[name] }),
      click: () => sendTextCommand(name),
    }));
    return path.reduceRight((submenu, label) => [{ label, submenu }], items)[0];
  });
}
function sendTextCommand(name) {
  const record = activeRecord(),
    state = nativeTextMenuState(record?.history);
  if (
    !record?.vault ||
    !record.group?.lease.canWrite(record) ||
    record.nativeDialogOpen ||
    !textCommandEnabled(name, state) ||
    !NATIVE_TEXT_COMMANDS.includes(name)
  )
    return;
  record.window.webContents.send('ivo:command', { name, textTarget: state.textTarget });
}
function applyHistory(record) {
  const menu = Menu.getApplicationMenu(),
    state = record.history || {};
  for (const [id, enabled, label] of [
    ['undo', !!state.canUndo, state.undoLabel],
    ['redo', !!state.canRedo, state.redoLabel],
  ]) {
    const item = menu?.getMenuItemById(id);
    if (item) {
      if (item.enabled !== enabled) item.enabled = enabled;
      const title = (id === 'undo' ? 'Undo' : 'Redo') + (label ? ' ' + label : '');
      if (item.label !== title) item.label = title;
    }
  }
  const canvas = editorMenuState(state);
  const panelAvailable =
    !!record.vault && !!record.group?.lease.canWrite(record) && !record.nativeDialogOpen;
  const panelCommands = [
    ...Object.keys(PANEL_LABELS).map((kind) => ['show-panel-' + kind, canvas.canvasEditing]),
    ['show-contextual', canvas.canShowContextual],
    ['wrap-preferences', canvas.canvasEditing],
    ['find-change', canvas.canvasEditing],
    ['document-dictionary', canvas.canvasEditing],
    ['load-text-styles', canvas.canvasEditing],
    ['page-link', canvas.canvasEditing],
    ['new-cross-reference', canvas.canvasEditing],
    ...Object.keys(endnoteCommands).map((id) => [id, canvas.canvasEditing]),
    ['mark-paragraph-destination', canvas.canvasEditing],
    ['define-cross-reference-formats', canvas.canvasEditing],
    ['update-cross-references', canvas.canvasEditing],
    ['insert-table', canvas.canvasEditing],
    ['generate-index', canvas.canvasEditing],
    ['update-index', canvas.canvasEditing],
    ['table-of-contents', canvas.canvasEditing],
    ['update-table-of-contents', canvas.canvasEditing],
    ['check-spelling', canvas.canvasEditing],
  ];
  for (const [id, enabled] of panelCommands) {
    const item = menu?.getMenuItemById(id);
    const available = panelAvailable && enabled;
    if (item && item.enabled !== available) item.enabled = available;
  }
  for (const name of Object.keys(ARRANGE_COMMANDS)) {
    const item = menu?.getMenuItemById(name);
    if (item)
      item.enabled =
        !!record.vault &&
        !!record.group?.lease.canWrite(record) &&
        !record.nativeDialogOpen &&
        canvas.canArrange;
  }
  const smartGuides = menu?.getMenuItemById('toggle-smart-guides');
  if (smartGuides) {
    smartGuides.checked = canvas.smartGuides;
    smartGuides.enabled = !!record.vault && !record.nativeDialogOpen && canvas.canvasView;
  }
  const text = nativeTextMenuState(state);
  for (const name of NATIVE_TEXT_COMMANDS) {
    const item = menu?.getMenuItemById('type-' + name);
    if (item)
      item.enabled =
        !!record.vault &&
        !!record.group?.lease.canWrite(record) &&
        !record.nativeDialogOpen &&
        textCommandEnabled(name, text);
  }
  for (const [id, value] of [
    ['go-back', state.canGoBack],
    ['go-forward', state.canGoForward],
  ]) {
    const item = menu?.getMenuItemById(id);
    if (item) item.enabled = !!record?.vault && !record.nativeDialogOpen && value === true;
  }
}
function installMenu() {
  const record = activeRecord(),
    nativeFields = record?.nativeDialogOpen || palettes?.focused()?.editing,
    hasVault = !!record?.vault;
  const compositionPreferences = {
    label: 'Preferences',
    submenu: [
      {
        id: 'wrap-preferences',
        label: 'Composition…',
        enabled: false,
        click: () => sendCommand('wrap-preferences'),
      },
    ],
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Ivo',
        submenu: [
          { role: 'about' },
          ...(process.platform === 'darwin' ? [compositionPreferences] : []),
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'New Document',
            enabled: hasVault,
            accelerator: 'CmdOrCtrl+N',
            click: () => sendCommand('new-document'),
          },
          {
            label: 'New Document to the Right',
            enabled: hasVault,
            accelerator: 'CmdOrCtrl+Shift+N',
            click: () => sendCommand('new-document-right'),
          },
          {
            label: 'New Tab',
            enabled: hasVault,
            accelerator: 'CmdOrCtrl+T',
            click: () => sendCommand('new-tab'),
          },
          { label: 'New Layout…', enabled: hasVault, click: () => sendCommand('new-layout') },
          {
            label: 'Open Document…',
            enabled: hasVault,
            accelerator: 'CmdOrCtrl+O',
            click: () => sendCommand('quick-switcher'),
          },
          {
            label: palettes?.focused() ? 'Close Panel' : 'Close Tab',
            accelerator: 'CmdOrCtrl+W',
            click: () => sendCommand('close-tab'),
          },
          {
            label: 'Reopen Closed Tab',
            enabled: hasVault,
            accelerator: 'CmdOrCtrl+Shift+T',
            click: () => sendCommand('reopen-tab'),
          },
          { type: 'separator' },
          { label: 'Manage Vaults…', click: showManager },
          { type: 'separator' },
          {
            label: 'Export PDF…',
            enabled: hasVault,
            accelerator: 'CmdOrCtrl+Shift+E',
            click: () => sendCommand('export-pdf'),
          },
          { label: 'Data Merge…', enabled: hasVault, click: () => sendCommand('data-merge') },
          {
            label: 'Publication Order…',
            enabled: hasVault,
            click: () => sendCommand('publication-order'),
          },
          {
            label: 'Export Reflowable EPUB…',
            enabled: hasVault,
            click: () => sendCommand('export-epub'),
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          ...(process.platform !== 'darwin' ? [compositionPreferences, { type: 'separator' }] : []),
          ...(nativeFields
            ? [
                { role: 'undo', accelerator: 'CmdOrCtrl+Z' },
                { role: 'redo', accelerator: 'CmdOrCtrl+Shift+Z' },
              ]
            : [
                {
                  id: 'undo',
                  label: 'Undo',
                  enabled: false,
                  accelerator: 'CmdOrCtrl+Z',
                  click: () => sendCommand('undo'),
                },
                {
                  id: 'redo',
                  label: 'Redo',
                  enabled: false,
                  accelerator: 'CmdOrCtrl+Shift+Z',
                  click: () => sendCommand('redo'),
                },
              ]),
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { type: 'separator' },
          {
            id: 'find-change',
            label: 'Find/Change…',
            enabled: false,
            accelerator: 'CmdOrCtrl+F',
            click: () => sendCommand('find-change'),
          },
          {
            label: 'Spelling',
            submenu: [
              {
                id: 'check-spelling',
                label: 'Check Spelling…',
                enabled: false,
                click: () => sendCommand('check-spelling'),
              },
              {
                id: 'document-dictionary',
                label: 'Document Dictionary…',
                enabled: false,
                click: () => sendCommand('document-dictionary'),
              },
            ],
          },
        ],
      },
      {
        label: 'Layout',
        submenu: [
          {
            id: 'generate-index',
            label: 'Generate Index…',
            enabled: false,
            click: () => sendCommand('generate-index'),
          },
          {
            id: 'update-index',
            label: 'Update Index',
            enabled: false,
            click: () => sendCommand('update-index'),
          },
          {
            id: 'table-of-contents',
            label: 'Table of Contents…',
            enabled: false,
            click: () => sendCommand('table-of-contents'),
          },
          {
            id: 'update-table-of-contents',
            label: 'Update Table of Contents',
            enabled: false,
            click: () => sendCommand('update-table-of-contents'),
          },
        ],
      },
      {
        label: 'Object',
        submenu: [
          {
            label: 'Arrange',
            submenu: Object.entries(ARRANGE_COMMANDS).map(([name, value]) => ({
              id: name,
              ...value,
              enabled: false,
              click: () => sendCommand(name),
            })),
          },
        ],
      },
      {
        label: 'Insert',
        submenu: [
          { label: 'Document Link…', enabled: hasVault, click: () => sendCommand('link') },
          {
            id: 'insert-table',
            label: 'Table…',
            enabled: false,
            click: () => sendCommand('insert-table'),
          },
          {
            id: 'new-cross-reference',
            label: 'New Cross-Reference…',
            enabled: false,
            click: () => sendCommand('new-cross-reference'),
          },
          {
            id: 'mark-paragraph-destination',
            label: 'Mark Paragraph Destination…',
            enabled: false,
            click: () => sendCommand('mark-paragraph-destination'),
          },
          {
            id: 'define-cross-reference-formats',
            label: 'Define Cross-Reference Formats…',
            enabled: false,
            click: () => sendCommand('define-cross-reference-formats'),
          },
          {
            id: 'update-cross-references',
            label: 'Update Cross-References',
            enabled: false,
            click: () => sendCommand('update-cross-references'),
          },
          {
            id: 'page-link',
            label: 'Page Link…',
            enabled: false,
            click: () => sendCommand('page-link'),
          },
        ],
      },
      {
        label: 'Type',
        submenu: [
          ...Object.entries(endnoteCommands).map(([id, label]) => ({
            id,
            label,
            enabled: false,
            click: () => sendCommand(id),
          })),
          { type: 'separator' },
          ...NATIVE_TEXT_COMMANDS.filter(
            (name) =>
              !Object.hasOwn(INSERT_CHARACTERS, name) &&
              !Object.hasOwn(LIST_COMMANDS, name) &&
              !Object.hasOwn(CASE_COMMANDS, name),
          ).map((name) => ({
            id: 'type-' + name,
            label:
              name === 'tabs'
                ? 'Tabs…'
                : name === 'keep-options'
                  ? 'Keep Options…'
                  : name[0].toUpperCase() + name.slice(1),
            enabled: false,
            accelerator: NATIVE_TEXT_ACCELERATORS[name],
            click: () => sendTextCommand(name),
          })),
          { type: 'separator' },
          {
            id: 'load-text-styles',
            label: 'Load Text Styles…',
            enabled: false,
            click: () => sendCommand('load-text-styles'),
          },
          textActionMenu(false, 'Bulleted & Numbered Lists', LIST_COMMANDS),
          textActionMenu(false, 'Change Case', CASE_COMMANDS),
          ...characterMenuItems(false),
        ],
      },
      {
        label: 'Select',
        submenu: [
          ...(nativeFields
            ? [{ role: 'selectAll', accelerator: 'CmdOrCtrl+A' }]
            : [
                {
                  label: 'All',
                  accelerator: 'CmdOrCtrl+A',
                  click: () => sendCommand('select-all'),
                },
              ]),
          {
            label: 'Deselect',
            accelerator: 'CmdOrCtrl+Shift+A',
            click: () => sendCommand('deselect'),
          },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            id: 'toggle-smart-guides',
            label: 'Smart Guides',
            type: 'checkbox',
            checked: false,
            enabled: false,
            accelerator: 'CmdOrCtrl+U',
            click: () => sendCommand('toggle-smart-guides'),
          },
          { type: 'separator' },
          { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => sendCommand('zoom-in') },
          { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => sendCommand('zoom-out') },
          {
            label: 'Actual Size',
            accelerator: 'CmdOrCtrl+1',
            click: () => sendCommand('zoom-100'),
          },
          {
            label: 'Fit All Pages',
            accelerator: 'CmdOrCtrl+0',
            click: () => sendCommand('fit-all'),
          },
          { type: 'separator' },
          {
            label: 'Reading / Editing',
            accelerator: 'CmdOrCtrl+E',
            click: () => sendCommand('toggle-edit'),
          },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          ...Object.entries(PANEL_LABELS).map(([kind, label]) => ({
            id: 'show-panel-' + kind,
            label,
            enabled: false,
            ...(kind === 'text-wrap' && { accelerator: 'CmdOrCtrl+Alt+W' }),
            click: () => sendCommand('show-panel-' + kind),
          })),
          {
            label: 'Contextual Text Bar',
            id: 'show-contextual',
            enabled: false,
            click: () => sendCommand('show-contextual'),
          },
          { type: 'separator' },
          ...(WORKSPACE_FEATURES.savedLayouts
            ? [
                { label: 'Workspaces…', enabled: hasVault, click: () => sendCommand('workspaces') },
                {
                  label: 'Restore Previous Workspace',
                  enabled: hasVault,
                  click: () => sendCommand('restore-workspace'),
                },
                { type: 'separator' },
              ]
            : []),
          { label: 'Split Right', enabled: hasVault, click: () => sendCommand('split-right') },
          { label: 'Split Down', enabled: hasVault, click: () => sendCommand('split-down') },
          { label: 'Merge This Pane', enabled: hasVault, click: () => sendCommand('merge-pane') },
          { label: 'Next Pane', enabled: hasVault, click: () => sendCommand('next-pane') },
          { label: 'Previous Pane', enabled: hasVault, click: () => sendCommand('previous-pane') },
          ...[
            ['Left', 'Left'],
            ['Right', 'Right'],
            ['Up', 'Up'],
            ['Down', 'Down'],
          ].map(([label, key]) => ({
            label: 'Focus Pane ' + label,
            enabled: hasVault,
            accelerator: 'CmdOrCtrl+Alt+' + key,
            click: () => sendCommand('focus-pane-' + label.toLowerCase()),
          })),
          { type: 'separator' },
          {
            id: 'go-back',
            label: 'Back',
            enabled: hasVault,
            accelerator: 'CmdOrCtrl+Alt+[',
            click: () => sendCommand('go-back'),
          },
          {
            id: 'go-forward',
            label: 'Forward',
            enabled: hasVault,
            accelerator: 'CmdOrCtrl+Alt+]',
            click: () => sendCommand('go-forward'),
          },
          { type: 'separator' },
          {
            label: 'Next Tab',
            enabled: hasVault,
            accelerator: 'Ctrl+Tab',
            click: () => sendCommand('next-tab'),
          },
          {
            label: 'Previous Tab',
            enabled: hasVault,
            accelerator: 'Ctrl+Shift+Tab',
            click: () => sendCommand('previous-tab'),
          },
          { type: 'separator' },
          { role: 'minimize' },
          { role: 'front' },
        ],
      },
    ]),
  );
  if (record && !nativeFields) applyHistory(record);
}
app.on('window-all-closed', () => {
  app.quit();
});
