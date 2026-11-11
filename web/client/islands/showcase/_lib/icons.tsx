import {
  css,
  type Handle,
  type Props,
  type RemixElement,
} from "@remix-run/component";

/** Aligns an inline icon next to a label inside a `button()` host. */
export const iconButtonStyle = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
});

/**
 * Small inline-SVG icon set for the showcase.
 *
 * @remix-run/ui 0.5.0 removed the `Glyph` sprite component, so the demos carry a few
 * hand-rolled icons. They inherit `currentColor` and accept the usual host
 * props (`mix`, `width`, `aria-label`, …), which are spread onto the `<svg>`.
 */

export type IconProps = Omit<Props<"svg">, "children">;

function icon(path: RemixElement, filled = false) {
  return (handle: Handle<IconProps>) => () => (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...handle.props}
    >
      {path}
    </svg>
  );
}

export const AddIcon = icon(<path d="M12 5v14M5 12h14" />);
export const CloseIcon = icon(<path d="M18 6 6 18M6 6l12 12" />);
export const CheckIcon = icon(<path d="M20 6 9 17l-5-5" />);
export const ChevronRightIcon = icon(<path d="m9 6 6 6-6 6" />);
export const SearchIcon = icon(
  <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3" />,
);
export const PlayIcon = icon(<path d="M8 5v14l11-7z" />, true);
