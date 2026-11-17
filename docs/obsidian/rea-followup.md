# REA follow-up — 4 November 2026

The scoped process-inspection restriction is resolved. The previous worker PID was absent and its reported temporary directory empty when inspected with command-specific approval. No stale PID was killed. REA's ownership checks were retained; global settings were not changed by this work.

Two REA 6.7.0 CLI analyses of the unchanged Obsidian 1.15.0 `obsidian.asar` completed with exit code zero and successful cleanup. The artifact SHA-256 remains `0e6383301078a798f0f3bdb42bdb606d904ada77eab8c8fc89da533573979248`. Complete evidence is private in the parent workspace's `work/rea-evidence/`, outside this repository. The public [summary](rea-evidence-summary.json) preserves source selection, counts, evidence identities, and limits; its earlier failed observations remain historical records.

| Run | Evidence ID | Result |
|---|---|---|
| `package.json`, `sim.js` | `ev_4ce3e3241f6a2632e16e8e2877acc09660179e5242fafcd71a70bd221389a9a9` | One JS file parsed; 6,190 AST nodes visited; 4,710 semantic nodes and 4,669 relations retained. 36 inventoried files excluded. |
| `package.json`, `main.js`, `worker.js`, `app.js` | `ev_6a3f18deceb876b5ce3f0320a1e75af5577e9bc75cf79981c87088439ccb8e90` | Three JS files parsed; 1,057,330 AST nodes visited; 185 findings; 24,000 semantic nodes and 10,231 relations retained. 34 inventoried files excluded. |
| Summary projection of core run | `ev_efea29cbcf969eeb6c2c6b2e60ae2503d734e1dda46855898ceafa074e36145c` | REA `inspect-analysis-view` over complete inline evidence; no repeated parsing. |

The simulation evidence identity matches the earlier partial run because its static result is the same. Successful exit and completed cleanup distinguish this execution from the previous error envelope.

## Questions and evidence

| Question | Status | Observation and limit |
|---|---|---|
| Can actual REA analysis finish on this computer? | Answered | Both commands completed after approval, using the project-local `REA_DARWIN_MODULE_CACHE_PATH`. No helper or cleanup validation was disabled. |
| Are metadata and graph computation separate workers? | Answered for packaged syntax | Core evidence includes distinct worker constructions in `app.js`: metadata at line 401, columns 2837–2891 (`jag_node_4f6c75f46a96dfa339f5c258e465b377d6c0ed8e4b3bd3fb608013f4375ff22a`), graph at line 466, columns 90666–90709 (`jag_node_853019d8b6f7ca4d00e20afcd1dcb8c4ff152c002128c168919d4cec35b07aa9`). REA leaves their automatic path resolution null; the literal constructions corroborate manual ledger A01/A16. This does not observe workers executing. |
| What belongs in the desktop shell? | Partially answered | REA observes two BrowserWindow constructions and 48 literal main-side IPC registrations. `vault-open`, `get-documents-path`, and `get-default-vault-path` occur at `main.js` line 70, columns 6022–6226, 7777–7832, and 7894–7954 respectively. This supports separating native window/filesystem responsibilities from page rendering. It does not prove runtime reachability or complete authorization. |
| How do link indexing, graph selection, and authored layouts differ? | Partially answered | The existing manual ledger A02–A21 and controlled fixture observations remain the detailed evidence. REA parsed the corresponding source files, but bounded semantic extraction is not a full reconstruction of every routine. |
| Is the full application, sync, and mobile behavior understood? | Unresolved | No full application call graph, sync investigation, device run, or performance benchmark is claimed. |

The core run had a 2,048 MiB worker heap and a 180-second per-source deadline. Retention ceilings were 8,000 semantic nodes/unknown records per source and 24,000 each per application. Node capacity was reached; 21,405 semantic unknowns remain, with additional omitted occurrence counts in the summary. Dynamic or ambiguous relationships remain unknown. `complete-within-view` on a summary projection describes that view, not complete application coverage. Zero detected bridge APIs or preload entrypoints must not be read as proof of absence.

## Ivo decisions

The existing separation of authored page geometry, derived relationships, graph selection, and graph physics remains appropriate. Keep stable document IDs. Persist authoritative documents and original assets as files; keep graph positions and derived indexes out of the document contract. Put native filesystem access behind a narrow storage bridge. These are original Ivo implementation choices informed by the reference, not copied Obsidian code.

The follow-up adds no new Obsidian runtime observation. The isolated fixture tests already recorded in [runtime verification](runtime-verification.md) remain the runtime boundary.
