# Architecture Decisions

Why this site is built the way it is, what lives where, and which parts are
stock Quartz versus written for this project.

Companion documents: [README.md](README.md) is how to _use_ it,
[CLAUDE.md](CLAUDE.md) is the operational gotchas that will bite during
maintenance, [TODO.md](TODO.md) is what is still open. This file is the _why_.

---

## Stack

| Layer           | Choice                                                   | Notes                                 |
| --------------- | -------------------------------------------------------- | ------------------------------------- |
| Source of truth | Obsidian vault at `~/Documents/Base`                     | ~1900 notes, PARA, mostly private     |
| Generator       | Quartz v5                                                | YAML config, plugins as npm packages  |
| Host            | Cloudflare Workers (static assets + `/api/*`)            | one Worker serves both                |
| Database        | Cloudflare D1 (SQLite)                                   | likes and comments                    |
| Search          | Pagefind                                                 | chunked static index with tag facets  |
| Spam            | Cloudflare Turnstile                                     | lazy-loaded, only on form interaction |
| Notifications   | Telegram Bot API                                         | called directly from the Worker       |
| Mentions        | webmention.io + Bridgy                                   | fetched at build time                 |
| Deploy          | `wrangler deploy` from desktop; GitHub Actions elsewhere | same sync and audits in both paths    |

---

## ADR-001 — Quartz never sees the vault

**Context.** Quartz's own documentation says filter plugins only filter
markdown: _"Regardless of the filter plugin used, all non-markdown files will be
emitted and available publically in the final build."_ Pointing Quartz at the
vault would publish every image and PDF in it, including attachments belonging
to private notes.

**Decision.** `scripts/sync.ts` copies published notes into `content/`, and
Quartz builds from `content/`. Attachments are copied only when a published note
references them. The vault is never on the build path.

**Why it matters.** Publishing is fail-closed _by construction_, not by filter.
A note sync does not copy cannot be built, committed, or deployed — there is no
code path that reaches it. `explicit-publish` and the audits are the second and
third layers, not the only ones.

**Consequences.** `content/` is generated and must never be hand-edited (the
audit hashes it). The private vault GitHub Action can build from scratch because
it checks out both repositories; the public site repository alone cannot.

## ADR-002 — Explicit opt-in publishing (superseded by ADR-017)

**Original decision.** A note was published only if it was inside an
allowlisted vault folder and carried `publish: true`.

**Why.** Either alone is defensible. Together, a stray flag in `Journal/` or
`2 Areas/Health` is inert.

**On what counts as true.** `isPublished()` accepts the boolean `true` and the
string `"true"`, and nothing else — `yes`, `1` and `True` all fail closed. The
string form is allowed because Obsidian's Properties UI writes it when the
property's type is Text rather than Checkbox, and `explicit-publish` already
accepted both; rejecting it here only produced a silent dead end where a note
passed Quartz's filter but was never synced.

**Current decision.** ADR-017 removes the folder gate. A literal publish toggle
is the single author-facing decision, backed by default-deny metadata copying,
attachment tracing, a pre-deploy plan, and both audits.

## ADR-003 — The audit runs in two places for different reasons

- `npm run audit` (content) — before commit. Hashes every file against
  `.publish-manifest.json`, so hand-editing `content/` is caught.
- `npm run audit:out` (output) — after build. Deliberately needs **no vault
  access** so it can also run in CI. Every emitted page must trace to a
  published note; every media file must be a traced attachment.

Both exit non-zero and abort the build. Neither ever warns and continues. The
frontmatter boundary and other critical primitives have regression coverage;
TODO.md tracks the remaining end-to-end negative audit cases.

## ADR-004 — Cloudflare, not Vercel

**Context.** The site started on Vercel. Adding likes and comments meant adding
a Cloudflare Worker anyway.

**Decision.** Move hosting to Cloudflare Workers static assets.

