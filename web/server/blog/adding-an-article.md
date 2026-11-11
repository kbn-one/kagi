---
title: Adding an article
date: "2026-07-20"
summary: Drop a Markdown file next to this one — the crawl does the rest.
---

Articles are Markdown files in `server/blog/`. To add one, create a new `.md`
file there with `title`, `date`, and `summary` frontmatter, then write the body.

## How it shows up

`server/blog/mod.tsx` reads every `.md` file beside it, sorts them by date, and
the listing screen in `client/pages/blog/` links to each one at
`/blog/<filename>`. That listing is not a formality: the static build discovers
pages by following links, so being listed is what makes an article part of the
site. A file nothing links to is served by the dev server and never written to
`dist/`.

## Why the generator never sees Markdown

`server/blog/mod.tsx` is the whole of it: the frontmatter parser, the file
reads, and the Markdown renderer. The two screens it hands the results to are in
`client/pages/blog/`, where nothing may open a file. It belongs to this site,
not to `@remix-kbn/ssg` — which is what keeps `@kuboon/md` and the frontmatter
parser out of the generator, and what lets this site swap either without asking
anyone.

What the generator sees is a `Response`, the same as for every other page:
`router.tsx` maps the blog's routes to that module and never learns that
Markdown was involved. The listing places no islands, so it ships no JavaScript
at all; an article places one — its share row — and so loads the client runtime.

## Authoring tips

- The frontmatter `title` is used for the page `<title>` and the index list.
- Start the body at `##`; the layout renders the `title` as the page heading.
- Any raw HTML in the Markdown is stripped during sanitization.
