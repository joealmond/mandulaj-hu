# Operations guide

Personal site, built from an Obsidian vault with [Quartz v5](https://github.com/jackyzha0/quartz)
and deployed to Cloudflare Workers.

The vault is the source of truth. This repo only ever contains notes that were
explicitly published.

| Document                                            | What it covers                              |
| --------------------------------------------------- | ------------------------------------------- |
| [Repository README](../../README.md)                | Concise daily use and constraints           |
| [Architecture decisions](architecture-decisions.md) | The stack, rationale, and custom components |
| [Project TODO](todo.md)                             | Completed, open, and deferred work          |
| [Maintenance gotchas](maintenance-gotchas.md)       | Constraints that matter during maintenance  |

---

## Commands

**Every day**

| Command           | What it does                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`     | Writing loop — syncs, serves on :8080, **watches the vault**. Edit a note, the browser reloads.                    |
| `npm run preview` | Everything loop — syncs, then serves on :8799 through the **real Worker**. Search, likes and comments all work.    |
| `npm run publish` | sync → audit → build → plan → **deploy** → commit generated artifacts. Add `-- --dry` to review without deploying. |

**Occasionally**

| Command                         | What it does                                                |
| ------------------------------- | ----------------------------------------------------------- |
| `npm run sync`                  | vault → `content/`. **The only step that reads the vault.** |
| `npm run build`                 | Full build with both audits. Does _not_ sync.               |
| `npm run deploy`                | Ship the current `public/` without rebuilding.              |
| `npm run toggle -- "<file.md>"` | Add or remove `publish: true` on a note.                    |
| `npm run audit:all`             | Check `content/` and `public/` without rebuilding.          |
| `npm run check`                 | Typecheck and formatting.                                   |

**Cloudflare**

| Command                    | What it does                                    |
| -------------------------- | ----------------------------------------------- |
| `npm run db:migrate`       | Apply D1 migrations to the **remote** database. |
| `npm run db:migrate:local` | Same, against the local dev database.           |
| `npm run worker:dev`       | Worker alone against local D1, no build.        |

**Webmentions**

| Command                    | What it does                                 |
| -------------------------- | -------------------------------------------- |
| `npm run webmentions`      | Fetch received mentions (runs during build). |
| `npm run webmentions:send` | Send outgoing mentions. `-- --dry` previews. |

> `dev`, `preview` and `publish` all sync for you. A bare `npm run build` does
> not read the vault — the audit warns by name when that leaves notes behind.

## The one thing to understand

**Quartz never sees your vault.** A sync step copies published notes into
`content/`, and Quartz builds from that:

```
~/Documents/Base                 this repo
┌──────────────────┐            ┌─────────────┐        ┌──────────┐
│  1903 notes      │  npm run   │  content/   │ quartz │ public/  │
│  mostly private  │ ──sync──►  │  published  │ ─build►│  site    │
└──────────────────┘            │  only       │        └──────────┘
                                └─────────────┘
   one explicit gate:             sanitized metadata,
   publish: true                  committed and deployed
```

Publishing is fail-closed **by construction**, not by filter. A note that sync
doesn't copy cannot be built, committed, or deployed — there is no code path
that reaches it.

---

## First-time setup

Do this once. Steps 1–2 are needed to build locally; 3–4 to deploy; 5 to publish
from Obsidian.

### 1. The repo

```bash
npm install                              # Node 22+
npx quartz plugin install --from-config  # fetches the community plugins
cp .env.example .env                     # all values optional
npm run build                            # should end with two green audits
```

### 2. Point it at your vault

`scripts/publish.config.ts` holds the publishing policy. The default vault path
is `~/Documents/Base`; override with `VAULT_PATH` in `.env` if yours differs.

### 3. Cloudflare

```bash
wrangler login
wrangler d1 create mandulaj      # paste database_id into wrangler.jsonc
npm run db:migrate               # applies every pending D1 migration remotely
```

Secrets (never committed):

```bash
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put VISITOR_SALT
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put TELEGRAM_THREAD_ID # optional: forum chats only
```

`TURNSTILE_SITE_KEY` is public and goes in `.env` — it gets baked into the HTML.
With it unset the comment form simply stays hidden.

### 4. Domain

See [Project TODO](todo.md) §4. The short version: add the domain to Cloudflare,
**verify the imported MX/SPF/TXT records against `dig` before switching
nameservers**, then add the Worker custom domain.

### 5. Obsidian

Two plugins, one setting.

|                    | Why                                                                     |
| ------------------ | ----------------------------------------------------------------------- |
| **Shell commands** | Runs the desktop publish and toggle scripts.                            |
| **obsidian-git**   | Backs up the private vault and bridges Obsidian Sync changes to GitHub. |

**The setting** — Obsidian hides frontmatter by default:

> Settings → Editor → **Properties in document → Visible**

Then add two commands under Settings → Shell commands:

```
# Toggle publish  (give it a hotkey)
/path/to/myblog/scripts/obsidian-toggle-publish.sh "{{file_path:absolute}}"

# Publish site  (run it from the command palette)
/path/to/myblog/scripts/publish-from-obsidian.sh
```

For each, open its settings and set _stdout_ and _stderr_ output to
**Notification**, so successes and failures both surface as a toast.

## Publish a post

**One key, from inside Obsidian.** Open the note, press the hotkey. That is the
whole gesture — no frontmatter to type, no tags to restate, no description to
write.

Set it up once:

1. Install the **Shell commands** plugin.
2. New shell command:

   ```
   /path/to/myblog/scripts/obsidian-toggle-publish.sh "{{file_path:absolute}}"
   ```

3. Alias it `Toggle publish`, send stdout to **Notification**, and give it a
   hotkey (Settings → Hotkeys).
4. Press it again on the same note to unpublish.

Then press your **Publish site** button (or `npm run publish`) when you want the
site rebuilt and deployed. Marking and shipping are deliberately separate:
`publish: true` says _this note may go out_, the publish button says _now_.

### You do not need to write frontmatter

The toggle writes the only key that matters:

```yaml
---
publish: true
---
```

Everything else is derived:

|                 | Where it comes from                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Title**       | The filename, unless you set `title:`                                                                                                                                                |
| **Description** | Generated from the first ~150 characters of the note, cut at a sentence boundary. Used in RSS, the OG card, and search results. Writing one by hand is optional and rarely worth it. |
| **Tags**        | Your inline `#hashtags`, taken from **lines that contain nothing but tags** — your `#moc #index` convention. Hoisted into frontmatter at sync time.                                  |
| **Dates**       | Git history of the published copy                                                                                                                                                    |
| **Category**    | Whichever published MOC page links to the note                                                                                                                                       |
| **Colour**      | The category                                                                                                                                                                         |

**A hashtag only counts as a tag when its line contains nothing else.** That is
how this vault is written — 199 notes tag on a line of their own, and the
handful that use hashtags mid-sentence are things like `#Example` and `#See`,
which are not tags at all.

So `#moc #index` on its own line is a tag line. A sentence such as
"Use `#codebase` in Copilot chat" is prose, and its hashtags are escaped in the
published copy: they still read exactly the same but never reach the tag index.
Code is ignored entirely, so `#include`, `#!/bin/sh` and `#fff` are safe.

Tag-only lines are removed from the published copy, so a generated description
starts with your actual prose rather than "moc index …".

### Line breaks work like Obsidian

Obsidian treats a single newline as a line break. Standard Markdown does not —
it joins consecutive lines into one paragraph. So a list written like this:

```markdown
[[Brute-force algorithm]]
[[Hashing algorithm]]
[[Sorting algorithm type]]
```

would render as one run-on sentence on most Markdown sites. Here it renders as
three lines, matching what you see while writing.

**The consequence:** do not hard-wrap paragraphs. Write a paragraph as one long
line and let the browser wrap it. A paragraph wrapped at 80 characters in the
editor will break at every one of those points on the site.

### Editing frontmatter in Obsidian

Obsidian calls frontmatter **Properties**. It is hidden by default, which is why
notes look like they have none.

> Settings → Editor → **Properties in document → Visible**

With that on, a properties panel appears at the top of every note. `publish`
renders as a checkbox you can tick.

**Adding the property by hand:** `Cmd+P` → _Add file property_ → type `publish`.
Or just type `---` on the first line of an empty note and Obsidian opens the
block for you.

#### Gotchas

**Property types are global, not per-note.** Obsidian remembers the type of each
property name in `.obsidian/types.json` and applies it everywhere. Set `publish`
to **Checkbox** the first time you create it; from then on every note gets a
checkbox.

If it ends up as **Text**, Obsidian writes `publish: "true"` — a string, not a
boolean. Both are accepted here (Quartz accepts both, so rejecting one only
created a silent dead end), but Checkbox is the type you want.

**Nothing else counts as true.** `yes`, `1`, `True`, `Y` all fail the gate and
the note stays unpublished, silently. That is deliberate — a typo must never
publish something.

**Frontmatter must be the very first thing in the file.** A blank line, a stray
space, or anything above the opening `---` and Obsidian will not recognise it as
properties — it becomes a horizontal rule in the body instead. If the properties
panel does not appear, that is almost always why.

**The delimiters are exactly three dashes**, on their own lines, no trailing
spaces.

**Tags: use inline `#hashtags` as you already do.** They are hoisted into
frontmatter automatically at sync time and removed from the published body if
they sit on a line of their own. You never need to restate them as a property.
If you _do_ add a `tags` property, Obsidian and this pipeline both accept it.

**Deleting a property** — click the property name in the panel, then the trash
icon. Removing `publish` unpublishes the note on the next deploy.

**Templater** is installed and can stamp frontmatter into new notes. Useful if
you want every note in a folder to start with a `publish` checkbox already
present and unticked.

### Which notes are eligible

Folder location is deliberately irrelevant. `publish: true` is the single,
explicit opt-in, so the same toggle works in every part of the vault and after
a note is moved. The tradeoff is simple: accidentally turning on that property
publishes the note on the next publish. The review plan prints the public slugs
being added, changed, or removed before deployment.

Publishing a note does **not** copy all its properties. Source frontmatter is
default-deny: today only the documented project-card fields (`description`,
`type`, `year`, `stack`, `link`) and reading-order fields (`series`,
`seriesOrder`) may cross unchanged. Title, slug, tags, category, and accent are
normalized or derived by sync; properties such as `client`, `status`, private
URLs, aliases, and arbitrary custom fields are dropped. The content audit blocks
any unexpected property that somehow appears in the generated artifact.

### Optional frontmatter

Everything here has a sensible default; set it only when you want to override.

| Key             | Effect                                                                       |
| --------------- | ---------------------------------------------------------------------------- |
| `publish`       | **The gate.** `true` or `"true"`. `yes`, `1` and `True` are rejected.        |
| `draft: true`   | Pull a note back at the source; this property itself is not copied publicly. |
| `title`         | Overrides the filename; sync writes the normalized result.                   |
| `description`   | Public source property; overrides the generated one.                         |
| `slug`          | Pins the URL; sync writes the normalized result.                             |
| `accent`        | Pins the derived colour without copying the source property verbatim.        |
| `moc`           | Picks the primary published category without copying arbitrary MOC metadata. |
| `zk`            | Pins the derived short id; it stays out of public frontmatter.               |
| `type: project` | Public source property; puts the note in the `/projects` listing.            |
| `year`          | Public project-card year.                                                    |
| `stack`         | Public project-card technology list.                                         |
| `link`          | Public project-card destination URL.                                         |
| `series`        | Groups published notes into one previous/next reading sequence.              |
| `seriesOrder`   | Numeric position within that series; lower numbers appear first.             |

## What publishing exposes beyond the note itself

Flagging a note publishes more than its body. Run this after any sync:

```bash
npm run privacy
```

It reports two things that are easy to forget.

**Titles of unpublished notes.** A link to a private note has its _link_
removed but keeps its _text_, because those words were visible prose in your
note. `[[NestJS]]` becoming "NestJS" is right. `[[Journal/2025-03-04]]` becoming
"Journal/2025-03-04" is not — that publishes the fact that a journal entry
exists for that date.

For targets like that, redact instead of flatten:

```ts
// scripts/publish.config.ts
redactLinkPrefixes: ["Journal/"],
```

Matching links are removed entirely rather than left as text. Empty by default,
because removing text changes your prose.

**Attachments.** Every image a published note embeds becomes a public URL. The
report lists them with the note that pulled them in.

The report is written to `.publish-exposure.json`, which is gitignored — those
titles are already visible on the published pages, but there is no reason to
also commit a tidy index of them.

## Categories (MOCs)

A category is a **published** MOC page. In this vault a MOC is a note tagged
`#moc` on its first line, whose title is the topic and whose body links out to
its members:

```markdown
#moc #index

## Starter Notes

- [[Controllers translate transport into application actions]]
- [[Dependency injection separates construction from behavior]]
```

Membership runs **MOC → note**: a note belongs to a category because that
category's page links to it, not because the note declares anything.

Three rules worth knowing:

- **A category only exists if its MOC page is itself published.** Otherwise
  publishing a note would expose the title of a private MOC ("Family growth")
  as a public label. Publishing a MOC is the deliberate act that creates a
  public category.
- **Colour follows category.** Every note under one MOC shares its accent, so
  a topic is recognisable before you read a word. Notes in no category are
  **neutral** — absence of colour means "unfiled", not "some other category".
- **Unfiled notes are shown, not hidden**, in the Categories pane. It tells you
  what you have published but never filed.

A note in several MOCs lists under each; the primary one (alphabetically, or
pinned with `moc:` in frontmatter) drives the header label and the colour.

## Unpublish

Remove `publish: true` (or set `draft: true`), then `npm run publish`.

`content/` is wiped and regenerated on every sync, so the note and any
attachments only it referenced disappear from the next deploy. Nothing is left
behind to clean up.

> Note: unpublishing removes it from the live site, not from git history or
> from anyone's cache. For something genuinely sensitive, treat it as having
> been public.

## Publish from Obsidian — desktop

Set `publish: true` on a note, then press one button. No terminal.

This runs the same `npm run publish` pipeline, which means the explicit toggle,
frontmatter sanitation, attachment tracing, link flattening, and both audits
all still apply. Nothing is bypassed.

1. Install **Shell commands** from Community Plugins.
2. Settings → Shell commands → **New shell command**, and set it to the
   absolute path of the wrapper:

   ```
   /path/to/myblog/scripts/publish-from-obsidian.sh
   ```

3. Open that command's settings (the gear):
   - **Alias**: `Publish site`
   - **Output** → _stdout_ to **Notification**, _stderr_ to **Notification**,
     so you see "✓ Published" or the audit failure as a toast.
   - **Events** tab (optional): tick nothing for button-only, or see "fully
     automatic" below.
4. Run it from the command palette: search for **Publish site**. Shell Commands
   0.23.0 does not provide a command-specific ribbon button. Keep the full-site
   command off a hotkey so publishing remains an explicit, confirmed action.

Press it. It syncs, verifies, builds, deploys to Cloudflare, then commits.

## Publish after editing in Obsidian — mobile

The supported mobile workflow uses **Obsidian Sync**, with the Mac as the bridge
to GitHub. Do not enable Obsidian Git on the phone: Obsidian Sync transfers the
vault files but not the hidden `.git` repository, so the mobile plugin reports
"cannot find Git repository".

```
edit and save on phone
      → Obsidian Sync copies the change to the Mac
      → desktop Obsidian Git commits and pushes base_note_vault
      → GitHub Action checks out vault + site
      → sync → audit → build → wrangler deploy      ~2 min after the push
```

Desktop Obsidian Git is configured to **auto commit-and-sync after file edits
stop**, with a 60-minute delay. Saving the note on the phone is therefore the
only mobile action. Keep Obsidian running on the Mac when prompt publishing is
important. If the Mac is asleep or Obsidian is closed, the edit remains in
Obsidian Sync and the overdue commit-and-sync runs the next time Obsidian opens.

This design has an intentional constraint: GitHub cannot read Obsidian's
private Sync service. Running the workflow manually from the GitHub mobile app
only redeploys the latest vault commit; it cannot include an edit that has not
yet reached GitHub through the Mac. If the Mac is lost, restore the vault from
Obsidian Sync on another computer, restore this repository, and run desktop
commit-and-sync or **Publish site**.

The workflow lives in `deploy/vault-publish.yml`. Install it into the **private
vault repo** so no secret ever sits in this public one:

```bash
mkdir -p ~/Documents/Base/.github/workflows
cp deploy/vault-publish.yml ~/Documents/Base/.github/workflows/publish.yml
```

Then add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as Actions secrets
on that repo. Any Markdown push starts a cheap sync because a toggled note may
live anywhere, but private-only changes stop before build and deployment when
the generated public artifact is unchanged.

The GitHub Action itself does not depend on Obsidian Sync. It starts only after
desktop Obsidian Git (or another desktop Git client) pushes the private vault
repository. The desktop **Publish site** command remains the immediate manual
path when the Mac is in front of you.

The vault push is the source record. After a successful deployment, the Action
commits only the generated public paths to the site repository and records both
commit IDs in its summary. This persistent baseline is what lets the next
private-only vault push stop before build and deployment.

Add `SITE_REPO_TOKEN` to the vault repository's Actions secrets: use a
fine-grained token limited to the `mandulaj-hu` repository with **Contents: Read
and write**. It is required even when the site repo is public because a vault
repository's default Actions token cannot write to a different repository.

### Can it publish automatically, with no button?

Yes, but read this first. Shell commands has an **Events** tab that can fire on
_File saved_. Wiring publish to that means every keystroke-pause in any note
triggers a full build, commit, and push — you'd get dozens of deploys an hour
and a filthy git history.

The middle ground, if you want it: enable the event **File saved**, and under
the command's settings set a **debounce** (Shell commands supports this) of
several minutes. Even then it publishes edits you may not consider finished.

**Recommendation: keep it on the button.** `publish: true` marks a note
_eligible_; pressing the button is you deciding _now_. That separation is the
whole point of the fail-closed design, and it's one keypress.

## Why not Quartz Syncer

Quartz Syncer is the better-known route and it was in the original plan, but
it's the wrong fit here and is deliberately **not** used.

Syncer writes from the vault straight to `content/` on GitHub. That skips
`scripts/sync.ts` entirely, so it does not sanitize frontmatter, trace
attachments, or flatten links to unpublished notes. The output audit still
blocks anything without `publish: true`, but bypassing the code that constructs
the public artifact defeats the stronger privacy boundary.

The Shell commands button gives the same one-press experience _through_ the
sync pipeline, so there's nothing to trade off. If you ever do want Syncer's
diff preview, install it alongside and treat it as a read-only review tool.

## Run it locally

Two commands. Which one depends on what you are changing.

```bash
npm run dev        # http://localhost:8080  — writing notes, theme work
npm run preview    # http://localhost:8799  — the real Worker, everything on
```

### `npm run dev` — the writing loop

Builds your local plugins, syncs once, starts Quartz's server, and then
**watches the vault**. Edit a note in Obsidian, save, and the browser reloads.
No commands to re-run.

```
→ building local plugins
→ initial sync from vault
✓ Synced 8 note(s)
✓ watching <vault> for note changes
Started a Quartz server listening at http://localhost:8080
```

Deliberately skipped to keep it fast: OG cards, font conversion, the Pagefind
index, and the API. So in `dev`:

- **search finds nothing** — there is no index
- **likes and comments are hidden** — there is no `/api`

That is the graceful-degradation path working, not breakage.

### `npm run preview` — the everything loop

Syncs, applies local D1 migrations, does a full build, and serves through the
**real Worker** — the same code that ships. This is the one that shows search,
likes and comments working.

Slower to start, and it does not watch. Re-run it after a change.

Local data lives in `.wrangler/state`, which is gitignored and never touches
your Cloudflare account. Wipe it any time:

```bash
rm -rf .wrangler/state && npm run preview
```

### What needs what

| You changed                                | What to run                                  |
| ------------------------------------------ | -------------------------------------------- |
| A note in the vault                        | Nothing — `dev` re-syncs and reloads         |
| A note, but you are in `preview`           | Re-run `npm run preview`                     |
| `quartz-custom/theme/custom.scss`          | Nothing — Quartz hot-reloads CSS             |
| A component under `quartz-custom/plugins/` | Restart `dev` (it rebuilds plugins on start) |
| `quartz.config.yaml`                       | Restart `dev`                                |
| `worker/` or `migrations/`                 | `npm run preview` — `dev` has no API         |
| Anything, and you want it live             | `npm run publish`                            |

> `npm run build` on its own does **not** read the vault. `npm run sync` is the
> only step that does. `dev`, `preview` and `publish` all sync for you; a bare
> `build` does not, and the audit warns when that leaves notes behind.

## Likes, comments and mentions

Three separate mechanisms, deliberately:

|              | Where it lives                  | Needs                  |
| ------------ | ------------------------------- | ---------------------- |
| **Likes**    | D1, via `/api/likes`            | Turnstile not required |
| **Comments** | D1, via `/api/comments`         | Turnstile keys         |
| **Mentions** | webmention.io, fetched at build | a webmention.io token  |

Likes and comments are fetched at runtime and **never enter the repo** — no
stranger's text in your git history, and deleting takes effect immediately
rather than at the next deploy. The publish audit is untouched by anything
readers write.

Comments are **post-moderated**: they appear at once and Telegram pings you.
Every alert includes a **Moderate or reply** button. It opens a private,
per-comment URL where you can post a public reply labelled as József Mandula or
hide the complete thread. Hiding is recoverable in D1; there is no destructive
GET link for Telegram or a link-preview crawler to trigger.

Production reuses the Hermes bot and its existing private chat:
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are encrypted Worker secrets, while
`TELEGRAM_THREAD_ID` is deliberately unset. The Worker calls Telegram directly,
so Hermes does not receive or interpret comments and does not share its incoming
message stream. A random moderation capability authorizes only one comment; the
page is no-cache, no-index, and requires a same-origin form POST for changes.

New likes also send a Telegram note containing the post title and the new total.
Removing a like is silent.

For a future forum group, set `TELEGRAM_THREAD_ID` to a positive forum-topic ID
to keep alerts in that topic. An invalid topic ID fails closed and sends no
alert rather than falling back to the chat root. Defences are Turnstile, a
per-visitor rate limit, and a link cap.
Commenters need no account — their name is remembered in their own browser, and
a token stored there lets them delete their own comment.

Likes use a signed, random, first-party browser cookie. It is `HttpOnly`,
`Secure`, `SameSite=Lax`, created only when the reader presses Like, and contains
no IP address or user agent. D1 stores a separate HMAC of that random identity,
so the same browser can toggle its vote while different browsers/devices remain
separate. Clearing cookies permits a new vote; reliably recognizing one human
across devices would require accounts, which this site deliberately avoids.

Rate limiting uses a scoped HMAC of Cloudflare's client IP, independent of
User-Agent and cookies. Keys stay stable across midnight so quotas cannot reset
inside a sliding window; their rows are pruned after 24 hours. IP plus User-Agent
is used only to recognize legacy votes during migration. Comments do not
retain a visitor key. Rotating `VISITOR_SALT` invalidates signed like cookies,
so it requires a planned reset of `like_votes` and `likes`; otherwise old votes
can no longer be toggled off.

### Getting likes from Mastodon and Bluesky (Bridgy)

No code. [Bridgy](https://brid.gy) watches your social accounts and forwards
likes, boosts and replies to you as webmentions, which fill the avatar row that
already renders on each note.

1. Register `mandulaj.hu` at [webmention.io](https://webmention.io) and add the
   two `<link>` tags it gives you (see below).
2. Sign in to [brid.gy](https://brid.gy) with Mastodon, Bluesky or GitHub and
   press **Start**.
3. Set `WEBMENTION_IO_TOKEN` and `WEBMENTION_DOMAIN` in `.env`.

The `<link>` tags belong in `quartz-custom/pages/_headers`? No — they are HTML,
so add them to the head via `scripts/postbuild.ts` alongside the feed
autodiscovery tag:

```html
<link rel="webmention" href="https://webmention.io/mandulaj.hu/webmention" />
<link rel="pingback" href="https://webmention.io/mandulaj.hu/xmlrpc" />
```

Outgoing mentions are sent by `npm run webmentions:send` (run it with
`-- --dry` first). It discovers each target's endpoint and skips anything that
has none, so it never fails a publish.

## Troubleshooting

**I marked a note and `npm run build` did not pick it up.**

`npm run build` does **not** read the vault — `npm run sync` is the only step
that does. Build alone rebuilds whatever `content/` already held.

```bash
npm run sync && npm run build     # or just: npm run publish
```

The audit now warns when the vault holds notes marked `publish: true` that are
not in the build, so this announces itself rather than failing silently.
`npm run preview` syncs for you.

**My lines all ran together into one paragraph.** That was the old behaviour and
is fixed — `hard-line-breaks` is enabled. If you see it again, that plugin was
disabled in `quartz.config.yaml`.

**A paragraph is broken into short lines.** The opposite problem: the paragraph
is hard-wrapped in the editor. Join it into one line.

**Something that is not a tag showed up in the Tags pane.** A hashtag only
counts on a line containing nothing else, so this usually means the note has a
line like `#foo #bar` that was not meant as tags. Put the hashtags inside a
sentence or in backticks and they are ignored.

**The note will not publish.** In order of likelihood:

1. The properties panel is hidden, so you never saw that `publish` is missing —
   turn on _Properties in document_.
2. The value is `yes`/`1`/`True` rather than `true`.
3. Frontmatter is not the first thing in the file (a blank line above `---`).
4. `draft: true` is also set, which pulls it back.

`npm run sync` lists exactly what it copied. If your note is not in that list,
it never reached the build.

**The build fails with a publish safety error.**

```
✗ PUBLISH SAFETY CHECK FAILED — 1 finding(s)
  ✗ content/some-note.md does NOT carry `publish: true` …
```

Working as designed: nothing is deployed. It usually means `content/` was edited
by hand. Never edit `content/` — it is generated and hashed. Fix the note in the
vault and re-run `npm run sync`.

**The site builds but is completely empty.** Check that
`@quartz-community/note-properties` is still enabled. It looks like a display
component but is also the frontmatter _parser_; with it off, every note is
filtered out and the build is green and empty.

**Search finds nothing in `npm run dev`.** Expected — `dev` skips the Pagefind
index. Use `npm run preview`.

**Likes and comments do not appear locally.** Also expected in `dev`: there is no
`/api`. Use `npm run preview`.

**A deploy did not change anything.** `wrangler deploy` ships `public/`. If you
did not rebuild, you shipped the previous build. `npm run publish` always builds
first.

**Descriptions start with your tag names.** Should not happen — tag-only lines
are stripped at sync. If it does, the tags were mixed into a sentence, which is
left alone on purpose.

### If the safety check fires

```
✗ PUBLISH SAFETY CHECK FAILED — 1 finding(s)
  ✗ content/some-note.md does NOT carry `publish: true` …
```

The build stops and nothing is pushed. Usually it means `content/` was edited
by hand, or Quartz Syncer wrote a note the sync policy wouldn't have. Fix the
note in the vault and re-run `npm run sync`. Never edit `content/` directly —
it's regenerated, and the audit hashes it to detect exactly that.

## Maintenance

### Updating Quartz

This repo shares git history with `jackyzha0/quartz`, so it is a normal merge:

```bash
git fetch upstream v5
git merge upstream/v5
npm install
npx quartz plugin install --from-config
npm run build
```

Conflicts should be limited to `package.json` and `quartz.config.yaml`. If
`quartz/styles/custom.scss` conflicts, keep the symlink:

```bash
rm -f quartz/styles/custom.scss
ln -s ../../quartz-custom/theme/custom.scss quartz/styles/custom.scss
```

After any upgrade, re-read the [maintenance gotchas](maintenance-gotchas.md) — several
workarounds there exist because of upstream behaviour that may have changed. If
one is fixed upstream, delete the workaround rather than leaving both.

### Adding a community plugin

```bash
npx quartz plugin add github:quartz-community/<name>
npm run build
```

### Adding your own component

Copy an existing local plugin — they are all the same shape:

```bash
cp -r quartz-custom/plugins/webmentions quartz-custom/plugins/my-thing
```

Edit `package.json` (the `name` and the `quartz` manifest block) and
`src/index.tsx`, then register it in `quartz.config.yaml`:

```yaml
- source: ./quartz-custom/plugins/my-thing
  enabled: true
  layout:
    position: afterBody
    priority: 30
```

```bash
npx quartz plugin install --from-config
npm run build
```

`npm run build` rebuilds local plugins every time, so editing source is enough.

> Two traps when writing components, both explained in the [maintenance gotchas](maintenance-gotchas.md):
> plugin CSS is emitted inside a `@layer`, so `custom.scss` beats it regardless
> of specificity; and a backtick inside a CSS comment terminates the template
> literal and breaks the build in a way the log does not obviously show.

### Changing the theme

`quartz-custom/theme/custom.scss`. `quartz/styles/custom.scss` is a symlink to
it, so Quartz picks it up without the file living in core.

Colours are in `quartz.config.yaml` under `theme.colors`; the six accents are in
`scripts/gen-accents.ts`. If you add an accent, solve it for WCAG AA against
both backgrounds rather than eyeballing it — the original comp palette did not
pass.

### Adding a serverless route

`worker/index.ts`. Anything under `/api/*` invokes the Worker; everything else is
served as a static asset. Add the route, then `npm run deploy`.

### Routine checks

- `npm run audit:all` — verifies content and output without rebuilding
- `npm run check` — typecheck and formatting
- `npm run verify` — checks, regression suites, full build, generated-page checks and dependency audit
- `npm run deploy` — runs `verify` before deploying; does not sync the vault
- `npm run webmentions:send -- --dry` — see what would be sent

## Configuration

Everything optional lives in `.env` (copy `.env.example`). **The build succeeds
with all of it unset** — features just stay off.

| Variable              | Effect when unset                  |
| --------------------- | ---------------------------------- |
| `UMAMI_HOST`          | no analytics script emitted at all |
| `UMAMI_WEBSITE_ID`    | ditto — both are required together |
| `WEBMENTION_IO_TOKEN` | mentions section renders nothing   |
| `WEBMENTION_DOMAIN`   | ditto                              |
| `VAULT_PATH`          | falls back to `~/Documents/Base`   |

On Cloudflare, `TURNSTILE_SITE_KEY` is a build-time value (keep it in `.env`);
the secrets go in with `wrangler secret put`. Copy `.dev.vars.example` to
`.dev.vars` for local Worker development; real values stay ignored by Git.
