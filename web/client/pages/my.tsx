import type { Handle } from "@remix-run/component";

import { IDP_ORIGIN } from "../idp.ts";
import { DemoCard } from "../islands/demo_card.tsx";
import { PushCard } from "../islands/push_card.tsx";
import { SignOutButton } from "../islands/signout_button.tsx";

export const title = "マイページ — Remix3 on Deno Template";
export const description =
  "外部 IdP (id.kbn.one) を使ったサインインとプッシュ通知のサンプル。";

/** The cards are islands. */
export const hydrate = true;

export default function My(_handle: Handle) {
  return () => (
    <>
      <meta name="idp-origin" content={IDP_ORIGIN} />
      <h1>マイページ</h1>
      <p>
        このページは外部 IdP (id.kbn.one) を使ったサインイン UX のサンプルです。
        DPoP 鍵を生成し、IdP に thumbprint を bind してもらうことで Cookie
        レスにセッションを共有します。 サインインはナビバー右上の「Sign
        In」から行います。
      </p>

      <PushCard idpOrigin={IDP_ORIGIN} />

      <SignOutButton />

      {/* [feature:demo-panel] */}
      <DemoCard idpOrigin={IDP_ORIGIN} />
    </>
  );
}
