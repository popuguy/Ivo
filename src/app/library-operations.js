/** Persist first, then publish canonical library updates to the live window. */
export function createLibraryOperations({
  flush,
  commit,
  getDocuments,
  receive,
  getLibrary,
  setLibrary,
  record,
  onChanged,
}) {
  return Object.freeze({
    async run(command) {
      if (!(await flush())) return false;
      const before = new Map(
        getDocuments().map((document) => [document.id, structuredClone(document)]),
      );
      const result = await commit(command);
      if (!result.changed) return true;
      const updates = new Map(result.documents.map((document) => [document.id, document]));
      receive(getDocuments().map((document) => updates.get(document.id) || document));
      setLibrary(result.library, getLibrary(), result.mapping);
      for (const document of result.documents) {
        const old = before.get(document.id);
        if (old) record(old, document);
      }
      onChanged(result);
      return true;
    },
  });
}
