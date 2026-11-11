import { css, type Handle } from "@remix-run/component";

import { routes } from "../routes.ts";
import { cardStyle } from "../theme.ts";

export const title = "Remix3 on Deno Template";
export const description =
  "Remix v3 + Deno reference app with a DPoP session middleware. Served live on Deno Deploy and statically on GitHub Pages.";

/** The shell places the sign-in island, so every page boots the runtime. */
export const hydrate = true;

export default function Home(_handle: Handle) {
  return () => (
    <>
      <h1>Remix3 on Deno Template</h1>
      <p>Deno + Remix v3 (fetch-router) リファレンス実装。</p>
      <p>
        デモ:{" "}
        <a href="https://kuboon.github.io/deno-remix-tmpl/">
          GitHub Pages (静的版)
        </a>
        {" / "}
        <a href="https://deno-remix-tmpl.kuboon.workers.dev/">
          Cloudflare Workers (サーバー版)
        </a>
      </p>

      <section mix={cardStyle}>
        <h2>構成</h2>
        <ul mix={listStyle}>
          <li>
            <code>packages/remix-dpop-session-middleware/</code>{" "}
            — DPoP セッション middleware (Remix v3 fetch-router)
          </li>
          <li>
            <code>packages/session-storage-kv/</code>{" "}
            — Remix v3 SessionStorage を KvRepo で実装
          </li>
          <li>
            <code>web/</code> — この Web アプリ。<code>client/</code>{" "}
            がブラウザへ渡るもの全て、<code>server/</code> がルーターと API
          </li>
        </ul>
      </section>

      <section mix={cardStyle}>
        <h2>デプロイ</h2>
        <p>
          同じ <code>web/server/router.tsx</code>{" "}
          から静的サイトを作り、2 通りに配信します。
        </p>
        <ul mix={listStyle}>
          <li>
            <strong>Cloudflare Workers</strong>{" "}
            — 静的ビルドを Workers の static assets として配信し、<code>
              /api/*
            </code>{" "}
            だけを Worker (<code>web/server/worker.ts</code>) が答える。
          </li>
          <li>
            <strong>GitHub Pages</strong>{" "}
            — ビルドが同じルーターをクロールして 静的 HTML にする。<code>
              /api/*
            </code>{" "}
            は静的化しない。
          </li>
        </ul>
      </section>

      <section mix={cardStyle}>
        <h2>API エンドポイント (Cloudflare Workers のみ)</h2>
        <ul mix={listStyle}>
          <li>
            <code>GET {routes.api.protected.get.href()}</code>{" "}
            — DPoP proof 必須。セッションデータを返す
          </li>
          <li>
            <code>POST {routes.api.protected.post.href()}</code>{" "}
            — DPoP proof 必須。リクエスト body をセッションにマージ
          </li>
          <li>
            <code>POST {routes.api.notify.href()}</code>{" "}
            — サーバー起点のプッシュ通知 (id.kbn.one 経由)
          </li>
          <li>
            <code>GET {routes.api.turso.href()}</code> — Turso (libSQL) +{" "}
            <code>@remix-run/data-table</code> のサンプル
          </li>
          <li>
            <code>GET {routes.jwks.href()}</code> — RP の公開 JWKS
          </li>
        </ul>
      </section>

      <p>
        <a href={routes.hydration.href()}>Hydration のサンプル →</a>{" "}
        <a href={routes.my.href()}>マイページ →</a>
      </p>
    </>
  );
}

const listStyle = css({
  paddingLeft: "1.1rem",
  "& li": { marginBlock: "0.4rem" },
});
