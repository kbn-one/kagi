import type { Handle } from "@remix-run/component";

import { IDP_ORIGIN } from "../idp.ts";
import { routes } from "../routes.ts";
import { PushCard } from "../islands/push_card.tsx";
import { SignOutButton } from "../islands/signout_button.tsx";

export const title = "マイページ — kagi";
export const description =
  "id.kbn.one でサインインし、承認リクエストの通知を受け取る端末を登録する。";

/** The cards are islands. */
export const hydrate = true;

export default function My(_handle: Handle) {
  return () => (
    <>
      <meta name="idp-origin" content={IDP_ORIGIN} />
      <h1>マイページ</h1>
      <p>
        承認リクエストの通知は id.kbn.one 経由で届きます。ナビバー右上の「Sign
        In」から id.kbn.one にサインインし、この端末への通知を登録してから、
        <a href={routes.kagi.href()}>承認</a>{" "}
        の画面で端末を承認者として登録してください。
      </p>

      <PushCard idpOrigin={IDP_ORIGIN} />

      <SignOutButton />
    </>
  );
}
