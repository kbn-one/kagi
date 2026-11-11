/**
 * Shared types for the browser-side push subscription foundation.
 *
 * The RP (this app) does not store subscriptions itself — it manages the
 * signed-in user's subscriptions on the IdP (id.kbn.one) through DPoP-bound,
 * cross-origin requests to `${idpOrigin}/push/*`. These shapes mirror the
 * IdP's `/push/*` JSON responses.
 */

export interface PushSubscriptionMetadata {
  deviceName?: string;
  userAgent?: string;
  language?: string;
  timezone?: string;
  lastSuccessfulSendAt?: number;
  lastError?: string;
  lastErrorAt?: number;
}

export interface PushSubscriptionItem {
  id: string;
  endpoint: string;
  updatedAt: number;
  metadata?: PushSubscriptionMetadata;
}

export type PushAlertKind = "info" | "success" | "warning" | "error";

export interface PushManagerState {
  supported: boolean;
  permission: NotificationPermission;
  subscriptions: PushSubscriptionItem[];
  currentId: string | null;
  vapidKey: string | null;
  registration: ServiceWorkerRegistration | null;
  loading: boolean;
}

/** DPoP-bound fetch (string URL form), as produced by `@kuboon/dpop`. */
export type FetchDpop = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface PushManagerDeps {
  /** DPoP-bound fetch used for every IdP `/push/*` call. */
  fetchDpop: FetchDpop;
  /** Origin of the IdP (id.kbn.one) that owns the subscriptions. */
  idpOrigin: string;
  /** False during SSR; gates browser-only work (SW, Notification, IndexedDB). */
  isClientEnv: boolean;
  setStatus: (
    message: string,
    kind?: PushAlertKind,
    autoHide?: boolean,
  ) => void;
  onChange: () => void;
}
