# Phase 1 audit and validation

Historical report: UI and deletion-based completion below have been superseded by the [functional redesign](functional-redesign.md). The anonymous-read finding and missing management access remain relevant.

Audit date: October 30, 2026. Source baseline: `b9a8d76`. The implementation is now on local `main` in the owner's chosen checkout at `C:\Users\speed_ayzysvt\Documents\GitHub\To-do-Website`, outside OneDrive. No production task mutations, migrations, policies, or deployments were performed.

## Existing data contract

Before changing the data-access layer, the original code was inspected:

| Operation | Existing query/fields | Phase 1 behavior |
| --- | --- | --- |
| List load | `lists.select('id,title')` | Same columns, stable pagination |
| Task load | `tasks.select('*').eq('list_id', id)` | Same list association, paginated by `id`; sort parsed dates locally |
| Create | `list_id`, `content`, `due_date`, `urgency` | Same insert fields; verify returned row |
| Edit | Update content/date/urgency by task `id` | Only changed fields; filter both task `id` and original `list_id`; verify row |
| Complete/delete | Delete task by `id` | Explicit confirmation, filter `id` and `list_id`, verify returned ID |
| Rename | Update list `title` by list `id` | Same field; only update the displayed title after confirmation |

All 14 original list UUIDs are retained verbatim in `todo-config.js`. Task identity is independent of list position; `tasks.list_id` associates it with `lists.id`. No UUIDs, records, or titles are migrated. The existing eight custom cards retain their HTML order. Four other IDs (`discrete`, `calc`, `cyber`, `topics`) previously had query mappings but no cards; they append after those eight. All live lists, including future unknown IDs, can render. A missing legacy row remains a disabled card; it is not silently recreated.

A redacted, one-row anonymous read confirmed these task JSON columns: `id`, `list_id`, `content`, `due_date`, `is_done`, `created_at`, `urgency`. It did not establish SQL types, nullability, defaults, foreign keys, triggers, or policy definitions. The original app ignores `is_done` and deletes completed tasks; Phase 1 preserves that behavior rather than inventing new completion semantics. All returned tasks continue to display, including any with `is_done` set.

## Supabase security audit

Target: `walsvybskelqhgvpdagj`. The committed legacy key decodes to the `anon` role. It is a browser credential, not a service-role credential. No service-role credentials were added.

Observed read-only checks:

- `GET /rest/v1/lists?select=id,title` returned HTTP 200 with all 14 list IDs and titles using the public key and **no user sign-in**.
- `GET /rest/v1/tasks?select=*&limit=1` returned HTTP 206 and one personal task row without user sign-in. The audit output redacted every value and printed column names/types only. Anonymous task readability is therefore confirmed.
- The OpenAPI root returned HTTP 401 (`Invalid API key`), even though the table endpoints answered. This is not evidence that table access is protected, and schema details must not be inferred from it.
- The connected Supabase management account lists only a different project. A read-only catalog query against this task's project returned “You do not have permission to perform this action.” No query was run against the other project's database.
- The application contains no sign-in or owner authorization step. Browser controls, a private-looking URL, and hiding the anon key cannot protect publicly readable records. The app now uses the same anon key for compatibility; the exposure remains until approved backend work.

**Unverified:** whether RLS is enabled; policy predicates; anonymous INSERT/UPDATE/DELETE grants; auth provider settings; active owner accounts; constraints; triggers. Anonymous writes were not attempted, including no-op or rollback probes. The old app relies on anonymous writes, so write exposure is a serious possibility, not a verified result. Read access is verified; RLS's exact cause is unknown.

### Proposed owner-access transition (requires separate approval)

