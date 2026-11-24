/**
 * Per-address limits on the two API calls that cost this server something for anyone at all: a
 * registration (`PUT /api/sub/:id`), which needs no account, and a relayed call
 * (`/api/sub/:id/relay`), which fetches from this server's network. Without them, anyone could
 * register a phone of their own and use the relay as an open proxy.
 *
 * On Cloudflare the limits are Workers Rate Limiting bindings (`cloudflare.config.ts`), keyed by the
 * client's address. They count per location and are approximate, which is enough to stop a loop.
 * Without the bindings (`deno serve`, tests) nothing is limited.
 */

import { problem } from "../problem.ts";
import { parseSubPath } from "./room.ts";

/** The part of a Workers Rate Limiting binding used here. */
export interface RateLimiterLike {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimiters {
  /** Relayed calls, per client address. */
  RELAY_LIMIT?: RateLimiterLike;
  /** Registrations, per client address. */
  REGISTER_LIMIT?: RateLimiterLike;
}

/** A 429 problem when `request` is over its limit, or null when it may go ahead. */
export async function rateLimited(
  request: Request,
  limiters: RateLimiters,
): Promise<Response | null> {
  const target = parseSubPath(new URL(request.url).pathname, request.method);
  const limiter = target?.action === "relay"
    ? limiters.RELAY_LIMIT
    : target?.action === "register"
    ? limiters.REGISTER_LIMIT
    : undefined;
  if (!limiter) return null;
  const key = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await limiter.limit({ key });
  if (success) return null;
  return problem(
    {
      status: 429,
      detail: "Too many requests from this address; wait a minute",
    },
    { "retry-after": "60" },
  );
}
