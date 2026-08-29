# Private comment mirror in Obsidian

Status: deferred design. This is not implemented yet.

## Goal

Create private companion notes that make public discussion visible beside the
corresponding article in Obsidian without turning the vault into another source
of truth.

```text
Public Comments/
  about.md
  algorithms.md
```

Each companion note links to its article:

```yaml
---
type: public-comments
post: "[[About me]]"
slug: about
visible: 0
hidden: 2
last_synced: 2026-08-29
publish: false
---
```

The wikilink gives the article an Obsidian backlink without changing the
article itself. `publish: false` is mandatory. Cloudflare D1 remains
authoritative; the companion note is a private, read-only mirror.

## Data boundary

The mirror must exclude:

- email addresses;
- author edit or deletion tokens;
- moderation capability tokens;
- visitor IDs, signed visitor cookies, IP-derived keys, and rate-limit data;
- credentials or Telegram configuration.

Only the public-safe fields needed to recognize a discussion should cross the
boundary: stable comment ID, public display name, body, timestamps, visibility,
owner/reply relationship, article slug, and aggregate counts.

## Content safety

Comment bodies are untrusted plain text. The public engagement client inserts
them with `textContent`; the mirror must preserve the same safety property. See
the [engagement client](../../quartz-custom/plugins/engagement/src/index.tsx).

Before writing Markdown, escape or neutralize syntax that could be interpreted
as structure, including frontmatter delimiters, fenced code blocks, HTML,
wikilinks, embeds, headings, block IDs, and callouts. A comment must not be able
to create links, properties, backlinks, embeds, or executable HTML merely by
containing Markdown-looking text. Never render a comment body as HTML.

## Recommended one-way design

1. A local sync command reads D1 through a narrowly scoped, authenticated export
   endpoint or Wrangler query.
2. It validates the response and discards all non-allowlisted fields.
3. It groups comments by canonical article slug and writes one companion note
   per article.
4. Generated sections are replaced atomically while a clearly separated owner
   annotation section is preserved.
5. The command records stable comment IDs and a sync cursor so repeated runs are
   idempotent.
6. Missing or renamed articles are reported as orphans instead of silently
   deleting their companion notes.

Required tests include safe escaping, field exclusion, incremental refresh,
hidden/deleted comment handling, orphan detection, stable ordering, annotation
preservation, and prevention of accidental publication.

## Effort estimate

| Option                           | Effort     | Value                             |
| -------------------------------- | ---------- | --------------------------------- |
| Manual D1-to-Markdown snapshot   | 2–4 hours  | Occasional archive                |
| Reliable one-way Obsidian mirror | 1–2 days   | Recommended eventual option       |
| Add an Obsidian Base/dashboard   | +2–4 hours | Useful after comment volume grows |
| Two-way reply/hide from Obsidian | 3–5 days   | Not worth it currently            |

A reliable one-way mirror includes stable comment IDs, incremental refresh,
orphan detection, safe escaping, exclusion of private fields, tests, and
preservation of owner annotations.

## Deliberate non-goals

- Do not reply to, hide, delete, or moderate comments from Obsidian. Telegram's
  private moderation links remain the control surface.
- Do not deploy or rebuild the public site because the mirror changed.
- Do not treat Git history or the vault as a comment backup containing private
  capabilities.
- Do not implement this until the read-only archive is worth its operational
  cost.
