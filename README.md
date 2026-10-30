# To-Do

Static task application with a compact all-lists overview, full list editor, global search and task management. Development branch: `codex/todo-functional-redesign`.

## Preview safely

```powershell
cd C:\Users\speed_ayzysvt\Documents\GitHub\To-do-Website
npm ci
npm run dev
```

Open <http://127.0.0.1:4173/todo.html?demo>. All task and list mutations operate on invented, in-memory data. Reload resets sample records; preferences retain Compact/Expanded, last destination, list order and archived IDs. No task content is saved to browser storage. No Supabase or external script requests occur in demo mode.

<http://127.0.0.1:4173/todo.html?source=live> loads actual lists **read-only**. Hosted mode uses public read/write access, as explicitly requested by the owner. Authentication is deferred. Local live previews remain read-only. Apply the metadata/capacity migration before publishing these assets.

## Implemented

- Side-by-side pinned lists on desktop; stacked on mobile. Three ordinary columns at 1440px+, two at tablet/smaller desktop widths, one on mobile.
- Compact mode shows five tasks per ordinary list and an exact `+N more` link. Expanded mode shows all active tasks on the same page. Empty lists take one heading row.
- Quick Add remembers the destination. Pinned cards also support inline entry and direct completion.
- Full list editor: all active tasks, individual task details, independently editable deadline/urgency, task moves, sorting, completed visibility, rename and bulk add.
- Completion updates `is_done`; it does not delete. Reopen and recent-completion Undo preserve task identity and metadata. Permanent deletion is separate and confirmed.
- Global search includes list names and task text; completed tasks require an explicit checkbox. Upcoming groups dated tasks across unarchived lists.
- List creation uses the existing ID/title model. Order, archive and restore synchronize through Supabase in hosted mode. Demo preferences remain browser-only. Existing browser list preferences require an explicit import. Archiving hides the card without changing/deleting tasks. Pinned lists cannot be archived.
- Shared `todo-data.js` repository/TaskStore retain verified writes, pagination, pending locks, failure handling and ambiguous-insert reconciliation. Moves/reopens also recheck Must Do Today's active capacity. Browser locks do not guarantee cross-device capacity; SQL enforces active-task capacity with parent-row serialization.
- PWA metadata/icons preserved. No service worker or private task cache.

## Validation

```powershell
npm ci
npx playwright install chromium webkit
npm test
```

The suite includes prior data regressions, new functional tests, isolated PostgreSQL SQL/RLS checks using PGlite, and Playwright desktop/tablet/iPhone tests. PGlite is a development dependency only; it is not loaded by the app.

See [functional redesign report](docs/functional-redesign.md) for results, screenshots, schema-dependent work and release prerequisites. [Phase 1 audit](docs/phase-1.md) is historical evidence; its original UI and deletion-based completion have been superseded.
