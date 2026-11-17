import { folderContains } from '../../domain/documents/library-commands.js';
import { escapeHTML as esc } from '../../shared/html/sanitize.js';
import { showNavigationMenu } from './menu.js';
export async function showFolderActions({
  path,
  event,
  paths,
  vaultName,
  showDialog,
  onCreateDocument,
  onCreateFolder,
  onChange,
}) {
  const choice = await showNavigationMenu(
    [
      { id: 'document', label: 'New document' },
      { id: 'folder', label: 'New folder' },
      { type: 'separator' },
      { id: 'rename', label: 'Rename folder…' },
      { id: 'move', label: 'Move folder to…' },
    ],
    { x: event.clientX, y: event.clientY, anchor: event.target.closest('summary') },
  );
  if (choice === 'document') return onCreateDocument(path);
  if (choice === 'folder') return onCreateFolder(path);
  if (choice === 'rename') {
    showDialog(
      `<h2>Rename folder</h2><label class="dialog-field">Name<input name="name" value="${esc(path.split('/').at(-1))}" maxlength="256" autofocus></label><button type="submit" class="button-primary">Rename</button>`,
      async (data) => onChange({ type: 'rename-folder', path, name: data.get('name') }),
    );
  } else if (choice === 'move') {
    const parent = path.split('/').slice(0, -1).join('/');
    showDialog(
      `<h2>Move folder</h2><label class="dialog-field">Destination<select name="destination"><option value="">${esc(vaultName)}</option>${paths
        .filter((folder) => !folderContains(path, folder))
        .map(
          (folder) =>
            `<option value="${esc(folder)}" ${folder === parent ? 'selected' : ''}>${esc(folder)}</option>`,
        )
        .join(
          '',
        )}</select></label><button type="submit" class="button-primary">Move folder</button>`,
      async (data) => onChange({ type: 'move-folder', path, destination: data.get('destination') }),
    );
  }
}
