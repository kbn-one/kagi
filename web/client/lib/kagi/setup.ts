/**
 * Where this phone is in setting kagi up: home screen → notifications → passkey.
 *
 * The device questions (is this the home-screen app, can it be installed here, will push work) are
 * `@kuboon/browser-how-to`'s; this module only adds the two things kagi itself remembers, in
 * localStorage: that the approver chose to carry on in the browser, and that notifications have
 * worked once.
 */

import { detectDevice, type DeviceInfo } from "@kuboon/browser-how-to";
import { type A2hsStatus, createA2hs } from "@kuboon/browser-how-to/a2hs";
import { detectPushStatus, type PushStatus } from "@kuboon/browser-how-to/push";

export type { A2hsStatus, DeviceInfo, PushStatus };

const BROWSER_MODE = "kagi.browserMode";
const PUSH_DONE = "kagi.pushDone";

/** One per page: importing `/a2hs` is what captures `beforeinstallprompt`. */
let a2hs: ReturnType<typeof createA2hs> | undefined;
export const installer = () => (a2hs ??= createA2hs());

export const device = (): DeviceInfo => detectDevice();

export const pushStatus = (): PushStatus => detectPushStatus();

/**
 * Whether the approver may skip the home screen and use the browser as it is. Not on iOS, where
 * Web Push reaches only a home-screen app.
 */
export const canUseBrowser = (): boolean =>
  pushStatus().support !== "needs-install";

export function browserModeChosen(): boolean {
  return localStorage.getItem(BROWSER_MODE) === "1";
}

export function chooseBrowserMode(): void {
  localStorage.setItem(BROWSER_MODE, "1");
}

/** Notifications have been on at least once on this phone. */
export function pushDone(): boolean {
  return localStorage.getItem(PUSH_DONE) === "1";
}

export function markPushDone(): void {
  localStorage.setItem(PUSH_DONE, "1");
}

export function forgetSetup(): void {
  localStorage.removeItem(PUSH_DONE);
}
