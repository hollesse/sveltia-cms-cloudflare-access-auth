# sveltia-cms-cloudflare-access-auth

[![CI](https://github.com/hollesse/sveltia-cms-cloudflare-access-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/hollesse/sveltia-cms-cloudflare-access-auth/actions/workflows/ci.yml)

**Email-based login for [Sveltia CMS](https://github.com/sveltia/sveltia-cms)
(and Decap-compatible CMSs) — no GitHub account required for your editors.**

A single, stateless Cloudflare Worker that acts as the CMS's authentication
backend (`base_url`). Editors sign in with nothing but their email address:
Cloudflare Access sends them a one-time code, checks it against your allowlist,
and the worker hands the CMS a **short-lived GitHub token (8 hours)** minted
from a bot account's GitHub App authorization. Optionally, editors with a
GitHub account can keep signing in with GitHub via your existing
[`sveltia-cms-auth`](https://github.com/sveltia/sveltia-cms-auth) deployment.

Built for small git-based sites — clubs, families, small organizations —
running on free tiers end to end (Workers Free, Access Free ≤ 50 users).

## How it works

- **Identity** is delegated to **Cloudflare Access** (email one-time code +
  allowlist policy). The worker never stores users or passwords.
- **Authorization** is delegated to **GitHub**: a machine ("bot") account is a
  collaborator on your site repo and authorizes your GitHub App once, via
  device flow. Commits made through the CMS are attributed to the bot.
- **Tokens are short-lived by design:** the worker keeps the bot's refresh
  token in a Durable Object and rotates it on a cron (00/06/12/18 UTC).
  Browsers only ever hold a token that dies within 8 hours — extracting it
  from `localStorage` buys an attacker almost nothing.
- **Zero GitHub secrets in the worker config.** The only secret material (the
  refresh token) is created during setup and never leaves the Durable Object.
- **Two gates against abuse:** requests must carry your site's `site_id`
  (`ALLOWED_DOMAINS`), and tokens are only posted to allowed origins. An empty
  `ALLOWED_DOMAINS` disables login entirely (no open relay).

## Prerequisites

- A Cloudflare account (free plan is fine).
- A GitHub account that owns the site repository, plus **one extra GitHub
  account** to act as the bot (e.g. `myclub-cms-bot`).
- A site using Sveltia CMS with `backend: name: github`.

## Setup

Target: under 30 minutes.

### 1. Deploy the worker

```sh
git clone https://github.com/<you>/sveltia-cms-cloudflare-access-auth
cd sveltia-cms-cloudflare-access-auth
npm ci
npx wrangler login
npx wrangler deploy
```

Note the deployed URL (`https://<name>.<subdomain>.workers.dev`). The worker
boots unconfigured on purpose — it will tell you exactly which settings are
missing. **You never need to edit any file in this repo to deploy it.**

### 2. Create a GitHub App

GitHub → Settings → Developer settings → **GitHub Apps** → New GitHub App
(note: a *GitHub App*, not an *OAuth App*):

- Webhook: **disable**.
- Permissions: **Repository → Contents: Read and write** (Metadata: Read-only
  is added automatically). Nothing else.
- After creating: enable **Device Flow** (General → "Enable Device Flow" —
  without it, setup fails with a 400).
- Copy the **Client ID** (`Iv…`). You do *not* need a private key, an
  installation, or a client secret.

### 3. Create the bot account

- Register a machine account (e.g. `myclub-cms-bot`).
- Invite it as a **collaborator (write)** on the site repository and accept
  the invitation as the bot.

### 4. Protect the worker with Cloudflare Access

Cloudflare dashboard → **Zero Trust** (first use: pick a team name — that's
your `ACCESS_TEAM_DOMAIN`, e.g. `myclub.cloudflareaccess.com` — and confirm
the free plan). Then **Access → Applications → Add → Self-hosted**, using
**public hostname** entries (they support paths; the "Workers" destination
type protects the whole worker and hides the AUD):

| Hostname (your workers.dev host) | Path |
|---|---|
| `<name>.<subdomain>.workers.dev` | `auth/access` |
| `<name>.<subdomain>.workers.dev` | `setup` |

Paths act as prefixes, so `setup` covers all setup routes. `/auth` (the
method-selection page) stays public by design.

- Login method: **One-time PIN** (default).
- Policy: Allow → Include → **Emails** → your editors' addresses, *plus*
  yourself as the operator (you'll need it in step 5, the setup wizard).
  This policy IS your editor allowlist; Access won't even send a code to
  addresses that aren't on it.
- Session duration: 1 week is a good balance (offboarding takes effect within
  session + 8 h).

You do **not** need to copy the Application Audience (AUD) tag — the setup
wizard reads it straight out of your signed-in session (step 5).

### 5. Configure the worker (two secrets, then the wizard)

Only two values need to be set by hand, ever (ADR 0014 — everything else is
configured through the browser wizard below, no file edits, no redeploys):

```json
{
  "ACCESS_TEAM_DOMAIN": "myclub.cloudflareaccess.com",
  "SETUP_ADMINS": "you@example.org"
}
```

```sh
npx wrangler secret bulk secrets.json
```

(`secrets.json` is git-ignored; never commit it.) `SETUP_ADMINS` is a
comma-separated list of the operator email(s) allowed to open `/setup` —
without it, setup is locked for everyone (fail-closed).

Now open `https://<worker>/setup` and sign in via Access as a `SETUP_ADMINS`
address. The wizard walks through seven steps:

1. **Set the app** — the wizard shows you the AUD your Access session's JWT
   actually carries; confirm it once (trust-on-first-use) and the worker
   pins it — no copy-pasting a 64-char hex tag.
2. **GitHub App** — paste the GitHub App **Client ID** from step 2 above and
   save it.
3. **Connect bot** — click *Connect bot*, then sign in to GitHub **as the bot
   account** at github.com/login/device and enter the device code shown
   inline.
4. **Approve a website** — comma-separated domain(s) your CMS is served
   from (`ALLOWED_DOMAINS`, e.g. `myclub.example.org`); add more with the
   *+* button.
5. **GitHub sign-in** (optional, skippable) — only if you also want the
   `sveltia-cms-auth` delegation path (see below).
6. **Users link** (optional, skippable) — a deep link to your Access
   policy for the "Manage users" button.
7. **Done** — a summary, plus the `config.yml` snippet for the next step.

From here on the same page (`/setup`) is the ongoing admin dashboard
(Users / GitHub connection / Settings, with a collapsible sidebar): the
GitHub-connection section shows the current token (masked, reveal with the eye
icon), its validity and next rotation in your timezone, plus **rotate now**,
**reconnect** and **disconnect**; the Users section lists a sign-in history
(who signed in, first/last, sortable, deletable); Settings offers inline
editing of every value via its pencil icon.

### 6. Point the CMS at the worker

In your site's `admin/config.yml`:

```yaml
backend:
  name: github
  repo: you/your-site
  branch: main
  base_url: https://<name>.<subdomain>.workers.dev
  auth_methods: [oauth]   # hides Sveltia's "Sign In Using Access Token"
```

That's it. Editors click the CMS sign-in button, get the method page (or go
straight to the email flow if GitHub isn't configured), enter their one-time
code, and are signed in.

## Optional: keep GitHub sign-in via sveltia-cms-auth

If some editors prefer their personal GitHub account, the worker can delegate
that path to an existing `sveltia-cms-auth` deployment (it proxies the OAuth
round-trip so the CMS's origin checks stay happy):

1. Set `GITHUB_AUTH_URL` (secret) to the `sveltia-cms-auth` base URL. This
   enables the selection page with both buttons.
2. Change the **callback URL of that deployment's GitHub OAuth App** to
   `https://<this worker>/callback`. ⚠️ OAuth Apps have a *single* callback
   URL — after this, logins that go directly to `sveltia-cms-auth` (without
   this worker) stop working for that OAuth App.
3. Make sure the `sveltia-cms-auth` deployment's own `ALLOWED_DOMAINS`
   includes your site's domain.

## Operations

- **Add/remove users:** edit the Access policy (Include → Emails) — reachable
  via the dashboard's *Manage users* button. Removal takes effect within
  Access session + 8 h. No other list to maintain for the email path.
- **Sign-in history:** the dashboard's Users section records who signed in and
  when (first/last), as an audit log — Access remains the source of truth for
  *who may* sign in. This stores editors' email addresses + timestamps
  (personal data); a **Clear history** button and per-user delete are provided
  (ADR 0015). As the operator you are responsible for its GDPR handling.
- **Admins:** `SETUP_ADMINS` (comma-separated emails) controls who can open
  `/setup` (wizard + dashboard). Editors get a 403 there.
- **Rotation:** automatic at 00/06/12/18 UTC. Each rotation also renews the
  refresh token, so nothing ever ages out — even if the site sleeps for
  months. If a rotation moment cuts a live editing session, the editor
  reloads, re-signs in (2 seconds with a live Access session) and restores
  the draft — see [docs/redakteure.md](docs/redakteure.md).
- **Suspected leak:** press "Rotate token now" on the setup page — all
  outstanding tokens die immediately.
- **Recovery:** if GitHub ever revokes the bot's authorization, logins show a
  clear error page; reconnect via the dashboard's GitHub-connection section.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Config error page listing key names | `ACCESS_TEAM_DOMAIN`/`SETUP_ADMINS` are missing — set them (step 5). |
| "Setup incomplete" page, links to `/setup` | AUD or GitHub Client ID aren't pinned yet — finish the wizard. |
| Device-flow start fails with `github_error_400` | Device Flow not enabled on the GitHub App (step 2). |
| `UNSUPPORTED_DOMAIN` | The requesting site isn't in the wizard's/dashboard's allowed domains. |
| Editor sees "Bad credentials" when saving | Token rotated mid-session — reload, sign in again, restore the draft (see editor guide). |
| Everything asks for an email code, even `/auth` | Your Access app targets the whole worker ("Workers" destination). Recreate it with public-hostname entries and paths (step 4). |

## Notes

- Editor-facing pages are bilingual: German for German browser locales,
  English otherwise (Accept-Language; no header defaults to German). All
  strings live in `src/texts.ts` — adding a locale is one object.
- Commits made via the email path are attributed to the bot account. That's
  the documented trade-off for accountless editing.
- Architecture decision records live in `.agentheim/knowledge/decisions/`.

## Development

```sh
npm ci
npm run dev        # wrangler dev
npm test           # vitest (Workers runtime, mocked upstreams)
npm run typecheck  # tsc --noEmit
npm run deploy     # wrangler deploy
```

## License & attribution

MIT — see [LICENSE](LICENSE). The GitHub OAuth delegation path builds on the
excellent [`sveltia-cms-auth`](https://github.com/sveltia/sveltia-cms-auth)
(also MIT), which this project deliberately reuses instead of reimplementing.
