# sveltia-cms-cloudflare-access-auth

[![CI](https://github.com/hollesse/sveltia-cms-cloudflare-access-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/hollesse/sveltia-cms-cloudflare-access-auth/actions/workflows/ci.yml)

**Email-based login for [Sveltia CMS](https://github.com/sveltia/sveltia-cms)
(and Decap-compatible CMSs) — no GitHub account required for your users.**

A single, stateless Cloudflare Worker that acts as the CMS's authentication
backend (`base_url`). Users sign in with nothing but their email address:
Cloudflare Access sends them a one-time code, checks it against your allowlist,
and the worker hands the CMS a **short-lived GitHub token (8 hours)** minted
from a bot account's GitHub App authorization. Optionally, users with a
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
  Browsers only ever hold a token that dies within 8 hours, which bounds how
  long a leaked token is usable — but within that window it is the bot's full
  GitHub token (repo read/write), not a CMS-scoped one, so treat a leak as real.
- **Zero GitHub secrets in the worker config.** The only secret material (the
  refresh token) is created during setup and never leaves the Durable Object.
- **Two gates against abuse:** requests must carry your site's `site_id`
  (`ALLOWED_DOMAINS`), and tokens are only posted to allowed origins. An empty
  `ALLOWED_DOMAINS` disables login entirely (no open relay).

## What you should know before deploying

A few things about how this works have real consequences for you as the
operator — nothing hidden, but worth understanding up front.

**Identity and authorization are split.** *Who* may sign in is decided by
Cloudflare Access (email one-time code + your allowlist). *What* they may do
in the repository comes from a single shared **bot GitHub account** that
authorizes the GitHub App once. Everyone who signs in through the email path
receives a token that acts as that one bot.

What that means for you as the operator:

- **No per-person attribution on the email path.** Every commit made through
  the email login is authored by the bot account. You **cannot tell from the
  git history which user wrote a given change** — the history shows the bot,
  not the person. If you need real per-author commits, have those users use
  the optional *personal GitHub* sign-in path instead (see below), where each
  commit carries their own GitHub identity.
- **Everyone gets the same permissions.** The email path grants exactly the
  bot's repository permissions (Contents: read/write on the target repo).
  There are no roles and no per-user restrictions — anyone on the allowlist can
  edit anything the bot can. (Fine-grained roles are an explicit non-goal of v1.)
- **You can see *who signed in*, not *who wrote what*.** The dashboard's
  sign-in history is an audit log of authentications (who, first/last time); it
  does not link commits to people.

**Token lifetimes and where tokens live:**

- The token handed to a user's browser **expires after 8 hours**. Like every
  git-based CMS, Sveltia keeps it in the browser's `localStorage` unencrypted.
  The short life bounds the exposure window, but the token is the bot's full
  GitHub token (repo read/write, not limited to CMS actions): a leaked token can
  read or write the repo directly for those hours, and anything it commits
  persists after it expires. Keep the blast radius small — one dedicated bot,
  minimal GitHub App permissions, collaborator on only the target repo — and
  rotate immediately on a suspected leak (see offboarding below).
- The service refreshes the bot token automatically four times a day
  (00/06/12/18 UTC) and renews the underlying refresh token on every rotation,
  so nothing ever reaches GitHub's 6-month refresh-token expiry — even if the
  site is untouched for months.
- The **refresh token is the only long-lived secret**. It lives in the worker's
  Durable Object and is never sent to any browser. The worker holds **no GitHub
  secrets in its configuration** — the bot authorizes once via device flow.

**Removing access (offboarding):** delete the person from the Access policy.
They lose access after at most *(Access session length, default 1 week) + 8
hours*. On a suspected leak, click *Rotate token now* in the dashboard: GitHub
invalidates the previously issued bot token immediately, so any copied bot token
stops working. Note what rotation does **not** do — it does not end Cloudflare
Access sessions (a user still signed in can fetch a fresh token, so remove
them from the Access policy too) and does not touch personal GitHub sign-in
tokens. Shortening the Access session length reduces the offboarding delay.

**Abuse protection:** requests must carry an allowed `site_id`
(`ALLOWED_DOMAINS`) and tokens are only delivered to allowed origins; an empty
list disables login entirely (no open relay). The admin area is restricted to
the `SETUP_ADMINS` emails.

**During first-time setup (before you pin the app):** the wizard trusts your
signed-in Access session on first use to read the app's audience (AUD) tag. Until
you confirm it in step 1, `/setup` accepts any `SETUP_ADMINS` session from your
Access *team* — not only this app. If your Access team also hosts other, less
restrictive apps, finish the wizard's first step (pin the AUD) before relying on
it; once pinned, only this app's sessions are accepted everywhere.

To close that first-use window entirely, set the optional secret
`SETUP_BOOTSTRAP_AUD` to this app's AUD before the first sign-in
(`wrangler secret put SETUP_BOOTSTRAP_AUD`). When set, `/setup` enforces exactly
that audience from the very first request — a JWT from another app of the same
team is rejected — so there is no trust-on-first-use step to get right. Leave it
unset for the default behaviour above. Single-app deployments (the common case)
don't need it; it matters only when you share a team domain with weaker apps.

**The personal-GitHub alternative.** If you enable the optional GitHub sign-in
path (delegated to `sveltia-cms-auth`, see below), users using it sign in with
their own GitHub account: commits are attributed to them personally, but that
path uses GitHub's classic long-lived token (no 8-hour expiry). It is the
opposite trade-off — real attribution, longer-lived browser token. You can
offer both paths at once; each user picks per login.

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
- Policy: Allow → Include → **Emails** → your users' addresses, *plus*
  yourself as the operator (you'll need it in step 5, the setup wizard).
  This policy IS your user allowlist; Access won't even send a code to
  addresses that aren't on it.
- Session duration: 1 week is a good balance (offboarding takes effect within
  session + 8 h).

You do **not** need to copy the Application Audience (AUD) tag — the setup
wizard reads it straight out of your signed-in session (step 5).

### 5. Configure the worker (two secrets, then the wizard)

Only two values need to be set by hand for normal operation (ADR 0014 —
everything else is configured through the browser wizard below, no file edits,
no redeploys; the only exception is the optional `SETUP_BOOTSTRAP_AUD` secret
described further down, used solely for the one-time first-admin bootstrap):

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
   *+* button. List each **exact** CMS host: the token is only handed to
   `https://<that host>` on the default port — subdomains are **not** matched
   automatically, so add every host you actually use.
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

That's it. Users click the CMS sign-in button, get the method page (or go
straight to the email flow if GitHub isn't configured), enter their one-time
code, and are signed in.

## Optional: keep GitHub sign-in via sveltia-cms-auth

If some users prefer their personal GitHub account, the worker can delegate
that path to a `sveltia-cms-auth` deployment. Since ADR 0017, this runs as a
**postMessage relay** (§7.6 option B), not a pass-through proxy: the GitHub
button on the selection page opens `sveltia-cms-auth` directly in a *second*
popup on its own origin (`/auth/github` no longer exists on the worker — it
returns 404), and only postMessage *data* — never HTML or script — crosses
back to the worker's origin. Set up both configuration steps together, at
deploy time — the GitHub sign-in path is broken between step 1 and step 2:

1. Set `GITHUB_AUTH_URL` (secret) to the `sveltia-cms-auth` base URL. This
   enables the selection page with both buttons, and switches the GitHub
   button on to the relay page.
2. Change the **callback URL of that `sveltia-cms-auth` deployment's GitHub
   OAuth App** back to `https://<that deployment>/callback` (its own origin —
   *not* this worker). ⚠️ OAuth Apps have a *single* callback URL.
3. Make sure the `sveltia-cms-auth` deployment's own `ALLOWED_DOMAINS`
   includes **both**: your CMS site's domain(s) (checked against the
   `site_id` query parameter it receives, "gate 1") **and** this worker's
   host (checked against the relay popup's origin when it receives the
   result, "gate 2"). If that deployment leaves `ALLOWED_DOMAINS` empty, both
   gates are skipped — fine for a self-hosted instance you already trust, not
   recommended for anything shared.

**Security note (delegated trust, narrowed by ADR 0017).** No upstream HTML or
script ever runs on this worker's origin anymore — a compromised
`sveltia-cms-auth` deployment can at most send bad *data* through the relay,
which is still gated by the exact-origin token handover used everywhere else
in this project. Treat the deployment as you would any code you delegate to:
run your own instance and keep it updated.

**Protocol coupling.** The relay page reproduces `sveltia-cms-auth`'s
postMessage handshake (`authorizing:<provider>` ping/reply, then
`authorization:<provider>:success:…` / `:error:…`) as read from its `main`
branch source on 2026-09-04. An upstream protocol change could break the
relay; if GitHub sign-in stops working after updating your `sveltia-cms-auth`
deployment, check whether its handshake messages changed.

## Running the service day to day

Once set up, the service runs itself — token rotation is automatic and there is
no scheduled maintenance. The only recurring task is deciding who may sign in.
Everything below is done from the admin dashboard at `/setup`.

**Add or remove a user.** Access is controlled entirely by your Cloudflare
Access policy, not by this service. Click *Manage users* in the dashboard to
open that policy and add or remove an email address. A removed user loses
access once their Access session and last token expire (at most session length
+ 8 hours). The dashboard's user list is only a **sign-in history** (who signed
in, first and last time) — deleting someone there does *not* revoke access, and
adding happens only in the Access policy.

**Who can open the admin area.** Only the emails in the `SETUP_ADMINS` secret
can open `/setup`; everyone else gets "access denied". Change it with
`wrangler secret put SETUP_ADMINS` (comma-separated).

**Tokens (normally nothing to do).** The service hands each user a token that
expires after 8 hours and refreshes itself automatically four times a day
(00/06/12/18 UTC), so it never goes stale — even if the site is untouched for
months. If a refresh happens while someone is mid-edit, they simply see a
save error, reload, sign in again (a two-second popup), and their draft is
still there — see [docs/nutzer.md](docs/nutzer.md).

**If you suspect a token leaked.** Click *Rotate token now* in the dashboard —
every token currently out there stops working immediately. Note that a still-valid
Cloudflare Access session can then fetch a fresh token right away; rotation
invalidates the *leaked* token, it is not a global logout.

**If you need to stop everyone signing in right now.** Toggle *CMS login* off
under **Settings**. While disabled, `/auth/access` hands out no token at all — even
to a valid, still-open Access session — until you enable it again. Use it for a
planned maintenance window, or as the immediate emergency brake when rotating alone
isn't enough (e.g. an Access session you can't yet revoke); the internal cron refresh
keeps the vault current in the meantime, so re-enabling restores normal operation
instantly. Each toggle is recorded in the audit log.

**If sign-in suddenly fails for everyone.** GitHub may have revoked the bot's
authorization (e.g. the bot account changed its password). The login shows a
clear error; fix it by clicking *Reconnect* in the dashboard's GitHub section
and re-authorizing as the bot.

**Privacy note.** The sign-in history stores users' email addresses and
timestamps (personal data). Use *Clear history* or per-user delete to remove
it; as the operator you are responsible for handling it under GDPR.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Config error page listing key names | `ACCESS_TEAM_DOMAIN`/`SETUP_ADMINS` are missing — set them (step 5). |
| "Setup incomplete" page, links to `/setup` | AUD or GitHub Client ID aren't pinned yet — finish the wizard. |
| Device-flow start fails with `github_error_400` | Device Flow not enabled on the GitHub App (step 2). |
| `UNSUPPORTED_DOMAIN` | The requesting site isn't in the wizard's/dashboard's allowed domains. |
| User sees "Bad credentials" when saving | Token rotated mid-session — reload, sign in again, restore the draft (see user guide). |
| Everything asks for an email code, even `/auth` | Your Access app targets the whole worker ("Workers" destination). Recreate it with public-hostname entries and paths (step 4). |

## Notes

- User-facing pages are bilingual: German for German browser locales,
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
npm run test:e2e   # playwright (two-origin relay handshake, browser)
npm run typecheck  # tsc --noEmit
npm run deploy     # wrangler deploy
```

## License & attribution

MIT — see [LICENSE](LICENSE). The GitHub OAuth delegation path builds on the
excellent [`sveltia-cms-auth`](https://github.com/sveltia/sveltia-cms-auth)
(also MIT), which this project deliberately reuses instead of reimplementing.
