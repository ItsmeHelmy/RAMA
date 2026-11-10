import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        uii: {
          navy: "#0B2447",
          blue: "#19376D",
          accent: "#2563EB",
          gold: "#F59E0B",
          goldLight: "#FEF3C7",
        },
      },
    },
  },
  plugins: [],
};
export default config;
