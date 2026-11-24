/**
 * Where a relayed call (`relay.ts`) may not go, whatever the approver approved.
 *
 * The relay makes the call from this server's network, for anyone who registers a phone, so it must
 * not reach what this server can reach and others cannot: an address given as an IP literal, a
 * `localhost` name, or a host in this server's own zone (`kbn.one` for `kagi.kbn.one`). A call the
 * phone makes itself is not limited here: it goes from the phone's network.
 */

/**
 * Why the relay may not call `host` (a URL's `host`, port and all) for the server at `selfHost`
 * (its own hostname), or null when it may.
 */
export function relayTargetProblem(
  host: string,
  selfHost: string,
): string | null {
  let hostname: string;
  try {
    hostname = new URL(`https://${host}`).hostname.toLowerCase();
  } catch {
    return "The request has no valid host";
  }
  // `URL` has already turned every IPv4 spelling (`0x7f.1`, `2130706433`) into dotted decimal.
  if (hostname.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return "The relay does not call IP addresses";
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "The relay does not call localhost";
  }
  const zone = zoneOf(selfHost.toLowerCase());
  if (hostname === zone || hostname.endsWith(`.${zone}`)) {
    return `The relay does not call ${zone}, this server's own domain`;
  }
  return null;
}

/** The last two labels of a hostname: `kbn.one` for `kagi.kbn.one`. */
const zoneOf = (hostname: string): string =>
  hostname.split(".").slice(-2).join(".");
