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

開発のルールは [CLAUDE.md](./CLAUDE.md)、テンプレからの残りの整理は
[TEMPLATE.md](./TEMPLATE.md)。

ref: https://github.com/remix-run/remix
