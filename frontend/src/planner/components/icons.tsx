// Small inline SVG icons (24 × 24 grid, stroked with currentColor so they take the text colour).
// Decorative by default (aria-hidden): the text beside an icon carries the meaning. Pass `label`
// when the icon stands alone, and it becomes role="img" with that accessible name.
import type { ReactNode, SVGProps } from "react";
import "./icons.css";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children" | "role"> {
  /** Accessible name; omit for a decorative icon. */
  label?: string;
  /** Pixel size (width and height). Defaults to 16. */
  size?: number;
}

function Icon({ label, size = 16, className, children, ...rest }: IconProps & { children: ReactNode }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round" className={className ? `icon ${className}` : "icon"}
         {...a11y} {...rest}>
      {children}
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16.2 9.6" />
    </Icon>
  );
}

export function CrossIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.2h.01" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.2" />
      <path d="M12 7.8h.01" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v11" />
      <path d="M7 10.5l5 5 5-5" />
      <path d="M5 20h14" />
    </Icon>
  );
}

export function PrintIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 9V4h10v5" />
      <rect x="3.5" y="9" width="17" height="8" rx="1.5" />
      <path d="M7 14h10v6H7z" />
    </Icon>
  );
}

/** Points right; turns down (CSS) inside a button with aria-expanded="true". */
export function ChevronIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 6l6 6-6 6" />
    </Icon>
  );
}
