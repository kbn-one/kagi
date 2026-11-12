import { css, type Handle } from "@remix-run/component";

import { routes } from "../routes.ts";
import { cardStyle } from "../theme.ts";
import { color, font, radius } from "../tokens.ts";

export const title = "使い方 — kagi";
export const description =
  "承認者のスマホの準備、リクエストの送り方、GitHub App で git push を 1 リポジトリに絞る方法。";

/** The shell places the sign-in island, so every page boots the runtime. */
export const hydrate = true;

const ORIGIN = "https://kagi.kbn.one";
const SUB = `${ORIGIN}/api/sub/<id>`;

const HELPER_URL =
  "https://raw.githubusercontent.com/kbn-one/kagi/main/tools/git_credential_kagi.ts";

export default function Docs(_handle: Handle) {
  return () => (
    <>
      <h1>使い方</h1>
      <nav mix={tocStyle} aria-label="目次">
        <a href="#approver">承認者の準備</a>
        <a href="#request">リクエストを送る</a>
        <a href="#git">git push を 1 リポジトリに絞る</a>
        <a href="#limits">できること・できないこと</a>
      </nav>

      <section mix={cardStyle} id="approver">
        <h2>1. 承認者の準備（スマホ）</h2>
        <ol mix={listStyle}>
          <li>
            スマホでこのサイトを開き、ホーム画面に追加する（iPhone
            はホーム画面から開かないと通知を受け取れない）。
          </li>
          <li>
            <a href={routes.my.href()}>マイページ</a>{" "}
            で id.kbn.one にサインインし、「このデバイスへの通知を登録」を押す。
          </li>
          <li>
            <a href={routes.kagi.href()}>承認</a>{" "}
            の画面で 「パスキーを作成」を押し、秘密を追加する。秘密は
            localStorage
            に、パスキーから導いた鍵で暗号化して置かれ、サーバーには送られない。
            秘密ごとに送信を許すホスト（例: <code>api.github.com</code>
            ）を指定しておくと、別のホストへは送れなくなる。
          </li>
          <li>
            同じ画面で「この端末を承認者として登録」を押す。表示される
            <code>{`${ORIGIN}/api/sub/<id>`}</code>{" "}
            がリクエスト用の URL。 この ID
            を知っていれば誰でもリクエストを送れるので、ID は秘密にしておく。
          </li>
        </ol>
      </section>

      <section mix={cardStyle} id="request">
        <h2>2. リクエストを送る（スクリプト・エージェント）</h2>
        <p>
          秘密を使う箇所を <code>[NAME]</code>{" "}
          と書いて送る。サーバーは承認者に 通知し、<code>transaction_id</code>
          {" "}
          を返す。
        </p>
        <pre mix={preStyle}>{`curl -X POST ${SUB}/req \\
  -H 'content-type: application/json' \\
  -d '{
    "secrets": ["GH_SECRET"],
    "url": "https://api.github.com/user",
    "headers": { "authorization": "Bearer [GH_SECRET]" }
  }'
# → 202 {"transaction_id":"…","status":"pending","notified":true}`}</pre>
        <p>
          結果は <code>/res</code> で受け取る。承認されるまで最大{" "}
          <code>wait</code> 秒（既定 25、最大 55）待ち、結果は一度だけ返る。
        </p>
        <pre mix={preStyle}>{`curl '${SUB}/res?transaction_id=…&wait=25'`}</pre>
        <dl mix={tableStyle}>
          <dt>200</dt>
          <dd>
            実行結果{" "}
            <code>{`{ "response": { "status", "headers", "body" } }`}</code>
            。結果に含まれる秘密の値は <code>[NAME]</code> に置き換え済み
          </dd>
          <dt>202</dt>
          <dd>まだ承認されていない。もう一度呼ぶ</dd>
          <dt>403</dt>
          <dd>承認者が拒否した</dd>
          <dt>502</dt>
          <dd>承認者のスマホからの呼び出しが失敗した（CORS など）</dd>
          <dt>410</dt>
          <dd>期限切れ（10 分）か、受け渡し済み</dd>
        </dl>
        <p>
          エラーは RFC 9457 の problem（<code>application/problem+json</code>
          ）で、<code>detail</code> に理由が入る。
        </p>
        <h3>リクエストの項目</h3>
        <dl mix={tableStyle}>
          <dt>
            <code>secrets</code>
          </dt>
          <dd>
            使う秘密の名前。<code>[NAME]</code> と過不足なく一致させる
          </dd>
          <dt>
            <code>url</code>
          </dt>
          <dd>
            http(s) の絶対 URL。ホスト部分には <code>[NAME]</code> を使えない
          </dd>
          <dt>
            <code>method</code>
          </dt>
          <dd>
            省略時は body が無ければ GET、あれば POST
          </dd>
          <dt>
            <code>headers</code>
          </dt>
          <dd>文字列の値のオブジェクト</dd>
          <dt>
            <code>body</code>
          </dt>
          <dd>JSON（JSON で送る）か文字列（そのまま送る）</dd>
        </dl>
        <p>
          API はスマホのブラウザーから呼ばれるので、呼び先が CORS
          を許可している必要がある（<code>api.github.com</code>{" "}
          は許可している）。redirect は失敗として扱う。
        </p>
      </section>

      <section mix={cardStyle} id="git">
        <h2>3. git push を 1 リポジトリに絞る（GitHub App）</h2>
        <p>
          エージェントに広い権限のトークンを渡す代わりに、push のたびに
          <strong>そのリポジトリだけ・指定した権限だけ・1 時間だけ</strong>
          のトークンを、承認付きで発行する。制限は GitHub
          が強制するので、関係ないリポジトリへは push できない。
        </p>
        <h3>GitHub 側</h3>
        <ol mix={listStyle}>
          <li>
            Settings → Developer settings → GitHub Apps で App を作る。
            Repository permissions の <strong>Contents</strong> を{" "}
            <strong>Read and write</strong>{" "}
            にする（発行するトークンはこれを超えられない）。Webhook は不要。
          </li>
          <li>push させてよいリポジトリに App をインストールする。</li>
          <li>秘密鍵（.pem）を生成し、App ID を控える。</li>
        </ol>
        <h3>スマホ側</h3>
        <p>
          <a href={routes.kagi.href()}>承認</a>{" "}
          の画面で「パスキーで開いて編集」→「GitHub App を追加」に、名前（
          <code>GH_APP</code>）・App ID・.pem
          の中身を入れて保存する。鍵は端末から出ない。
        </p>
        <h3>エージェント側</h3>
        <p>
          git の credential helper を設定する。git が push 先の{" "}
          <code>owner/repo</code>{" "}
          を helper に渡し、helper がそのリポジトリだけのトークンを kagi
          に依頼する。
        </p>
        <pre
          mix={preStyle}
        >{`git config --global credential.https://github.com.useHttpPath true
git config --global credential.https://github.com.helper \\
  '!KAGI_URL=${SUB} deno run --allow-net=kagi.kbn.one --allow-env ${HELPER_URL}'`}</pre>
        <p>
          あとは普通に <code>git push</code>{" "}
          する。スマホに「GitHub トークン発行 owner/repo (contents:write)」
          と通知が届くので、リポジトリ名と権限を確かめてパスキーで承認する。
          別のリポジトリへの push には別の承認が要る。認証が要る fetch / clone
          でも承認を求められる。
        </p>
        <p>
          環境変数: <code>KAGI_APP</code>（App の名前、既定 <code>GH_APP</code>
          ）、<code>KAGI_PERMISSIONS</code>（既定{" "}
          <code>contents:write</code>、<code>name:read|write</code>{" "}
          をカンマ区切り）。
        </p>
        <h3>トークンを直接頼む</h3>
        <pre mix={preStyle}>{`curl -X POST ${SUB}/req \\
  -H 'content-type: application/json' \\
  -d '{
    "type": "github-app-token",
    "app": "GH_APP",
    "owner": "kbn-one",
    "repositories": ["kagi"],
    "permissions": { "contents": "write" }
  }'`}</pre>
        <p>
          <code>repositories</code> と <code>permissions</code>{" "}
          は空にできない（GitHub は空を「全部」と解釈するため）。結果の{" "}
          <code>body</code> は GitHub の応答（
          <code>token</code>、<code>expires_at</code> など）。
        </p>
      </section>

      <section mix={cardStyle} id="limits">
        <h2>4. できること・できないこと</h2>
        <ul mix={listStyle}>
          <li>
            秘密はスマホの外に出ない。サーバーもリクエスト元も秘密を見ない。
          </li>
          <li>
            GitHub App の鍵は通常のリクエストの <code>[NAME]</code>{" "}
            には埋め込めない（鍵そのものの持ち出しを防ぐ）。
          </li>
          <li>
            承認したリクエストの結果は一度だけ受け渡され、スマホのメモリにしか
            残らない。
          </li>
          <li>
            止められるのは<strong>あなたの資格情報を使った</strong>操作だけ。
            攻撃者が自分のトークンで自分のリポジトリに push
            するような持ち出しは、ネットワークの出口制限で防ぐ必要がある。
          </li>
          <li>
            ID を知っている人は誰でもリクエストを送れる。承認者は内容を見て
            拒否できる。
          </li>
        </ul>
      </section>
    </>
  );
}

const tocStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem 1.25rem",
  marginBlock: "1rem 1.5rem",
});

const listStyle = css({
  paddingInlineStart: "1.25rem",
  lineHeight: 1.7,
  "& li": { marginBlock: "0.4rem" },
});

const preStyle = css({
  margin: "0.75rem 0",
  padding: "0.75rem 0.9rem",
  borderRadius: radius.sm,
  background: color.bg,
  border: `1px solid ${color.border}`,
  fontFamily: font.mono,
  fontSize: "0.8rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
});

const tableStyle = css({
  display: "grid",
  gridTemplateColumns: "max-content 1fr",
  gap: "0.35rem 1rem",
  margin: "0.75rem 0",
  "& dt": { fontWeight: 600 },
  "& dd": { margin: 0, minWidth: 0 },
});