**Why.** One Worker serves the static site _and_ `/api/*`, so there is no CORS,
no second origin, no second dashboard. Static asset requests are **free and
unlimited** and do not count against the 100k/day Workers limit; with
`run_worker_first: ["/api/*"]`, page views cost zero invocations and the entire
free budget belongs to the API.

The deciding argument was not feature comparison — it was that "Vercel now,
Cloudflare later" meant performing the risky DNS cutover twice.

## ADR-005 — D1 for likes, not KV, and not Durable Objects

**Rejected: Workers KV.** The free tier allows **1,000 writes/day** and one
write per second per key, and it is eventually consistent, so concurrent likes
silently overwrite each other. Most "add likes to your static site" tutorials
reach for KV; it is the wrong primitive for anything with write volume.

**Rejected for now: Durable Objects.** Correct instinct, wrong scale. DOs earn
their keep for strongly-consistent _per-entity_ state under contention. A single
DO caps near 1K req/s and adds complexity a personal blog does not need. Free
limits are identical to D1.

**Chosen: D1.** SQLite with serialised writes, so `count = count + 1` is atomic
— no lost updates. Relational shape suits comments (status, parent, timestamps).
Free tier: 5M rows read/day, 100k written/day, 5GB.

DO remains the documented upgrade path if write contention ever becomes real.

## ADR-006 — Comments live in D1, never in git

**Decision.** Likes and comments are fetched at runtime and are never part of
the build.

**Why.** An earlier plan had a like or comment trigger a rebuild so state would
be baked into the static HTML. That was rejected: it makes the endpoint a
denial-of-wallet vector (anonymous, scriptable, one build per click), and
auto-committing stranger text into a public repo puts spam and abuse into git
history permanently.

Keeping them out of the build means deletion is instant, nothing enters git, and
**the publish audit is untouched by anything readers write** — the fail-closed
guarantee in ADR-001 stays intact.

**Consequence.** Comments require JavaScript. If the API is unreachable the
whole section stays hidden, because a dead comment box is worse than none.

## ADR-007 — Post-moderation, not pre-moderation

**Decision.** Comments appear immediately; Telegram notifies; you reply or
delete afterwards.

**Why.** Pre-moderation makes the author a bottleneck and kills conversation on
a low-traffic site. Defences are Turnstile, a per-visitor rate limit, and a link
cap. Commenters need no account: their name is remembered in their own browser,
and a locally-held token lets them delete their own comment.

**Risk accepted.** Something abusive can be publicly visible until you see the
Telegram message. Mitigated by deletion taking effect immediately (ADR-006).

## ADR-008 — Categories come from MOC pages, not frontmatter tags

**Context.** The vault already has 40 MOC pages. `#moc` is an **inline tag on
line one**, the page title is the topic, and membership is expressed by the MOC
page linking _out_ to its members.

**Decision.** Membership runs **MOC → note**, computed across the whole vault at
sync time. A category exists only if its MOC page is **itself published**.

**Why the published-only rule.** MOCs live in `2 Areas/*` — `Career`, `Health`,
`Family growth`. Using an unpublished MOC's title as a public category label
would publish the _title_ of a private page, which is exactly the leak class
ADR-001 exists to prevent. Publishing a MOC is now the deliberate act that
creates a public category.

**Consequence.** With no MOC published, there are no categories — correct, and
initially surprising.

## ADR-009 — Colour means category

**Decision.** Six accents. Every note under one MOC shares that MOC's accent.
Notes in no category are **neutral**.

**Why.** Colour was originally a hash of the slug: distinct, but meaningless.
Deriving it from the category makes a topic recognisable before a word is read,
and makes absence of colour mean "unfiled" rather than "some other category".

**Accepted limits.** With six accents and more categories, two categories will
eventually share a colour — it is a hint, not a unique key. Every value is
solved to clear WCAG AA against its own mode's background with hue held; the
original comp colours did not (ochre measured 2.56:1 in light mode).

## ADR-010 — Deploy from the machine that has the vault

**Decision.** `npm run publish` runs sync → audit → build → `wrangler deploy`.
Git is history and rollback, not the deploy trigger, and the commit happens
_after_ a successful deploy.

