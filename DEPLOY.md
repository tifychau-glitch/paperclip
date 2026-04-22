# Deploying Clipboard to Railway

## Manual deploy

1. Fork this repo to your GitHub account.
2. Go to [railway.com](https://railway.com) and create a new project.
3. Choose **Deploy from GitHub repo** and select your fork.
4. Add a **PostgreSQL** database service to the same project. Railway will
   automatically inject `DATABASE_URL` into the app service.
5. Set the environment variables below under the **Variables** tab.
6. Wait for the first build to finish, then open the generated
   `https://<project>.railway.app` URL.

## Environment variables

### Required

| Variable | Purpose |
|---|---|
| `BETTER_AUTH_SECRET` | 32+ random hex chars. Signs auth session cookies. Generate with:<br>`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `BETTER_AUTH_URL` | Your Railway app's public URL, e.g. `https://clipboard-abc123.railway.app`. Better Auth uses this to build OAuth callback URLs and validate redirects. Without it, Google sign-in callbacks will fail. Set this to whatever URL Railway assigns to your deploy. |
| `PAPERCLIP_AGENT_JWT_SECRET` | Another 32+ random hex chars, **different** from `BETTER_AUTH_SECRET`. Signs agent JWTs used by long-running adapter processes. |
| `DATABASE_URL` | Set automatically when you attach the PostgreSQL service. Format: `postgresql://user:password@host:port/dbname`. |

### Auth: Google SSO (optional but recommended)

Clipboard uses [Better Auth](https://better-auth.com). When both of the below
are set, a Google sign-in option is enabled automatically. If unset, only
email/password auth is available.

| Variable | How to get it |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → **Create OAuth 2.0 Client ID**. Authorized redirect URI: `https://your-app.railway.app/api/auth/callback/google` |
| `GOOGLE_CLIENT_SECRET` | Same credential in Google Cloud Console. |

### Invite allowlist (optional, recommended for beta)

| Variable | Purpose |
|---|---|
| `INVITE_ALLOWLIST` | Comma-separated list of email addresses allowed to use the app. Leave blank to allow anyone. Example: `alice@gmail.com,bob@gmail.com,charlie@gmail.com` |
| `CLIPBOARD_CONTACT_EMAIL` | Shown on the "invite only" page so rejected users know who to contact. |

When set, the allowlist is enforced in two places:

- **At sign-up**: Better Auth's `databaseHooks.user.create.before` hook
  rejects any new account — email/password or Google OAuth — whose email
  isn't on the list. No off-list account is ever created in the database.
- **At API-call time**: Any existing session whose email is off-list gets
  a 403 HTML page with the contact prompt. Agent JWTs and board API keys
  are not affected (they're already provisioned, not interactive).

The double gate means you can tighten the allowlist later and existing
off-list accounts stop working immediately, even if their cookies are
still valid.

### Other optional

| Variable | Purpose |
|---|---|
| `VITE_CLIPBOARD_ROOT` | Override the default `delegate.py` path. Leave blank for cloud deployments. |
| `PAPERCLIP_TELEMETRY_DISABLED` | Set to `1` to disable anonymous telemetry. |
| `PAPERCLIP_PUBLIC_URL` | Full base URL (e.g. `https://clipboard-abc.railway.app`). Usually only needed if Better Auth's callback URLs need to be forced to a specific host. |
| `PAPERCLIP_DISABLE_BOOTSTRAP_CLAIM` | Set to `true` after first admin is established if you want to hard-disable the `POST /api/bootstrap/claim-instance-admin` endpoint. Normal operation doesn't need this. |

### Deprecated / safe to delete

If you see these in your Railway Variables tab from earlier iterations,
they are no longer read by the server and can be removed:

- `DISABLE_HOSTNAME_GUARD` — the hostname guard is hard-disabled in code.
- `PAPERCLIP_ALLOWED_HOSTNAMES` — only consumed when the hostname guard is
  active, which it isn't.

## Database

Railway's PostgreSQL plugin sets `DATABASE_URL` automatically. Clipboard
applies all pending migrations in-process on startup (see `ensureMigrations`
in `server/src/index.ts`), so no separate migration step is required.

The **`pg_trgm`** extension is required for issue search. Run this once in
your Railway PostgreSQL console (Data tab → Query):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

## Health check

Railway is configured to hit `/api/health` with a 300-second grace period.
That endpoint probes the database connection and returns 503 if the DB is
unreachable, so failed deploys surface quickly.

## After deploying

1. Railway will give you a URL like `https://clipboard-abc123.railway.app`.
2. Visit that URL — you should see the Clipboard sign-in page.
3. The first user to sign in becomes the bootstrap CEO for the instance.
4. Share the URL with beta users (whose emails are in `INVITE_ALLOWLIST`).

## Notes

- **Port**: The server already reads `process.env.PORT`, so Railway's injected
  `$PORT` works without any Dockerfile change. The `EXPOSE 3100` in the
  Dockerfile is advisory only.
- **Start command**: Migrations run in-process, so the Railway start command
  is simply the server entry point. See `railway.toml`.
- **Deployment mode**: `PAPERCLIP_DEPLOYMENT_MODE=authenticated` and
  `PAPERCLIP_DEPLOYMENT_EXPOSURE=lan` are set in `railway.toml` for production.
  Do not change these unless you know what they do.
