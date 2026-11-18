import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
/** Narrow read-only bridge: installed PostScript identities, never renderer-supplied paths. */
export function createSystemFonts(executable, { run = exec } = {}) {
  let catalog;
  async function invoke(args) {
    try {
      const { stdout } = await run(executable, args, {
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 44 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(
        error.stderr?.trim() || 'System fonts could not be read. Rebuild Ivo’s native font helper.',
        { cause: error },
      );
    }
  }
  async function list(refresh = false) {
    if (refresh || !catalog)
      catalog = invoke(['list'])
        .then((rows) => {
          if (!Array.isArray(rows) || rows.length > 30000)
            throw new Error('Invalid system font catalog.');
          const seen = new Set();
          return rows.filter((row) => {
            if (
              !row ||
              !['postscript', 'family', 'style', 'fullName'].every(
                (key) =>
                  typeof row[key] === 'string' &&
                  row[key].length <= 512 &&
                  ![...row[key]].some((c) => c.charCodeAt(0) < 32),
              )
            )
              return false;
            if (!row.postscript || seen.has(row.postscript)) return false;
            seen.add(row.postscript);
            return true;
          });
        })
        .catch((error) => {
          catalog = null;
          throw error;
        });
    return listCopy(await catalog);
  }
  return {
    list,
    async read(postscript) {
      if (
        typeof postscript !== 'string' ||
        !(await list()).some((row) => row.postscript === postscript)
      )
        throw new Error('Choose a font from the installed font list.');
      const value = await invoke(['read', postscript]);
      if (
        typeof value?.data !== 'string' ||
        value.data.length > 42 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data) ||
        typeof value.name !== 'string'
      )
        throw new Error('Invalid system font data.');
      return value;
    },
  };
}
const listCopy = (rows) => rows.map((row) => ({ ...row }));
