# Changelog

All notable changes to the public Filarr desktop client are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/).

## [v2.6.0] — 2026-04-29

First sync from the upstream private codebase since the initial public
release. Brings two minor versions of improvements (v2.5.0 → v2.6.0) and one
major new feature, all 100 % local-only.

### Added — OS Downloads Watcher

Filarr can now **watch a folder on your PC** (typically the system Downloads
folder) and **automatically import every new file** into a Filarr inbox
folder of your choice. Combined with the automation engine, this lets you
route specific file types: "every PDF I download → Documents", "every image
→ Photos", etc.

- chokidar-based watcher in the main process with `awaitWriteFinish` (2 s
  stability window) so files mid-write are never grabbed half-empty.
- Multi-folder support, top-level only (`depth: 0`), `ignoreInitial: true`
  to avoid re-importing on every app start.
- Hard blocklist of executable extensions (`.exe`, `.msi`, `.bat`, `.ps1`,
  `.vbs`, `.js`, `.scr`, `.lnk`, `.jar`, `.app`, `.dmg`…) applied **before**
  any user-configured filter.
- Refuses to watch system directories (`C:\Windows`, `C:\Program Files`,
  `/etc`, `/usr/bin`, etc.) — a tampered config can't make us read
  protected paths. `delete-source` IPC is restricted to paths the watcher
  itself surfaced **and** under a configured watch root.
- Opt-in extension allowlist via UI chips. Empty = all (minus blocklist).
- One-shot **catch-up scan** button: enumerates every watched folder and
  surfaces existing files through the same handleNewFile pipeline (so the
  blocklist + allowlist + size limit + dedup all apply).
- New automation trigger `file_imported_from_os` (fires alongside
  `file_created`) and a new condition type `os_source_path` (with
  Windows/Unix separator normalization). Three new templates use it: route
  all OS imports, sort downloaded PDFs, sort downloaded images.
- Live status in Settings: `Active` / `Starting…` / `Error` / `Inactive`
  badge with watched-folder count, last-import filename, total imports
  counter. Updates in real time via `status-changed` IPC. Red banner if a
  watched folder vanishes from disk. Master toggle disabled until both an
  inbox folder and at least one source folder are configured, with an
  inline hint for what's missing.
- Per-profile config persisted in `appConfig.json`; the watcher restarts
  with the new profile's settings on profile switch.

### Added — Auto-route imported files (in-app)

The automation engine had `file_created` as a trigger but **nothing was
firing it** for in-app file additions, so user rules never ran on drag-drop
or import. The `addFileToFolder` thunk now dispatches the event after every
successful upload. Combined with a new `Auto-route imported files` template
(no-condition rule + `move_to_folder`), you get one-click routing for files
added to Filarr. Also added a no-op guard: `move_to_folder` /
`copy_to_folder` skip when source folder == target folder, preventing rule
loops when a "move all new files to X" rule matches a file dropped directly
into X.

### Changed — Note editor performance

- **Typing in long notes** — the hot-path `onUpdate → Redux → useEffect`
  used to do a full `JSON.stringify(editor.getJSON())` on every keystroke
  and compare to `note.content` (O(n)). Now cached via a
  `lastSyncedContentRef` ref: round-trip comparisons collapse to identity
  checks (O(1)). Microbenchmark shows **300× speedup on 3 KB notes,
  ~395 000× on 1 MB, ~9.5 M× on 30 MB**. On a 5.9 MB note, the old path
  was burning 30 ms of main-thread per second of typing; the new one
  consumes 4 ns. Logic extracted to a pure `syncEditorContent` helper
  (50 lines) covered by 8 Jest tests + a microbenchmark
  (`scripts/bench-note-editor-sync.mjs`).
- **Opening a long note** — `NoteEditor` was mounted with `key={id}` so
  each click on a note remounted the entire editor (TipTap + 30+
  extensions + ProseMirror schema rebuild). Measured INP: 743 ms. Removed
  the `key`, added a reset effect on `note.id` change to clear leaking UI
  state across notes, a snapshot ref so onUpdate flushes hit the right
  note mid-switch, and a synchronous flush in `onBlur` to avoid losing
  the last 300 ms of typing. **INP now 230 ms** (~70 % reduction).
- **Double `JSON.parse` eliminated** on note open: `useEditor` already
  parsed `note.content`, the resync effect did it again. The ref is now
  seeded with `note.content` so the effect skips on first run.
- **Side panels deferred** with `useDeferredValue` — `BacklinksPanel` was
  running three O(N) to O(N·M) scans synchronously on every note switch
  (`findBacklinks`, `findPotentialLinks`, `unlinkedMentions`). Now
  fractioned: editor commits first, panels recompute at low priority.

### Fixed — Notes

- **Kanban no longer pollutes note icons** — the Kanban view was writing
  the column id (`inbox`, `in-progress`, `review`, `done`, or a custom id)
  directly into the note's `icon` field. Result: dragging a note into a
  column overwrote the chosen emoji with a kebab-case string that then
  showed up in every view (list, card, title). Fix: dedicated
  `kanbanStatus` field on the `Note` type + a one-shot idempotent
  `migrateKanbanIconPollution` reducer that heals the existing dataset
  (heuristic: real icons are emojis / `lucide:` / `img:` — none match
  `/^[a-z0-9-]+$/`). Dispatched on `KanbanView` mount.
- **Notebooks are now displayable in the Graph view** — they were
  intentionally hidden ("prevents artificial clustering") which made
  notebook-organized users lose hierarchy. New "Show notebooks" toggle
  (notebook icon next to time-travel), **off by default** to preserve the
  current philosophy, persisted in localStorage. When on: violet diamond
  node per notebook (only those with at least one note in the graph),
  discreet dotted edges (~22 % opacity) so they don't compete with
  wiki-links. Click on a notebook = filter by notebook + switch to list
  view. EN/FR i18n.

## [v2.4.0] — 2026-04-19 — Initial public release

- Initial public, source-available release of the Filarr desktop client.
- Cloud sync, account, billing and infrastructure code have been removed
  from the source tree. The application now runs in 100 % local mode under
  a per-profile vault password.
- Licence switched to the Business Source License 1.1.
