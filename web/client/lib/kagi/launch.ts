/**
 * A launch from the home-screen icon goes to the approver's screen, never the top page.
 *
 * The manifest's `start_url` is `/kagi` already, but a browser that ignores it (older iOS, an icon
 * added before the manifest said so) opens the URL the icon was added from — `/`. The top page
 * therefore carries {@link standaloneRedirectScript} in its `<head>`, which runs before anything is
 * drawn and replaces the history entry so "back" does not land on the top page again.
 *
 * The approver's screen links to the top page with {@link aboutHref}, whose `?about` keeps the
 * script from sending the reader straight back.
 */

/** The query parameter that lets a home-screen app show the top page on purpose. */
export const ABOUT_PARAM = "about";

/** The top page, as the approver's screen links to it: `/?about`. */
export const aboutHref = (home: string): string => `${home}?${ABOUT_PARAM}`;

/**
 * The inline script that sends a standalone launch to `target`.
 *
 * Standalone is `display-mode: standalone` (or `fullscreen`), or iOS Safari's own
 * `navigator.standalone`. A normal browser tab matches neither, so it sees the page unchanged.
 *
 * @param target Where to go, e.g. `/kagi`
 * @returns The script's source, for a `<script nonce>` in `<head>`
 */
export function standaloneRedirectScript(target: string): string {
  return `(function(){try{` +
    `if(new URLSearchParams(location.search).has(${
      JSON.stringify(ABOUT_PARAM)
    }))return;` +
    `var m=function(q){return matchMedia("(display-mode: "+q+")").matches};` +
    `if(m("standalone")||m("fullscreen")||navigator.standalone===true)` +
    `location.replace(${JSON.stringify(target)})` +
    `}catch(e){}})()`;
}
