import * as React from "react";
import { cn, initials } from "@/lib/utils";

const SIZES = { xs: 22, sm: 28, md: 36, lg: 48, xl: 64 } as const;

const PALETTE = [
  "linear-gradient(135deg,#4a9dff,#2d7ff0)",
  "linear-gradient(135deg,#5b8fd4,#3d6eb8)",
  "linear-gradient(135deg,#3dceb8,#2a9f8c)",
  "linear-gradient(135deg,#8b9cff,#6b7ae0)",
  "linear-gradient(135deg,#b07bff,#8b5cf6)",
  "linear-gradient(135deg,#f4515c,#d63a45)",
];

function pick(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name?: string;
  src?: string;
  /** Named size or pixel number */
  size?: keyof typeof SIZES | number;
  square?: boolean;
  ring?: boolean;
  status?: "online" | "away" | "offline";
}

export function Avatar({
  name = "",
  src,
  size = "md",
  square = false,
  ring = false,
  status,
  className = "",
  style = {},
  ...rest
}: AvatarProps) {
  const px = typeof size === "number" ? size : SIZES[size];
  return (
    <span
      className={cn(
        "mx-avatar",
        square && "mx-avatar--sq",
        ring && "mx-avatar__ring",
        className,
      )}
      style={{
        width: px,
        height: px,
        fontSize: Math.round(px * 0.4),
        background: src ? undefined : pick(name),
        ...style,
      }}
      {...rest}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} />
      ) : (
        initials(name)
      )}
      {status ? (
        <span className={`mx-avatar__status mx-avatar__status--${status}`} />
      ) : null}
    </span>
  );
}
