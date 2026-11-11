/**
 * A fullscreen game page: the screen is the app, and there is nothing else on it.
 *
 * DELETE ME in a repository made from this template: this page, the island it imports
 * (`islands/fullscreen-game.tsx`), its route in `routes.ts`, its import and line in
 * `server/router.tsx`, and the nav link in `layout.tsx`. See the root README.
 *
 * The game is a placeholder. What this page carries is the frame a game needs from the document:
 * no site chrome around it, a stage that fills whatever the browser leaves visible, and one action
 * before the game that gets it the rest of the screen — tap to fullscreen where the Fullscreen API
 * exists, scroll to fullscreen on iPhone Safari where it does not. See the island.
 */

import type { Handle } from "@remix-run/component";

import { FullscreenGame } from "../islands/fullscreen-game.tsx";

export const title = "Fullscreen game — Remix3 on Deno Template";
export const description =
  "A game page that is the whole screen: no site chrome, safe-area insets, " +
  "and no zoom, scroll or text selection.";

/** This page places a client entry, so the shell boots the runtime for it. */
export const hydrate = true;

/** No header, nav or footer: the game is the whole of `<body>`. */
export const bare = true;

/**
 * `viewport-fit=cover` lets the stage reach the screen's edges and makes `env(safe-area-inset-*)`
 * non-zero. `maximum-scale=1, user-scalable=no` turns pinch zoom off where the browser honours it;
 * iOS does not, which the island handles.
 */
export const viewport =
  "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, " +
  "viewport-fit=cover";

export default function FullscreenPage(_handle: Handle) {
  return () => <FullscreenGame />;
}
