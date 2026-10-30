# Release verification

October 30, 2026. Public access is explicitly retained by the owner; authentication and owner-only RLS are deferred. This supersedes earlier owner-auth rollout requirements.

## Supabase

Only `supabase-todo` was used, and its project URL verified `walsvybskelqhgvpdagj`. Applied migration history: `20261030231617_todo_list_metadata_capacity`. The local migration filename matches that actual server-generated version; the handoff candidate was originally `20261030224513_todo_list_metadata_capacity.sql`.

Verified new metadata columns, list/task guards, list_id index, preserved public CRUD, removal of list deletion and unused table-wide grants. RLS remains disabled intentionally. No existing task rows were migrated. No Edge Functions existed or were required; none deployed. The owner-access candidate is retained under `supabase/deferred/`, outside deployable migrations.

A real standalone PostgreSQL 18.6 fixture with two independent clients verified competing inserts at read-committed and repeatable-read isolation. Both finish with three active tasks; the loser receives a capacity error or serialization failure. Run `scripts/test-capacity-concurrency.mjs` with `TODO_PG_RUNTIME` pointing to an isolated folder containing `pg` and `@embedded-postgres/windows-x64`. No Docker is required.

Production verification used synthetic list/task fixtures under the `anon` role inside one transaction, then rolled everything back. Checked public CRUD, capacity, completion/reopen, identity/timestamp/free-form deadline preservation on move, and archive/restore. No personal task contents were used as fixtures.

## Website

GitHub Pages settings verified: legacy build from `main`, repository root, HTTPS enabled, custom domain `bamnstudios.net`. The handoff spelling `bammstudios.net` differs from the actual configured domain.

The application preserves in-memory demo mode and read-only local `?source=live`. Hosted mode supports public live writes. Server list archive/order takes precedence over old browser preferences; import is explicit. View mode remains local. Devices fetch shared metadata on load or Refresh data; no background realtime subscription is added.

## Validation

21 Node data/schema tests passed. The responsive Playwright run had 29 passes and one artifact-file error during concurrent test runs. Additional hosted regression work and publication were stopped at the owner's request to push the current work and handle the rest later. The updated website has not been published or live-verified. Actual iPhone installation and OS keyboard behavior remain manual device checks.
