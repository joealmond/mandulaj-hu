# Arkstead author entry and separate drafts

User-approved September8,2026. The public site navigation now links to the private Arkstead Writing area. The link does not grant access: existing Tailscale membership and owner authorization still apply. No public login endpoint or new identity provider is introduced.

Cloud-authored drafts remain in Arkstead, not the Obsidian vault. A deliberate Publish action selects one immutable saved revision. The private Mac bridge can place its approved source under `quartz-custom/pages/arkstead/`; this is the existing repo-owned source boundary, not generated `content/`. Existing sync sanitization, default-deny frontmatter, slug-collision checks, audits, tests and build gates remain mandatory.

The bridge aborts if sync would change another published note. It invokes sync, verify and Wrangler deployment directly; it does not invoke the existing helper's Git push/webmention side effects. Successful publication requires a matching public artifact. Queued is not published; uncertain deployment outcomes require review before retrying.

Push to Obsidian is independent: it creates an inbox copy with `publish: false`, keyed by draft/revision ID, and never overwrites existing notes. No automatic bidirectional synchronization or vault-to-cloud listing is introduced. Local bridge configuration and source ownership maps remain protected outside public source.

Current implementation/evidence lives in the Arkstead project's `docs/homelab/WRITING-MONITORS.md`. Physical-device/editor compatibility and live publication of a real article must not be inferred from fixture tests. No fixture article is approved for public deployment.
