---
description: "Things I have built, with what I learned from each."
publish: true
title: Projects
slug: projects
tags: []
---

Scaffolding for the portfolio section. To add a project, create a note in the vault under `Projects/` with this frontmatter:

```yaml
---
publish: true
type: project
year: 2026
stack: [TypeScript, NestJS, AWS]
link: https://github.com/joealmond/example
description: One sentence on what it does.
---
```

The note body is the write-up: what the problem was, what you chose, what you'd do differently. Once `publish: true` is set, `npm run sync` picks it up and it appears here.

> [!note]
> The listing component that renders these automatically lands with the feature
> layer. Until then this page is the placeholder it looks like.
