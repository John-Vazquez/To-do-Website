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
| Task CRUD/move/completion and list create/rename | Repository operations implemented, exercised against fixtures; live writes gated |
| All 14 legacy list identifiers and task associations | Preserved; unknown lists append |
| View mode, last destination | Browser preference containing IDs/settings only |
| Reorder/archive/restore | Functional browser-only preferences, explicitly labelled; tasks never deleted |
| Cross-device order/archive | Prepared columns `sort_order`/`is_archived`; adapter integration and production schema verification pending |
| Task text/drafts | In memory only; navigation warns on unsaved edits, but mobile OS termination cannot be prevented |

No AI integration, completion history table, service worker or offline task cache was added.

## Database/security evidence and blockers

The previous read-only audit confirmed anonymous list and task reads from `walsvybskelqhgvpdagj`, including a JSON boolean `is_done`. It did not establish SQL types, defaults, nullability, policy definitions, grants, triggers or intended completion semantics. The old app ignored the flag. The redesigned service/fixtures use boolean completion without rewriting old records.

Management access was rechecked during this work and again after the owner reconnected Supabase. Both the connector's project list and local CLI exposed only the Speedpack project, not To-Do. A direct information-schema query against To-Do still returned “You do not have permission to perform this action.” The separately scoped MCP connection reported no `public.lists` table, so it was not used for To-Do changes. **No production SQL or Edge Function deployment has been performed. No Edge Functions are required by this static redesign.**

Live mode is therefore read-only regardless of hostname. This is an application safeguard, not a fix for the existing anonymous-read exposure. Do not publish it as a finished operational replacement: owner sign-in, verified RLS and actual-schema compatibility must be completed first.

The prepared owner model grants one verified Supabase Auth UUID access to this personal project's lists/tasks through a protected private membership table. It does not give all authenticated users access, use editable user metadata, or expose a service-role key. The candidate migration refuses to run without an existing verified owner UUID. Existing permissive policies must be reviewed before replacement; otherwise policy OR semantics could retain anonymous access.

To provide access, authorize the Supabase connection for the organization containing the To-Do project, using its owning account. A separate project-scoped MCP connection can preserve Speedpack access. Official instructions: [Supabase MCP authentication and project scoping](https://supabase.com/docs/guides/ai-tools/mcp). Do not paste secrets into chat.

## Prepared migrations and rollout order

Two CLI-generated migration files are prepared, not applied:

1. `20261030224513_todo_list_metadata_capacity.sql`: verifies required column types; adds list metadata without rewriting task records; protects pinned-list identity/title/archive; serializes capacity-changing writes with parent locks and blocks active inserts/moves/reopens beyond three. Existing over-capacity records are preserved, not deleted.
2. `20261030224943_todo_owner_access.sql`: requires `todo.owner_id` to identify a verified existing Auth user; creates private owner membership, replaces reviewed legacy policies, enables RLS and restricts CRUD to that owner. It removes anonymous access. List deletion is not granted.

Before production:

1. Gain read-only access to the exact To-Do project. Inspect migration history, all columns/defaults/constraints, RLS/grants, views/functions, triggers, Auth configuration and existing user identities. Reconcile candidates with the actual schema; do not blindly apply them.
2. Verify the owner's chosen sign-in and recovery method. Implement/test the sign-in UI and owner session before revoking anonymous access. Confirm the owner can read/write the original lists while another authenticated identity and unauthenticated clients cannot.
3. Validate the candidate against a real development/staging database, including simultaneous writes from two independent connections and any existing triggers. PGlite provides a single connection; its tests do not prove multi-session concurrency behavior.
4. Apply only reviewed task-specific migrations with the verified owner ID in the migration session. Record and verify migration history. Audit for remaining exposure through views/functions/grants.
5. Connect synchronized metadata and authenticated sessions in the adapter, enable live mutations, verify owner CRUD/moves/completion and anon/outsider denial, then merge/publish the static assets. Confirm Home Screen installation on actual iPhone hardware.

This sequencing is a technical release gate, not an outstanding request for approval. Existing task data has not been altered.

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

Limitations: production owner login/RLS/type/default verification and write tests remain blocked by management access; cross-device list preferences await schema integration; actual iPhone installation/keyboard behavior and multi-session SQL concurrency require live/device checks. These are not claimed complete.
