# Maintenance gotchas

Hard-won gotchas for `mandulaj.hu`. Read this before changing the build, the
publish pipeline, or the theme.

The _reasoning_ behind the architecture lives in the
[architecture decisions](architecture-decisions.md); open work is in the
[project TODO](todo.md). This file is the set of traps — things that cost real
time once and should not cost it twice.

## Context

- **Owner**: full-stack TypeScript dev (Angular, NestJS, AWS). Don't explain basics.
- **Source of truth**: Obsidian vault at `~/Documents/Base` — ~1900 notes,
  PARA structure, overwhelmingly private.
- **Stack**: Quartz v5 → Cloudflare Workers (static assets + `/api/*`), D1, custom domain `mandulaj.hu`.

## The central decision: Quartz never sees the vault

Quartz's own docs warn that filter plugins only filter **markdown**:

> "Regardless of the filter plugin used, all non-markdown files will be emitted
> and available publically in the final build."

So pointing Quartz at the vault would publish every image and PDF in it,
including attachments belonging to private notes. That's fail-open.

Instead `scripts/sync.ts` copies published notes into `content/`, and Quartz
builds from `content/`. Attachments are copied **only** when a published note
references them. The vault is never Quartz's content root. The private-vault
GitHub Action can check the vault out beside the site, but sync remains the only
bridge into Quartz's `content/`.

This makes the guarantee structural. `explicit-publish` and the audit are the
second and third layers, not the only ones.

### One visible gate, several structural controls

**`publish: true`** is the only author-facing gate, regardless of folder. The
string `"true"` is also accepted because Obsidian can emit it for a Text-typed
property; `yes`, `1`, and other truthy values fail closed.

Do not replace this clarity with implicit source copying. Sync reconstructs
frontmatter from a default-deny list (the documented project-card fields) plus
normalized structural values. The audit independently rejects unexpected
public keys. Attachments must be referenced and unpublished wikilinks are
flattened.

### The audit runs in two places for different reasons

- `npm run audit` (content) — pre-commit. Hashes every file against
  `.publish-manifest.json`, so hand-editing `content/` is caught.
- `npm run audit:out` (output) — post-build, **and in CI**. Deliberately
  needs no vault access, so CI can run it. Every emitted page must trace to a
  published note; every media file must be a traced attachment.

Both exit non-zero and abort the build. Neither ever warns-and-continues.

## Gotchas that cost real time

### `note-properties` is the frontmatter parser

It looks like a display component — it renders the properties table — but it is
**also what populates `vfile.data.frontmatter`**. Disabling it makes
`explicit-publish` read `undefined` and filter out _every_ note; the site
builds green and completely empty.

Keep it enabled with `hidePropertiesView: true`: parsing without the table.
This is commented in `quartz.config.yaml`; don't undo it.

### `imageStructure` on the og-image plugin does not work

The documented TS-override path (`ExternalPlugin.CustomOgImages({ imageStructure })`)
registers correctly — `componentRegistry.setOptionOverrides` fires with the
right key and all options — but the config loader **never calls
`getOptionOverrides` back** for that plugin, so the default card always renders.

`scripts/og.ts` therefore renders the cards directly with satori and overwrites
the plugin's output in place. The plugin stays enabled because it emits the
correct `<meta property="og:image">` tags and filenames; only the bytes are
replaced. If upstream fixes the override path, this script can be deleted.

Also: the real `imageStructure` signature takes **one object**, not positional
arguments. Both examples in the Quartz docs show the positional form and are
wrong. Source of truth is `og-image/dist/index.js`.

### The OG card avoids JSX on purpose

`quartz-custom/og/card.ts` builds plain `{type, props}` objects. It's executed
by `tsx` inside a build script where JSX runtime resolution is unreliable — the
classic transform reaches for a `React` global that isn't there, and the
`@jsxImportSource` pragma didn't take. satori consumes plain objects natively,
so dropping JSX removes the whole failure mode.

### Fonts arrive as TTF, not WOFF2

`quartz-fonts` fetches from the Google Fonts CSS API with no `User-Agent`.
Google serves the legacy TTF payload to unrecognised agents — about 2× the
bytes for identical glyphs (810KB vs 272KB here).

`scripts/optimize-fonts.ts` re-encodes to WOFF2 after the build and rewrites
the CSS. It also rewrites the `@font-face` `src` from the absolute
`https://mandulaj.hu/...` the plugin emits to origin-relative `/static/fonts/...`,
which is otherwise broken on localhost and on every preview deployment.

