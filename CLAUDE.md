# kagi (kagi.kbn.one)

秘密トークンを承認者のスマホのブラウザー内に持ち、API コールを検閲するアプリ。
Remix v3 + Deno。ページは静的ビルドを Cloudflare Workers の static assets
として、API は Worker + Durable Objects で配信する。`kuboon/deno-remix-tmpl`
から作り、使わない機能は削除済み。

## kagi の構成

- 三者: リクエスト元（秘密を知らない）・サーバー（秘密を見ない）・承認者の
  スマホ（秘密を持ち、承認して自分で API を呼ぶ）。プロトコルの型は
  `web/client/lib/kagi/protocol.ts` に一つだけ置き、サーバーとブラウザーで共有。
- サーバー: `web/server/lib/kagi/room.ts` の `Room` が subscription
  一つ分（登録・トランザクション・承認者の WebSocket・`GET /res`
  の待ち手）。`hub.ts` がローカルではメモリ、Cloudflare では Durable Object
  (`durable_object.ts` の `KagiRoom`、`cloudflare.config.ts` で宣言) に置く。
  WebSocket と long-poll を同じインスタンスで会わせるため DO が必須。
- Deno では `Deno.upgradeWebSocket` が fetch-router を通ると壊れる （router が
  Request/Response を作り直す）ので、`router.tsx` の default export が
  `/api/sub/:id/ws` だけ router の前で hub に渡す。Worker は `WebSocketPair`
  なので router 経由で良い。
- ブラウザー: `lib/kagi/vault.ts`（パスキー PRF → HKDF → AES-GCM で
  localStorage）、`device.ts`（subscription と IndexedDB の非 extractable ECDSA
  端末鍵）、`connection.ts`（WebSocket。結果はメモリにだけ保持）、
  `substitute.ts`（`[NAME]` の置換、送信先ホスト制限、結果からの秘密の除去）、
  画面は `islands/kagi_app.tsx`（`/kagi`）。
- リクエストは 3 種類（`protocol.ts` の `KagiRequest`）。3 つめは
  `github-create-repo`: スマホが App でリポジトリを作り（作成用トークンはスマホ
  内で使い捨て、直後に revoke）、名前と URL だけを返す。公開範囲は必須。CLI は
  `tools/git_credential_kagi.ts create owner/name --public|--private`。
- リクエストは 2 種類（`protocol.ts` の `KagiRequest`）: `[NAME]` を埋めて API
  を 呼ぶ `http`（既定）と、GitHub App の installation token を 1
  リポジトリ・指定 権限・1 時間に絞って発行する
  `github-app-token`（`lib/kagi/github_app.ts`。App の秘密鍵は vault の
  `kind: "github-app"` に入り、`http` リクエストには埋め込め
  ない）。エージェント側は `tools/git_credential_kagi.ts`（git credential
  helper。 `useHttpPath` で push
  先のリポジトリ名を受け取り、それだけのトークンを頼む）。 App の設定手順は
  `README.md`。
- 通知は既存の id.kbn.one 連携（`server/lib/push/client.ts`）で承認者の userId
  へ送る。`RP_ORIGIN`（`https://kagi.kbn.one`）を IdP の `AUTHORIZE_WHITELIST`
  に入れ、Worker secret の `RP_SIGNING_KEY_JWK` を設定しておく。
- 既知の制約: `:id` を知る人は誰でもリクエストを送れる（承認者が拒否できる
  だけ）。`PUT /api/sub/:id` の userId は IdP で検証していない（他人の userId
  を登録すると、その人に通知が届きうる）。呼び先 API は CORS
  でこのオリジンを許可している必要がある。

## 構造

- `web/client/` — ブラウザに渡るもの全て (routes / pages / islands / layout /
  static / lib)。`deno.ns` 無しで型チェックされる。`Deno.` を参照しない。
  - ページは `/`、`/kagi`（承認者の画面）、`/my`（id.kbn.one サインインと push
    登録）。
