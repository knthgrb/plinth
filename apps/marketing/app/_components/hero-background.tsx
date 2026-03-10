"use client";

/**
 * Subtle moving gradient in the hero — gives depth without clutter.
 */
export function HeroBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <div
        className="absolute -right-[15%] -top-[20%] h-[80vmax] w-[80vmax] opacity-[0.08]"
        style={{
          background: "conic-gradient(from 0deg, #c4b5fd, #a78bfa, #e9d5ff, #c4b5fd)",
          borderRadius: "50%",
          animation: "hero-spin 30s linear infinite",
          filter: "blur(60px)",
        }}
      />
      <div
        className="absolute -left-[10%] top-[30%] h-[50vmax] w-[50vmax] opacity-[0.06]"
        style={{
          background: "conic-gradient(from 180deg, #695eff, #a78bfa, #e9d5ff, #695eff)",
          borderRadius: "50%",
          animation: "hero-spin 40s linear infinite reverse",
          filter: "blur(50px)",
        }}
      />
    </div>
  );
}
