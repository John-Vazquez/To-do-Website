# Functional redesign

October 30, 2026. Work builds on `5dd0e78` in the selected local checkout, on `codex/todo-functional-redesign`. The owner subsequently authorized pushing/deploying finished work and applying applicable backend changes. Authorization is available; backend **access and verification** remain separate prerequisites.

## Working features

The overview has a compact toolbar, search, Quick Add, Add List, Upcoming and an actions menu. Pinned lists appear side by side on desktop and stack on mobile. Ordinary cards use three/two/one responsive columns. Compact mode shows up to five active tasks and an exact remaining count. Expanded mode removes that limit. Empty cards contain their title/count/add control only.

Every task can open its details. Full list editors show all active tasks with add, bulk add, rename, urgency/deadline sorting and optional completed rows. Mobile editors fill the screen. Individual dialogs have Save, Cancel, Close, explicit unsaved-discard and permanent-delete confirmation. No repeated deadline/urgency forms appear in overview cards.

Quick Add remembers its successful destination. Moves update `list_id` on the original task, preserving ID, creation timestamp, unedited legacy dates, completion and unrelated metadata. Completion writes `is_done: true`; reopen/Undo writes `false`. It never deletes the record. Permanent deletion remains a separate confirmed action.

TaskStore operations reserve pending work before awaiting. Moves acquire source/destination locks in stable order. Create, active moves and reopen refresh capacity before admitting a task into Must Do Today. Completed rows do not consume its three slots. Failed writes retain original rows and drafts. Uncertain inserts require reconciliation. Partial bulk failures retain only unsaved lines and report how many already saved; they do not resubmit successful lines.

Global search returns matching lists/tasks with the original list name. Completed results require an explicit checkbox; archived-list results are labelled and remain accessible. Upcoming excludes completed and archived lists and groups dated tasks into Overdue, Today, Next 7 days and Later.

## Scope of persistence

| Data | Current implementation |
| --- | --- |
| Task CRUD/move/completion and list create/rename | Public hosted writes; read-only local live preview |
| All 14 legacy list identifiers and task associations | Preserved; unknown lists append |
| View mode, last destination | Browser preference containing IDs/settings only |
| Reorder/archive/restore | Synchronized Supabase metadata; demo browser preferences; tasks never deleted |
| Cross-device order/archive | Applied columns `sort_order`/`is_archived`; explicit browser preference import |
| Task text/drafts | In memory only; navigation warns on unsaved edits, but mobile OS termination cannot be prevented |

No AI integration, completion history table, service worker or offline task cache was added.

## Backend and release state

The owner explicitly requested public read/write access for now, with authentication deferred. No owner identity is guessed or enrolled. The optional owner migration is retained in `supabase/deferred/20261030224943_todo_owner_access.sql` and must not be applied until a real owner and sign-in/recovery flow have been verified.

The exact `supabase-todo` connection targets `walsvybskelqhgvpdagj`. Inspection found the expected legacy UUID/text/nullable schema, no custom functions/views/triggers or policies, no Auth users, no migration history and no Edge Functions. Existing `lists.type` and `max_items` are preserved; ordinary limits (including 50) are honored, while Must Do Today remains three active tasks. No task contents or timestamps are rewritten.

The metadata/capacity migration adds synchronized archive/order fields, a `tasks(list_id)` index, and guards for list/task identity, pinned lists, archived destinations and active capacity. A parent row version serializes admissions even under repeatable-read isolation. Public list deletion and table-wide privileges are removed; normal public list select/create/update and task CRUD remain available by owner request.

The static redesign needs no Edge Functions. The former management-access blocker is resolved. Release verification and applied migration history are recorded in `docs/release.md`.

## Verification and review screenshots

- 12 retained data/PWA regression checks passed.
- 7 added functional data checks passed: move metadata preservation/failure rollback, active-only capacity for reopen/move/Undo, source/destination reservations, partial bulk recovery, search/Upcoming, safe persisted preferences, list creation/read-only enforcement.
- An isolated PGlite PostgreSQL test passed for both candidate migrations: schema guard, owner selection guard, owner CRUD, anonymous access denial, authenticated outsider denial, capacity on insert/move/reopen, metadata preservation, archive and pinned protections. No live schema was assumed to match the fixture.
- All 30 Playwright scenarios passed: 10 each at 1650×900 desktop Chromium, 820×1180 tablet Chromium and iPhone 13 WebKit. An explicit desktop assertion requires at least six ordinary cards within the initial 900px viewport; the supplied compact fixture displays all 14 cards, including a 24-task list with long names.
- Browser tests block external requests; all screenshots contain invented data. Observed issues during implementation—exact select labels and a completion checkbox being reset during pending saves—were corrected before the successful affected checks.

Screenshots were compared with the brief: no motivational content, compact toolbar, two pinned desktop cards, three ordinary desktop columns, minimal empty cards, mobile single column/full-screen editor. Expanded mode intentionally grows to show every task.

- [Desktop compact](screenshots/desktop-compact.png)
- [Desktop expanded](screenshots/desktop-expanded.png)
- [Desktop list editor](screenshots/desktop-list-editor.png)
- [Mobile overview](screenshots/mobile-overview.png)
- [Mobile list editor](screenshots/mobile-list-editor.png)

Actual iPhone installation/keyboard behavior requires device checks. Authentication is deferred by explicit owner choice. See the release record for current verification and deployment status.
