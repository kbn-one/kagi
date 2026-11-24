/**
 * The approver's history: every request this phone has seen, kept in this browser's localStorage.
 *
 * The server forgets a transaction an hour after it arrives (`TX_RETENTION_MS`), and sends the
 * phone what it still has on each connection. The phone keeps its own copy of each one — the
 * request as the requester sent it (placeholders, never secret values) and how it ended — so the
 * approval screen can show what was approved, rejected or handed over long after the server has
 * dropped it. Results are never kept: they live in memory until the requester takes them
 * (`connection.ts`). Only a result's HTTP status is, on the entry of the phone that made the call
 * ({@link HistoryEntry}): the server never has it, so a sealed result stays sealed.
 *
 * The rest is the pure part of the screen: what status to show for an entry the server can no longer
 * update, the date format, and the range a swipe selects.
 */

import {
  FINAL_STATUSES,
  PENDING_TTL_MS,
  type Transaction,
  TX_RETENTION_MS,
  type TxStatus,
} from "./protocol.ts";

const HISTORY_KEY = "kagi.history";

/** A transaction as this phone keeps it: the server's copy, and what only this phone knows. */
export type HistoryEntry = Transaction & {
  /** The HTTP status of the result this phone handed over (never the body). */
  resultStatus?: number;
};
/**
 * Entries the approver deleted, by id, with when they arrived. The server sends what it still keeps
 * on every connection, so a deleted entry would come straight back; it is ignored until the server
 * has forgotten it too (`TX_RETENTION_MS`), and then the mark is dropped.
 */
const DELETED_KEY = "kagi.history.deleted";

/** Past this many entries the oldest are dropped. */
export const MAX_HISTORY = 300;

/** The entries stored on this phone, newest first. */
export function readHistory(storage: Storage = localStorage): HistoryEntry[] {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? sortNewestFirst(list as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeHistory(
  list: HistoryEntry[],
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch (e) {
    // A full storage loses the newest change, not the screen.
    console.warn("kagi: history not saved", e);
  }
}

export function clearHistory(storage: Storage = localStorage): void {
  storage.removeItem(HISTORY_KEY);
  storage.removeItem(DELETED_KEY);
}

/** Deleted ids (to `createdAt`), without the ones the server has forgotten by `now`. */
export function readDeleted(
  storage: Storage = localStorage,
  now = Date.now(),
): Map<string, number> {
  try {
    const raw = JSON.parse(storage.getItem(DELETED_KEY) ?? "{}") as Record<
      string,
      number
    >;
    return new Map(
      Object.entries(raw).filter(([, at]) =>
        typeof at === "number" && now - at <= TX_RETENTION_MS
      ),
    );
  } catch {
    return new Map();
  }
}

export function writeDeleted(
  deleted: ReadonlyMap<string, number>,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(DELETED_KEY, JSON.stringify(Object.fromEntries(deleted)));
  } catch (e) {
    console.warn("kagi: deletions not saved", e);
  }
}

const sortNewestFirst = <T extends Transaction>(list: T[]) =>
  [...list].sort((a, b) => b.createdAt - a.createdAt);

/**
 * `history` with `seen` folded in: a transaction the server sent replaces the stored copy, a new
 * one is added, a `deleted` one stays out. Newest first, at most {@link MAX_HISTORY}.
 */
export function mergeHistory(
  history: readonly HistoryEntry[],
  seen: Iterable<Transaction>,
  deleted: ReadonlyMap<string, number> = new Map(),
): HistoryEntry[] {
  const byId = new Map<string, HistoryEntry>(history.map((t) => [t.id, t]));
  for (const tx of seen) {
    if (deleted.has(tx.id)) continue;
    // The server's copy replaces ours, but it knows nothing of the result's status.
    const resultStatus = byId.get(tx.id)?.resultStatus;
    byId.set(tx.id, resultStatus === undefined ? tx : { ...tx, resultStatus });
  }
  return sortNewestFirst([...byId.values()]).slice(0, MAX_HISTORY);
}

/** `history` with the HTTP status of the result of `txId` recorded on its entry. */
export function withResultStatus(
  history: readonly HistoryEntry[],
  txId: string,
  resultStatus: number,
): HistoryEntry[] {
  return history.map((t) => t.id === txId ? { ...t, resultStatus } : t);
}

/**
 * `history` without `ids`, and `deleted` with them added (so the server's copy does not bring them
 * back).
 */
export function removeFromHistory(
  history: readonly HistoryEntry[],
  ids: Iterable<string>,
  deleted: ReadonlyMap<string, number> = new Map(),
): { history: HistoryEntry[]; deleted: Map<string, number> } {
  const drop = new Set(ids);
  const marks = new Map(deleted);
  for (const t of history) if (drop.has(t.id)) marks.set(t.id, t.createdAt);
  return { history: history.filter((t) => !drop.has(t.id)), deleted: marks };
}

/**
 * The status to show. The stored copy stops changing once the server forgets the transaction, so
 * one that was still open is shown as it must have ended: a request nobody decided on expires
 * after `PENDING_TTL_MS`, and a result nobody collected is gone with the server's copy.
 */
export function shownStatus(tx: Transaction, now = Date.now()): TxStatus {
  const age = now - tx.createdAt;
  if (
    (tx.status === "pending" || tx.status === "approved") &&
    age > PENDING_TTL_MS
  ) {
    return "expired";
  }
  if (tx.status === "done" && age > TX_RETENTION_MS) return "expired";
  return tx.status;
}

/** Whether the entry is finished, so it belongs in the folded history rather than the open list. */
export const isPast = (tx: Transaction, now = Date.now()): boolean =>
  FINAL_STATUSES.includes(shownStatus(tx, now));

const pad = (n: number) => String(n).padStart(2, "0");

/** `yyyy-mm-dd HH:mm`, in this phone's time zone. */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${
    pad(d.getHours())
  }:${pad(d.getMinutes())}`;
}

/**
 * The selection after a swipe from row `anchor` to row `current` over `ids` (in screen order):
 * `base` — the selection when the swipe began — with every row between the two set to `select`.
 * Swiping back shrinks the range again, because it is always worked out from `base`.
 */
export function selectRange(
  base: ReadonlySet<string>,
  ids: readonly string[],
  anchor: number,
  current: number,
  select: boolean,
): Set<string> {
  const out = new Set(base);
  const [from, to] = anchor <= current ? [anchor, current] : [current, anchor];
  for (let i = Math.max(0, from); i <= Math.min(ids.length - 1, to); i++) {
    if (select) out.add(ids[i]);
    else out.delete(ids[i]);
  }
  return out;
}