It must run **after** `scripts/og.ts` — satori needs the TTFs.

### Local plugins need an explicit rebuild

`quartz plugin install` builds a local plugin only on first link. Editing a
component's source afterwards leaves the stale `dist/` in place and the change
silently doesn't appear. `scripts/build-plugins.mjs` runs on every build to
prevent that.

### Layout groups render as `.flex-component`

A `layout.groups.<name>` entry in `quartz.config.yaml` does **not** put its name
on the element. It renders as `.flex-component`, so `.toolbar` matches nothing.

Worse, Quartz writes the flex properties as **inline styles** on each child
wrapper — including `align-self: center`. Inline styles beat every stylesheet
rule, so a tall child (search results) drags its siblings to the vertical middle
and no amount of `align-items` on the container fixes it. `!important` scoped to
`.sidebar .flex-component > *` is the only override available.

### `tsc -p tsconfig.json` does not check this project's code

The root tsconfig includes only `quartz/**` and root-level `*.ts`. For a long
while every "typecheck passed" here was checking **zero** files under
`scripts/`, `worker/` or `quartz-custom/` — a syntax error in `scripts/lib.ts`
once sailed through it and only failed at runtime.

Use `npm run typecheck`, which runs all three projects:
`tsconfig.json` (upstream), `tsconfig.project.json` (scripts, plugins, worker
tests), `worker/tsconfig.json` (Worker runtime, tests excluded).

Turning it on immediately found a dangling `else` in `collectTags` that had
silently discarded the comma-separated `tags:` string form.

### Vault notes start at `###`, and that fails WCAG

Obsidian treats the filename as a note's title, so bodies commonly open with
`###` rather than `##`. Rendered under the page `<h1>` that skips a level and
fails `heading-order`. `normaliseArticleHeadings` in `finalize` shifts an
article's headings so its shallowest becomes `<h2>`, preserving relative
structure.

It only showed up once real vault notes were published — the hand-written seed
notes had no headings at all. Worth remembering when a check looks green on
sample content.

### Turnstile verification needs three checks, not one

`success: true` only says a challenge was solved somewhere, by someone, for some
widget. Production also requires `action === "comment"` (or a token from any
other widget on the site can be replayed here) and a `hostname` we actually
serve (or someone embeds our sitekey on their own page and farms tokens).

The hostname list is NOT hardcoded to mandulaj.hu. It defaults to the configured
site plus the host serving the request, so verification works on *.workers.dev
during bootstrap and on the custom domain afterwards without a code change.
`TURNSTILE_HOSTNAMES` pins it once DNS is live.

**The test keys cannot exercise those checks.** Cloudflare's always-pass secret
returns `success` for ANY token — including "garbage" — with
`hostname: "example.com"` and no `action`. The code accepts it only via
Cloudflare's own `metadata.result_with_testing_key` marker, and logs loudly when
it does, because a production Worker holding a test secret would accept
anything. Use `2x0000000000000000000000000000000AA` to exercise the rejection
path locally; the unit tests cover action/hostname with stubbed responses.

### Changing `database_id` resets your LOCAL D1

Local D1 state is keyed by the id in `wrangler.jsonc`. Replacing the placeholder
with the real database id gives you a fresh empty local database and
`no such table: comments`. Re-run `npm run db:migrate:local`.

### Never let Prettier touch `content/`

It is generated by sync and **hash-verified** by `scripts/audit.ts`.
Reformatting it breaks the content audit. It is in `.prettierignore`; keep it
there.

### Cross-device deploys require a Git push, not merely Obsidian Sync

GitHub Actions cannot read Obsidian Sync. `deploy/vault-publish.yml` runs after
Markdown is committed and pushed to the private vault repo. It must watch all
Markdown paths because the publish toggle may live anywhere; sync then stops
private-only changes before build and deploy. The Action records both the vault
source commit and the site commit, and writes only generated public paths back
after deployment. That site commit is required as the comparison baseline for
the next run; without it, every later sync would compare against stale content.

### `npm run build` does not sync

Only `npm run sync` reads the vault. Build rebuilds whatever `content/` already
holds, so marking a note in Obsidian and running build changes nothing — with no
error, because from the build's point of view nothing is wrong.

