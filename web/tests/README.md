# web/tests — ブラウザ smoke

opt-in のブラウザテスト。デフォルトの `deno task test`
には含まれず、`deno
task test:browser` で明示的に起動する。 lightpanda
バイナリは `deno task lightpanda:install` で取得する (@lightpanda/browser 1.6
以降は install 時に自動取得しない。CI も同じ手順)。 nightly
ではなくリリース版（ルートの `deno.json` のタスクに書いた版）に固定
してある。上げるときは lightpanda-io/browser のタグを見てそこを書き換える。

## 前提

- ルーターは起動時に `Deno.bundle` で client を bundle する
  (`web/server/assets.ts`) ので、事前のビルド手順は不要。

## 実行

```bash
deno task test:browser    # root から
```

## カバー範囲

- `kagi_browser.test.ts` — `/kagi` を開き、`globalThis.__rmxReady`
  が立つまで待ってから「パスキーを作成」をクリックし、island の alert
  が出ることを assert する（lightpanda に WebAuthn は無いので、エラー表示が出る
  ＝ hydrate されたクリックハンドラーが動いた）。
