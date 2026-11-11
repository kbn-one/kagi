# kagi (kagi.kbn.one)

秘密トークンを承認者のスマホのブラウザー内に持ち、API コールを検閲するアプリ。
`kuboon/deno-remix-tmpl`（Remix v3 + Deno）から作った派生アプリで、**server
モード**（Cloudflare Workers + Durable Objects）を選んだ。GitHub Pages
への静的デプロイは消した（API が要るので静的版では動かない）。

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
- 通知は既存の id.kbn.one 連携（`server/lib/push/client.ts`）で承認者の userId
  へ送る。`RP_ORIGIN`（`https://kagi.kbn.one`）を IdP の `AUTHORIZE_WHITELIST`
  に入れ、Worker secret の `RP_SIGNING_KEY_JWK` を設定しておく。
- 既知の制約: `:id` を知る人は誰でもリクエストを送れる（承認者が拒否できる
  だけ）。`PUT /api/sub/:id` の userId は IdP で検証していない（他人の userId
  を登録すると、その人に通知が届きうる）。呼び先 API は CORS
  でこのオリジンを許可している必要がある。

以下はテンプレから引き継いだ説明。

## このリポジトリは何か（最初に判定する）

このリポジトリは **GitHub
テンプレート**で、ここから新しいアプリを作る。ファイルは全部コピーされるので、
同じ `CLAUDE.md` が **テンプレ本体**と**派生アプリ**の両方にある。次で区別する。

1. `git remote get-url origin` が `kuboon/deno-remix-tmpl` →
   **テンプレ本体**。「テンプレ本体を保守するとき」を読む。
2. それ以外 → **派生アプリ**。`TEMPLATE.md` が残っていれば、init 前なので **まず
   `TEMPLATE.md` の ステップ 0 とステージ 1 を済ませる**。`TEMPLATE.md`
   が無ければ init 済みで、普通のアプリとして扱う
   （テンプレ本体の事情は持ち込まない）。

判定できない（remote が無い等）ときは、推測せずユーザーに聞く。

## テンプレ本体を保守するとき

（派生アプリでは、init の最後にこの節を削除する。）

- 方針: **機能は全部このテンプレに置く**。別の starter に機能を分散させない（旧
  SSG starter
  の機能もここに統合済み）。派生アプリが要らない機能を消せるよう、`TEMPLATE.md`
  の機能表と `[feature:名前]` タグを **機能を足す/消す/動かすたびに更新する**。
- 機能を足したら: 配線行（`routes.ts` / `router.tsx` / `layout.tsx` /
  `assets.ts`）に `[feature:名前]` を付け、 `TEMPLATE.md`
  の表に行（消すファイル・配線・依存）を足す。
- 二つのモードが両方動くことを保つ: static（SSG → Pages）と server（Deno
  Deploy）。 デモは両方の URL を `README.md`
  とトップページに載せている。`/api/*` を static に出さない
  （どこからもリンクしない、`entryPoints` に入れない）。
- 変更前後に `deno task check && deno task test && deno task build` と
  `deno task test:browser` を通す。 `TEMPLATE.md`
  の削除リストが本当に通るか、確かめるには scratch の `git worktree` で static
  用と server 用の リストをそれぞれ実際に消して `check`/`build`(`test`) を回す。
- `@remix-run/render-middleware` / `@remix-run/spa` は 1.0.0 で固定を外した
  （`TEMPLATE.md` 参照）。依存を上げたら `/blog` の本文を確認する。

## 構造

- `KvRepo` 抽象は [jsr:@kuboon/kv](https://jsr.io/@kuboon/kv) を利用 (memory /
  Deno KV / Turso libSQL)。
- `packages/session-storage-kv/` — `@remix-run/session` の `SessionStorage` を
  `KvRepo` で実装。
