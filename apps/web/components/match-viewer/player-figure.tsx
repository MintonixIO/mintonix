"use client";

export function PlayerFigure({ color, dark }: { color: string; dark: string }) {
  return (
    <>
      <div
        className="absolute left-1/2 top-1/2 h-[11px] w-[26px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px]"
        style={{
          borderColor: `${color}bf`,
          background: `radial-gradient(closest-side, ${color}4d, transparent)`,
          boxShadow: `0 0 12px ${color}73`,
        }}
      />
      <div
        className="absolute bottom-0 left-1/2 h-[46px] w-6 origin-bottom -translate-x-1/2"
        style={{ transform: "translateX(-50%) rotateX(-90deg)", transformOrigin: "50% 100%" }}
      >
        <div
          className="absolute left-1/2 top-0 h-[13px] w-[13px] -translate-x-1/2 rounded-full"
          style={{ background: color, boxShadow: `0 0 10px ${color}b3` }}
        />
        <div
          className="absolute bottom-0 left-1/2 h-[29px] w-4 -translate-x-1/2 rounded-[8px_8px_5px_5px]"
          style={{
            background: `linear-gradient(${color}, ${dark})`,
            boxShadow: `0 0 14px ${color}80`,
          }}
        />
      </div>
      <div
        className="absolute bottom-0 left-1/2 h-[46px] w-6 origin-bottom -translate-x-1/2"
        style={{
          transform: "translateX(-50%) rotateX(-90deg) rotateY(90deg)",
          transformOrigin: "50% 100%",
        }}
      >
        <div
          className="absolute left-1/2 top-0 h-[13px] w-[13px] -translate-x-1/2 rounded-full"
          style={{ background: dark, boxShadow: `0 0 10px ${color}99` }}
        />
        <div
          className="absolute bottom-0 left-1/2 h-[29px] w-4 -translate-x-1/2 rounded-[8px_8px_5px_5px]"
          style={{
            background: `linear-gradient(${dark}, ${color}99)`,
            boxShadow: `0 0 14px ${color}66`,
          }}
        />
      </div>
    </>
  );
}
