import { css, type Handle } from "@remix-run/component";

import { SequenceDiagram } from "../components/sequence_diagram.tsx";
import { SetupCta } from "../islands/setup_cta.tsx";
import { routes } from "../routes.ts";
import { cardStyle } from "../theme.ts";
import { color, radius } from "../tokens.ts";

export const title = "kagi";
export const description =
  "秘密トークンを承認者のスマホのブラウザー内に持ち、API コールを検閲してから実行する。";

/** The call to action reads the device, so the page boots the runtime. */
export const hydrate = true;

/** Launched from the home-screen icon, the app opens on the approver's screen, not here. */
export const standaloneStart = routes.kagi.href();

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

      <h3>ふだんの流れ</h3>
      <figure mix={figureStyle}>
        <SequenceDiagram
          id="flow"
          title="ふだんの流れ: トークンはスマホから API への一本の矢印にしか乗らない"
          actors={["リクエスト元", "kagi", "スマホ", "API"]}
          steps={[
            { from: 0, to: 1, label: "[TOKEN] と書いた\nリクエスト" },
            { from: 1, to: 2, label: "通知" },
            { from: 2, to: 2, label: "内容を確かめ\nパスキーで承認" },
            { from: 2, to: 3, label: "トークンを埋めて呼ぶ", kind: "secret" },
            { from: 3, to: 2, label: "応答" },
            { from: 2, to: 1, label: "結果（トークンは\n[TOKEN] に戻す）" },
            { from: 1, to: 0, label: "結果" },
          ]}
        />
        <figcaption>
          太い矢印だけがトークンを運ぶ。kagi のサーバーを通るのは
          <code>[TOKEN]</code> という名前だけ。
        </figcaption>
      </figure>

      <h3>CORS を許可していない API のとき</h3>
      <p>
        ブラウザーは CORS を許可していない API の応答を読めない。そういう API
        に使うトークンは、登録するときに「kagi
        のサーバー経由で送る」を選んでおく。承認すると、その 1
        回の呼び出しのためだけに使い捨ての Worker が作られ、スマホとその Worker
        のあいだで鍵を決めて、暗号化したまま渡す。
      </p>
      <figure mix={figureStyle}>
        <SequenceDiagram
          id="relay"
          title="中継: kagi のサーバー本体を通るのは暗号文だけ"
          actors={["スマホ", "kagi", "使い捨て\nWorker", "API"]}
          shade={{ column: 1, caption: "暗号文だけが通る" }}
          steps={[
            { from: 0, to: 1, label: "承認の署名で接続" },
            { from: 1, to: 2, label: "Worker を作り\n送り先だけ教える" },
            { from: 2, to: 0, label: "公開鍵" },
            { from: 0, to: 0, label: "鍵を決めて\nトークンを暗号化" },
            { from: 0, to: 2, label: "暗号化した呼び出し", kind: "sealed" },
            { from: 2, to: 3, label: "トークンを\n埋めて呼ぶ", kind: "secret" },
            { from: 3, to: 2, label: "応答" },
            { from: 2, to: 0, label: "暗号化した応答", kind: "sealed" },
            { from: 2, to: 2, label: "捨てる" },
          ]}
        />
        <figcaption>
          破線は暗号文。トークンが平文になるのは使い捨ての Worker
          の中と、そこから API への太い矢印だけ。Worker
          は承認したリクエストの送り先にしか送れず、 呼び出しは 1
          回、終わったら捨てる。
        </figcaption>
      </figure>
      <p mix={noteStyle}>
        この暗号化で防げるのは、サーバー側のログや不具合からの漏れ。Worker
        に渡すコードもスマホの画面のコードも kagi
        のサーバーが配っているので、サーバーそのものを信用しなくてよくなるわけではない。
      </p>

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

const figureStyle = css({
  marginInline: 0,
  marginBlock: "1rem 1.5rem",
  padding: "1rem 0.5rem 0.75rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  "& figcaption": {
    marginTop: "0.75rem",
    paddingInline: "0.5rem",
    color: color.muted,
    fontSize: "0.9rem",
  },
});

const noteStyle = css({ color: color.muted, fontSize: "0.9rem" });
