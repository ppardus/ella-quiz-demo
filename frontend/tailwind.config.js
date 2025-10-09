export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#8B7CFF", light: "#B6A4FF", dark: "#6A5DFF" },
        background: "#F7F6FA",
      },
      boxShadow: { soft: "0 2px 8px rgba(0,0,0,0.06)" }
    }
  },
  plugins: []
}
