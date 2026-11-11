/**
 * The social card, drawn with Skia.
 *
 * A link to a page is a title, a line of description and nothing else until someone renders it —
 * so this draws the page's own words onto a 1200×630 canvas and hands back a PNG. It is the whole
 * of the drawing: what a card says is decided next door in `mod.ts`, and this only knows how to
 * put words on a rectangle.
 *
 * `canvaskit-wasm` is Skia compiled to WebAssembly — the text stack a browser uses, minus the
 * browser. That matters for the part that is hard: a title is arbitrary length and the box is not,
 * so it has to be shaped, wrapped, and cut with an ellipsis at a line count. Skia's paragraph API
 * does that, and it does it with the same shaper the page itself will use.
 *
 * The palette is the site's dark theme, copied from `client/static/app.css` — CSS custom
 * properties are resolved by a browser, and there is no browser here. Five values, restated,
 * rather than a stylesheet parser.
 *
 * The fonts come from `fonts/`, whatever is in it, and Skia falls back through them per glyph — so
 * a Japanese title is Japanese and the Latin around it is still Inter. A character nothing covers
 * is reported rather than silently drawn as a box; see `report` and `fonts/README.md`.
 *
 * Nothing here touches the network or the clock, so a card is a pure function of its text: the same
 * article builds the same bytes on every machine, which is what keeps a rebuild from churning the
 * deployed artifact.
 */

import CanvasKitModule, {
  type CanvasKit,
  type CanvasKitInitOptions,
  type FontMgr,
  type Paragraph,
} from "canvaskit-wasm";

/**
 * The loader, given the type its own package documents.
 *
 * `canvaskit-wasm` ships CommonJS with ES-module type declarations, and Deno resolves the default
 * import to the module rather than to the function inside it. The declarations are right about
 * what that function takes and returns; only where it sits is wrong, so this restates it rather
 * than describing it again.
 */
const CanvasKitInit = CanvasKitModule as unknown as (
  options?: CanvasKitInitOptions,
) => Promise<CanvasKit>;

/** What a card says. */
export interface Card {
  /** The small line above the title — the site's name, or a section's. */
  eyebrow: string;
  /** The page's title, wrapped to at most three lines. */
  title: string;
  /** The page's description, wrapped to at most two lines. Omitted when a page has none. */
  description?: string;
  /** The line along the bottom — where the page lives. */
  footer: string;
}

/** The card's size. 1200×630 is what every social preview crops to. */
const WIDTH = 1200;
const HEIGHT = 630;
/** The margin every line starts at, and the one the footer sits above. */
const PADDING = 72;
/** The blank line between the blocks of text. */
const GAP = 26;

/**
 * How each block is drawn.
 *
 * The sizes and line counts are a budget, not a preference: the tallest card this can produce is
 * `PADDING` + the eyebrow + the title at three lines + the description at two, gaps included —
 * 463px — and the rule above the footer sits at 495. A card whose title and description both
 * overflow therefore still clears it, which is the case that has to be checked, because it is the
 * one nobody writes on purpose.
 */
const type = {
  eyebrow: { size: 28, maxLines: 1, letterSpacing: 1 },
  title: { size: 64, maxLines: 3, height: 1.15 },
  description: { size: 30, maxLines: 2, height: 1.4 },
  footer: { size: 26, maxLines: 1 },
} as const;

/**
 * The site's dark palette, from `client/static/app.css`.
 *
 * Dark because a card is shown against someone else's timeline rather than against this site, and
 * a dark rectangle reads as one deliberate object there; the light theme would read as a
 * screenshot with a white edge nobody trimmed.
 */
const color = {
  bg: "#0b0f19",
  fg: "#e5e7eb",
  muted: "#9ca3af",
  accent: "#60a5fa",
  border: "#1f2937",
} as const;

/** Where the fonts are: a directory, so adding one is dropping a file in. See `loadFonts`. */
const fontsDir = new URL("fonts/", import.meta.url);

