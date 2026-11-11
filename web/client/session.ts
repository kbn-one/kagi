/**
 * Shared DPoP session store for the browser.
 *
 * The navbar (NavAuth) and the /my cards (SignOutButton, PushCard, DemoCard) all need the
 * same session: this browser's DPoP key plus a `/session` probe against the
 * IdP. The islands are code-split out of one graph (`server/assets.ts`), so
 * this module is emitted once into a chunk they share and there is exactly one
 * instance. The DPoP init + `/session` probe run once
 * ({@link DpopSessionStore.load} is idempotent), and a typed `change` event
 * keeps every subscriber in sync — signing out in one card immediately updates
 * the navbar.
 *
 * Subscribe with `sessionStore.addEventListener("change", cb, { signal })`
 * using a clientEntry's `handle.signal` so the listener is removed on unmount.
 */

import { init } from "@kuboon/dpop";
import { TypedEventTarget } from "@remix-run/component";

import { IDP_ORIGIN } from "./idp.ts";

export type FetchDpop = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type SessionEventMap = { change: Event };

class DpopSessionStore extends TypedEventTarget<SessionEventMap> {
  /** DPoP-bound fetch, available once {@link load} resolves (null if init failed). */
  fetchDpop: FetchDpop | null = null;
  /** This browser's DPoP key thumbprint — needed to start the sign-in flow. */
  thumbprint = "";
  /** IdP user id, or `null` when signed out / not yet loaded. */
  userId: string | null = null;
  /** True once the initial probe has resolved (success or failure). */
  ready = false;

  #loading?: Promise<void>;

  /**
   * Generate/reuse the DPoP key and probe the IdP `/session` — once. Concurrent
   * and later callers share the single in-flight/resolved probe, so N
   * components trigger one `/session` request. Always resolves (even if DPoP
   * init fails) so subscribers leave the loading state.
   */
  load(): Promise<void> {
    return (this.#loading ??= (async () => {
      try {
        const { fetchDpop, thumbprint } = await init();
        this.fetchDpop = fetchDpop;
        this.thumbprint = thumbprint;
        try {
          const response = await fetchDpop(`${IDP_ORIGIN}/session`);
          if (response.ok) {
            const session = (await response.json()) as {
              userId: string | null;
            };
            this.userId = session.userId ?? null;
          }
        } catch {
          // Signed out: the cross-origin probe can 401 or reject.
          this.userId = null;
        }
      } catch {
        // DPoP init failed (e.g. no IndexedDB) — stay signed-out but ready.
      } finally {
        this.ready = true;
        this.#emitChange();
      }
    })());
  }

  /** Sign out at the IdP, then notify every subscriber. */
  async signOut(): Promise<void> {
    if (!this.fetchDpop) return;
    await this.fetchDpop(`${IDP_ORIGIN}/session/logout`, { method: "POST" });
    this.userId = null;
    this.#emitChange();
  }

  #emitChange(): void {
    this.dispatchEvent(new Event("change"));
  }
}

export const sessionStore: DpopSessionStore = new DpopSessionStore();
