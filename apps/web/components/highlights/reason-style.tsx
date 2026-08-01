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
  rec: { icon: Gauge, tone: "success", color: "var(--success-500)" },
  ctx: { icon: Flag, tone: "warning", color: "var(--warning-500)" },
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