**Why.** `sync` needs the vault (ADR-001), so CI can only ever rebuild the
`content/` you already synced and committed — identical output, slower.

**Mobile is the exception.** Obsidian mobile cannot run shell commands, node, or
wrangler, so a mobile trigger must be server-side. `obsidian-git` already pushes
the vault to a private repo, so a workflow _there_ runs the same pipeline. It
lives in the vault repo so the Cloudflare token never sits in the public one.

## ADR-011 — All customisation outside `quartz/`

**Decision.** Nothing in `quartz/` is edited. Custom components are local plugin
packages under `quartz-custom/plugins/`, referenced by path in
`quartz.config.yaml`. `quartz/styles/custom.scss` is a **symlink** out to
`quartz-custom/theme/custom.scss`.

**Why.** The repo shares git history with `jackyzha0/quartz`, so
`git merge upstream/v5` is a normal merge. Conflicts stay limited to
`package.json` and `quartz.config.yaml`.

## ADR-012 — Caps are a treatment, never the data

**Decision.** The H1 is uppercased with `text-transform`. The title string
itself stays sentence case everywhere: sidebar, breadcrumb, TOC, backlinks,
`og:title`, RSS.

**Why.** One title, one display rule. The alternative — writing titles in caps —
would leak the treatment into the feed, the OG card and every listing.

**Conditions.** The breadcrumb is _not_ uppercased: caps there competed with the
H1 for the same reason the H1 wins. And titles over 60 characters drop a type
step (`.is-long`, applied in `postbuild.ts`, because CSS cannot count
characters) — all-caps at display size is a signature at three lines and a wall
at five.

## ADR-013 — Patch the explorer's ARIA rather than drop the tree

**Context.** Mobile accessibility sat at 93 because Quartz's explorer puts
`aria-expanded` on a bare `<div>`, which is not a valid ARIA combination.
Setting the explorer to `desktop-only` would have cleared it.

**Decision.** Patch it. Navigation is worth more than seven points.
`aria-expanded` is mirrored onto the real `<button class="explorer-toggle">`
that already carries `aria-controls`, and a `MutationObserver` keeps the
container clean when the explorer's own script writes to it again.

**Result.** Mobile accessibility is 100 and the tree survives on phones. The
patch is small and belongs upstream; delete it if a fix lands.

## ADR-014 — The graph is removed on mobile, not hidden

**Decision.** On viewports under 800px the graph container is removed from the
DOM before the graph's script initialises.

**Why `desktop-only` was not enough.** It is presentational. Measured on a phone
viewport, the hidden graph still pulled and executed **pixi.js (637ms) and d3
(95ms) from a CDN** — for a component that is invisible and, at ~4px nodes with
no 44px touch target, unusable. Hiding it recovered nothing.

**Result.** pixi bootup 637ms → 153ms, mobile TBT 170ms → 100ms. The residual
153ms is pixi's module import, which happens whether or not a container exists;
removing it entirely would mean disabling the graph outright.

**Also worth recording:** the graph is the one component that reintroduces
third-party runtime requests. It does so via dynamic import, so it does not
appear in the built HTML and a grep for CDN hosts will not find it.

## ADR-015 — Search lives in the rail, not in a modal

**Context.** Search was a centred overlay with tag filter chips. It existed
mainly to have somewhere to put the chips — the chrome came first and content
was found to fill it. It dimmed the note you were reading, left the sidebar's
own search affordance visible behind the dim, and its empty state was six tags
above no results.

**Decision.** The sidebar field _is_ the search surface. Typing filters in place
and the Recent / Categories / Tags / Tree row is replaced by results; Esc
restores it. Nothing covers the page.

**Tags moved to their own pane.** They are navigation, not search, and the rail
already owns wayfinding. Once they had a home, the filter chips were unnecessary
and the search empty state needed nothing at all — an empty field is a fine
empty state. Tag _matches_ still appear in results, as a small group above title
matches.

