/**
 * DemoCard — the "デモ" panel on the `/my` page, a `@remix-run/component` clientEntry.
 *
 * [feature:demo-panel] Everything here exists to explain the template, not to be part of an app:
 *
 * - "状態": the DPoP session status and this browser's key thumbprint.
 * - "仕組み": how the DPoP sign-in against the IdP (id.kbn.one) works.
 * - "サーバーから送信": the server-initiated push path. It calls this app's own `POST /api/notify`,
 *   which authenticates to the IdP with a `private_key_jwt` assertion and fans the notification out
 *   to the user's devices via `POST /rp/notifications`. An optional badge count is sent along and
 *   reaches the app badge (Badging API) through the service worker.
 *
 * A derived app deletes this file and its `<DemoCard>` in `pages/my.tsx` — see `TEMPLATE.md`.
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
import { actionStyle, alertStyle, cardStyle } from "../theme.ts";
import { color, radius } from "../tokens.ts";
import { routes } from "../routes.ts";

type AlertKind = "info" | "success" | "warning" | "error";

export interface DemoCardProps {
  idpOrigin: string;
  [key: string]: SerializableValue;
}

export const DemoCard = clientEntry(
  import.meta.url,
  function DemoCard(handle: Handle<DemoCardProps>) {
    let sending = false;
    let status: { message: string; kind: AlertKind } | null = null;
    let statusTimeout: ReturnType<typeof setTimeout> | null = null;
    let badgeInput: HTMLInputElement | undefined;

    if (typeof document !== "undefined") {
      // Re-render when the shared session changes: the send button needs a signed-in user.
      sessionStore.addEventListener("change", () => handle.update(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    const setStatus = (message: string, kind: AlertKind = "info") => {
      status = { message, kind };
      if (statusTimeout !== null) clearTimeout(statusTimeout);
      statusTimeout = setTimeout(() => {
        status = null;
        statusTimeout = null;
        handle.update();
      }, 4000);
      handle.update();
    };

    // Read the optional demo badge count from the number input.
    const readBadgeCount = (): number | undefined => {
      const raw = badgeInput?.value.trim();
      if (!raw) return undefined;
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 ? n : undefined;
    };

    // [feature:server-send] The button below and the `POST /api/notify` it calls.
    const onServerSend = async () => {
      const userId = sessionStore.userId;
      if (sending || !userId) return;
      sending = true;
      handle.update();
      try {
        const badgeCount = readBadgeCount();
        const notification: Record<string, unknown> = {
          title: "サーバーからの通知",
          body: badgeCount != null
            ? `バッジ数 ${badgeCount} を送信しました。`
            : "RP サーバーが id.kbn.one 経由で送信しました。",
          url: globalThis.location.href,
        };
        if (badgeCount != null) notification.badgeCount = badgeCount;
        const r = await fetch(routes.api.notify.href(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: [userId], notification }),
        });
        // Errors are RFC 9457 problems (`application/problem+json`): `detail` says what went wrong.
        const data = await r.json().catch(() => ({})) as {
          detail?: string;
          title?: string;
          results?: { ok?: boolean }[];
        };
        if (!r.ok) {
          throw new Error(
            data.detail ?? data.title ?? `送信に失敗しました (${r.status})`,
          );
        }
        const results = Array.isArray(data.results) ? data.results : [];
        const delivered = results.filter((x) => x?.ok).length;
        if (results.length === 0) {
          setStatus(
            "送信先のデバイスがありません。先に「通知」でこのデバイスを登録してください。",
            "warning",
          );
        } else {
          setStatus(
            `サーバーから ${delivered}/${results.length} 件の通知を送信しました。`,
            "success",
          );
        }
      } catch (e) {
        setStatus(
          e instanceof Error && e.message
            ? `サーバー送信に失敗しました: ${e.message}`
            : "サーバー送信に失敗しました。",
          "error",
        );
      } finally {
        sending = false;
        handle.update();
      }
    };

    return () => {
      const { idpOrigin } = handle.props;
      const ready = sessionStore.ready;
      const signedIn = sessionStore.userId !== null;
      const sessionText = !ready
        ? "セッションを確認しています…"
        : signedIn
        ? "セッションを取得しました。"
        : "";
      const sessionKind: AlertKind | "" = !ready
        ? "info"
        : signedIn
        ? "success"
        : "";
      const userInfo = signedIn
        ? `サインイン中: ${sessionStore.userId}`
        : ready
        ? "サインインしていません。"
        : "…";
      return (
        <section mix={cardStyle}>
          <h2>デモ</h2>
          <p mix={mutedStyle}>
            このパネルはテンプレートの説明用です。アプリを作るときは削除します。
          </p>

          <h3>状態</h3>
          <div role="alert" data-kind={sessionKind} mix={alertStyle}>
            <span>{sessionText}</span>
          </div>
          <p>{userInfo}</p>
          <p>
            このブラウザの DPoP thumbprint:{" "}
            <code>{sessionStore.thumbprint || "…"}</code>
          </p>
          {ready && !signedIn
            ? (
              <p>
                サインインするには、ナビバー右上の「Sign
                In」ボタンを使用してください。
              </p>
            )
            : null}

          <h3>仕組み</h3>
          <ol mix={listStyle}>
            <li>
              このページが <code>thumbprint</code> を計算
            </li>
            <li>
              「サインイン」で{" "}
              <code>{idpOrigin}/authorize?dpop_jkt&amp;redirect_uri</code>{" "}
              へ遷移
            </li>
            <li>
              IdP がパスキー認証 → <code>POST /bind_session</code>{" "}
              でこの thumbprint に userId を紐付け
            </li>
            <li>
              戻ってきたページで <code>fetchDpop GET {idpOrigin}/session</code>
              {" "}
              が userId を返す
            </li>
          </ol>

          <h3>サーバーから送信</h3>
          {status && (
            <div role="alert" data-kind={status.kind} mix={alertStyle}>
              <span>{status.message}</span>
            </div>
          )}
          <div mix={rowStyle}>
            <input
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              placeholder="バッジ数"
              aria-label="バッジ数"
              mix={[
                inputStyle,
                ref((node) => {
                  badgeInput = node as HTMLInputElement;
                }),
              ]}
            />
            <button
              type="button"
              disabled={sending || !sessionStore.userId}
              mix={[
                actionStyle,
                on("click", () => {
                  void onServerSend();
                }),
              ]}
            >
              サーバーから送信
            </button>
          </div>
          <p mix={mutedStyle}>
            「バッジ数」に数字を入れて送信すると、その値がアプリのバッジ
            (Badging API) に反映されます。空欄なら通常の通知のみ。
            「サーバーから送信」は <code>POST /api/notify</code>{" "}
            を使うため、サーバーが動いている環境 (Cloudflare Workers)
            でのみ動作します。静的に配信された GitHub Pages では送信できません。
          </p>
        </section>
      );
    };
  },
);

// --- styles -----------------------------------------------------------------

const mutedStyle = css({ color: color.muted, fontSize: "0.9rem" });

const listStyle = css({
  paddingLeft: "1.1rem",
  "& li": { marginBlock: "0.4rem" },
});

const rowStyle = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.5rem",
  marginBlock: "0.5rem",
});

const inputStyle = css({
  font: "inherit",
  width: "6rem",
  padding: "0.35rem 0.5rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  background: color.bg,
  color: color.fg,
});
