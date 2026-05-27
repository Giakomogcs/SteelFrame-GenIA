import type { Config } from "tailwindcss";

/**
 * Paleta SENAI Distrito Tecnológico (DT).
 * O alias `brand-*` é mantido por compatibilidade com classes existentes,
 * mas remapeado para a escala magenta DT (#DD1C4A é o hero — `brand-500`/`brand-600`).
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Montserrat",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      colors: {
        brand: {
          50: "#fff1f4",
          100: "#ffd9e1",
          200: "#ffa8ba",
          300: "#ff7794",
          400: "#ff3d6a",
          500: "#dd1c4a",
          600: "#c1163f",
          700: "#8a0f2c",
          800: "#660a20",
          900: "#3d0613",
        },
        dt: {
          primary: "#dd1c4a",
          soft: "#ff3d6a",
          deep: "#8a0f2c",
          bg: "#161419",
          elev: "#1f1c23",
          elev2: "#2a262f",
          text: "#f6f4f8",
          inventory: "#6c4bd6",
          purchasing: "#e08a1a",
          production: "#2faa6a",
        },
      },
      boxShadow: {
        "dt-card":
          "0 10px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
        "dt-glow": "0 4px 14px rgba(221,28,74,0.4)",
      },
    },
  },
  plugins: [],
};
export default config;
