/**
 * SetupCta — the top page's call to action: add kagi to the home screen, or open it.
 *
 * The server cannot tell a phone from a laptop or a browser tab from the home-screen app, so it
 * renders a plain link to `/kagi`; once hydrated this picks what to say from the device
 * (`lib/kagi/setup.ts`).
 */

import { clientEntry, css, type Handle, on } from "@remix-run/component";
import { showA2hsGuide } from "@kuboon/browser-how-to/a2hs/ui";

import { routes } from "../routes.ts";
import { actionStyle, primaryStyle } from "../theme.ts";
import { color } from "../tokens.ts";
import { readSubscription } from "../lib/kagi/device.ts";
import {
  canUseBrowser,
  chooseBrowserMode,
  device,
  installer,
} from "../lib/kagi/setup.ts";

type View =
  | { kind: "loading" }
  | { kind: "open" }
  | { kind: "install"; canPrompt: boolean }
  | { kind: "installed" }
  | { kind: "in-app"; app: string }
  | { kind: "desktop" };

const isClientEnv = typeof document !== "undefined";

export const SetupCta = clientEntry(
  import.meta.url,
  function SetupCta(handle: Handle) {
    let view: View = { kind: "loading" };
    let message = "";

    const read = (): View => {
      const d = device();
      if (d.isStandalone || readSubscription()) return { kind: "open" };
      const status = installer().getStatus();
      if (status.support === "in-app-blocked") {
        return { kind: "in-app", app: d.inApp.appLabel ?? "アプリ" };
      }
      if (status.support === "installed") return { kind: "installed" };
      if (d.platform === "desktop" && !status.canPrompt) {
        return { kind: "desktop" };
      }
      return { kind: "install", canPrompt: status.canPrompt };
    };

    if (isClientEnv) {
      // After hydration, so the first render matches the server's.
      setTimeout(() => {
        if (handle.signal.aborted) return;
        view = read();
        handle.update();
        handle.signal.addEventListener(
          "abort",
          installer().onChange(() => {
            view = read();
            handle.update();
          }),
        );
      }, 0);
    }

    const onInstall = async () => {
      const a2hs = installer();
      if (!a2hs.getStatus().canPrompt) {
        showA2hsGuide();
        return;
      }
      if (await a2hs.promptInstall() === "accepted") {
        message = "追加しました。ホーム画面の kagi から開いてください。";
        handle.update();
      }
    };

    const onBrowser = () => {
      chooseBrowserMode();
      location.href = routes.kagi.href();
    };

    const openButton = (label: string) => (
      <a href={routes.kagi.href()} mix={[actionStyle, primaryStyle, linkStyle]}>
        {label}
      </a>
    );

    const browserLink = () =>
      canUseBrowser() && (
        <p mix={mutedStyle}>
          <button type="button" mix={[textButtonStyle, on("click", onBrowser)]}>
            追加せずにこのブラウザーで使う
          </button>
        </p>
      );

    return () => (
      <div mix={boxStyle}>
        {view.kind === "loading" && openButton("はじめる")}
        {view.kind === "open" && openButton("承認画面を開く")}
        {view.kind === "install" && (
          <>
            <p>
              まずスマホのホーム画面に追加してください。通知はホーム画面のアプリに届きます。
            </p>
            <button
              type="button"
              mix={[actionStyle, primaryStyle, on("click", onInstall)]}
            >
              {view.canPrompt ? "ホーム画面に追加" : "ホーム画面に追加する方法"}
            </button>
            {browserLink()}
          </>
        )}
        {view.kind === "installed" && (
          <>
            <p>
              ホーム画面に追加済みです。ホーム画面の <strong>kagi</strong>{" "}
              から開いてください。
            </p>
            {browserLink()}
          </>
        )}
        {view.kind === "in-app" && (
          <>
            <p>
              {view.app}{" "}
              の中のブラウザーでは使えません。いつものブラウザーで開いてください。
            </p>
            <button
              type="button"
              mix={[
                actionStyle,
                primaryStyle,
                on("click", () => void installer().escapeInAppBrowser()),
              ]}
            >
              ブラウザーで開く
            </button>
          </>
        )}
        {view.kind === "desktop" && (
          <>
            <p>
              承認はスマホで行います。スマホのブラウザーで{" "}
              <strong>{isClientEnv ? location.host : "kagi.kbn.one"}</strong>
              {" "}
              を開いてください。
            </p>
            {browserLink()}
          </>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    );
  },
);

const boxStyle = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "0.5rem",
  "& p": { margin: 0 },
});

const linkStyle = css({ textDecoration: "none", display: "inline-block" });

const mutedStyle = css({ color: color.muted, fontSize: "0.9rem" });

const textButtonStyle = css({
  padding: 0,
  border: "none",
  background: "none",
  color: color.accent,
  font: "inherit",
  textDecoration: "underline",
  cursor: "pointer",
});
