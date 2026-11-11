/**
 * Device metadata helpers for the push subscription UI.
 *
 * `collectPushMetadata()` is sent alongside a new subscription so the IdP can
 * label each registered device; `pushSummaryText()` drives the human-readable
 * status line.
 */

import type { PushSubscriptionMetadata } from "./types.ts";

const isClientEnv = typeof globalThis !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined" &&
  typeof (globalThis as { window?: unknown }).window !== "undefined";

export const detectDeviceName = (): string => {
  if (!isClientEnv) return "このデバイス";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android")) {
    return ua.includes("mobile")
      ? "Android スマートフォン"
      : "Android デバイス";
  }
  if (ua.includes("windows")) return "Windows PC";
  if (ua.includes("mac os")) return "Mac";
  if (ua.includes("linux")) return "Linux";
  return "このデバイス";
};

export const collectPushMetadata = (): PushSubscriptionMetadata => {
  if (!isClientEnv) return {};
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch { /* ignore */ }
  return {
    deviceName: detectDeviceName(),
    userAgent: navigator.userAgent,
    language: typeof navigator.language === "string"
      ? navigator.language
      : undefined,
    timezone,
  };
};

export const pushSummaryText = (s: {
  supported: boolean;
  permission: NotificationPermission;
  hasSubscription: boolean;
}): string => {
  if (s.supported && s.permission === "denied") {
    return "通知がブロックされています。ブラウザーの設定から通知を許可してください。";
  }
  if (s.supported && s.permission === "granted") {
    return "通知が許可されています。テスト通知を送信して動作を確認できます。";
  }
  return "通知を許可すると id.kbn.one 経由でこのデバイスへプッシュ通知を送れます。";
};