- `web/server/` — router・asset bundler・API・config・og 画像・Worker。
  - `router.tsx` — ローカル (`deno serve`)・テスト・静的ビルドが使う唯一の
    ルーター定義。
  - `worker.ts` — Cloudflare の Worker。`/api/*` と `/.well-known/jwks.json`
    だけを答える（他は static assets）。API を足したらここにも配線する。
- `web/tests/` — lightpanda によるブラウザ smoke（`deno task test:browser`）。

## プッシュ通知 (id.kbn.one 連携)

id.kbn.one を Web Push のバックエンドとして使う。購読情報は IdP が保持し、RP
(このアプリ) は購読 UI（`/my`）と送信だけを持つ。

- ブラウザ側 (`web/client/lib/push/`, `web/client/islands/push_card.tsx`,
  `web/client/sw.js`):
  - `/sw.js` をこのオリジンに登録し push を受信 (`router.tsx`
    の専用ルートが配信。scope を `/` にするため `static/` 配下には置かない)。
  - 購読の取得/登録/改名/削除/テストは DPoP-bound fetch で IdP の
    `${IDP_ORIGIN}/push/*` を直接叩く (cross-origin)。VAPID 公開鍵も IdP
    のもの。
- サーバ側 (`web/server/lib/push/client.ts`, `lib/signing-key.ts`):
  - 承認リクエストが来ると `lib/kagi/notify.ts` が通知を送る。RP は ES256 鍵で
    `private_key_jwt` クライアントアサーション ([RFC 7521]/[RFC 7523]) を作り、
    IdP の `POST /rp/notifications` へ送信する。
  - `GET /.well-known/jwks.json` で RP の公開鍵を配布し、IdP
    がアサーションを検証 する (共通鍵不要。IdP は RP の JWKS を取得するだけ)。
  - RP の `clientId` はこのアプリの origin (`RP_ORIGIN`) で、IdP の
    `AUTHORIZE_WHITELIST` に含まれている必要がある。

[RFC 7521]: https://www.rfc-editor.org/rfc/rfc7521
[RFC 7523]: https://www.rfc-editor.org/rfc/rfc7523

## 環境変数

env アクセスは `web/server/config.ts` に集約し、ホスト非依存にしてある。
`getConfig()` が Deno では `Deno.env`、Cloudflare Workers では
`cloudflare:workers` の `env`（動的 `import()`）から起動時に一度だけ読む。

- `IDP_ORIGIN` — 外部 IdP の origin（既定 `https://id.kbn.one`）。
- `RP_ORIGIN` — このアプリの公開 origin（`https://kagi.kbn.one`）。
  クライアントアサーションの `clientId`/`iss`/`sub`。未設定だと通知送信が
  エラーになる（リクエスト自体は受け付け、`notified: false` を返す）。
- `RP_SIGNING_KEY_JWK` — ES256 秘密鍵 (JWK JSON)。未設定ならプロセス毎に生成
  （開発用）。本番は Worker secret
  に固定鍵を置く。`web/server/set_signing_key.ts` が鍵を生成して Cloudflare API
  で直接 secret に入れる（鍵はログにもコマンド行 にも出ず、`kid`
  だけを表示）。デプロイ（`cloudflare.yml`）が鍵の有無を先に調べ、 無ければ
  `cloudflare.config.ts` は secret を宣言せずにデプロイし（初回デプロイは
  継承元の版が無いので宣言すると失敗する）、直後に鍵を入れる。ローテートは
  Actions の `signing-key` ワークフローを `rotate` 付きで手動実行する。

## API のエラー応答 (RFC 9457)

`/api/*` のエラーは [RFC 9457] の Problem Details
（`application/problem+json`）で返す。`web/server/lib/problem.ts` の
`problem({ status, detail, ... })` を使う（`type` は既定で `about:blank`、
`title` は既定でステータスの説明句、それ以外のキーは拡張メンバー）。

