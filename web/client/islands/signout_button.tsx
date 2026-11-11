/**
 * SignOutButton — a @remix-run/component `clientEntry` for the /my page.
 *
 * Shows a sign-out button while the DPoP session is signed in, and nothing otherwise. Signing in
 * is initiated from the navbar (NavAuth), and the session status itself is shown by the demo panel
 * (DemoCard), so this is the one piece of the page an app keeps.
 *
 * As a clientEntry, the server emits a hydration marker that survives soft navigation, and the
 * page's `run()` (../hydration.ts) picks it up and hydrates in place.
 *
 * Setup runs on both server and client. Browser-only work (DPoP key gen via IndexedDB, IdP
 * probing) is gated on `typeof document !== "undefined"`.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/component";

import { sessionStore } from "../session.ts";
import { actionStyle, alertStyle } from "../theme.ts";

export interface SignOutButtonProps {
  [key: string]: SerializableValue;
}

export const SignOutButton = clientEntry(
  import.meta.url,
  function SignOutButton(handle: Handle<SignOutButtonProps>) {
    let busy = false;
    // Result of the last sign-out attempt; a success also removes the button, so it is the only
    // thing left on screen.
    let result: { message: string; kind: "success" | "error" } | null = null;

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => handle.update(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    const onSignoutClick = async () => {
      busy = true;
      result = null;
      handle.update();
      try {
        await sessionStore.signOut();
        result = { message: "サインアウトしました。", kind: "success" };
      } catch (error) {
        result = {
          message: `サインアウトに失敗: ${(error as Error).message}`,
          kind: "error",
        };
      } finally {
        busy = false;
        handle.update();
      }
    };

    return () => {
      const signedIn = sessionStore.ready && sessionStore.userId !== null;
      return (
        <div>
          {result && (
            <div role="alert" data-kind={result.kind} mix={alertStyle}>
              <span>{result.message}</span>
            </div>
          )}
          {signedIn
            ? (
              <button
                type="button"
                disabled={busy}
                mix={[actionStyle, on("click", onSignoutClick)]}
              >
                サインアウト
              </button>
            )
            : null}
        </div>
      );
    };
  },
);
