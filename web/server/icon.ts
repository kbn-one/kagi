/**
 * The app icon: a key on the accent colour, drawn here rather than kept as image files.
 *
 * The same shapes are `client/static/favicon.svg`. The PNGs are what a home screen needs — iOS takes
 * only a PNG `apple-touch-icon`, and Android's install prompt wants 192 and 512 in the manifest — so
 * they are drawn with Skia (the social cards' renderer) at build time, from the geometry below.
 *
 * Full bleed, no rounded corners: every launcher rounds or masks the icon itself, and a corner drawn
 * in would show as a second, smaller one. The `maskable` variant draws the key smaller, inside the
 * centre circle a launcher's mask always keeps.
 */

import CanvasKitModule, {
  type CanvasKit,
  type CanvasKitInitOptions,
} from "canvaskit-wasm";

/** See `og/card.ts`: the default import is the module, the function is what it really is. */
const CanvasKitInit = CanvasKitModule as unknown as (
  options?: CanvasKitInitOptions,
) => Promise<CanvasKit>;

/** `--accent` (light) and white, from `client/static/app.css`. */
export const ICON_BACKGROUND = "#2563eb";
const ICON_FOREGROUND = "#ffffff";

/** The served icons: path → how to draw it. */
export const ICONS = {
  "/icons/icon-192.png": { size: 192, maskable: false },
  "/icons/icon-512.png": { size: 512, maskable: false },
  "/icons/maskable-512.png": { size: 512, maskable: true },
  "/icons/apple-touch-icon.png": { size: 180, maskable: false },
} as const;

let started: Promise<CanvasKit> | undefined;

/** Draws the key at `size` pixels square. */
export async function renderIcon(
  size: number,
  maskable = false,
): Promise<Uint8Array<ArrayBuffer>> {
  const ck = await (started ??= CanvasKitInit());
  const surface = ck.MakeSurface(size, size);
  if (!surface) throw new Error("CanvasKit could not allocate a surface");
  try {
    const canvas = surface.getCanvas();
    canvas.clear(ck.parseColorString(ICON_BACKGROUND));
    // The geometry is on a 64-unit grid, the favicon's.
    const unit = size / 64;
    const scale = maskable ? 0.75 : 1;
    canvas.translate(size / 2, size / 2);
    canvas.scale(unit * scale, unit * scale);
    canvas.translate(-32, -32);

    const fill = new ck.Paint();
    fill.setAntiAlias(true);
    fill.setColor(ck.parseColorString(ICON_FOREGROUND));
    const ring = new ck.Paint();
    ring.setAntiAlias(true);
    ring.setColor(ck.parseColorString(ICON_FOREGROUND));
    ring.setStyle(ck.PaintStyle.Stroke);
    ring.setStrokeWidth(6);

    canvas.drawCircle(21, 32, 9, ring);
    canvas.drawRect(ck.LTRBRect(30, 29, 53, 35), fill);
    canvas.drawRect(ck.LTRBRect(42, 35, 47, 43), fill);
    canvas.drawRect(ck.LTRBRect(49, 35, 53, 41), fill);
    fill.delete();
    ring.delete();

    const image = surface.makeImageSnapshot();
    try {
      const png = image.encodeToBytes(ck.ImageFormat.PNG, 100);
      if (!png) throw new Error("CanvasKit could not encode the icon");
      return new Uint8Array(png);
    } finally {
      image.delete();
    }
  } finally {
    surface.delete();
  }
}

/** Serves one of {@link ICONS}, or null for any other path. */
export async function serveIcon(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname as keyof typeof ICONS;
  const icon = ICONS[path];
  if (!icon) return null;
  return new Response(await renderIcon(icon.size, icon.maskable), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
  });
}

/**
 * The web app manifest. `start_url` is the approver's screen: launched from the home screen, the
 * app opens where the requests are.
 */
export const manifest = {
  id: "/kagi",
  name: "kagi",
  short_name: "kagi",
  description: "秘密をスマホに持ち、API コールを承認してから実行する。",
  lang: "ja",
  start_url: "/kagi",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    {
      src: "/icons/maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
} as const;
