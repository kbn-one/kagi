import type { Handle } from "@remix-run/component";

import { IDP_ORIGIN } from "../idp.ts";
import { KagiApp } from "../islands/kagi_app.tsx";

export const title = "承認 — kagi";
export const description =
  "秘密をスマホのブラウザーに持ち、API コールを承認してから実行する。";

/** The whole screen is an island. */
export const hydrate = true;

export default function Kagi(_handle: Handle) {
  return () => (
    <>
      <meta name="idp-origin" content={IDP_ORIGIN} />
      <h1>承認</h1>
      <KagiApp />
    </>
  );
}
