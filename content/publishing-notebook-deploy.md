---
description: How an approved Obsidian note travels through GitHub and Cloudflare to this site.
series: Publishing this notebook
seriesOrder: 3
publish: true
title: Publishing from the Mac
slug: publishing-notebook-deploy
tags: []
accent: aubergine
---

Obsidian Sync carries edits between my devices. On the Mac, the vault’s Git integration records those file changes in a private repository. A separate publishing workflow reads that private source, rebuilds the approved public content, and deploys the result to Cloudflare.

The public site repository contains generated public notes and the software that presents them, not the private vault. A failure in GitHub or Cloudflare may delay a deployment, but it does not change which notes are allowed to leave Obsidian.

This division also keeps mobile publishing practical. I can edit a note on my phone; when the Mac receives the synchronized change, the same reviewed path produces the public page.
