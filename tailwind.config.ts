import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#282621", coral: "#ff7a5c", cream: "#f7f6f2" } } },
  plugins: [],
} satisfies Config;
