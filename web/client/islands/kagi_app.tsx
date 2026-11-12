/**
 * KagiApp — the approver's screen on `/kagi`.
 *
 * Three cards: the secrets (a passkey-sealed vault, `lib/kagi/vault.ts`), this phone's
 * subscription (`lib/kagi/device.ts`) with the endpoint a requester calls, and the requests waiting
 * for a decision, live over the subscription's WebSocket (`lib/kagi/connection.ts`).
 *
 * Approving asks for the passkey every time: that unlocks the secrets, fills the request's
 * placeholders, makes the call from this browser, and keeps the (scrubbed) answer in memory until
 * the requester's `GET /res` comes for it.
 */

import {
  clientEntry,
  css,
  type Handle,
  on,
  ref,
  type SerializableValue,
} from "@remix-run/component";

import { sessionStore } from "../session.ts";
import { routes } from "../routes.ts";
import {
  actionStyle,
  alertStyle,
  cardStyle,
  dangerStyle,
  primaryStyle,
} from "../theme.ts";
import { color, font, radius } from "../tokens.ts";
import { connect, type KagiConnection } from "../lib/kagi/connection.ts";
import {
  createSubscription,
  forgetSubscription,
  readSubscription,
  type Subscription,
} from "../lib/kagi/device.ts";
import {
  isSecretName,
  methodOf,
  type Transaction,
  type TxStatus,
} from "../lib/kagi/protocol.ts";
import { execute, hostOf, secretsProblem } from "../lib/kagi/substitute.ts";
import {
  createVault,
  deleteVault,
  hasVault,
  passkeysAvailable,
  type UnlockedVault,
  unlockVault,
} from "../lib/kagi/vault.ts";

type AlertKind = "info" | "success" | "warning" | "error";

export interface KagiAppProps {
  [key: string]: SerializableValue;
}

const isClientEnv = typeof document !== "undefined";

const STATUS_LABEL: Record<TxStatus, string> = {
  pending: "承認待ち",
  approved: "実行中",
  done: "完了 (受け取り待ち)",
  delivered: "受け渡し済み",
  rejected: "拒否",
  failed: "失敗",
  expired: "期限切れ",
};

