/**
 * A cross-island singleton: module-level state two separate client entrypoints both import.
 *
 * This is the module that makes the bundling strategy observable. `counter.tsx` writes to it and
 * `total.tsx` reads from it, and they are *different* browser entrypoints. If each were compiled on
 * its own, each would get a private copy — the counter would bump its copy, the total would read
 * its own, and the page would show a total that never moves.
 *
 * It works because every island is compiled as one graph, so this module is emitted once into a
 * chunk they share. Nothing here is anchored on `globalThis`; it is a plain module-level instance,
 * which is the whole point.
 *
 * It is a `TypedEventTarget` rather than a hand-rolled listener set because that is what a
 * component can unsubscribe from without being handed a function to keep: `addEventListener(…,
 * { signal: handle.signal })` ends the subscription when the component disconnects, and a
 * subscriber that forgets is a subscriber that outlives its own island. Which matters here even
 * though nothing on this site ever unmounts a counter by hand: an internal link is a soft
 * navigation, so leaving the home page and coming back disposes these islands and hydrates new
 * ones, in a document that has been running since the first page load.
 */

import { TypedEventTarget } from "@remix-run/component";

/** The sum of every counter's value on the page, shared by every island. */
class ClickStore extends TypedEventTarget<{ change: Event }> {
  #total = 0;

  /** What all the counters currently add up to. */
  get total(): number {
    return this.#total;
  }

  /**
   * Adds a change in some counter's value and notifies subscribers.
   *
   * A counter registers its starting value on mount and takes it back out on unmount, so the total
   * is the sum of the counters that are on the page — `+1` for an increment, `-1` for a decrement.
   *
   * @param by How much to add (negative to subtract)
   */
  bump(by: number): void {
    if (by === 0) return;
    this.#total += by;
    this.dispatchEvent(new Event("change"));
  }
}

export const clicks: ClickStore = new ClickStore();
