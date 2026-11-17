import type { Handle } from "@remix-run/component";

import { KagiApp } from "../islands/kagi_app.tsx";

export const title = "kagi";
export const description =
  "秘密をスマホのブラウザーに持ち、API コールを承認してから実行する。";

/** The whole screen is an island. */
export const hydrate = true;

/** The home-screen app: the island's tab bar is the navigation, so no site header or footer. */
export const frame = "app";

export default function Kagi(_handle: Handle) {
  return () => <KagiApp />;
}
