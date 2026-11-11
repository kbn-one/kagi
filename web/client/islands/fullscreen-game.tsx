/**
 * The stage of a fullscreen game, with a placeholder where the game goes.
 *
 * DELETE ME with the rest of the fullscreen demo — see `pages/fullscreen.tsx` and the root README.
 *
 * Where getting the whole screen takes an action from the player, the game waits for it, and which
 * one depends on the browser:
 *
 * - **Tap to fullscreen**, on a touch screen with the Fullscreen API — Android, iPad. It has to be
 *   a tap because `requestFullscreen()` is refused outside a user gesture.
 * - **Scroll to fullscreen**, on a touch screen without it — iPhone Safari. Safari's bars only
 *   shrink when the page scrolls, so the stage sits over a document taller than the screen and lets
 *   a vertical swipe through until the scroll has happened.
 *
 * Everywhere else the game starts at once: a page already running from the Home Screen has the
 * screen, and a desktop window is a fine place to play. There fullscreen is offered rather than
 * required — a button in the corner, where the API exists.
 *
 * Once the game starts the stage takes every touch (`touch-action: none`), so nothing scrolls the
 * bars back out. Zoom is off throughout: `pan-y` and `none` both exclude pinch and double-tap zoom,
 * and Safari's `gesture*` events are refused because iOS ignores `user-scalable=no`.
 *
 * The frame loop draws into the canvas directly; `handle.update()` runs only when the phase or the
 * mode changes. Replace `draw()` with the game.
 */

import { clientEntry, css, type Handle, on, ref } from "@remix-run/component";

import { routes } from "../routes.ts";
import { color, font } from "../tokens.ts";

/** The prefixed half of the API, as Safari shipped it. */
type LegacyElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type LegacyDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

/** How this browser gets to the whole screen. `null` until the browser has been asked. */
type Mode = "fullscreen" | "scroll" | "none" | null;

