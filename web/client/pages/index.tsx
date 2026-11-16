import { css, type Handle } from "@remix-run/component";

import { SetupCta } from "../islands/setup_cta.tsx";
import { routes } from "../routes.ts";
import { cardStyle } from "../theme.ts";
import { color, radius } from "../tokens.ts";

export const title = "kagi";
export const description =
  "秘密トークンを承認者のスマホのブラウザー内に持ち、API コールを検閲してから実行する。";

/** The call to action reads the device, so the page boots the runtime. */
export const hydrate = true;

export default function Home(_handle: Handle) {
  return () => (
    <>
      <h1>kagi</h1>
      <p mix={leadStyle}>
        API のトークンを<strong>スマホの中</strong>
        に置いたまま、スクリプトや AI エージェントに API を使わせる。
        呼び出しは一件ずつスマホに届き、あなたが承認したものだけが実行される。
      </p>

      <section mix={[cardStyle, ctaStyle]}>
        <SetupCta />
      </section>

      <h2>仕組み</h2>
      <ul mix={rolesStyle}>
        <li>
          <strong>リクエスト元</strong>
          <span>
            スクリプトやエージェント。トークンを知らず、<code>[GH_TOKEN]</code>
            {" "}
            のような名前で書いたリクエストを kagi に送る。
          </span>
        </li>
        <li>
          <strong>サーバー</strong>
          <span>
            リクエストを預かってスマホに通知し、結果を受け渡すだけ。トークンは見ない。
          </span>
        </li>
        <li>
          <strong>あなたのスマホ</strong>
          <span>
            トークンをパスキーで暗号化して持つ。内容を確かめてパスキーで承認すると、
            スマホが名前をトークンに置き換えて API を呼び、結果を返す。
          </span>
        </li>
      </ul>

      <h2>はじめかた</h2>
      <ol mix={stepsStyle}>
        <li>このページをスマホで開き、ホーム画面に追加する。</li>
        <li>ホーム画面の kagi を開き、通知を有効にする。</li>
        <li>パスキーを作り、API のトークンを登録する。</li>
        <li>
          表示される URL をリクエスト元に設定する。
        </li>
      </ol>
      <p>
        リクエストの書き方や GitHub での使い方は{" "}
        <a href={routes.docs.href()}>使い方</a>。
      </p>
    </>
  );
}

const leadStyle = css({ fontSize: "1.05rem", lineHeight: 1.8 });

const ctaStyle = css({ marginBlock: "1.5rem" });

const rolesStyle = css({
  listStyle: "none",
  padding: 0,
  display: "grid",
  gap: "0.75rem",
  "& li": {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    padding: "0.9rem 1rem",
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
  },
  "& span": { color: color.muted, fontSize: "0.95rem" },
});

const stepsStyle = css({ paddingInlineStart: "1.25rem", lineHeight: 1.9 });
