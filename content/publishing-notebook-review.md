---
description: What is checked and removed before an Obsidian note can become a public page.
series: Publishing this notebook
seriesOrder: 2
publish: true
title: Reviewing the public boundary
slug: publishing-notebook-review
tags: []
accent: ultramarine
---

Publishing is a transformation rather than a copy of the vault. The build selects only notes marked `publish: true` that are not drafts, sanitizes their frontmatter, traces only the attachments they actually use, and removes Obsidian-only footer metadata.

Links deserve special care. A link to an unpublished note cannot become a working public link. The build flattens it to ordinary text and reports the change for review, so a private page is not accidentally exposed through navigation. The visible link text remains, so I still need to check whether that text reveals something private.

Before deployment, automated audits check that every generated note passed the publication gate and that no unexpected property or attachment crossed it. The review is still a human decision; the checks make that decision easier to verify.
