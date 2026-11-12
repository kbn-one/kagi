/**
 * Where a subscription's {@link Room} lives.
 *
 * - With a Durable Object namespace (Cloudflare, `worker.ts` calls {@link useDurableObjects}), each
 *   id is a Durable Object and the request is forwarded to it as is.
 * - Without one (`deno serve`, tests), rooms are kept in this process's memory. That is one
 *   process's worth of state: fine locally, lost on restart.
 */

import { notifyApprover } from "./notify.ts";
import { MemoryStorage, Room, type RoomAction, type RoomDeps } from "./room.ts";
import { upgradeWebSocket } from "./upgrade.ts";

/** The part of a Cloudflare `DurableObjectNamespace` binding used here. */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface KagiHub {
  dispatch(
    subId: string,
    action: RoomAction,
    request: Request,
  ): Promise<Response>;
}

/** Rooms held in memory, one per id. `deps` overrides are for tests. */
export function createMemoryHub(
  deps: Partial<Omit<RoomDeps, "storage">> = {},
): KagiHub {
  const rooms = new Map<string, Room>();
  return {
    dispatch(subId, action, request) {
      let room = rooms.get(subId);
      if (!room) {
        room = new Room(subId, {
          storage: new MemoryStorage(),
          upgrade: deps.upgrade ?? upgradeWebSocket,
          notify: deps.notify ?? notifyApprover,
          now: deps.now,
        });
        rooms.set(subId, room);
      }
      return room.handle(request, action);
    },
  };
}

/** Rooms as Durable Objects: the request goes to the object named by the id. */
export function createDurableObjectHub(
  namespace: DurableObjectNamespaceLike,
): KagiHub {
  return {
    dispatch(subId, _action, request) {
      // The object reads the action back off the URL (`parseSubPath`).
      return namespace.get(namespace.idFromName(subId)).fetch(request);
    },
  };
}

let hub: KagiHub | undefined;

/** The hub the API uses. */
export function kagiHub(): KagiHub {
  return (hub ??= createMemoryHub());
}

/** Switches the API to Durable Objects. Called by the Worker once it has its env. */
export function useDurableObjects(namespace: DurableObjectNamespaceLike): void {
  hub = createDurableObjectHub(namespace);
}

/** Replaces the hub, for tests. */
export function setKagiHub(next: KagiHub | undefined): void {
  hub = next;
}
