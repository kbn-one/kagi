import { css, type Handle } from "@remix-run/component";

import { routes } from "../routes.ts";
import { cardStyle } from "../theme.ts";

export const title = "kagi";
export const description =
  "秘密トークンを承認者のスマホのブラウザー内に持ち、API コールを検閲してから実行する。";

/** The shell places the sign-in island, so every page boots the runtime. */
export const hydrate = true;

export default function Home(_handle: Handle) {
  return () => (
    <>
      <h1>kagi</h1>
      <p>
        秘密トークンを<strong>承認者のスマホのブラウザー内</strong>
        に持ち、API コールを検閲する。 リクエスト元（スクリプトや AI
        エージェント）は秘密を知らないまま、承認された API
        コールの結果だけを受け取る。
      </p>
      <p>
        <a href={routes.kagi.href()}>承認者の画面を開く</a>
      </p>

      <section mix={cardStyle}>
        <h2>流れ</h2>
        <ol mix={listStyle}>
          <li>
            承認者はスマホでこのサイトをホーム画面に追加し、
            <a href={routes.my.href()}>マイページ</a>{" "}
            でサインインして通知を登録する。
          </li>
          <li>
            <a href={routes.kagi.href()}>承認</a>{" "}
            で秘密を保存する。秘密は localStorage に、パスキー（WebAuthn
            PRF）で暗号化して置かれ、サーバーには送られない。
          </li>
          <li>
            同じ画面で端末を承認者として登録すると、リクエスト用の URL （<code>
              /api/sub/:id/req
            </code>）が発行される。
          </li>
          <li>
            リクエスト元が <code>POST /api/sub/:id/req</code> に、秘密を{" "}
            <code>[NAME]</code>{" "}
            で埋めたリクエストを送る。サーバーは承認者のスマホに push
            通知し、<code>transaction_id</code> を返す。
          </li>
          <li>
            承認者は内容（送信先ホスト・ヘッダー・ボディ）を見て、パスキーで承認する。
            ブラウザーが秘密を埋めて API を呼び、結果を手元に保持する。
          </li>
          <li>
            リクエスト元の <code>GET /api/sub/:id/res?transaction_id=…</code>
            {" "}
            に、サーバーが WebSocket
            越しにスマホから結果を取り寄せて返す（一度だけ）。
            結果に含まれる秘密の値は <code>[NAME]</code> に置き換えられる。
          </li>
        </ol>
      </section>

      <section mix={cardStyle}>
        <h2>リクエストの形</h2>
        <pre mix={preStyle}>{`POST /api/sub/:id/req
{
  "secrets": ["GH_SECRET"],
  "url": "https://api.github.com/user",
  "method": "GET",
  "headers": { "authorization": "Bearer [GH_SECRET]" },
  "body": {}
}
→ 202 { "transaction_id": "…", "status": "pending", "notified": true }

GET /api/sub/:id/res?transaction_id=…&wait=25
→ 200 { "status": "delivered", "response": { "status", "headers", "body" } }
→ 202 { "status": "pending" }   まだ決まっていない（再度呼ぶ）
→ 403 / 502 / 410               拒否 / 呼び出し失敗 / 期限切れ・受け渡し済み`}</pre>
        <p>
          API はブラウザーから呼ばれるので、呼び先が CORS
          でこのオリジンを許可している必要がある。
        </p>
      </section>
    </>
  );
}

const listStyle = css({ paddingInlineStart: "1.25rem", lineHeight: 1.7 });

const preStyle = css({
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  fontSize: "0.85rem",
});
