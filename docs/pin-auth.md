# Private PIN setup

On Windows, you can set the PIN through the Supabase Dashboard using your browser session. Open the To-Do project's [Edge Function Secrets](https://supabase.com/dashboard/project/walsvybskelqhgvpdagj/functions/secrets) and enter `TODO_PIN_HASH` in the Key field first. Then run this from the project folder:

```powershell
npm run set-pin -- --copy-hash
```

Enter your four-digit PIN twice at the hidden prompts. Paste directly into Value and save before copying anything else. The clipboard holds only the hash.

For first activation, run this from the project folder in an interactive PowerShell terminal:

```powershell
npm run setup-auth
```

If an existing environment token belongs to a different account, setup will offer a hidden replacement prompt after a 401/403. To explicitly ignore the environment token, run `npm run setup-auth -- --prompt-token`. PIN changes also support `npm run set-pin -- --prompt-token`. This does not change the terminal's saved token or other projects.

You need Node.js, the Supabase CLI on PATH (already present on this workstation), and a personal access token from the **account that owns project `walsvybskelqhgvpdagj`**. Create the token at https://supabase.com/dashboard/account/tokens. Do not paste the token or PIN into chat. The token prompt is hidden and no credentials are written to disk. An existing `SUPABASE_ACCESS_TOKEN` environment variable can also supply the token.

The command checks project access/schema, deploys `todo-api`, applies the PIN migration in a transaction, verifies browser access is denied, and then prompts twice for your four-digit PIN. It registers the migration in Supabase migration history. If deployment fails it stops before changing database permissions. If you cancel after database activation, the lists stay locked until you set a PIN. Rerunning the command skips the applied PIN migration and redeploys the API. The category and schedule migration must also be applied before using this API. Publish the updated website files through the normal GitHub Pages workflow afterward. The old website cannot read tasks after the database is locked.

To change the PIN after setup:

```powershell
npm run set-pin
```

The command prompts for your Supabase access token if `SUPABASE_ACCESS_TOKEN` is not already set, then asks for and confirms a four-digit PIN. Inputs are hidden. It derives a PBKDF2-SHA256 hash and uploads that hash as `TODO_PIN_HASH` to the Supabase project Secrets using the Management API. Nothing is written to the repository or printed except success or a safe error status.

Use a Supabase Personal Access Token with permission to manage this project. Keep it private; it is only held in memory for this command. Each PIN change invalidates old sessions once the Edge runtime receives the updated secret; secret propagation is not necessarily instantaneous. PIN rotation does not clear an existing five-minute attempt window.

## Activation notes

The website's browser code must call the `todo-api` Edge Function for all live task reads and writes. The function must verify a short-lived session token for data actions and reject attempts when `TODO_PIN_HASH` is unset. Configure database grants and row-level security so `anon` and `authenticated` clients cannot query `lists` or `tasks` directly; the Edge Function uses a server-only Supabase key after checking the PIN session. Never put that key in website code.

Unlock attempts are limited atomically in the database to five attempts per five-minute window, shared across all visitors (including successful attempts). This bounds distributed guessing without trusting client IP headers; someone can also temporarily exhaust this shared allowance. Sessions expire after eight hours. Only a hash of each random session token is stored, bound to the configured PIN hash so changing the PIN revokes old sessions. The function fails closed while the PIN is unset. The Lock lists action immediately clears displayed data and the tab token, and revokes the session on the server when online. Offline logout relies on server expiry for revocation.

The PIN is never used as a Supabase Auth password. There is no signup or email flow. The function explicitly disables gateway JWT verification because it verifies its own opaque random sessions. The service-role key is only read inside the Edge Function; no client chooses tables, columns, SQL, or arbitrary filters. Database capacity and pinned-list triggers continue to apply.

Local validation: `npm test` checks data regressions, isolated PostgreSQL access restrictions/throttling, API session handling, and desktop/tablet/iPhone browser flows. These do not replace a production smoke test after activation: confirm wrong/correct PIN behavior, create/edit/delete a disposable task, lock/reopen, and verify the public `lists`/`tasks` REST endpoints return permission denied. No production migration, function deployment, PIN, or website publication was performed during implementation because the CLI account available to the agent cannot access this project.

For local development, use a separate local Supabase project and local Edge Function secrets. Do not set a production PIN against a local function or local PIN against production.
