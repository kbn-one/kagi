/**
 * Browser push-subscription manager for the RP (this app).
 *
 * The subscriptions live on the IdP (id.kbn.one): this manager registers a
 * service worker on *this* origin to receive push events, but performs every
 * read/write of the subscription itself against the IdP's `/push/*` endpoints
 * via a DPoP-bound, cross-origin `fetchDpop`. The VAPID application server key
 * is the IdP's — the IdP signs and sends the actual push messages
 * (`POST /rp/notifications`); the browser only manages its registration here.
 *
 * Adapted from id.kbn.one's own in-origin push manager: the only structural
 * difference is that all endpoints are prefixed with `idpOrigin`.
 */

import type {
  PushManagerDeps,
  PushManagerState,
  PushSubscriptionItem,
} from "./types.ts";
import { collectPushMetadata } from "./device.ts";

const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const data = await response.clone().json();
    if (
      data && typeof data === "object" &&
      typeof (data as { message?: unknown }).message === "string"
    ) {
      const m = (data as { message: string }).message.trim();
      if (m) return m;
    }
  } catch { /* ignore */ }
  try {
    const text = await response.text();
    if (text.trim()) return text.trim();
  } catch { /* ignore */ }
  return `リクエストがステータス${response.status}で失敗しました`;
};

export interface PushManager {
  readonly state: PushManagerState;
  init(): void;
  load(initial?: boolean): Promise<void>;
  subscribe(): Promise<void>;
  remove(id: string): Promise<void>;
  test(id: string): Promise<void>;
  rename(id: string, raw: string): Promise<boolean>;
}

