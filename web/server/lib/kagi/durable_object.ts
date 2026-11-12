/**
 * `KagiRoom` — the Durable Object behind one subscription id on Cloudflare.
 *
 * A plain class rather than `extends DurableObject` from `cloudflare:workers`: the runtime accepts
 * either, and this way the module also loads (and is tested) on Deno. Each object keeps its
 * registration and transactions in its own storage and its live sockets and waiters in memory,
 * which is why the phone's WebSocket and the requester's `GET /res` must reach the same object.
 */

import { problem } from "../problem.ts";
import { notifyApprover } from "./notify.ts";
import { parseSubPath, Room, type RoomStorage } from "./room.ts";
import { upgradeWebSocket } from "./upgrade.ts";

export interface DurableObjectStateLike {
  storage: RoomStorage;
}

export class KagiRoom {
  readonly #state: DurableObjectStateLike;
  #room?: Room;

  constructor(state: DurableObjectStateLike, _env: unknown) {
    this.#state = state;
  }

  fetch(request: Request): Promise<Response> {
    const target = parseSubPath(new URL(request.url).pathname, request.method);
    if (!target) return Promise.resolve(problem({ status: 404 }));
    this.#room ??= new Room(target.subId, {
      storage: this.#state.storage,
      upgrade: upgradeWebSocket,
      notify: notifyApprover,
    });
    return this.#room.handle(request, target.action);
  }
}
