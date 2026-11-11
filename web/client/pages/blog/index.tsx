/**
 * The article listing.
 *
 * It is handed the articles rather than reading them: `server/blog/` owns the files, this owns the
 * screen — which is what lets it live here, in the half of the site that is never allowed to touch
 * a filesystem. What it renders still decides what the site contains, though: the crawl writes what
 * something links to, so an article missing from this list is an article missing from `dist/`.
 */

import { css, type Handle } from "@remix-run/component";

import { routes } from "../../routes.ts";
import { metaStyle } from "../../theme.ts";
import { color } from "../../tokens.ts";

/** What the listing needs of an article. The server reads more than this and passes it along. */
export interface ArticleSummary {
  /** The article's URL segment. */
  slug: string;
  title: string;
  date: string;
  summary: string;
}

export const title = "Blog — Remix3 on Deno Template";
export const description =
  "Articles authored in Markdown, rendered to static HTML.";

/** A list of links and nothing else — the one screen on this site that ships no JavaScript. */
export const hydrate = false;

/**
 * @param handle The articles, in the order they should be listed
 * @returns The listing
 */
export default function BlogIndex(
  handle: Handle<{ articles: readonly ArticleSummary[] }>,
) {
  return () => (
    <>
      <h1>Blog</h1>
      <ul mix={postListStyle}>
        {handle.props.articles.map((article) => (
          <li key={article.slug}>
            <a
              mix={postTitleStyle}
              href={routes.blog.show.href({ slug: article.slug })}
            >
              {article.title}
            </a>
            {article.date
              ? (
                <time mix={metaStyle} datetime={article.date}>
                  {article.date}
                </time>
              )
              : null}
            <p mix={summaryStyle}>{article.summary}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- styles -----------------------------------------------------------------

const postListStyle = css({
  listStyle: "none",
  padding: 0,
  "& li": {
    paddingBlock: "1rem",
    borderBottom: `1px solid ${color.border}`,
  },
});

const postTitleStyle = css({
  fontSize: "1.2rem",
  fontWeight: 600,
});

const summaryStyle = css({ marginBlock: "0.3rem 0" });