This is correct (CI has no vault) but it is a genuine footgun. Mitigations:
`preview` syncs first, `publish` syncs first, and the content audit warns when
the vault holds `publish: true` notes that are not in the build.

### Don't name a script `postbuild`

npm treats it as an implicit lifecycle hook for `build` and runs it twice. It's
called `finalize`.

## Design: Kassák

Hungarian constructivist print, after Kassák Lajos and the MA circle. Chosen
over the two obvious alternatives (cream/serif/terracotta; near-black with one
acid accent) because those are where this genre defaults to regardless of subject.

Rules, if you're extending it:

- **One accent per page**, in exactly three places: the ID block, the title
  register mark, and links. Nowhere else.
- **Structure is drawn, not shaded** — solid blocks and rules. No shadows, no
  gradients, no border radius.
- **One transition** (120ms on link underline colour). Nothing else moves.
- Reading measure is `--measure: 34rem` (~68 characters). This is the most
  important rule in the stylesheet.

### Per-page accents are deterministic, balanced, and sticky

Four accents, each solved to clear WCAG AA (4.5:1) against **its own mode's**
background with hue held constant. The raw comp colours did not: ochre was
2.56:1 in light mode, ultramarine and oxblood ~2:1 in dark.

| accent      | light     | dark      |
| ----------- | --------- | --------- |
| ultramarine | `#1F3FA8` | `#5777E0` |
| ochre       | `#91630D` | `#C98A12` |
| verdigris   | `#3F6B5F` | `#51897A` |
| oxblood     | `#7A2540` | `#CC557B` |

Assignment order (`assignAccent` in `sync.ts`):

1. `accent:` in frontmatter — an explicit pin always wins.
2. Whatever the note had last time, read from the old manifest.
3. The least-used accent, ties broken by slug hash.

(3) keeps the four colours evenly spread even at five pages, where a plain
hash-mod clumps badly. (2) is what stops publishing a new note from reshuffling
the colours of everything already published. **Never replace this with
`Math.random()` or with rank-based round-robin** — the first flickers between
builds, the second reshuffles the archive.

The result is emitted as static CSS keyed on `body[data-slug]`, which Quartz
already renders. No JavaScript, no flash of the wrong colour, and SPA
navigation reapplies it for free because micromorph swaps the attribute.

### The note ID is derived, not real

The `0142`-style ID is a hash of the slug, **not** a Luhmann address — it
encodes no ordering or lineage. It exists because the design needs a
fixed-width identifier as its one bold element. `zk:` in frontmatter pins a
real one. Don't document it as though it means something.

### The header is CSS over Quartz's own markup

`.page-header > .popover-hint` is made a grid, and its `::before` / `::after`
supply the ID block and the register mark. No Quartz component is replaced,
which is why `quartz/` stays untouched. `content-meta` already provides both
reading time and the git-derived date — neither needed building.

## Obsidian publishing: Shell commands, not Quartz Syncer

Quartz Syncer writes vault → `content/` on GitHub directly, bypassing
`scripts/sync.ts` and therefore default-deny frontmatter, attachment tracing,
and link flattening. The output audit still blocks unpublished notes, but
bypassing the artifact constructor defeats the stronger privacy boundary.

`scripts/publish-from-obsidian.sh` + the Shell commands plugin gives the same
one-button experience _through_ the real pipeline. It resolves PATH explicitly
because Obsidian runs commands with a minimal environment and no Homebrew or
nvm on PATH.

Publishing stays manual on purpose: `publish: true` marks a note eligible, the
button is the decision to ship. Don't wire it to a file-save event.

## Performance work

Lighthouse desktop is 100/100/100/100. Things that got it there, all of which
are easy to regress:

- **Latex plugin disabled.** It injected KaTeX CSS + JS from cdn.jsdelivr.net
  into every page regardless of content: ~265ms render-blocking plus a
  third-party connection. Re-enable only if notes actually use math.
- **cdnjs preconnect stripped** in `finalize`. obsidian-flavored-markdown emits
  it for mermaid; nothing is ever fetched from that host, so it cost a TCP+TLS
  handshake for no payload.
- **CSS bundled.** Quartz emits one stylesheet per component — 22 separate
  render-blocking requests. `bundleCss()` concatenates them in head order
  (cascade preserved) into one content-hashed file.
