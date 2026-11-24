import { assertEquals } from "@std/assert";

import {
  formatTime,
  isPast,
  MAX_HISTORY,
  mergeHistory,
  readDeleted,
  readHistory,
  removeFromHistory,
  selectRange,
  shownStatus,
  withResultStatus,
  writeDeleted,
  writeHistory,
} from "../../../client/lib/kagi/history.ts";
import {
  PENDING_TTL_MS,
  type Transaction,
  TX_RETENTION_MS,
} from "../../../client/lib/kagi/protocol.ts";

const tx = (
  id: string,
  createdAt: number,
  status: Transaction["status"] = "delivered",
): Transaction => ({
  id,
  createdAt,
  status,
  request: { secrets: [], url: "https://api.example/x" },
});

/** A `Storage` in memory. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

Deno.test("mergeHistory keeps the newest copy of each transaction, newest first, capped", () => {
  const stored = [tx("a", 1, "pending"), tx("b", 2)];
  const merged = mergeHistory(stored, [tx("a", 1, "delivered"), tx("c", 3)]);
  assertEquals(merged.map((t) => [t.id, t.status]), [
    ["c", "delivered"],
    ["b", "delivered"],
    ["a", "delivered"],
  ]);
  const many = Array.from(
    { length: MAX_HISTORY + 5 },
    (_, i) => tx(`t${i}`, i),
  );
  const capped = mergeHistory([], many);
  assertEquals(capped.length, MAX_HISTORY);
  assertEquals(capped[0].id, `t${MAX_HISTORY + 4}`);
});

Deno.test("the history survives a round trip through storage, and a broken one reads as empty", () => {
  const storage = memoryStorage();
  writeHistory([tx("a", 1), tx("b", 2)], storage);
  assertEquals(readHistory(storage).map((t) => t.id), ["b", "a"]);
  storage.setItem("kagi.history", "{not json");
  assertEquals(readHistory(storage), []);
});

Deno.test("a deleted entry stays deleted while the server still sends it, then the mark goes", () => {
  const storage = memoryStorage();
  const now = 5 * TX_RETENTION_MS;
  const a = tx("a", now - 1000);
  const b = tx("b", now - 2000);
  const { history, deleted } = removeFromHistory([a, b], ["a"]);
  assertEquals(history.map((t) => t.id), ["b"]);
  // The server sends both again on the next connection; only b comes back.
  assertEquals(mergeHistory(history, [a, b], deleted).map((t) => t.id), ["b"]);

  writeDeleted(deleted, storage);
  assertEquals([...readDeleted(storage, now).keys()], ["a"]);
  // Once the server has forgotten it, the mark is not needed.
  assertEquals(readDeleted(storage, now + TX_RETENTION_MS).size, 0);
});

Deno.test("an entry the server can no longer update is shown as it must have ended", () => {
  const now = 10 * TX_RETENTION_MS;
  assertEquals(shownStatus(tx("a", now - 1000, "pending"), now), "pending");
  assertEquals(
    shownStatus(tx("a", now - PENDING_TTL_MS - 1, "pending"), now),
    "expired",
  );
  assertEquals(
    shownStatus(tx("a", now - PENDING_TTL_MS - 1, "approved"), now),
    "expired",
  );
  assertEquals(
    shownStatus(tx("a", now - PENDING_TTL_MS - 1, "done"), now),
    "done",
  );
  assertEquals(
    shownStatus(tx("a", now - TX_RETENTION_MS - 1, "done"), now),
    "expired",
  );
  assertEquals(isPast(tx("a", now, "delivered"), now), true);
  assertEquals(isPast(tx("a", now, "done"), now), false);
});

Deno.test("formatTime is yyyy-mm-dd HH:mm in local time", () => {
  const ms = new Date(2026, 0, 5, 7, 3).getTime();
  assertEquals(formatTime(ms), "2026-01-05 07:03");
});

Deno.test("a swipe selects the rows between its start and the finger, worked out from where it began", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const base = new Set(["e"]);
  assertEquals([...selectRange(base, ids, 1, 3, true)].sort(), [
    "b",
    "c",
    "d",
    "e",
  ]);
  // Backwards, and back again: the range follows the finger, the rest is untouched.
  assertEquals([...selectRange(base, ids, 3, 1, true)].sort(), [
    "b",
    "c",
    "d",
    "e",
  ]);
  assertEquals([...selectRange(base, ids, 1, 1, true)].sort(), ["b", "e"]);
  // Starting on a selected row deselects.
  const all = new Set(ids);
  assertEquals([...selectRange(all, ids, 0, 2, false)].sort(), ["d", "e"]);
  // Out of range clamps.
  assertEquals(selectRange(new Set(), ids, -3, 99, true).size, 5);
});

Deno.test("a result's status is kept on this phone's entry, and survives the server's copy", () => {
  const sent: Transaction = {
    id: "a",
    request: { secrets: [], url: "https://api.example.com/x" },
    status: "done",
    createdAt: 1,
  };
  let history = mergeHistory([], [sent]);
  history = withResultStatus(history, "a", 404);
  assertEquals(history[0].resultStatus, 404);

  // The server sends the transaction again, delivered now, and without the status.
  const merged = mergeHistory(history, [{ ...sent, status: "delivered" }]);
  assertEquals(merged[0].status, "delivered");
  assertEquals(merged[0].resultStatus, 404);

  // An entry this phone never answered has none.
  const other = mergeHistory(merged, [{ ...sent, id: "b", createdAt: 2 }]);
  assertEquals(other.find((t) => t.id === "b")?.resultStatus, undefined);
});