**One chip vocabulary.** Tags on a note, tags in the rail, and tag matches in
search now share the same outline treatment. The filled accent chip in the page
header remains the only solid one.

**Mobile keeps a sheet**, because there is no rail to type into — the same
component, promoted to full screen by CSS. That is the only place a dialog earns
its keep.

**Two framework details this exposed**, both recorded in CLAUDE.md: a layout
`group` renders as `.flex-component`, not by its group name, and Quartz writes
`align-self: center` as an **inline** style on every group child — which no
stylesheet rule can beat, so the darkmode toggle centred itself against the full
height of the results and floated mid-rail.

## ADR-016 — Derive everything except the publish flag

**Context.** The vault has no frontmatter. Notes are tagged with inline
`#hashtags`, and roughly 1900 existing notes will never get a hand-written
description.

**Decision.** The only key an author writes is `publish: true`, and a hotkey
writes it. Everything else is derived at sync or build time: title from the
filename, description generated from the first ~150 characters, tags hoisted
from inline hashtags, dates from git, category from whichever published MOC
links to the note, colour from the category.

**Why not fall back to the title for descriptions.** It was the obvious answer
and it is worse than what Quartz already does — the description plugin cuts real
prose at a sentence boundary, whereas the title would just repeat the heading in
the feed and on every OG card.

**Tag hoisting matters more than it looks.** Inline tags left in the body are
prose to Quartz, so a `#moc #index` line at the top of a note led every
generated description with its own tag names. Hoisting them into frontmatter and
removing tag-only lines fixes the descriptions and satisfies "tag the way I
already tag". Sentences containing a tag are untouched, and code is stripped
before scanning so `#include` and `#fff` never become tags.

**Consequence.** `scripts/toggle-publish.ts` is deliberately conservative: it
writes `publish` and nothing else, preserves key order, and removes the
frontmatter block entirely if unpublishing leaves it empty.

## ADR-017 — Publishing is toggle-only

**Decision.** Folder location is not a publishing rule. `publish: true` is the
single author-facing opt-in, wherever the note lives.

**Why.** The owner wants to mark notes individually across the vault rather than
move them into publishing folders first.

**Safety tradeoff.** A stray valid toggle anywhere in the vault makes that
note eligible on the next publish. The compensating controls are easier to
reason about than a second, invisible location rule: source frontmatter is
default-deny; attachments must be referenced; private wikilinks are flattened;
the desktop command prints additions, changes, and removals before deploy; and
the independent audit blocks any unexpected generated property or artifact.

**Metadata boundary.** Only the documented public fields `description`, `type`,
`year`, `stack`, and `link` currently cross from source frontmatter unchanged.
Structural fields are normalized or derived. Properties such as client names,
workflow status, private URLs, aliases, and custom plugin data are discarded
even when the note body is deliberately published.

**Cross-device consequence.** A remote publish starts from a commit in the
private vault repository. After deployment, the Action commits only generated
public artifacts to the site repository. That commit is both the audit trail
and the baseline that makes a later private-only vault push a no-op. The
fine-grained cross-repository token is limited to that one site repo.

## ADR-018 — The published page renders what Obsidian renders

**Context.** Two mismatches made published notes look wrong in ways the author
could not predict from the editor.

**Line breaks.** Obsidian's `strictLineBreaks` is off by default, so a single
newline is a line break there; standard Markdown joins those lines into a
paragraph. A note listing one wikilink per line published as a run-on sentence.
`@quartz-community/hard-line-breaks` is enabled so the two agree.

_Cost:_ hard-wrapped prose now breaks at every wrap point. This vault does not
wrap, but the two repo-owned pages did and were unwrapped.

**Tags.** A hashtag counts only when its line contains nothing else. This was
measured rather than guessed: across the vault, 199 notes tag on a line of their
own, 3 do both, and 7 tag exclusively mid-prose — and all 7 are false positives
(`#Example`, `#User`, `#See`, `#Getting`). One note documenting GitHub Copilot
had filled the tag index with `#codebase`, `#selection` and `#terminalSelection`,
which are chat variables.

