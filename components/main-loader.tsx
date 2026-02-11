"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";

export function MainLoader() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/90 backdrop-blur-sm">
      <div className="h-[120px] w-[120px] sm:h-[160px] sm:w-[160px]">
        <DotLottieReact
          src="/loader.lottie"
          loop
          autoplay
          className="h-full w-full"
        />
      </div>
    </div>
  );
}
