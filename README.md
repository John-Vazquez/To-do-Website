# To-Do

## Current interaction update

The overview is centered within 1180px. Doing Right Now is full width above Must Do Today; ordinary lists use three columns when space permits, two on tablet and one on mobile. Each task exposes pencil/edit and confirmed-delete actions on hover or keyboard focus, always visible on touch devices. Task completion checkboxes and the full-list/bulk-add dialog have been removed. Ordinary list titles open only the rename dialog; pinned names remain protected. Card plus buttons add tasks, and +N more expands that card inline. Existing task data and completion flags are preserved.


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

- Pinned lists stack vertically at full content width. Three ordinary columns at 1100px+, two on tablet, one on mobile, within a centered 1180px canvas.
- Compact mode shows five tasks per ordinary list and an exact `+N more` link. Expanded mode shows all active tasks on the same page. Empty lists take one heading row.
- Quick Add remembers the destination. Every card has a plus button to add a task.
- Task pencil controls open individual details for deadline/urgency edits and moves. List title buttons open rename only.
- Task rows offer edit and confirmed permanent deletion. Existing completion metadata remains intact; the completion checkbox workflow is no longer exposed.
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
