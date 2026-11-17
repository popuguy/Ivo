import { escapeHTML as esc } from '../../shared/html/sanitize.js';
import { icon } from '../../shared/ui/icons.js';
import { showNavigationMenu } from './menu.js';
/** One manager shared by native/menu entry points; all mutations go through application commands. */
export function showWorkspaceManager({ dialog, showDialog, manager, run, onError }) {
  let form;
  const current = () => dialog.open && dialog.querySelector('form') === form;
  const refresh = () => {
    if (current()) showWorkspaceManager({ dialog, showDialog, manager, run, onError });
  };
  const layouts = manager.list();
  showDialog(
    `<h2>Workspaces</h2><div class="workspace-layout-list">${layouts.map((item) => `<div class="saved-workspace-row"><button type="button" data-load-workspace="${esc(item.id)}"><strong>${esc(item.name)}</strong><small>${item.workspace.groups.length} panes · ${item.workspace.tabs.length} tabs</small></button><button type="button" class="icon-button" data-workspace-menu="${esc(item.id)}" aria-label="Options for ${esc(item.name)}" title="Workspace options">${icon('dots')}</button></div>`).join('') || '<p class="small-empty">No saved workspaces.</p>'}</div><label class="dialog-field">Save current workspace<input name="name" maxlength="80" placeholder="Workspace name" autocomplete="off"></label><button type="submit" class="button-primary">Save workspace</button>${manager.canRestorePrevious ? '<button type="button" class="button-outline" data-previous-workspace>Restore previous workspace</button>' : ''}`,
    async (data) => {
      if (await manager.save(data.get('name'), null, { isCurrent: current })) refresh();
    },
  );
  form = dialog.querySelector('form');
  dialog.querySelector('[data-previous-workspace]')?.addEventListener('click', () =>
    run(async () => {
      if (await manager.restorePrevious({ isCurrent: current })) dialog.close();
    }).catch(onError),
  );
  for (const button of dialog.querySelectorAll('[data-load-workspace]'))
    button.addEventListener('click', () =>
      run(async () => {
        if (await manager.load(button.dataset.loadWorkspace, { isCurrent: current }))
          dialog.close();
      }).catch(onError),
    );
  for (const button of dialog.querySelectorAll('[data-workspace-menu]'))
    button.addEventListener('click', async () => {
      try {
        const id = button.dataset.workspaceMenu,
          choice = await showNavigationMenu(
            [
              { id: 'load', label: 'Load workspace' },
              { id: 'replace', label: 'Update from current workspace' },
              { id: 'rename', label: 'Rename…' },
              { type: 'separator' },
              { id: 'remove', label: 'Delete saved workspace' },
            ],
            { anchor: button },
          );
        if (!choice || !current()) return;
        if (choice === 'rename') {
          const item = manager.list().find((layout) => layout.id === id);
          if (!item) return;
          let renameForm;
          showDialog(
            `<h2>Rename workspace</h2><label class="dialog-field">Name<input name="name" maxlength="80" value="${esc(item.name)}" autofocus></label><button type="submit" class="button-primary">Rename</button>`,
            async (data) => {
              if (!dialog.open || dialog.querySelector('form') !== renameForm) return;
              manager.rename(id, data.get('name'));
              showWorkspaceManager({ dialog, showDialog, manager, run, onError });
            },
          );
          renameForm = dialog.querySelector('form');
          return;
        }
        await run(async () => {
          if (choice === 'load') {
            if (await manager.load(id, { isCurrent: current })) dialog.close();
          } else if (choice === 'replace') {
            if (await manager.replace(id, { isCurrent: current })) refresh();
          } else if (choice === 'remove') {
            manager.remove(id);
            refresh();
          }
        });
      } catch (error) {
        onError(error);
      }
    });
}
