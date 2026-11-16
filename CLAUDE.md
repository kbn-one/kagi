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
- 通知はこのサーバーが自分で送る（下の「プッシュ通知」）。サインインは無い。
- 既知の制約: `:id` を知る人は誰でもリクエストを送れる（承認者が拒否できる
  だけ）。呼び先 API は CORS でこのオリジンを許可している必要がある。

## 構造

- `web/client/` — ブラウザに渡るもの全て (routes / pages / islands / layout /
  static / lib)。`deno.ns` 無しで型チェックされる。`Deno.` を参照しない。
  - ページは `/`（仕組みの概要と、ホーム画面への追加を促す
    `islands/setup_cta.tsx`）、 `/kagi`（承認者の画面。manifest の
    `start_url`）、`/docs`（使い方）。
  - スマホで使う前提。`/kagi` は準備が済むまで 1 画面 1 ステップで進む:
    ホーム画面 に追加 → 通知を有効にする（同時に承認者として登録）→
    パスキーを作る。判定は `lib/kagi/setup.ts`（端末の判定は
    `@kuboon/browser-how-to`）。iPhone 以外は 「このブラウザーで続ける」で 1
    つめを飛ばせる。
  - `/manifest.webmanifest` とアイコン（`server/icon.ts` が Skia で描く PNG）は
    `router.tsx` のルートで、静的ビルドの `entryPoints` に入れてある。
- `web/server/` — router・asset bundler・API・config・og 画像・Worker。
  - `router.tsx` — ローカル (`deno serve`)・テスト・静的ビルドが使う唯一の
    ルーター定義。
  - `worker.ts` — Cloudflare の Worker。`/api/*` だけを答える（他は static
    assets）。API を足したらここにも配線する。
- `web/tests/` — lightpanda によるブラウザ smoke（`deno task test:browser`）。

## プッシュ通知

Web Push は `jsr:@remix-kbn/web-push`（id.kbn.one と共通）で、このサーバーが
自分の VAPID 鍵で送る。id.kbn.one には依存しない。

- 購読は subscription の登録に付けて Room（Durable Object）に置く
  （`Registration.push`）。スマホが認証済みの WebSocket で
  `{ type: "push", subscription }` を送って入れ替える（null で止める）。 `ready`
  メッセージが VAPID 公開鍵と、購読が保存済みかを返す。
- スマホ側（`lib/kagi/connection.ts`）は通知が許可済みなら接続のたびに
  `subscribePush` して送り直す（鍵が変わっていれば作り直される）。なので購読の
  失効や鍵のローテートは、スマホが `/kagi` を開けば自動で直る。未許可なら
  `/kagi` の「通知を有効にする」ボタン。
- 送信は `lib/kagi/notify.ts`。push サービスが購読の失効（404/410・VAPID
  不一致）を返したら Room が購読を消し、スマホに
  `{ type: "push", registered: false }` を伝える。
- `/sw.js` は `router.tsx` が `pushServiceWorkerScript()` を配信する（scope を
  `/` にするため `static/` 配下には置かない）。

## 環境変数

env アクセスは `web/server/config.ts` に集約し、ホスト非依存にしてある。
`getConfig()` が Deno では `Deno.env`、Cloudflare Workers では
`cloudflare:workers` の `env`（動的 `import()`）から起動時に一度だけ読む。

- `VAPID_KEYS` — Web Push の VAPID 鍵ペア（`{ publicKey, privateKey }` の JWK
  JSON）。未設定なら Deno ではプロセス毎に生成（開発用）、Worker では通知を
  送らない。本番は Worker secret。`web/server/set_vapid_keys.ts` が鍵を生成して
  Cloudflare API で直接 secret に入れる（秘密鍵はログにもコマンド行にも出ず、
  公開鍵だけを表示）。デプロイ（`cloudflare.yml`）が鍵の有無を先に調べ、無ければ
  `cloudflare.config.ts` は secret を宣言せずにデプロイし（継承元の版に無い
  secret を宣言すると失敗する）、直後に鍵を入れる。ローテートは Actions の
  `vapid-keys` ワークフローを `rotate` 付きで手動実行する。
- `PUSH_CONTACT` — VAPID の連絡先（既定 `https://kagi.kbn.one`）。

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
