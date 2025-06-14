/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
        fontFamily: { // Add the Inter font family
            sans: ['Inter', 'sans-serif'],
        },
    },
  },
  plugins: [],
}