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
  git history which editor wrote a given change** — the history shows the bot,
  not the person. If you need real per-author commits, have those editors use
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

- The token handed to an editor's browser **expires after 8 hours**. Like every
  git-based CMS, Sveltia keeps it in the browser's `localStorage` unencrypted —
  but its short life means a leaked or copied token is worthless within hours,
  and needs no manual revocation.
- The service refreshes the bot token automatically four times a day
  (00/06/12/18 UTC) and renews the underlying refresh token on every rotation,
  so nothing ever reaches GitHub's 6-month refresh-token expiry — even if the
  site is untouched for months.
- The **refresh token is the only long-lived secret**. It lives in the worker's
  Durable Object and is never sent to any browser. The worker holds **no GitHub
  secrets in its configuration** — the bot authorizes once via device flow.

**Removing access (offboarding):** delete the person from the Access policy.
They lose access after at most *(Access session length, default 1 week) + 8
hours*. To cut everyone off immediately — e.g. on a suspected leak — click
*Rotate token now* in the dashboard; every outstanding token stops working at
once. Shortening the Access session length reduces the offboarding delay.

**Abuse protection:** requests must carry an allowed `site_id`
(`ALLOWED_DOMAINS`) and tokens are only delivered to allowed origins; an empty
list disables login entirely (no open relay). The admin area is restricted to
the `SETUP_ADMINS` emails.

**The personal-GitHub alternative.** If you enable the optional GitHub sign-in
path (delegated to `sveltia-cms-auth`, see below), editors using it sign in with
their own GitHub account: commits are attributed to them personally, but that
path uses GitHub's classic long-lived token (no 8-hour expiry). It is the
opposite trade-off — real attribution, longer-lived browser token. You can
offer both paths at once; each editor picks per login.

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

**Security note (delegated trust).** This worker proxies the OAuth round-trip on
its own origin — the same origin as `/setup`. The `sveltia-cms-auth` deployment you
point to therefore runs inside your admin origin's trust boundary. The worker only
ever forwards the `csrf-token` cookie in either direction, so your Cloudflare Access
identity (`CF_Authorization`) is never exposed to it and it cannot set cookies in
your origin — but a compromised or XSS-affected upstream could still act within the
admin origin. Treat that deployment as trusted as this worker itself: run your own
instance and keep it updated. If you need stronger isolation, host the admin area on
a separate origin.

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

**Tokens (normally nothing to do).** The service hands each editor a token that
expires after 8 hours and refreshes itself automatically four times a day
(00/06/12/18 UTC), so it never goes stale — even if the site is untouched for
months. If a refresh happens while someone is mid-edit, they simply see a
save error, reload, sign in again (a two-second popup), and their draft is
still there — see [docs/redakteure.md](docs/redakteure.md).

**If you suspect a token leaked.** Click *Rotate token now* in the dashboard —
every token currently out there stops working immediately.

**If sign-in suddenly fails for everyone.** GitHub may have revoked the bot's
authorization (e.g. the bot account changed its password). The login shows a
clear error; fix it by clicking *Reconnect* in the dashboard's GitHub section
and re-authorizing as the bot.

**Privacy note.** The sign-in history stores editors' email addresses and
timestamps (personal data). Use *Clear history* or per-user delete to remove
it; as the operator you are responsible for handling it under GDPR.

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
