import type { Config } from "tailwindcss";

const config: Config = {
  theme: {
    extend: {
      colors: {
        brand: {
          purple: "#695eff",
          "purple-hover": "#5547e8",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-open-sans)",
          '"Avenir Next"',
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
      },
    },
  },
};

export default config;