/**
 * Skia, and the fonts to draw with — started once, on the first card.
 *
 * Lazy because `deno serve` should not pay for a WebAssembly runtime it may never use, and shared
 * because the build asks for one card per page and there is no reason to load Skia twice.
 */
let started: Promise<{ ck: CanvasKit; fonts: FontMgr; families: string[] }>;

/**
 * Draws a card.
 *
 * @param card The words to put on it
 * @returns The PNG bytes, ready to serve
 */
export async function renderCard(card: Card): Promise<Uint8Array<ArrayBuffer>> {
  const { ck, fonts, families } = await (started ??= start());

  const surface = ck.MakeSurface(WIDTH, HEIGHT);
  if (surface === null) {
    throw new Error("CanvasKit could not allocate a surface");
  }

  try {
    const canvas = surface.getCanvas();
    canvas.clear(ck.parseColorString(color.bg));

    // The accent bar across the top: the one piece of the site's identity that is not a word.
    const accent = new ck.Paint();
    accent.setColor(ck.parseColorString(color.accent));
    canvas.drawRect(ck.LTRBRect(0, 0, WIDTH, 10), accent);
    accent.delete();

    const paragraphs: Paragraph[] = [];
    /** Characters no registered font had a glyph for. See `report`. */
    const missing = new Set<number>();

    /** Lays a paragraph out to the content width, which is when Skia resolves its glyphs. */
    const lay = (paragraph: Paragraph): Paragraph => {
      paragraphs.push(paragraph);
      paragraph.layout(WIDTH - PADDING * 2);
      paragraph.unresolvedCodepoints().forEach((code) => missing.add(code));
      return paragraph;
    };

    /** Lays a paragraph out and draws it, returning the next free baseline. */
    const draw = (paragraph: Paragraph, top: number, gap = 0): number => {
      canvas.drawParagraph(lay(paragraph), PADDING, top);
      return top + paragraph.getHeight() + gap;
    };

    let top = PADDING;
    top = draw(
      text(ck, fonts, families, card.eyebrow, {
        ...type.eyebrow,
        color: color.accent,
        bold: true,
      }),
      top,
      GAP,
    );
    top = draw(
      text(ck, fonts, families, card.title, {
        ...type.title,
        color: color.fg,
        bold: true,
      }),
      top,
      GAP,
    );
    if (card.description) {
      draw(
        text(ck, fonts, families, card.description, {
          ...type.description,
          color: color.muted,
        }),
        top,
      );
    }

    // The footer is measured from the bottom rather than from whatever came before it, so a card
    // with a one-line title and one with three both end at the same place.
    const footer = text(ck, fonts, families, card.footer, {
      ...type.footer,
      color: color.muted,
    });
    lay(footer);
    const footerTop = HEIGHT - PADDING - footer.getHeight();

    const rule = new ck.Paint();
    rule.setColor(ck.parseColorString(color.border));
    canvas.drawRect(
      ck.LTRBRect(PADDING, footerTop - 32, WIDTH - PADDING, footerTop - 31),
      rule,
    );
    rule.delete();

    canvas.drawParagraph(footer, PADDING, footerTop);
    paragraphs.forEach((paragraph) => paragraph.delete());
    report(missing, card);

    const image = surface.makeImageSnapshot();
    try {
      const png = image.encodeToBytes(ck.ImageFormat.PNG, 100);
      if (png === null) {
        throw new Error("CanvasKit could not encode the card as a PNG");
      }
      // Re-wrapped rather than returned as it comes: the bytes arrive over an unspecified buffer,
      // and a response body has to be backed by a plain `ArrayBuffer`.
      return new Uint8Array(png);
    } finally {
      image.delete();
    }
  } finally {
    // WebAssembly memory is not the JavaScript heap, so nothing here is collected for us: a build
    // draws one card per page in one process, and leaking a surface each time would grow with the
    // site.
    surface.delete();
  }
}

