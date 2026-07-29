import {
  Clapperboard,
  Flag,
  Gauge,
  Star,
  type LucideIcon,
} from "lucide-react";
import type { BadgeTone } from "@/components/ui/badge";
import type { ReasonKey } from "@/lib/highlights/moments";

export const REASON_STYLE: Record<
  ReasonKey,
  { icon: LucideIcon; tone: BadgeTone; color: string }
> = {
  rec: { icon: Gauge, tone: "success", color: "#2dd4a7" },
  ctx: { icon: Flag, tone: "warning", color: "#fbbf24" },
  qua: { icon: Clapperboard, tone: "cyan", color: "#50deff" },
  top: { icon: Star, tone: "brand", color: "#3693ff" },
};

export function ReasonIcon({
  k,
  className,
}: {
  k: ReasonKey;
  className?: string;
}) {
  const Icon = REASON_STYLE[k].icon;
  return <Icon className={className} />;
}
