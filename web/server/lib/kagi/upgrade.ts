/**
 * Accepts a WebSocket on whichever host this runs on: `WebSocketPair` on Cloudflare (Workers and
 * Durable Objects), `Deno.upgradeWebSocket` on Deno.
 */

import type { Upgrade } from "./room.ts";

interface CfWebSocket extends WebSocket {
  accept(): void;
}
type WebSocketPairCtor = new () => { 0: WebSocket; 1: CfWebSocket };

export const upgradeWebSocket: Upgrade = (request) => {
  const Pair = (globalThis as { WebSocketPair?: WebSocketPairCtor })
    .WebSocketPair;
  if (Pair) {
    const pair = new Pair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    return {
      socket: server,
      response: new Response(null, {
        status: 101,
        webSocket: client,
      } as ResponseInit),
    };
  }
  return Deno.upgradeWebSocket(request);
};
