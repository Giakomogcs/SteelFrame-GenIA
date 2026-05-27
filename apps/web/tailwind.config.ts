import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7ff",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          900: "#0c1f33",
        },
      },
    },
  },
  plugins: [],
};
export default config;
