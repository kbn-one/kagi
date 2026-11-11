/**
 * PushCard — a `@remix-run/component` clientEntry for the `/my` page.
 *
 * The browser-facing half of the push foundation: it lets the signed-in user
 * register *this* device for notifications and manage every device registered
 * on the IdP (id.kbn.one). All subscription state is owned by the IdP and
 * reached through a DPoP-bound, cross-origin `fetchDpop` (see lib/push). The
 * service worker that receives the pushes is served from this origin (`/sw.js`,
 * under the deploy prefix).
 *
 * Setup runs on both server and client; browser-only work (DPoP key gen,
 * service worker, Notification) is gated on `typeof document !== "undefined"`.
 */

import {
  clientEntry,
  css,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/component";

import { sessionStore } from "../session.ts";
import {
  actionStyle,
  alertStyle,
  cardStyle,
  dangerStyle,
  primaryStyle,
} from "../theme.ts";
import { color, radius } from "../tokens.ts";
import {
  createPushManager,
  type PushManager,
  pushSummaryText,
} from "../lib/push/mod.ts";

type AlertKind = "info" | "success" | "warning" | "error";

export interface PushCardProps {
  idpOrigin: string;
  [key: string]: SerializableValue;
}

const isClientEnv = typeof globalThis !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined" &&
  typeof (globalThis as { window?: unknown }).window !== "undefined";

const formatDate = (value: number): string => {
  try {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
  } catch {
    return "-";
  }
};

export const PushCard = clientEntry(
  import.meta.url,
  function PushCard(handle: Handle<PushCardProps>) {
    let phase: "loading" | "signedout" | "ready" | "error" = "loading";
    let errorMessage: string | null = null;

    let status: { message: string; kind: AlertKind } | null = null;
    let statusTimeout: ReturnType<typeof setTimeout> | null = null;

    let pushManager: PushManager | null = null;

    const setStatus = (
      message: string,
      kind: AlertKind = "info",
      autoHide = false,
    ) => {
      status = { message, kind };
      if (statusTimeout !== null) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
      }
      if (autoHide) {
        statusTimeout = setTimeout(() => {
          status = null;
          statusTimeout = null;
          handle.update();
        }, 4000);
      }
      handle.update();
    };

    const initialize = async () => {
      try {
        await sessionStore.load();
        if (!sessionStore.fetchDpop) {
          throw new Error("DPoP セッションを初期化できませんでした。");
        }
        pushManager = createPushManager({
          fetchDpop: sessionStore.fetchDpop,
          idpOrigin: handle.props.idpOrigin,
          isClientEnv,
          setStatus,
          onChange: () => handle.update(),
        });
        pushManager.init();
        if (!sessionStore.userId) {
          phase = "signedout";
          handle.update();
          return;
        }
        await pushManager.load(true);
        phase = "ready";
      } catch (e) {
        phase = "error";
        errorMessage = e instanceof Error
          ? e.message
          : "通知設定を取得できませんでした。";
      }
      handle.update();
    };

    if (isClientEnv) {
      void initialize();
    }

    const onSubscribe = () => {
      if (!pushManager) return;
      void pushManager.subscribe();
    };

    const onRename = async (id: string, current: string) => {
      if (!pushManager) return;
      const next = globalThis.prompt("通知デバイスの新しい名前", current);
      if (next === null) return;
      await pushManager.rename(id, next);
    };

    return () => {
      const push = pushManager?.state ?? null;
      return (
        <section mix={cardStyle}>
          <h2>通知</h2>
          {push && (
            <p mix={mutedStyle}>
              {pushSummaryText({
                supported: push.supported,
                permission: push.permission,
                hasSubscription: push.currentId != null,
              })}
            </p>
          )}

          {status && (
            <div role="alert" data-kind={status.kind} mix={alertStyle}>
              <span>{status.message}</span>
            </div>
          )}

          {phase === "loading" && <p mix={mutedStyle} aria-busy="true">…</p>}

          {phase === "signedout" && (
            <p mix={mutedStyle}>
              通知を設定するには、ナビバー右上の「Sign
              In」からサインインしてください。
            </p>
          )}

          {phase === "error" && (
            <div role="alert" data-kind="error" mix={alertStyle}>
              <span>{errorMessage ?? "エラーが発生しました。"}</span>
            </div>
          )}

          {
            /*
              Must be wrapped in a single element, not a bare <>…</> fragment:
              the client reconciler does not commit a fragment when it replaces
              a previously-empty conditional slot (handle.update silently
              no-ops), which would freeze the card on the "loading" render.
            */
          }
          {phase === "ready" && push && (
            <div>
              <ul mix={listStyle}>
                {push.subscriptions.length === 0 && (
                  <li mix={mutedStyle}>
                    まだ通知を受け取るデバイスが登録されていません。
                  </li>
                )}
                {push.subscriptions.map((s) => (
                  <li mix={itemStyle}>
                    <div>
                      <strong>
                        {s.metadata?.deviceName?.trim() || "登録済みデバイス"}
                      </strong>
                      {push.currentId === s.id && (
                        <span mix={badgeStyle}>このデバイス</span>
                      )}
                    </div>
                    <dl mix={detailsStyle}>
                      <div>
                        <dt>更新日</dt>
                        <dd>{formatDate(s.updatedAt)}</dd>
                      </div>
                      <div>
                        <dt>最終通知</dt>
                        <dd>
                          {s.metadata?.lastSuccessfulSendAt
                            ? formatDate(s.metadata.lastSuccessfulSendAt)
                            : "-"}
                        </dd>
                      </div>
                    </dl>
                    <div mix={rowStyle}>
                      <button
                        type="button"
                        mix={[
                          actionStyle,
                          on("click", () => {
                            void onRename(
                              s.id,
                              s.metadata?.deviceName?.trim() ?? "",
                            );
                          }),
                        ]}
                      >
                        名前を変更
                      </button>
                      <button
                        type="button"
                        mix={[
                          actionStyle,
                          on("click", () => {
                            void pushManager?.test(s.id);
                          }),
                        ]}
                      >
                        テスト通知
                      </button>
                      <button
                        type="button"
                        mix={[
                          actionStyle,
                          dangerStyle,
                          on("click", () => {
                            void pushManager?.remove(s.id);
                          }),
                        ]}
                      >
                        解除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {!push.supported && (
                <p mix={mutedStyle}>
                  このブラウザーは Web Push に対応していません。
                </p>
              )}

              <div mix={rowStyle}>
                <button
                  type="button"
                  disabled={!push.supported ||
                    push.permission === "denied" ||
                    push.loading}
                  mix={[actionStyle, primaryStyle, on("click", onSubscribe)]}
                >
                  {push.currentId && push.permission === "granted"
                    ? "このデバイスを更新"
                    : "このデバイスへの通知を登録"}
                </button>
              </div>
            </div>
          )}
        </section>
      );
    };
  },
);

// --- styles -----------------------------------------------------------------

const mutedStyle = css({ color: color.muted, fontSize: "0.9rem" });

const listStyle = css({ listStyle: "none", padding: 0, margin: "1rem 0" });

const itemStyle = css({
  marginBlock: "0.75rem",
  padding: "0.9rem 1rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  background: color.bg,
});

const badgeStyle = css({
  marginInlineStart: "0.6rem",
  padding: "0.1rem 0.5rem",
  borderRadius: "999px",
  background: color.accent,
  color: color.onAccent,
  fontSize: "0.75rem",
});

const detailsStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.25rem 1.5rem",
  margin: "0.5rem 0",
  fontSize: "0.9rem",
  "& > div": { display: "flex", gap: "0.5rem" },
  "& dt": { color: color.muted },
  "& dd": { margin: 0, fontWeight: 600 },
});

const rowStyle = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.5rem",
  marginBlock: "0.5rem",
});