/**
 * Says which characters had no glyph, once per card.
 *
 * A character no registered font covers is drawn as whatever the font's `.notdef` is — a box in
 * some, nothing at all in others, which is how a name can quietly lose a letter. Either way it is
 * visible only to someone looking at the card, and nobody looks at a card; that is the point of
 * one. So the build says it out loud instead. It is a warning rather than an error because one
 * missing character is not a reason to fail a deploy, and because the fix is a font file rather
 * than a code change: `fonts/README.md` says which set is covered and how to widen it.
 *
 * @param missing The code points Skia could not resolve
 * @param card The card they were on, for naming it
 */
function report(missing: Set<number>, card: Card): void {
  if (missing.size === 0) return;

  const characters = [...missing].map((code) => String.fromCodePoint(code))
    .join(" ");
  console.warn(
    `og: no glyph for ${characters} in ${card.footer} — see server/og/fonts/README.md`,
  );
}

/** How one run of text is drawn. */
interface TextStyle {
  size: number;
  color: string;
  bold?: boolean;
  /** Lines past this are dropped and the last one ends in an ellipsis. */
  maxLines: number;
  /** Line height as a multiple of the font size. */
  height?: number;
  letterSpacing?: number;
}

/**
 * One paragraph, shaped but not yet laid out.
 *
 * @param ck Skia
 * @param fonts The fonts registered from `fonts/`
 * @param families Their family names, in fallback order
 * @param content The text to shape
 * @param style How to draw it
 * @returns The paragraph, for the caller to lay out and draw
 */
function text(
  ck: CanvasKit,
  fonts: FontMgr,
  families: string[],
  content: string,
  style: TextStyle,
): Paragraph {
  const paragraphStyle = new ck.ParagraphStyle({
    textStyle: {
      color: ck.parseColorString(style.color),
      fontFamilies: families,
      fontSize: style.size,
      fontStyle: {
        weight: style.bold ? ck.FontWeight.Bold : ck.FontWeight.Normal,
      },
      letterSpacing: style.letterSpacing,
      heightMultiplier: style.height,
    },
    textAlign: ck.TextAlign.Left,
    maxLines: style.maxLines,
    ellipsis: "…",
  });

  const builder = ck.ParagraphBuilder.Make(paragraphStyle, fonts);
  try {
    builder.addText(content);
    return builder.build();
  } finally {
    builder.delete();
  }
}

/** Starts Skia and registers the fonts. */
async function start(): Promise<
  { ck: CanvasKit; fonts: FontMgr; families: string[] }
> {
  const ck = await CanvasKitInit();
  const files = await loadFonts();

  const fonts = ck.FontMgr.FromData(...files);
  if (fonts === null) throw new Error(`No usable font in ${fontsDir}`);

  const families = Array.from(
    { length: fonts.countFamilies() },
    (_, i) => fonts.getFamilyName(i),
  );

  return { ck, fonts, families };
}

/**
 * Every font in `fonts/`, in name order.
 *
 * A directory rather than a list, for the same reason the islands are globbed: a font file being
 * there is the decision, and naming it again here would only be a second place to keep it.
 *
 * Skia falls back per glyph through the families in the order they are registered, so the names
 * decide which font draws a character two of them have: Inter sorts first and keeps the Latin,
 * Noto Sans JP follows and answers for the Japanese. Covering another script is dropping a file in
 * here, and `report` names the characters that nothing covered yet. See `fonts/README.md`.
 *
 * @returns The font files, sorted by name
 */
async function loadFonts(): Promise<ArrayBuffer[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(fontsDir)) {
    if (entry.isFile && /\.(?:ttf|otf)$/i.test(entry.name)) {
      names.push(entry.name);
    }
  }
  names.sort();

  if (names.length === 0) throw new Error(`No font files in ${fontsDir}`);

  return await Promise.all(names.map(async (name) => {
    // Skia takes the buffer rather than a view over it, and a view need not cover the whole of
    // one — so the bytes are copied into a buffer that is exactly the font and nothing else.
    const bytes = await Deno.readFile(new URL(name, fontsDir));
    return bytes.slice().buffer;
  }));
}