export function createPushManager(deps: PushManagerDeps): PushManager {
  const { fetchDpop, idpOrigin, isClientEnv, setStatus, onChange } = deps;

  /** Absolute IdP URL for a `/push/*` path. */
  const idp = (path: string): string => `${idpOrigin}${path}`;

  const state: PushManagerState = {
    supported: false,
    permission: "default",
    subscriptions: [],
    currentId: null,
    vapidKey: null,
    registration: null,
    loading: false,
  };

  const init = (): void => {
    if (!isClientEnv) return;
    state.supported = "serviceWorker" in navigator &&
      "PushManager" in window && "Notification" in window;
    state.permission = typeof Notification !== "undefined"
      ? Notification.permission
      : "default";
  };

  const ensureRegistration = async (): Promise<ServiceWorkerRegistration> => {
    if (!isClientEnv || !state.supported) {
      throw new Error("このブラウザーでは通知を利用できません。");
    }
    if (state.registration) return state.registration;
    try {
      if (!navigator.serviceWorker.controller) {
        await navigator.serviceWorker.register("/sw.js");
      }
      state.registration = await navigator.serviceWorker.ready;
      return state.registration;
    } catch {
      throw new Error("サービスワーカーを初期化できませんでした。");
    }
  };

  const fetchVapidKey = async (): Promise<string> => {
    if (state.vapidKey) return state.vapidKey;
    const r = await fetchDpop(idp("/push/vapid-key"));
    if (!r.ok) throw new Error(await extractErrorMessage(r));
    const data = await r.json() as { publicKey?: string };
    if (!data?.publicKey) {
      throw new Error("サーバーから鍵を取得できませんでした。");
    }
    state.vapidKey = data.publicKey;
    return data.publicKey;
  };

  const ensurePermission = async (): Promise<NotificationPermission> => {
    if (!isClientEnv || !state.supported) {
      throw new Error("このブラウザーでは通知を利用できません。");
    }
    if (Notification.permission !== "default") {
      state.permission = Notification.permission;
      return Notification.permission;
    }
    const permission = await Notification.requestPermission();
    state.permission = permission;
    return permission;
  };

  const load = async (initial = false): Promise<void> => {
    try {
      const r = await fetchDpop(idp("/push/subscriptions"));
      if (!r.ok) throw new Error(await extractErrorMessage(r));
      const data = await r.json() as {
        subscriptions?: PushSubscriptionItem[];
      };
      const subs = Array.isArray(data.subscriptions) ? data.subscriptions : [];
      state.subscriptions = subs;
      if (initial && isClientEnv && state.supported) {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          const existing = await reg?.pushManager.getSubscription();
          if (existing) {
            const match = subs.find((s) => s.endpoint === existing.endpoint);
            if (match) state.currentId = match.id;
          }
        } catch { /* ignore */ }
      } else if (
        state.currentId && !subs.some((s) => s.id === state.currentId)
      ) {
        state.currentId = null;
      }
    } catch (e) {
      state.subscriptions = [];
      state.currentId = null;
      setStatus(
        e instanceof Error && e.message
          ? `通知設定を取得できませんでした: ${e.message}`
          : "通知設定を取得できませんでした。",
        "error",
      );
    }
    onChange();
  };

  const subscribe = async (): Promise<void> => {
    if (state.loading) return;
    state.loading = true;
    onChange();
    try {
      const permission = await ensurePermission();
      if (permission !== "granted") {
        throw new Error(
          "通知が許可されていません。ブラウザーの設定をご確認ください。",
        );
      }
      const registration = await ensureRegistration();
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ??
        await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: await fetchVapidKey(),
        });
      const r = await fetchDpop(idp("/push/subscriptions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          metadata: collectPushMetadata(),
        }),
      });
      if (!r.ok) throw new Error(await extractErrorMessage(r));
      const data = await r.json() as { subscription?: { id?: string } };
      if (data?.subscription?.id) state.currentId = data.subscription.id;
      setStatus("通知を有効化しました。", "success");
      await load();
    } catch (e) {
      setStatus(
        e instanceof Error && e.message
          ? `通知を有効にできませんでした: ${e.message}`
          : "通知を有効にできませんでした。",
        "error",
      );
    } finally {
      state.loading = false;
      onChange();
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!id) return;
    if (!confirm("このデバイスの通知登録を解除しますか？")) return;
    try {
      const r = await fetchDpop(
        idp(`/push/subscriptions/${encodeURIComponent(id)}`),
        { method: "DELETE" },
      );
      if (!r.ok) throw new Error(await extractErrorMessage(r));
      if (state.currentId === id) {
        try {
          const registration = await ensureRegistration();
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) await subscription.unsubscribe();
        } catch { /* ignore */ }
        state.currentId = null;
      }
      setStatus("通知の登録を解除しました。", "success");
      await load();
    } catch (e) {
      setStatus(
        e instanceof Error && e.message
          ? `通知の解除に失敗しました: ${e.message}`
          : "通知の解除に失敗しました。",
        "error",
      );
    }
    onChange();
  };

  const test = async (id: string): Promise<void> => {
    if (!id) return;
    try {
      const r = await fetchDpop(idp("/push/notifications/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: id }),
      });
      if (!r.ok) throw new Error(await extractErrorMessage(r));
      const data = await r.json() as {
        warnings?: unknown[];
        removed?: boolean;
      };
      const warnings = Array.isArray(data?.warnings)
        ? data.warnings.filter((w): w is string =>
          typeof w === "string" && w.trim().length > 0
        )
        : [];
      if (data?.removed) {
        setStatus(
          warnings.length
            ? `通知の登録を削除しました。${warnings.join(" ")}`
            : "通知が無効になっていたため登録を削除しました。",
          "info",
        );
      } else {
        setStatus(
          warnings.length
            ? `テスト通知を送信しました。（${warnings.join(" ")}）`
            : "テスト通知を送信しました。",
          "success",
        );
      }
      await load();
    } catch (e) {
      setStatus(
        e instanceof Error && e.message
          ? `テスト通知の送信に失敗しました: ${e.message}`
          : "テスト通知の送信に失敗しました。",
        "error",
      );
    }
    onChange();
  };

  const rename = async (id: string, raw: string): Promise<boolean> => {
    const name = raw.trim();
    if (!name) {
      setStatus("通知デバイスの名前を入力してください。", "error");
      return false;
    }
    try {
      const r = await fetchDpop(
        idp(`/push/subscriptions/${encodeURIComponent(id)}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: { deviceName: name } }),
        },
      );
      if (!r.ok) throw new Error(await extractErrorMessage(r));
      setStatus(
        `通知デバイスの名前を「${name}」に更新しました。`,
        "success",
        true,
      );
      await load();
      onChange();
      return true;
    } catch (e) {
      setStatus(
        e instanceof Error && e.message
          ? `通知デバイスの更新に失敗しました: ${e.message}`
          : "通知デバイスの更新に失敗しました。",
        "error",
      );
      onChange();
      return false;
    }
  };

  return { state, init, load, subscribe, remove, test, rename };
}
