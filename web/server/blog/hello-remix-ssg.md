---
title: Hello, remix-ssg
date: "2026-07-21"
summary: How this site is rendered to static HTML at build time.
---

This article is a Markdown file in `server/blog/`. Its metadata comes from the
YAML frontmatter above; the body is rendered to HTML by
[`@kuboon/md`](https://jsr.io/@kuboon/md) and dropped into the shared layout.

## Rendered on the server

The page was produced by a handler this repository writes — `router.tsx` — and
written to disk as static HTML by
[`@remix-kbn/ssg`](https://jsr.io/@remix-kbn/ssg). No client-side JavaScript was
required, and none was shipped: count the `<script>` tags on this page.

## One handler, two jobs

`deno serve router.tsx` runs that handler as the dev server. The build drives
the very same object with `fetch()`, writes each response to disk, and follows
the links it finds to discover the rest of the site — including the `import`
statements inside JavaScript, which is how a code-split bundle's shared chunks
are reached.

So what you see locally is what gets generated, and moving this site to a live
server would be a change of deploy target rather than of code.

## Code, tables, and more

GitHub-flavored Markdown works out of the box, including syntax-highlighted
code:

```ts
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

| Feature   | Supported |
| --------- | :-------: |
| Tables    |     ✓     |
| Task list |     ✓     |