- **Opacity overrides.** Quartz dims explorer and footer links with
  `opacity: 0.7–0.8`, which pushed passing colours under AA (sidebar 3.95:1,
  footer 2.80:1 in dark). Contrast is controlled by the tokens, not by alpha.
- **Heading order.** Sidebar plugins emit bare `<h3>` after the article `<h1>`.
  `finalize` promotes them to `<h2>`; article headings carry an `id` so they
  are untouched.

### Known, unfixed

- **`aria-expanded` on the explorer container** (a bare `<div>`) is invalid
  ARIA. `finalize` strips it from the server-rendered DOM, but the explorer's
  own client script re-applies it when the tree is collapsed — which is the
  default on mobile. Mobile a11y is 93 because of this one issue. The real fix
  is upstream: the attribute belongs on the disclosure button. Setting the
  explorer to `display: desktop-only` would also clear it.
- **The graph loader is intentionally wrapped.** `lazy-graph` keeps D3 and
  PixiJS out of an ordinary mobile visit and exposes a **Load graph** button
  below Backlinks. Its build deliberately fails if the pinned upstream loader
  changes; inspect and update the wrapper rather than weakening that guard.

## Why Cloudflare, not Vercel

The site moved off Vercel once likes/comments entered the picture. One Worker
serves the static site _and_ `/api/*`, so there is no CORS, no second origin,
and no second dashboard. Static asset requests are **free and unlimited** and
do not count against the 100k/day Workers limit — with
`run_worker_first: ["/api/*"]`, page views cost zero invocations and the whole
free budget belongs to the API.

The deciding constraint was that "Vercel now, Cloudflare later" meant doing the
DNS cutover twice.

**KV was rejected for likes**: the free tier allows 1,000 writes/day and one
write per second per key, and it is eventually consistent, so concurrent likes
silently overwrite each other. D1 is SQLite with serialised writes, so
`count = count + 1` is atomic. Durable Objects would also work and have
identical free limits, but a single DO caps near 1K req/s and adds
per-entity complexity this traffic does not need. DO is the documented upgrade
path, not the starting point.

## Deploys

`sync` needs the vault, and the vault only exists on the owner's devices — so
CI can never do the full pipeline from scratch. Two paths, same pipeline:

- **Mac**: `npm run publish` → sync → audit → build → `wrangler deploy`. Git is
  no longer the deploy trigger; it is history. The commit happens AFTER a
  successful deploy so the repo never records a publish that did not ship.
- **Mobile**: `obsidian-git` pushes the private vault repo → a GitHub Action
  there checks out both repos and runs the same commands. The workflow lives in
  the _vault_ repo so the Cloudflare token never sits in this public one.

## CSS layers — the trap that will bite again

Quartz emits plugin component CSS inside a `@layer`. `quartz-custom/theme/custom.scss`
is **unlayered**, and unlayered rules beat layered ones _regardless of
specificity_.

This silently painted the header label's text the same colour as its own
background: the generic `a { color: var(--accent) }` in custom.scss overrode the
component's own `.nh-label { color: var(--light) }`.

**Rule: if a selector in custom.scss also matches something a component styles,
the component will lose. Settle it in custom.scss.**

## Structure

```
quartz/            upstream, NEVER edited (custom.scss is a symlink out)
quartz.config.yaml plugin + theme config
quartz.ts          TS overrides — env-driven analytics only
quartz-custom/
  theme/           SCSS + generated accent stylesheet
  og/card.ts       satori OG card
  pages/           repo-owned pages (home, projects) — site furniture, not notes
  plugins/         local Quartz plugins (pagefind-search, webmentions, projects)
  data/            build-time fetched webmentions
scripts/           sync · audit · og · fonts · finalize · publish · webmentions
content/           GENERATED — never edit by hand, the audit hashes it
worker/index.ts    the API; /api/* invokes it, everything else is a static asset
```

## Invariants

Things that will quietly break the guarantee if changed without care:

- `content/` is **generated**. The audit hashes it. Editing it by hand fails the build.
- `isPublished()` accepts boolean `true` or text `"true"` for publish. A draft flag must be absent, null, boolean `false`, or text `"false"`; any other value blocks publishing.
- The output audit must never need the vault — CI doesn't have one.
- Every gate runs before `git push` in `scripts/publish.ts`. Don't reorder.
- Analytics and webmentions must stay optional. An unset env var is a
  supported state, not an error.
