/**
 * The two navigations the runtime should not be handling, handed back to the browser.
 *
 * Calling `run()` — either one, `@remix-run/component`'s or `@remix-run/spa`'s — starts a Navigation API
 * listener that intercepts every same-origin navigation it can. Two of those are not navigations
 * at all in the sense the runtime means, and intercepting them is a regression rather than an
 * enhancement:
 *
 * - **A jump to a `#fragment` on the page you are already on.** The browser moves the scroll
 *   position and nothing else. Intercepted, it becomes a fetch of the whole page and a full
 *   reconciliation of the DOM — measurably so: one click on a chip in the UI showcase pulled the
 *   document again and re-hydrated eighteen islands to do what the browser does for free.
 * - **A reload.** F5, the toolbar button, `location.reload()`. Intercepted, it reconciles the new
 *   HTML into the document that is already open, which is very nearly a reload except for the part
 *   people reload *for*: component state survives it. A counter at 3 is still at 3 afterwards.
 *
 * Remix's own documentation site ships this same guard in its browser entry, with a comment saying
 * to remove it once `@remix-run/component` ignores these itself, so this is a workaround with an expiry date
 * rather than a disagreement with the framework. Check it against `@remix-run/component`'s changelog when
 * bumping the version, and delete this file when it lands upstream.
 *
 * `stopImmediatePropagation()` in the capture phase is what hands the navigation back: the
 * runtime's own listener never sees the event, so it never calls `intercept()`, and the browser
 * does what it would have done with no JavaScript on the page at all. It has to be installed
 * before `run()` for the capture-phase ordering to be guaranteed.
 */

/** The Navigation API, where there is one. Older Safari and Firefox have none, and need no guard. */
type NavigationTarget = {
  addEventListener(
    type: "navigate",
    listener: (event: NavigateEventLike) => void,
    options?: { capture?: boolean },
  ): void;
};

/** The part of `NavigateEvent` this reads. Typed here because `client/` has no DOM navigation lib. */
interface NavigateEventLike {
  navigationType?: string;
  destination?: { url?: string };
  stopImmediatePropagation(): void;
}

/**
 * Installs the guard. Call it before `run()`.
 *
 * @returns Nothing — the listener lives as long as the document does
 */
export function guardBrowserNavigations(): void {
  const navigation = (globalThis as { navigation?: NavigationTarget })
    .navigation;
  if (!navigation) return;

  navigation.addEventListener("navigate", (event) => {
    if (event.navigationType === "reload") {
      event.stopImmediatePropagation();
      return;
    }

    const destination = event.destination?.url;
    if (destination !== undefined && isSameDocumentHash(destination)) {
      event.stopImmediatePropagation();
    }
  }, { capture: true });
}

/**
 * Whether a destination is this document with a different fragment.
 *
 * Everything but the hash has to match, and one of the two hashes has to be non-empty — a
 * navigation to the exact same URL with no fragment on either side is a reload, which the caller
 * has already dealt with by the time this is asked.
 *
 * @param destination The destination URL, as the event reports it
 * @returns Whether the browser can be left to scroll
 */
function isSameDocumentHash(destination: string): boolean {
  let current: URL;
  let target: URL;
  try {
    current = new URL(location.href);
    target = new URL(destination, current);
  } catch {
    return false;
  }

  return current.origin === target.origin &&
    current.pathname === target.pathname &&
    current.search === target.search &&
    (current.hash !== "" || target.hash !== "");
}
