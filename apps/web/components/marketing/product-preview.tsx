import Image from "next/image";
import { cn } from "@/lib/utils";

export function ProductPreview({
  src,
  alt,
  aspect = "video",
  className,
}: {
  src: string;
  alt: string;
  aspect?: "video" | "wide" | "square";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-[var(--bg-base)]",
        aspect === "video" && "aspect-[16/9] min-h-[280px] max-h-[600px]",
        aspect === "wide" && "aspect-[21/10] min-h-[280px] max-h-[600px]",
        aspect === "square" && "aspect-square",
        className,
      )}
    >
      <Image
        src={src}
        alt={alt}
        fill
        className="object-cover object-top"
        sizes="(max-width: 1320px) 100vw, 1256px"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgba(10,16,32,0.55)]" />
    </div>
  );
}