1. Obtain read-only management access to this exact project; inspect schema, policies, grants, Auth configuration, triggers and existing owner accounts. Export a secure recovery backup outside the public repository.
2. Establish and test the owner's sign-in and recovery method before restricting access. Prefer Supabase Auth with explicitly approved email/identity; do not allow arbitrary signed-up users to access the lists.
3. Define ownership using an owner UUID on each list or a verified membership table. Backfill existing list ownership only after confirming the intended account. Task authorization must follow the task's parent list and prevent reassignment to lists the caller does not own.
4. Test authenticated owner access and anonymous denial for SELECT, INSERT, UPDATE and DELETE in a separate environment. UPDATE needs visibility plus both old-row and new-row authorization. Do not authorize using editable user metadata.
5. Coordinate the sign-in UI release and policy transition, verify owner access, then revoke anonymous data access. Keep a reviewed recovery path so the owner is not unexpectedly locked out. UI-only authentication is insufficient.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [returning inserted rows](https://supabase.com/docs/reference/javascript/insert). The Supabase changelog was checked; current browser CRUD uses the established API. The October 12 TLS deprecation targets unsupported TLS clients and does not require an application query change for modern browsers.

## Heartbeat findings and proposed correction

The only tracked file is `workflows/supabase-heartbeat.yml`. GitHub discovers workflow YAML under `.github/workflows/`, so this file is **not an active GitHub Actions workflow at its current path**. It cannot provide its intended scheduled heartbeat from this repository layout. The three most recent accessible Actions runs were successful `pages build and deployment` runs, not heartbeat runs. Workflow-list enumeration was rejected by the connector; Actions settings, secret availability and external schedulers were not verified.

Its curl command targets `/rest/v1/keepalive?select=id&limit=1`, but this table's existence, access policies and whether such a request meets the project's activity requirements are unverified. `curl -s` can exit successfully on HTTP 401/404/500, giving false success. Its cron `0 12 */2 * *` runs at 12:00 UTC on alternating calendar dates; it is not an exact every-48-hours interval.

After approval: verify a suitable harmless existing read endpoint without personal task content, validate both repository secrets, then move a reviewed workflow into `.github/workflows/` on the intended default branch. Use `permissions: { contents: read }`, a short job timeout, `curl --fail --silent --show-error --max-time 20`, and validate the HTTP result without logging task data or credentials. Run `workflow_dispatch` once and check its actual job result before relying on a schedule. Do not create a public `keepalive` table or introduce a service-role key merely to make this work. Scheduling and project pausing guarantees must be checked against the account's actual Supabase plan. The original file remains unchanged and unactivated.

References: [GitHub workflow location and syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Future provider-independent API (not implemented)

Keep Supabase as the source of truth. The UI already uses repository operations with no AI dependency. Expose authorized server operations later:

| Operation | Suggested input and authorization |
| --- | --- |
| Read lists | Authenticated principal; return only its authorized list IDs/titles |
| Read tasks | Authorized `list_id`; pagination and optional due/urgency filters |
| Create task | Authorized `list_id`, content, due date, urgency; caller idempotency key |
| Update task | Task UUID, changed fields, expected version; verify list ownership |
| Move task | Task UUID and authorized destination list UUID; transactional capacity check |
| Complete task | Task UUID and idempotency key; explicit completion semantics |
| Rename list | Authorized list UUID and new title |

Use revocable scoped OAuth/access tokens for assistants, verified server-side issuer/audience/expiry, owner-scoped authorization on every operation, rate limits and bounded inputs. Never give an assistant the service-role key. Do not trust list names as unique IDs or task text as instructions. Ask for clarification when a natural-language name matches multiple lists/tasks. Log operation IDs and outcomes while minimizing private text.

To guarantee Must Do Today's capacity across devices, add a reviewed transactional operation that serializes writes for the parent list and counts existing tasks before inserting/moving. Enforce it for all write paths so direct table inserts cannot bypass it. This needs approval and staging verification; frontend pending guards cannot replace it.

Completion history should be designed after auditing the existing `is_done` column. A future migration could add completion timestamps/actors and an event/history table with ownership protection, or retain completed rows with an approved visibility model. Define restore/delete semantics, backfill and retention before implementation. Never fabricate historical completion events for previously deleted tasks. Phase 1 introduces no such schema changes.

## Validation results

- **12/12 Node tests passed:** all IDs/order/title mapping, correct list associations, CRUD, rename, pagination beyond 500 rows, unlimited lists, pending and cross-tab capacity guards, fresh-count reconciliation, date/urgency sorting, validation, failed and zero-row writes, read-only mutation rejection, ambiguous insert recovery, manifest/PNG dimensions.
- **16/16 browser scenarios passed** in Chromium at desktop sizes and WebKit with iPhone 13 emulation. Fourteen passed initially; the two failure/recovery scenarios caught a stale reload-button accessible label after list titles loaded. That label was corrected and both affected scenarios passed on their targeted rerun. Scenarios cover every list, CRUD, explicit permanent completion, unsaved edit discard, failed operations, retry, title integrity, duplicate submit events, three-task cap, sort controls, refresh errors, layout at 1280/1024/390/320px, 44px mobile task controls, PWA metadata and absence of task caches.
- A separate Chromium read-only smoke check loaded the actual 14 Supabase list cards through the pinned SDK with no visible errors or JavaScript errors. All mutation controls were disabled. A network guard blocked non-read methods and recorded zero attempted writes. The demo also loaded 14 cards with no JavaScript errors; its desktop screenshot was visually inspected.
- Browser tests block all external requests and use invented data. Live checks are read-only; no live CRUD validation has been performed. Actual iPhone hardware/Safari Home Screen installation, live write permissions and database concurrency guarantees remain unverified.
- No deployment, production branch push, schema change, RLS change, data migration, AI integration or heartbeat activation is part of this implementation.
