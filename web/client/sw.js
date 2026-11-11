/**
 * Service worker for the RP app.
 *
 * Receives Web Push messages sent by the IdP (id.kbn.one) — which signs them
 * with its VAPID key — and renders them as notifications on this origin. The
 * subscription itself is created in the page (see lib/push/manager.ts) and
 * stored on the IdP; this worker only handles delivery + click routing.
 *
 * Served at `${base}/sw.js` by the `sw.js` route in server/router.tsx (verbatim).
 */

const DEFAULT_TITLE = "Remix3 on Deno";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const parsePushData = (event) => {
  if (!event.data) {
    return {};
  }
  try {
    const json = event.data.json();
    return typeof json === "object" && json !== null ? json : {};
  } catch {
    try {
      const text = event.data.text();
      return { body: text };
    } catch {
      return {};
    }
  }
};

// Apply the app-badge count (Badging API) the IdP forwarded in the payload.
// A count of 0 clears the badge; anything else sets it. No-op where the API
// is unavailable (e.g. desktop Chrome without an installed PWA).
const applyBadgeCount = async (badgeCount) => {
  if (typeof badgeCount !== "number" || !Number.isFinite(badgeCount)) return;
  try {
    if (badgeCount > 0 && "setAppBadge" in navigator) {
      await navigator.setAppBadge(Math.trunc(badgeCount));
    } else if ("clearAppBadge" in navigator) {
      await navigator.clearAppBadge();
    }
  } catch {
    /* Badging API unavailable or rejected — ignore. */
  }
};

self.addEventListener("push", (event) => {
  const data = parsePushData(event);
  const title = typeof data.title === "string" && data.title.trim()
    ? data.title
    : DEFAULT_TITLE;
  const options = {
    body: typeof data.body === "string" ? data.body : undefined,
    icon: typeof data.icon === "string" ? data.icon : undefined,
    badge: typeof data.badge === "string" ? data.badge : undefined,
    tag: typeof data.tag === "string" ? data.tag : undefined,
    requireInteraction: Boolean(data.requireInteraction),
    data: {
      ...(typeof data.data === "object" && data.data ? data.data : {}),
      url: typeof data.url === "string" ? data.url : undefined,
    },
  };

  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    applyBadgeCount(data.badgeCount),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (!url) {
    return;
  }
  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of windowClients) {
      if (client.url === url && "focus" in client) {
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(url);
    }
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  console.warn("Push subscription changed", event);
});
