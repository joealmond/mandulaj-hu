# mandulaj.hu

Personal site built from a private Obsidian vault with
[Quartz v5](https://github.com/jackyzha0/quartz) and deployed as a Cloudflare
Worker. The public site is [mandulaj.hu](https://mandulaj.hu).

The vault is the source of truth. Only notes explicitly marked `publish: true`
are copied into this public repository.

## Everyday use

| Command             | Purpose                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`       | Sync published notes and start the writing preview on port 8080.                     |
| `npm run preview`   | Build and serve through the local Worker on port 8799, including likes and comments. |
| `npm run publish`   | Sync, audit, build, show the deploy plan, deploy, and commit generated artifacts.    |
| `npm run audit:all` | Check both copied source and generated output for private material.                  |
| `npm test`          | Run the Node and Worker test suites.                                                 |

From Obsidian, use **Toggle publish** for the current note and **Publish site**
from the command palette. Do not hand-copy private vault notes into `content/`.

## Mobile publishing

Keep Git disabled in Obsidian mobile. The supported path is:

```text
phone edit → Obsidian Sync → Mac vault → desktop Obsidian Git → GitHub Actions
```

The Mac is the Git bridge because GitHub cannot read Obsidian Sync. If the Mac
is asleep, the edit remains safely in Obsidian Sync and publishes after the Mac
and desktop Obsidian reopen. Losing the Mac does not lose the notes: restore the
vault through Obsidian Sync, clone the private vault repository, and reconnect
the desktop automation.

## Important boundaries

- `content/` contains only sanitized, public copies; Quartz never reads the
  private vault directly.
- A bare `npm run build` does not sync the vault. Use `dev`, `preview`, or
  `publish` when vault changes must be included.
- Comments and likes live in Cloudflare D1, not Git. Comment text is untrusted
  plain text, and private tokens or visitor identifiers must never enter notes.
- Secrets belong in local environment files, GitHub secrets, or Cloudflare
  secrets—never in tracked files.
- Webmention.io and Bridgy integration is deliberately deferred.

## Documentation

Project documentation lives in [`docs/project/`](docs/project/index.md):

- [Operations and setup](docs/project/operations.md)
- [Architecture decisions](docs/project/architecture-decisions.md)
- [Maintenance gotchas](docs/project/maintenance-gotchas.md)
- [Open work](docs/project/todo.md)
- [Private comment-mirror design](docs/project/comment-mirror.md)

The other files under `docs/` are the upstream Quartz documentation.