export const FullscreenGame = clientEntry(
  import.meta.url,
  function FullscreenGame(handle: Handle) {
    let stage: HTMLElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let mode: Mode = null;
    let touch = false;
    let playing = false;
    /** Whether the Fullscreen API exists here, and whether the stage is fullscreen right now. */
    let canFullscreen = false;
    let fullscreen = false;

    function setPlaying(next: boolean): void {
      if (playing === next) return;
      playing = next;
      void handle.update();
    }

    async function enterFullscreen(): Promise<void> {
      const element = stage as LegacyElement | null;
      try {
        if (element?.requestFullscreen) {
          await element.requestFullscreen({ navigationUI: "hide" });
        } else await element?.webkitRequestFullscreen?.();
      } catch {
        // Refused — an iframe without `allow="fullscreen"`, say. Play in the page instead.
      }
    }

    async function exitFullscreen(): Promise<void> {
      const legacy = document as LegacyDocument;
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await legacy.webkitExitFullscreen?.();
      } catch {
        // Already out.
      }
    }

    /** A tap, not a swipe: `click` never fires for a touch the browser took as a scroll. */
    async function start(): Promise<void> {
      if (playing) return;
      if (mode === "fullscreen") await enterFullscreen();
      setPlaying(true);
    }

    /** The desktop's optional button. */
    function toggleFullscreen(): Promise<void> {
      return fullscreen ? exitFullscreen() : enterFullscreen();
    }

    handle.queueTask(() => {
      if (!stage || !canvas) return;
      const surface = canvas;
      const context = surface.getContext("2d");
      if (!context) return;
      const ctx = context;
      const options = { signal: handle.signal } as const;
      const legacy = document as LegacyDocument;

      touch = globalThis.matchMedia("(pointer: coarse)").matches;
      const standalone =
        globalThis.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      canFullscreen = Boolean(
        document.fullscreenEnabled || legacy.webkitFullscreenEnabled,
      );
      mode = !touch || standalone
        ? "none"
        : canFullscreen
        ? "fullscreen"
        : "scroll";
      // Nothing to gain by waiting: the game is on from the first frame.
      playing = mode === "none";
      void handle.update();

      // On a touch screen, leaving fullscreen — a swipe down — goes back to the prompt, so the next
      // tap brings the screen back rather than playing on with the browser's bars in the way. A
      // desktop window is a fine place to play, so there the game carries on.
      const onFullscreenChange = () => {
        fullscreen = Boolean(
          document.fullscreenElement ?? legacy.webkitFullscreenElement,
        );
        if (!fullscreen && mode === "fullscreen") setPlaying(false);
        void handle.update();
      };
      document.addEventListener(
        "fullscreenchange",
        onFullscreenChange,
        options,
      );
      document.addEventListener(
        "webkitfullscreenchange",
        onFullscreenChange,
        options,
      );

      // Scroll to fullscreen: once the swipe has scrolled the document and come to rest, the bars
      // have collapsed and the game can have every touch from here on.
      let settle: ReturnType<typeof setTimeout> | undefined;
      globalThis.addEventListener("scroll", () => {
        if (mode !== "scroll" || playing || globalThis.scrollY <= 0) return;
        clearTimeout(settle);
        settle = setTimeout(() => setPlaying(true), 200);
      }, options);

      for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
        stage.addEventListener(type, (e) => e.preventDefault(), options);
      }

      /** The canvas's CSS size; its pixel buffer is this times the device ratio. */
      let w = 1;
      let h = 1;
      let palette = { bg: "", fg: "", muted: "", accent: "" };
      function fit(): void {
        const ratio = Math.min(globalThis.devicePixelRatio || 1, 3);
        w = Math.max(surface.clientWidth, 1);
        h = Math.max(surface.clientHeight, 1);
        surface.width = Math.round(w * ratio);
        surface.height = Math.round(h * ratio);
        const style = getComputedStyle(surface);
        const read = (name: string) => style.getPropertyValue(name).trim();
        palette = {
          bg: read("--bg"),
          fg: read("--fg"),
          muted: read("--muted"),
          accent: read("--accent"),
        };
      }
      const observer = new ResizeObserver(fit);
      observer.observe(surface);
      handle.signal.addEventListener("abort", () => observer.disconnect());
      globalThis.matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", fit, options);
      fit();

      /** Where the last touch or pointer was, so the placeholder shows input arriving. */
      let pointer: { x: number; y: number } | null = null;
      const track = (event: PointerEvent) => {
        if (!playing) return;
        const rect = surface.getBoundingClientRect();
        pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      };
      surface.addEventListener("pointerdown", track, options);
      surface.addEventListener("pointermove", (event) => {
        if (event.buttons !== 0 || event.pointerType === "mouse") track(event);
      }, options);

      function draw(now: number): void {
        ctx.setTransform(surface.width / w, 0, 0, surface.height / h, 0, 0);
        ctx.fillStyle = palette.bg;
        ctx.fillRect(0, 0, w, h);

        const [headline, detail] = playing
          ? ["Your game goes here", `${Math.round(w)} × ${Math.round(h)}`]
          : prompt(mode);
        const unit = Math.min(w, h);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = palette.fg;
        ctx.font = `700 ${Math.max(18, unit * 0.07)}px system-ui, sans-serif`;
        ctx.fillText(headline, w / 2, h / 2);
        ctx.fillStyle = palette.muted;
        ctx.font = `500 ${Math.max(12, unit * 0.032)}px system-ui, sans-serif`;
        ctx.fillText(detail, w / 2, h / 2 + unit * 0.07);

        if (pointer && playing) {
          const r = unit * (0.05 + 0.01 * Math.sin(now / 200));
          ctx.fillStyle = palette.accent;
          ctx.beginPath();
          ctx.arc(pointer.x, pointer.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      let frame = requestAnimationFrame(function tick(now) {
        draw(now);
        frame = requestAnimationFrame(tick);
      });
      handle.signal.addEventListener(
        "abort",
        () => cancelAnimationFrame(frame),
      );
    });

    return () => (
      <div mix={mode === "scroll" ? runwayStyle : null}>
        <div
          mix={[
            ref((node) => (stage = node as HTMLElement)),
            stageStyle,
            mode === "scroll" && !playing ? scrollStyle : lockedStyle,
          ]}
        >
          <canvas
            mix={[
              ref((node) => (canvas = node as HTMLCanvasElement)),
              canvasStyle,
              on("click", () => void start()),
            ]}
          />
          <a href={routes.home.href()} mix={homeStyle}>← Home</a>
          {!touch && canFullscreen
            ? (
              <button
                type="button"
                mix={[cornerStyle, on("click", () => void toggleFullscreen())]}
              >
                {fullscreen ? "Exit fullscreen" : "Fullscreen"}
              </button>
            )
            : null}
        </div>
      </div>
    );
  },
);

/** What the stage says before the game, for each way of getting the screen. */
function prompt(mode: Mode): [string, string] {
  switch (mode) {
    case "fullscreen":
      return ["Tap to fullscreen", "and the game starts"];
    case "scroll":
      return ["Scroll to fullscreen", "swipe up to shrink the browser bar"];
    default:
      return ["", ""];
  }
}

// --- styles -----------------------------------------------------------------

/**
 * What there is to scroll, for scroll to fullscreen. Taller than the large viewport, so the
 * document can still scroll once the bars have collapsed — with nothing left to scroll the browser
 * bounces back and brings them out again.
 */
const runwayStyle = css({ minHeight: "150lvh" });

const stageStyle = css({
  position: "fixed",
  inset: 0,
  boxSizing: "border-box",
  paddingTop: "env(safe-area-inset-top)",
  paddingBottom: "env(safe-area-inset-bottom)",
  paddingLeft: "env(safe-area-inset-left)",
  paddingRight: "env(safe-area-inset-right)",
  background: color.bg,
  overflow: "hidden",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  WebkitTapHighlightColor: "transparent",
  "&::backdrop": { background: color.bg },
});

/** Before scroll to fullscreen: a vertical swipe scrolls the document; pinch still does nothing. */
const scrollStyle = css({
  touchAction: "pan-y",
  "& canvas": { touchAction: "pan-y" },
});

/** Everything else: every touch is the game's. */
const lockedStyle = css({
  touchAction: "none",
  "& canvas": { touchAction: "none" },
});

const canvasStyle = css({
  display: "block",
  width: "100%",
  height: "100%",
});

const cornerStyle = css({
  position: "absolute",
  top: "calc(env(safe-area-inset-top) + 0.5rem)",
  right: "calc(env(safe-area-inset-right) + 0.6rem)",
  font: "inherit",
  fontFamily: font.mono,
  fontSize: "0.8rem",
  color: color.muted,
  background: "none",
  border: "none",
  cursor: "pointer",
  "&:hover": { color: color.fg },
});

const homeStyle = css({
  position: "absolute",
  top: "calc(env(safe-area-inset-top) + 0.6rem)",
  left: "calc(env(safe-area-inset-left) + 0.8rem)",
  fontFamily: font.mono,
  fontSize: "0.8rem",
  color: color.muted,
  textDecoration: "none",
});