const errorText = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export const KagiApp = clientEntry(
  import.meta.url,
  function KagiApp(handle: Handle<KagiAppProps>) {
    let ready = false;
    let status: { message: string; kind: AlertKind } | null = null;
    let busy = false;

    /**
     * Whether the browser-only state below has been read. Until then the island renders what the
     * server rendered: anything read from localStorage or the browser's APIs during the first render
     * would not match the server's HTML, and hydration would duplicate the mismatched part.
     */
    let loaded = false;
    let passkeys = false;
    let vaultExists = false;
    /** Held only while the secrets card is open for editing. */
    let unlocked: UnlockedVault | null = null;

    let sub: Subscription | null = null;
    let connection: KagiConnection | null = null;
    const focusTx = isClientEnv
      ? new URL(location.href).searchParams.get("tx")
      : null;

    let nameInput: HTMLInputElement | null = null;
    let valueInput: HTMLInputElement | null = null;
    let hostsInput: HTMLInputElement | null = null;

    const setStatus = (message: string, kind: AlertKind = "info") => {
      status = { message, kind };
      handle.update();
    };

    const run = async (task: () => Promise<void>) => {
      if (busy) return;
      busy = true;
      status = null;
      handle.update();
      try {
        await task();
      } catch (e) {
        setStatus(errorText(e, "失敗しました。"), "error");
      } finally {
        busy = false;
        handle.update();
      }
    };

    const startConnection = () => {
      connection?.close();
      connection = sub ? connect(sub.id, () => handle.update()) : null;
    };

    if (isClientEnv) {
      // After hydration, not during it — see `loaded`.
      setTimeout(() => {
        if (handle.signal.aborted) return;
        passkeys = passkeysAvailable();
        vaultExists = hasVault();
        sub = readSubscription();
        loaded = true;
        startConnection();
        handle.update();
      }, 0);
      handle.signal.addEventListener("abort", () => connection?.close());
      void sessionStore.load().then(() => {
        ready = true;
        handle.update();
      });
      sessionStore.addEventListener("change", () => handle.update(), {
        signal: handle.signal,
      });
    }

    // --- secrets --------------------------------------------------------------

    const onCreateVault = () =>
      run(async () => {
        if (
          vaultExists &&
          !confirm("今の秘密を消して、新しいパスキーで作り直しますか？")
        ) return;
        unlocked = await createVault();
        vaultExists = true;
        setStatus(
          "パスキーを作成しました。秘密を追加してください。",
          "success",
        );
      });

    const onUnlock = () =>
      run(async () => {
        unlocked = await unlockVault();
      });

    const onLock = () => {
      unlocked = null;
      handle.update();
    };

    const onAddSecret = () =>
      run(async () => {
        if (!unlocked) return;
        const name = nameInput?.value.trim() ?? "";
        const value = valueInput?.value ?? "";
        const hosts = (hostsInput?.value ?? "").split(/[\s,]+/).filter(Boolean);
        if (!isSecretName(name)) {
          throw new Error(
            "名前は英字・数字・_ で、英字か _ で始めてください。",
          );
        }
        if (!value) throw new Error("値を入力してください。");
        const entries = { ...unlocked.entries, [name]: { value, hosts } };
        await unlocked.save(entries);
        unlocked.entries = entries;
        if (nameInput) nameInput.value = "";
        if (valueInput) valueInput.value = "";
        if (hostsInput) hostsInput.value = "";
        setStatus(`${name} を保存しました。`, "success");
      });

    const onRemoveSecret = (name: string) =>
      run(async () => {
        if (!unlocked || !confirm(`${name} を削除しますか？`)) return;
        const { [name]: _removed, ...rest } = unlocked.entries;
        await unlocked.save(rest);
        unlocked.entries = rest;
      });

    const onDeleteVault = () => {
      if (!confirm("この端末の秘密をすべて削除しますか？")) return;
      deleteVault();
      vaultExists = false;
      unlocked = null;
      handle.update();
    };

    // --- subscription ---------------------------------------------------------

    const onSubscribe = () =>
      run(async () => {
        const userId = sessionStore.userId;
        if (!userId) throw new Error("先にサインインしてください。");
        sub = await createSubscription(userId);
        startConnection();
        setStatus("この端末を承認者として登録しました。", "success");
      });

    const onForget = () =>
      run(async () => {
        if (
          !confirm(
            "この端末の登録を解除しますか？ この ID へのリクエストは誰も承認できなくなります。",
          )
        ) return;
        connection?.close();
        connection = null;
        await forgetSubscription();
        sub = null;
      });

    // --- requests -------------------------------------------------------------

    const onReject = (tx: Transaction) => {
      connection?.decide(tx.id, false);
    };

    const onApprove = (tx: Transaction) =>
      run(async () => {
        const conn = connection;
        if (!conn) return;
        // Every approval asks for the passkey; the secrets are dropped right after the call.
        const vault = await unlockVault();
        const problem = secretsProblem(tx.request, vault.entries);
        if (problem) throw new Error(problem);
        const secrets = Object.fromEntries(
          tx.request.secrets.map((name) => [name, vault.entries[name].value]),
        );
        conn.decide(tx.id, true);
        try {
          const result = await execute(tx.request, secrets);
          conn.complete(tx.id, result);
          setStatus(
            `実行しました (HTTP ${result.status})。結果はリクエスト元が受け取るまでこの画面に保持されます。`,
            "success",
          );
        } catch (e) {
          // Typically CORS: the API must allow this origin for a browser to call it.
          const message = errorText(e, "呼び出しに失敗しました");
          conn.fail(tx.id, message);
          throw new Error(
            `呼び出しに失敗しました: ${message}（API が CORS を許可していない可能性があります）`,
          );
        }
      });

    // --- view -----------------------------------------------------------------

    const endpoint = (path: string) =>
      isClientEnv ? new URL(path, location.href).href : path;

    const secretsCard = () => (
      <section mix={cardStyle}>
        <h2>秘密</h2>
        <p mix={mutedStyle}>
          秘密はこのブラウザーの localStorage
          に、パスキーで暗号化して保存します。 サーバーには送りません。
        </p>
        {!loaded && <p mix={mutedStyle} aria-busy="true">…</p>}
        {loaded && !passkeys && (
          <p mix={mutedStyle}>このブラウザーはパスキーに対応していません。</p>
        )}
        {loaded && !vaultExists && (
          <div mix={rowStyle}>
            <button
              type="button"
              disabled={busy}
              mix={[actionStyle, primaryStyle, on("click", onCreateVault)]}
            >
              パスキーを作成
            </button>
          </div>
        )}
        {vaultExists && !unlocked && (
          <div mix={rowStyle}>
            <button
              type="button"
              disabled={busy}
              mix={[actionStyle, primaryStyle, on("click", onUnlock)]}
            >
              パスキーで開いて編集
            </button>
            <button
              type="button"
              mix={[actionStyle, dangerStyle, on("click", onDeleteVault)]}
            >
              すべて削除
            </button>
          </div>
        )}
        {unlocked && (
          <div>
            <ul mix={listStyle}>
              {Object.keys(unlocked.entries).length === 0 && (
                <li mix={mutedStyle}>まだ秘密がありません。</li>
              )}
              {Object.entries(unlocked.entries).map(([name, entry]) => (
                <li mix={[itemStyle, secretRowStyle]} key={name}>
                  <code>[{name}]</code>
                  <span mix={mutedStyle}>
                    {entry.hosts.length
                      ? ` → ${entry.hosts.join(", ")} のみ`
                      : " → 送信先の制限なし"}
                  </span>
                  <button
                    type="button"
                    mix={[
                      actionStyle,
                      dangerStyle,
                      on("click", () =>
                        void onRemoveSecret(name)),
                    ]}
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
            <div mix={formStyle}>
              <input
                placeholder="名前 (例: GH_SECRET)"
                aria-label="秘密の名前"
                autocomplete="off"
                autocapitalize="characters"
                mix={[
                  inputStyle,
                  ref((n) => (nameInput = n as HTMLInputElement)),
                ]}
              />
              <input
                type="password"
                placeholder="値"
                aria-label="秘密の値"
                autocomplete="off"
                mix={[
                  inputStyle,
                  ref((n) => (valueInput = n as HTMLInputElement)),
                ]}
              />
              <input
                placeholder="送信を許すホスト (例: api.github.com、空なら制限なし)"
                aria-label="送信を許すホスト"
                autocomplete="off"
                autocapitalize="none"
                mix={[
                  inputStyle,
                  ref((n) => (hostsInput = n as HTMLInputElement)),
                ]}
              />
            </div>
            <div mix={rowStyle}>
              <button
                type="button"
                disabled={busy}
                mix={[actionStyle, primaryStyle, on("click", onAddSecret)]}
              >
                追加して保存
              </button>
              <button type="button" mix={[actionStyle, on("click", onLock)]}>
                閉じる
              </button>
              <button
                type="button"
                disabled={busy}
                mix={[actionStyle, on("click", onCreateVault)]}
              >
                パスキーを作り直す
              </button>
            </div>
          </div>
        )}
      </section>
    );

    const subscriptionCard = () => {
      const signedIn = !!sessionStore.userId;
      return (
        <section mix={cardStyle}>
          <h2>承認者の登録</h2>
          {!(ready && loaded) && !sub && (
            <p mix={mutedStyle} aria-busy="true">…</p>
          )}
          {ready && loaded && !sub && (
            <div>
              <p mix={mutedStyle}>
                リクエストが来たら、id.kbn.one 経由でこの端末に通知が届きます。
                先に <a href={routes.my.href()}>マイページ</a>{" "}
                でサインインし、通知を登録してください。 iPhone
                はホーム画面に追加してから開いてください。
              </p>
              <div mix={rowStyle}>
                <button
                  type="button"
                  disabled={busy || !signedIn}
                  mix={[actionStyle, primaryStyle, on("click", onSubscribe)]}
                >
                  この端末を承認者として登録
                </button>
              </div>
            </div>
          )}
          {sub && (
            <div>
              <p>
                接続:{" "}
                <strong>
                  {connection?.state === "online"
                    ? "オンライン"
                    : connection?.state === "connecting"
                    ? "接続中…"
                    : "オフライン"}
                </strong>
              </p>
              <p mix={mutedStyle}>
                リクエスト元はこの URL を使います。ID を知っている人は誰でも
                リクエストを送れるので、ID は秘密にしてください。
              </p>
              <pre mix={codeStyle}>{usage(endpoint, sub.id)}</pre>
              <div mix={rowStyle}>
                <button
                  type="button"
                  disabled={busy}
                  mix={[actionStyle, dangerStyle, on("click", onForget)]}
                >
                  登録を解除
                </button>
              </div>
            </div>
          )}
        </section>
      );
    };

    const requestsCard = () => {
      if (!connection) return null;
      const txs = [...connection.transactions.values()].sort((a, b) =>
        b.createdAt - a.createdAt
      );
      return (
        <section mix={cardStyle}>
          <h2>リクエスト</h2>
          {txs.length === 0 && (
            <p mix={mutedStyle}>承認待ちのリクエストはありません。</p>
          )}
          <ul mix={listStyle}>
            {txs.map((tx) => (
              <li
                key={tx.id}
                mix={[itemStyle, tx.id === focusTx ? focusStyle : null]}
              >
                <div mix={rowStyle}>
                  <strong>{methodOf(tx.request)}</strong>
                  <strong mix={hostStyle}>{safeHost(tx)}</strong>
                  <span mix={badgeStyle} data-status={tx.status}>
                    {STATUS_LABEL[tx.status]}
                  </span>
                </div>
                <dl mix={detailsStyle}>
                  <dt>URL</dt>
                  <dd>
                    <code>{tx.request.url}</code>
                  </dd>
                  <dt>使う秘密</dt>
                  <dd>
                    {tx.request.secrets.length
                      ? tx.request.secrets.map((s) => <code key={s}>[{s}]
                      </code>)
                      : "なし"}
                  </dd>
                  {tx.request.headers && (
                    <>
                      <dt>ヘッダー</dt>
                      <dd>
                        <pre mix={codeStyle}>
                          {Object.entries(tx.request.headers)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join("\n")}
                        </pre>
                      </dd>
                    </>
                  )}
                  {tx.request.body !== undefined && (
                    <>
                      <dt>ボディ</dt>
                      <dd>
                        <pre mix={codeStyle}>
                          {typeof tx.request.body === "string"
                            ? tx.request.body
                            : JSON.stringify(tx.request.body, null, 2)}
                        </pre>
                      </dd>
                    </>
                  )}
                  <dt>受付</dt>
                  <dd>{new Date(tx.createdAt).toLocaleString()}</dd>
                  {tx.error && (
                    <>
                      <dt>エラー</dt>
                      <dd>{tx.error}</dd>
                    </>
                  )}
                </dl>
                {tx.status === "pending" && (
                  <div mix={rowStyle}>
                    <button
                      type="button"
                      disabled={busy || connection?.state !== "online"}
                      mix={[
                        actionStyle,
                        primaryStyle,
                        on("click", () => void onApprove(tx)),
                      ]}
                    >
                      パスキーで承認して実行
                    </button>
                    <button
                      type="button"
                      disabled={connection?.state !== "online"}
                      mix={[
                        actionStyle,
                        dangerStyle,
                        on("click", () => onReject(tx)),
                      ]}
                    >
                      拒否
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      );
    };

    return () => (
      <div>
        {status && (
          <div role="alert" data-kind={status.kind} mix={alertStyle}>
            <span>{status.message}</span>
          </div>
        )}
        {requestsCard()}
        {subscriptionCard()}
        {secretsCard()}
      </div>
    );
  },
);

function safeHost(tx: Transaction): string {
  try {
    return hostOf(tx.request);
  } catch {
    return tx.request.url;
  }
}

function usage(endpoint: (path: string) => string, id: string): string {
  const req = endpoint(routes.api.sub.req.href({ id }));
  const res = endpoint(routes.api.sub.res.href({ id }));
  return `curl -X POST ${req} \\
  -H 'content-type: application/json' \\
  -d '{"secrets":["GH_SECRET"],"url":"https://api.github.com/user",
       "headers":{"authorization":"Bearer [GH_SECRET]"}}'
# → {"transaction_id":"…"}

curl '${res}?transaction_id=…'
# 承認されるまで待ち、結果を一度だけ返す (202 なら再度呼ぶ)`;
}

// --- styles -----------------------------------------------------------------

const mutedStyle = css({ color: color.muted, fontSize: "0.9rem" });

const listStyle = css({ listStyle: "none", padding: 0, margin: "1rem 0" });

const itemStyle = css({
  marginBlock: "0.75rem",
  padding: "0.9rem 1rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  background: color.bg,
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
});

const secretRowStyle = css({
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  "& button": { marginInlineStart: "auto" },
});

const focusStyle = css({ borderColor: color.accent, borderWidth: "2px" });

const hostStyle = css({ fontFamily: font.mono, wordBreak: "break-all" });

const badgeStyle = css({
  padding: "0.1rem 0.5rem",
  borderRadius: "999px",
  background: color.border,
  fontSize: "0.75rem",
  "&[data-status=pending]": {
    background: color.accent,
    color: color.onAccent,
  },
});

const detailsStyle = css({
  display: "grid",
  gridTemplateColumns: "max-content 1fr",
  gap: "0.25rem 1rem",
  margin: "0.5rem 0",
  fontSize: "0.9rem",
  "& dt": { color: color.muted },
  "& dd": { margin: 0, minWidth: 0, wordBreak: "break-all" },
  "& code": { marginInlineEnd: "0.4rem" },
});

const codeStyle = css({
  margin: 0,
  padding: "0.6rem 0.8rem",
  borderRadius: radius.sm,
  background: color.card,
  fontFamily: font.mono,
  fontSize: "0.8rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
});

const formStyle = css({
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  marginBlock: "0.5rem",
});

const inputStyle = css({
  padding: "0.55rem 0.7rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  background: color.bg,
  color: color.fg,
  font: "inherit",
});

const rowStyle = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.5rem",
  marginBlock: "0.25rem",
});
