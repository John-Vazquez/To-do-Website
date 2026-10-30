# To do — Phase 1

A static, all-lists personal task app. Open `todo.html` through an HTTP server; no application build is required. `personal.html` and the rest of the personal website keep their existing routes.

## Local preview

Requires Node.js 20 or newer:

```powershell
cd C:\Users\speed_ayzysvt\Documents\GitHub\To-do-Website
npm ci
npm run dev
```

Open <http://127.0.0.1:4173/todo.html>. Localhost defaults to **an in-memory demo with invented tasks**. Changes reset on page reload. No Supabase requests, task storage, or external script downloads happen in demo mode. `?demo` explicitly selects this mode on any host.

For a **read-only** view of your actual lists, open <http://127.0.0.1:4173/todo.html?source=live>. This loads the existing public Supabase client configuration; the repository adapter rejects create, update, delete, and rename calls in this mode. Production write tests have deliberately not been run. Do not expose the development server to your network or use another hostname to bypass its local safety mode.

## What changed

- Doing Right Now and Must Do Today are permanent full-width cards; Must Do Today retains its three-task limit. All additional lists stay on the same page in two desktop columns or one mobile column.
- All 14 original IDs remain in `todo-config.js`. The eight previously visible custom lists retain their order. Four academic lists that the original JavaScript loaded without matching HTML cards now appear after them. Additional database lists append in stable ID order because no persisted list-order column has been verified.
- Task CRUD and list renaming share a Supabase repository and DOM-independent `TaskStore` in `todo-data.js`. Paginated reads avoid an accidental 1,000-row limit. Default ordering remains urgency descending, then parsed due date ascending; a date-first option is available per list.
- Accessible add forms and modal editing replace `prompt()`. Failed writes keep drafts and original rows/titles. A successful write must return its matching row; a denied or zero-row mutation cannot silently look saved. Pending operations disable controls and repeated submissions are rejected before awaiting network operations.
- The three-task limit is checked against fresh server rows under a same-origin Web Lock where supported. Pending submissions are reserved immediately. **This cannot guarantee the limit across separate devices, origins, unsupported browsers, or direct API clients.** A transactional database operation is required for that guarantee; none was added without approval.
- Ambiguous insert failures require a successful list reload and a check for the previous task before retrying. No automatic INSERT retries. This reduces duplicates when the server saved a task but its response was lost.
- Editing only sends changed fields. Existing free-form due dates, `is_done`, timestamps, and other returned fields are not rewritten during a content-only edit. Native date controls are used for new dates. Existing tasks are never transformed on load.
- Completing a task retains the original app's deletion behavior. Both completion and deletion explicitly confirm permanent removal. Completion history and undo do not exist in Phase 1.
- Unsaved modal edits require explicit discard; background refresh preserves add-form drafts. Page navigation requests the browser's unsaved-changes warning. Mobile operating systems can terminate tabs without this event; private drafts are intentionally not persisted in browser storage.
- Static manifest, SVG favicon, 192/512 PNG icons and 180px Apple icon support Add to Home Screen. No service worker or offline task cache is installed. The live app requires internet. Home Screen installation on an actual iPhone remains a manual check after an approved HTTPS release.

## Tests

```powershell
npm ci
npx playwright install chromium webkit
npm test
```

Tests use fixtures only and block external browser requests. See [Phase 1 audit and validation](docs/phase-1.md) for results, security findings, known limits, heartbeat correction, and future API design. `node scripts/audit-supabase.mjs` is an optional **read-only live** audit: it prints list IDs/titles, counts, and redacted task column types. Do not commit its output or real personal task content.

## Release status

The completed changes are on local `main` in the owner's chosen checkout, outside OneDrive. `main` tracks `origin/main` at `John-Vazquez/To-do-Website`; pushing it updates that GitHub branch and may publish the website. Do not push, change GitHub Pages settings, deploy, or apply database/RLS changes until the owner explicitly approves. The existing heartbeat file has not been activated or moved.
