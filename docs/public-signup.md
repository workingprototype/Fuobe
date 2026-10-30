# Public sign-up and guest browsing

A Fuobe studio with a password can open itself a little to the public: signed-out visitors (guests)
browse it read-only, and anyone can make a free account. It is off by default, so a self-hosted
studio behaves as before: every page and API call needs the install password or an API token.

## Turning it on

Public sign-up works only on a studio that has a password (`FUOBE_PASSWORD` or **Settings →
Security**). Then it is on when one of these is true:

- `FUOBE_PUBLIC_SIGNUP=1` is set on the server. `FUOBE_PUBLIC_SIGNUP=0` keeps it off, whatever
  Settings says. While the variable is set, the Settings switch can't change it.
- The owner turns on **Settings → Security → Public sign-up**.
- The request is for `fuobe.com` or `www.fuobe.com` (the public demo), the server lists that name in
  `FUOBE_ALLOWED_ORIGINS`, and `FUOBE_PUBLIC_SIGNUP` is not `0`. The `Host` header comes from the
  client, so a self-hosted studio that someone reaches by its IP address can't be opened with
  `Host: fuobe.com`.

Turning it off signs out every account at once, and guests are sent to sign in again.

## Guests

A guest can open every page: galleries, presets, the studios, Layers, Cinema, Image to 3D and
Settings, read-only. The pages get the catalog and status reads they need (`/api/status`,
`/api/models`, `/api/search-index`, `/api/comfyui`, `/api/settings/models`, curated moodboards,
built-in skills). The owner's library stays private: the lists come back empty, and other reads of
it (files, uploads, projects, settings values, tokens) answer 401 "Sign up to see your library".

Every change a guest sends (generate, upload, save a setting, create a project…) answers 401. The
studio shows a "Create a free account to run this" card with **Sign up** and **Log in**. Price
checks (the estimate routes, and `?preview=1` on the run routes that support it) stay open, so the
studios can show prices.

## Accounts

- Sign up at `/login?signup=1` (`POST /api/auth/signup` with `{ "email", "password" }`). The
  password needs at least 8 characters. There is no email verification.
- Log in at `/login` (`POST /api/auth/login` with `{ "email", "password" }`). The install password
  still works as before: `POST /api/auth/login` with `{ "password" }`, or **Studio owner** on the
  login page.
- Accounts are stored in `auth.json` in the data folder: the email in lower case, a salted scrypt
  hash of the password (the same scheme as the install password), and the creation time.
- Sign-up and log-in attempts are rate limited per visitor (set `FUOBE_TRUST_PROXY=1` behind a
  reverse proxy, so that each visitor gets their own limit).

An account is signed in, but it sees the owner's studio as a guest does:

- **The owner's library stays the owner's.** An account opens every page and the catalog, but the
  owner's results, files, uploads, folders, shares, projects (Layers, Cinema, Canvas, storyboards,
  elements…) and Assist threads are hidden: the lists come back empty, and other reads answer 403.
  Every change to them (create, rename, move, share, delete, upload) answers 403 with
  `code: "library"`. Accounts don't have a library of their own yet.
- **Settings, keys and tokens are the owner's.** Changing settings or model switches, the password,
  API tokens, Public sign-up, LoRA downloads, Assist connectors and the MCP endpoint answer 403 for
  an account.
- **Accounts never run on the owner's keys or GPU.** Anything that would reach a model (a
  generation, an AI helper, a retry) answers 403 with `code: "connect-gpu"`, and the studio shows a
  "Connect your GPU to run this" card. An account's own GPU connection comes in a later change.

`GET /api/auth/me` (open to everyone) says who is looking: `{ signedIn, owner, publicSignup,
account? }`.

The rules are in `src/lib/guest-access.ts` (which paths guests and accounts may use) and
`src/proxy.ts` (where they are applied). The tests are in `tests/public-signup.test.ts`.