- `packages/remix-dpop-session-middleware/` — DPoP セッション middleware (Remix
  v3 fetch-router 用)。`context.get(DpopSession)` でアクセスでき、
  `@remix-run/session` の `Session` と共存可能。DPoP proof 生成・検証は
  [jsr:@kuboon/dpop](https://jsr.io/@kuboon/dpop) を利用。
- `web/` — Remix v3 リファレンス Web アプリ (Cloudflare Workers へ server
  として、GitHub Pages
  へ静的サイトとして同時にデプロイ。派生アプリはどちらか一方を選ぶ —
  `TEMPLATE.md`)
  - `web/client/` — ブラウザに渡るもの全て (routes / pages / islands / layout /
    static)。`deno.ns` 無しで型チェックされる
  - `web/server/` — router・asset bundler・API・config・og 画像
  - `/my` — id.kbn.one を IdP として使うサインインフロー +
    プッシュ通知のサンプル

## プッシュ通知 (id.kbn.one 連携)

id.kbn.one を Web Push のバックエンドとして使う最小構成。購読情報は IdP
が保持し、RP (このアプリ) は購読 UI と送信トリガーだけを持つ。

- ブラウザ側 (`web/client/lib/push/`, `web/client/islands/push_card.tsx`,
  `web/client/sw.js`):
  - `${base}/sw.js` をこのオリジンに登録し push を受信 (`router.tsx`
    の専用ルートが配信。scope を `${base}/` にするため `static/`
    配下には置かない)。
  - 購読の取得/登録/改名/削除/テストは DPoP-bound fetch で IdP の
    `${IDP_ORIGIN}/push/*` を直接叩く (cross-origin)。VAPID 公開鍵も IdP
    のもの。
- サーバ側 (`web/server/lib/push/client.ts`, `lib/signing-key.ts`):
  - `POST /api/notify` がサーバ起点で通知を送る。RP は ES256 鍵で
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
`loadConfig(env)` が env レコードから型付き `Config` を作り、`getConfig()` が
ホストに応じて env を自前で取得する (配線不要): Deno は `Deno.env`、Cloudflare
Workers は `cloudflare:workers` の `env`。後者は動的 `import()` なので、その
モジュールを持たない Deno はロードで落ちずフォールバックできる (静的 import は
Deno で catch 不能なエラーになる)。env は top-level await
で起動時に一度だけ解決・ 保持するので `getConfig()` は sync。

- `IDP_ORIGIN` — 外部 IdP の origin (例: `http://localhost:8000`)。 `/my`
  ページが `${IDP_ORIGIN}/authorize` へ DPoP thumbprint と redirect_uri
  を付けて遷移し、戻った後 `${IDP_ORIGIN}/session` で userId を取得する。
- `RP_ORIGIN` — このアプリの公開 origin。`POST /api/notify` のクライアント
  アサーションの `clientId`/`iss`/`sub` に使う。IdP の `AUTHORIZE_WHITELIST`
  に登録が必要。未設定だと送信時にエラーになる。
- `RP_SIGNING_KEY_JWK` — 任意。ES256 秘密鍵 (JWK JSON)。未設定ならプロセス毎に
  生成
  (開発用)。本番では固定鍵を設定し、再起動で鍵がローテートしないようにする。
- `BASE_URL` — 静的ビルド専用。Pages のサブパス（PR プレビュー等）を `base`
  にする。server（`deno serve` / Cloudflare）は常にルート配信なので読まない
  （`web/server/deno.json` の `dev` 権限で ignore）。
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — `GET /api/turso` サンプル用の
  Turso (libSQL) 接続。未設定なら 503 を返すのみ。

## API のエラー応答 (RFC 9457)

`/api/*` のエラーは [RFC 9457] の Problem Details
（`application/problem+json`）で返す。`web/server/lib/problem.ts` の
`problem({ status, detail, ... })` を使う（`type` は既定で `about:blank`、
`title` は既定でステータスの説明句、それ以外のキーは拡張メンバー）。

- 両 router の `cop()` は `onDeny: copDenied` で 403 を problem にする。Worker
  の `defaultHandler` は 404 を problem で返す。
- DPoP middleware（`packages/remix-dpop-session-middleware`）の既定の 401 も
  problem で、`WWW-Authenticate: DPoP error="invalid_dpop_proof"` を付ける （RFC
  9449 §7.1）。
- クライアントは `detail` を人向けのメッセージとして読む。
- API を足すときもエラーは `problem()` で返し、`{ message }`
  などの独自形にしない。

[RFC 9457]: https://www.rfc-editor.org/rfc/rfc9457

## Turso (libSQL) + data-table サンプル

`GET /api/turso` が `@remix-run/data-table` のリレーショナル API で Turso に
アクセスし、`visits` を記録して累計を返す。Turso の `@libsql/client` は非同期
なので、公式の同期 SQLite 実装ではなく非同期の
[`@remix-kbn/data-table-sqlite-turso`](https://jsr.io/@remix-kbn/data-table-sqlite-turso)
(`createTursoDatabase(client)`) を使う。クライアントは edge 対応の
`@libsql/client/web`。詳細は `web/server/lib/turso/README.md`。

## デプロイ (Cloudflare Workers + GitHub Pages)

`web/server/router.tsx` が唯一のルーター定義で、素の `@remix-run/fetch-router`
の router を default export する。ローカル (`deno serve`)
とテストはこれをそのまま使い、デプロイは 2 通り。

- **Cloudflare Workers**: `.github/workflows/cloudflare.yml` が
  `deno task
  build:cf` を走らせ、**静的ビルド (`web/dist`) を Workers の
  static assets** として、**server 専用ルート (`/api/*`,
  `/.well-known/jwks.json`) だけを Worker (`web/server/worker.ts`)**
  で配信する。`router.tsx` は `Deno.bundle` / `Deno.readTextFile` を使うので
  Workers では動かさない。
  - `cloudflare.config.ts` が `cf` CLI の設定 (`assets.runWorkerFirst` で Worker
    に回すパスを指定)。
  - `cf build` は Wrangler か Vite プラグインを呼ぶだけで `jsr:` を解決できない
    ので使わない。`deno bundle` で作った Worker (`web/worker-dist/worker.js`) と
    `web/dist` を `web/server/cf_build.ts` が Build Output Specification
    (`.cloudflare/output/v0`) に並べ、`cf deploy --prebuilt` でアップロードする
    (`deno task cf ...` が `npm:cf` の実行)。
  - 両 router（`router.tsx` と `worker.ts`）に `@remix-run/cop-middleware` の
    `cop()` を入れてある。`Sec-Fetch-Site` / `Origin` で、クロスオリジンの
    ブラウザからの unsafe メソッド（`POST /api/notify` など）を token 無しで
    拒否する。別オリジンから API を叩く構成にするなら `trustedOrigins` を足す。
  - `router.tsx` に `@remix-run/csp-middleware` の `csp()` を入れてある
    （`web/server/csp.ts`）。リクエストごとの nonce を使う strict CSP
    （`script-src 'nonce-…' 'strict-dynamic'`、`object-src 'none'`、
    `base-uri 'none'`）。`render()` が生成するタグには自動で付き、自分で書く
    `<script>` / `<link rel="modulepreload">` には `nonceOf(context)` を
    `Layout` の `nonce` に渡して付ける。ヘッダが付くのはライブの
    router（`deno
    serve`）だけで、静的に書き出したページ（Pages / Workers
    static assets）には CSP が付かない。
  - DPoP セッションの保存先は `TURSO_DATABASE_URL` があれば Turso、無ければ
    メモリ (isolate ごとなので本番では Turso を設定する)。
- **GitHub Pages**: `.github/workflows/pages.yml` が `deno task build`
  (`@remix-kbn/ssg`) を走らせ、同じ router を `fetch()` でクロールして
  `web/dist` に静的 HTML を書き出す。クロールは `entryPoints` (`/`、og
  画像、`/sw.js`) とそこからの リンクだけを辿る。どこからもリンクしていない
  `/api/*` は静的化されない。 main は Pages ルート、PR は preview
  サブパスにデプロイされる (`BASE_URL` から `base` が決まる)。

静的版では API が無いので、`/my`
の「デモ」パネルの「サーバーから送信」(`POST /api/notify`) は 動かない。それ以外
(DPoP + IdP は全てブラウザ → id.kbn.one の直接通信) は静的版でも動く。

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
- 制限: 別リポジトリの再利用ワークフローの呼び出し（`pages.yml` の
  `kuboon/workflows/...@main`）は lock
  されない。呼び出される側のリポジトリが自分の lockfile を持つ必要がある。

## 開発

```bash
deno task dev      # web アプリの開発サーバー起動
deno task build    # GitHub Pages 用の静的サイトを web/dist へ生成
deno task build:cf # 静的サイト + Worker を .cloudflare/output へ (cf deploy --prebuilt 用)
deno task test     # パッケージ/サーバーのテスト実行
deno task test:browser  # ブラウザ smoke テスト (lightpanda)
deno task check    # 型チェック + lint + fmt
```

## コーディング規約

- Deno ファースト（Web API 優先、Node.js API は必要最小限）
- TypeScript strict mode
- テストは `Deno.test()` + `@std/assert`
- ファイル名はスネークケース（例: `dpop_test.ts`）
- ページ/island の見た目は `@remix-run/component` の `css()` mixin と
  `web/client/tokens.ts` のトークンで書く (Tailwind / daisyUI は使わない)
- ブラウザへ渡るコードは `web/client/` に置き、`Deno.` を参照しない
