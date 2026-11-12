# kagi

<https://kagi.kbn.one/>

秘密トークンを**承認者のスマホのブラウザー内**に持ち、API コールを検閲する。
リクエスト元（スクリプトや AI エージェント）は秘密を知らないまま、承認された API
コールの結果だけを受け取る。

## 流れ

1. 承認者はスマホでサイトをホーム画面に追加し、`/my` で id.kbn.one
   にサインインして Web Push を登録する。
2. `/kagi` で秘密を保存する。秘密は localStorage に、パスキー（WebAuthn
   PRF）から導いた鍵で AES-GCM 暗号化して置く。サーバーには送らない。
3. 同じ画面で端末を承認者として登録する（`PUT /api/sub/:id`。`:id`
   はランダム、端末の ECDSA 公開鍵と id.kbn.one の userId を登録）。
4. リクエスト元が `POST /api/sub/:id/req` を送る:

   ```json
   {
     "secrets": ["GH_SECRET"],
     "url": "https://api.github.com/user",
     "headers": { "authorization": "Bearer [GH_SECRET]" },
     "body": {}
   }
   ```

   サーバーは承認者のスマホへ push し、`202 { "transaction_id": "…" }` を返す。
5. スマホはサーバーへ WebSocket を張り（端末鍵で challenge に署名）、リクエスト
   内容を表示する。承認者がパスキーで承認すると、ブラウザーが localStorage
   の秘密を復号して `[NAME]` を埋め、API を呼び、結果を手元に保持する。
6. `GET /api/sub/:id/res?transaction_id=…&wait=25` は、結果があれば WebSocket
   越しにスマホから取り寄せて直ちに返す（一度だけ。秘密の値は `[NAME]`
   に置換済み）。まだなら `wait` 秒まで待ち、`202 { "status": "pending" }`。
   拒否は 403、呼び出し失敗は 502、期限切れ・受け渡し済みは 410（RFC 9457
   problem）。

API はスマホのブラウザーから呼ぶので、呼び先が CORS でこのオリジンを許可して
いる必要がある（`api.github.com` は許可している）。

## git push を 1 リポジトリに絞る（GitHub App）

エージェントに広い権限のトークンを渡さず、push のたびに「そのリポジトリだけ・ 1
時間だけ」のトークンを承認付きで発行する。関係ないリポジトリへのコードの
持ち出しを、GitHub 側の権限で止める。

1. GitHub で App を作る（Settings → Developer settings → GitHub Apps）。
   Repository permissions の Contents を Read and write にする（発行するトークン
   はこの範囲を超えられない）。Webhook は不要。
2. App を、push させてよいリポジトリ（または全部）にインストールする。
3. App の秘密鍵（.pem）を生成し、App ID を控える。
4. スマホの `/kagi` で「GitHub App を追加」に名前（`GH_APP`）・App ID・.pem の
   中身を入れて保存する。鍵はパスキーで暗号化され、端末から出ない。
5. エージェント側で git の credential helper を設定する:

   ```bash
   git config --global credential.https://github.com.useHttpPath true
   git config --global credential.https://github.com.helper \
     '!KAGI_URL=https://kagi.kbn.one/api/sub/<id> deno run --allow-net=kagi.kbn.one --allow-env https://raw.githubusercontent.com/kbn-one/kagi/main/tools/git_credential_kagi.ts'
   ```

以後 `git push` のたびに、git が push 先の `owner/repo` を helper に渡し、helper
が kagi に `github-app-token`
を依頼する。スマホにはリポジトリ名と権限が表示され、
パスキーで承認するとスマホが App の JWT に署名してトークンを発行し、git に渡す。
別のリポジトリへの push には別の承認が要る。認証の要る fetch / clone でも承認を
求められる。

`github-app-token` リクエストは直接送ることもできる:

```json
{
  "type": "github-app-token",
  "app": "GH_APP",
  "owner": "kbn-one",
  "repositories": ["kagi"],
  "permissions": { "contents": "write" }
}
```

`repositories` と `permissions` は空にできない（GitHub は空を「全部」と解釈する
ため）。App の鍵は通常の HTTP リクエストの `[NAME]` には埋め込めない。

開発のルールは [CLAUDE.md](./CLAUDE.md)。

ref: https://github.com/remix-run/remix