- 両 router の `cop()` は `onDeny: copDenied` で 403 を problem にする。Worker
  の `defaultHandler` は 404 を problem で返す。
- クライアントは `detail` を人向けのメッセージとして読む。
- API を足すときもエラーは `problem()` で返し、`{ message }`
  などの独自形にしない。

[RFC 9457]: https://www.rfc-editor.org/rfc/rfc9457

## デプロイ (Cloudflare Workers)

`.github/workflows/cloudflare.yml` が main で `deno task build:cf` →
`deno task cf deploy --prebuilt` を走らせる。

- `deno task build` (`@remix-kbn/ssg`) が `router.tsx` を `fetch()` でクロール
  して `web/dist` に静的 HTML を書き出す。クロールは `entryPoints` (`/`、og
  画像、`/sw.js`) とそこからのリンクだけを辿るので `/api/*` は静的化されない。
- `deno bundle` で作った Worker (`web/worker-dist/worker.js`) と `web/dist` を
  `web/server/cf_build.ts` が Build Output Specification
  (`.cloudflare/output/v0`) に並べる。`cf build` は `jsr:` を解決できないので
  使わない。`cloudflare.config.ts` が `cf` CLI の設定（`runWorkerFirst`、
  `KagiRoom` Durable Object、`kagi.kbn.one`）。
- 両 router に `@remix-run/cop-middleware` の `cop()` を入れてある。クロス
  オリジンのブラウザからの unsafe メソッドを token 無しで拒否する（リクエスト元
  はブラウザ以外を想定）。
- `router.tsx` に `@remix-run/csp-middleware` の `csp()`（`web/server/csp.ts`、
  nonce + `'strict-dynamic'`）。ヘッダが付くのはライブの router（`deno serve`）
  だけで、Workers の static assets には付かない。

## GitHub Actions の lockfile

`.github/workflows/actions.lock` は、ワークフローが使う
action（推移的な依存を含む）を検証済みの commit に固定する
lockfile（[GitHub の docs](https://docs.github.com/en/actions/how-tos/secure-your-work/lock-workflow-dependencies)）。
`uses:` の `@v7` のような参照を読みやすいまま残し、実行は lockfile の commit
になる。

- 生成・更新は `gh extension install github/gh-actions-lock`
  したうえでリポジトリのルートから `gh actions-lock`（認証済みの `gh`
  が要る）。ワークフローを足した・消した、`uses:` を変えたら再実行して、
  `.github/workflows/` ごと commit する。lockfile は手で編集しない。
- `.github/workflows/verify-lockfile.yml` が PR と main で
  `gh actions-lock --verify` を走らせる。lockfile が まだ無い間は何もしない。
- `.github/dependabot.yml` が action の更新を出す。lockfile
  に載っているワークフローなら、同じ PR で lockfile の対応する行も更新される。

## 開発

```bash
deno task dev      # 開発サーバー起動
deno task build    # 静的サイトを web/dist へ生成
deno task build:cf # 静的サイト + Worker を .cloudflare/output へ (cf deploy --prebuilt 用)
deno task test     # サーバー/ライブラリのテスト
deno task test:browser  # ブラウザ smoke テスト (lightpanda)
deno task check    # 型チェック + lint + fmt
```

変更前後に `deno task check && deno task test && deno task build:cf` と
`deno task test:browser` を通す。

## コーディング規約

- Deno ファースト（Web API 優先、Node.js API は必要最小限）
- TypeScript strict mode
- テストは `Deno.test()` + `@std/assert`
- ファイル名はスネークケース（例: `dpop_test.ts`）
- ページ/island の見た目は `@remix-run/component` の `css()` mixin と
  `web/client/tokens.ts` のトークンで書く (Tailwind / daisyUI は使わない)
- ブラウザへ渡るコードは `web/client/` に置き、`Deno.` を参照しない
