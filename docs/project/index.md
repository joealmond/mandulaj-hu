# Project documentation

Documentation specific to `mandulaj.hu` lives in this directory. The other
documents directly under `docs/` belong to upstream Quartz and are kept
separate so framework updates remain understandable.

| Document                                                | Purpose                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Operations guide](operations.md)                       | Full setup, publishing, deployment, engagement, troubleshooting, and maintenance instructions. |
| [Architecture decisions](architecture-decisions.md)     | Why the system is shaped this way and which parts are custom.                                  |
| [Maintenance gotchas](maintenance-gotchas.md)           | Subtle constraints and failure modes that should not be rediscovered.                          |
| [Project TODO](todo.md)                                 | Completed work, open work, and deliberately deferred integrations.                             |
| [Private comment mirror](comment-mirror.md)             | Deferred design for a sanitized, one-way D1-to-Obsidian mirror.                                |
| [Legacy API note](api.md)                               | Explains why API routes live in `worker/`, not a top-level `api/` folder.                      |
| [Upstream code of conduct](upstream-code-of-conduct.md) | Quartz community document retained from upstream for reference.                                |

Start with the concise [repository README](../../README.md), then open the
operations guide when performing setup or maintenance.