**Narrowing detection was not enough.** Quartz _merges_ tags found in the body
with frontmatter, so writing an authoritative list still lost. Prose hashtags
are therefore backslash-escaped in the published copy: they render identically
and are never parsed as tags. Tag-only lines, code spans and fences are
untouched.

**Principle.** Where Obsidian and CommonMark disagree, follow Obsidian — the
author writes in Obsidian and cannot be expected to hold two rendering models
in their head.

## ADR-019 — Ambiguous links resolve by proximity, not alphabetically

**Context.** Obsidian lets a wikilink name a file by basename alone. When more
than one file in the vault shares that basename, something has to choose.

**The bug.** Sync took the first match from the directory walk — alphabetical
order. A published note embedding `![[shot.png]]` therefore copied
`Private/img/shot.png` in preference to `Public/img/shot.png`, shipping a file
out of a private folder under a public note. It warned "Ambiguous reference"
without saying what it had picked.

**Decision.** Score candidates by how many leading path segments they share with
the linking note and prefer the nearest, breaking ties by shortest path. That is
what Obsidian does, so the site resolves the same file the editor previews. The
warning now names the file chosen.

**How it was found.** Not by review — by writing the integration test. The unit
tests all passed; only running a real sync over a vault containing two files
called `shot.png` exposed it. Worth remembering when judging how much a green
test suite proves.

---

## Where things are

```
quartz/                  upstream, NEVER edited (custom.scss is a symlink out)
quartz.config.yaml       plugin + theme config — the main dial
quartz.ts                TS overrides; only env-driven analytics lives here
wrangler.jsonc           Worker + static assets + D1 binding
worker/
  index.ts               /api routes: likes, comments
  lib.ts                 visitor hashing, rate limit, Turnstile, Telegram
migrations/               ordered D1 schema migrations
quartz-custom/
  theme/custom.scss      the Kassák theme
  theme/_accents.generated.scss   GENERATED per-page accent CSS
  og/card.ts             satori OG card (plain objects, no JSX — see CLAUDE.md)
  pages/                 repo-owned pages: home, projects, _headers
  plugins/               local Quartz plugins (see table below)
  data/webmentions.json  fetched at build time
scripts/
  publish.config.ts      THE publish policy: vault path, public metadata keys
  sync.ts                vault → content/, the only bridge
  audit.ts               fail-closed checks, content + output modes
  gen-accents.ts         accent + id stylesheet from the manifest
  og.ts                  renders OG cards with satori
  optimize-fonts.ts      TTF → WOFF2, rewrites absolute font URLs
  postbuild.ts           RSS filter, robots, feed + webmention links, CSS bundle,
                         heading order, Turnstile meta, _headers
  publish.ts             sync → audit → build → deploy → commit
  preview.sh             full-stack local preview
  publish-from-obsidian.sh   wrapper for the Shell commands plugin
deploy/vault-publish.yml GitHub Action — belongs in the VAULT repo
content/                 GENERATED — never edit, the audit hashes it
.publish-manifest.json   GENERATED — public slugs, hashes, attachments, accents
```

---

## Stock vs unusual

### Stock Quartz, used as intended

`created-modified-date` (git dates) · `syntax-highlighting` ·
`obsidian-flavored-markdown` · `github-flavored-markdown` · `table-of-contents` ·
`crawl-links` · `description` · `explicit-publish` · `remove-draft` ·
`content-index` (RSS + sitemap) · `alias-redirects` · `favicon` ·
`content-page` / `folder-page` / `tag-page` · `article-title` · `content-meta`
(reading time) · `page-title` · `darkmode` · `explorer` · `backlinks` · `graph` ·
`breadcrumbs` · `footer` · `spacer` · `quartz-fonts`

### Deliberately disabled

