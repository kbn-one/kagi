/**
 * One article.
 *
 * The body arrives already rendered, from `server/blog/` — this places it and dresses it with
 * `proseStyle`, which is the one mixin that reaches into markup it did not write.
 *
 * It is also the only screen on this site that hydrates without being a demo of hydration: the
 * share row under the body is an island, so an article ships the client runtime and that one
 * entrypoint. The blog listing next door is the page to look at for what a screen with no island
 * ships, which is nothing.
 */

import { css, type Handle, type RemixNode } from "@remix-run/component";

import { ShareRow } from "../../islands/share.tsx";
import { routes } from "../../routes.ts";
import { metaStyle, proseStyle } from "../../theme.ts";

export interface ArticleProps {
  /** What the page shows of the article itself — its front-matter, as far as this needs it. */
  article: { title: string; date: string };
  /** The Markdown body, already a node tree. */
  body: RemixNode;
}

/** The share row under the body is an island, so an article boots the runtime. */
export const hydrate = true;

/**
 * @param handle The article's front-matter, and its rendered body
 * @returns The article page
 */
export default function BlogArticle(handle: Handle<ArticleProps>) {
  return () => {
    const { article, body } = handle.props;

    return (
      <article mix={proseStyle}>
        <h1>{article.title}</h1>
        {article.date
          ? (
            <time mix={metaStyle} datetime={article.date}>
              {article.date}
            </time>
          )
          : null}
        {body}
        <div mix={footerRowStyle}>
          <a href={routes.blog.index.href()}>← All posts</a>
          <ShareRow label="Share this post" />
        </div>
      </article>
    );
  };
}

// --- styles -----------------------------------------------------------------

/** The line under the body: back to the listing on one side, the share row on the other. */
const footerRowStyle = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "1rem",
  marginTop: "2.5rem",
});