| Plugin                                                                                                                                                                | Why                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `latex`                                                                                                                                                               | Injected KaTeX from a CDN into **every** page regardless of content — ~265ms render-blocking plus a third-party connection |
| `search`                                                                                                                                                              | Replaced by Pagefind; it ships the whole site's text as one JSON                                                           |
| `comments`                                                                                                                                                            | Giscus is a third-party iframe; comments are self-hosted on D1 instead                                                     |
| `cname`                                                                                                                                                               | A GitHub Pages artifact                                                                                                    |
| `tag-list`                                                                                                                                                            | Tags are rendered by `note-header` with Pagefind filter attributes                                                         |
| `recent-notes`                                                                                                                                                        | Replaced by the `panel` plugin so it matches the theme                                                                     |
| `canvas-page`, `bases-page`, `citations`, `roam`, `ox-hugo`, `hard-line-breaks`, `encrypted-pages`, `unlisted-pages`, `stacked-pages`, `reader-mode`, `quartz-themes` | Unused                                                                                                                     |

> `note-properties` is enabled with `hidePropertiesView: true`. It looks like a
> display component but is **also the frontmatter parser**. Disabling it makes
> `explicit-publish` read `undefined` and silently filter out every note — the
> site builds green and completely empty.

### Written for this project

| Local plugin      | What it does                                                                   |
| ----------------- | ------------------------------------------------------------------------------ |
| `note-header`     | The accent block: category name, links to it; tags with `data-pagefind-filter` |
| `panel`           | Left rail: Recent / Categories / Tree, toggled by `body[data-panel]`           |
| `pagefind-search` | Search dialog with tag facet chips, keyboard nav                               |
| `engagement`      | Likes + comments UI, progressive disclosure, optimistic like                   |
| `webmentions`     | Displays mentions fetched at build time                                        |
| `projects`        | Portfolio listing on `/projects`                                               |

### Not standard practice, and why

- **Sync-then-build instead of pointing Quartz at the vault** — ADR-001.
- **A build that refuses to finish.** Two audits abort the build rather than
  warn. Publishing privately-authored notes is the one failure this project
  will not tolerate.
- **Per-page accent as generated static CSS** keyed on `body[data-slug]`, which
  Quartz already renders. No JavaScript, no flash of the wrong colour, and SPA
  navigation reapplies it for free.
- **OG cards rendered by our own script.** The og-image plugin's documented
  `imageStructure` override does not work: the setter fires with the correct key
  and the config loader never reads it back. The plugin stays enabled for its
  correct `<meta>` tags; `scripts/og.ts` overwrites the image bytes.
- **Fonts re-encoded after the build.** `quartz-fonts` fetches Google Fonts with
  no `User-Agent`, so Google serves legacy TTF — roughly double the bytes.
  810KB → 272KB. It also rewrites `@font-face` URLs from absolute
  (`https://mandulaj.hu/...`) to origin-relative, which is otherwise broken on
  localhost and on every preview deployment.
- **22 component stylesheets bundled into one.** Quartz emits one per component;
  each cost 150–300ms on throttled mobile.
- **HTML post-processing in `postbuild.ts`** for things no plugin covers: RSS
  filtering (tag pages were arriving as posts in the feed), `robots.txt`,
  feed and webmention `<link>` tags, heading order, and stripping a preconnect
  to a host nothing is ever fetched from.
- **`_headers` copied from `quartz-custom/pages/`** so cache policy is version
  controlled next to the site rather than inside generated output.

---

## Current state

**Working and verified locally:** the full publish pipeline with both audits;
the Kassák theme; MOC categories; the switchable rail; Pagefind
with tag facets; full-content RSS; sitemap and robots; OG cards; likes and
comments end to end against a real D1; webmention endpoints; the mobile publish
workflow (written, not yet run).

**Lighthouse desktop:** 100 / 100 / 100 / 100.
**Mobile:** 94 / 100 / 100 / 100, measured against an _uncompressed_ local
server — production will be better.

**Not yet done:** everything requiring your Cloudflare account, the DNS cutover,
and the open design questions. See [TODO.md](TODO.md).
