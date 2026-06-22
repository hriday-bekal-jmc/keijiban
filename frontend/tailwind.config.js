/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          orange:  '#E8732A',
          orangeL: '#F5A460',
          dark:    '#3A2A1A',
          mid:     '#5A4030',
          muted:   '#A8906E',
          light:   '#FDE8D0',
          cream:   '#F4EDDA',
          card:    '#FFFDF7',
          border:  '#E4D4B8',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'sans-serif'],
      },
      keyframes: {
        popIn:     { '0%': { opacity:'0', transform:'scale(0.94)' }, '60%': { transform:'scale(1.02)' }, '100%': { opacity:'1', transform:'scale(1)' } },
        slideDown: { from: { opacity:'0', transform:'translateY(-8px)' }, to: { opacity:'1', transform:'translateY(0)' } },
      },
      animation: {
        popIn:     'popIn 0.25s ease forwards',
        slideDown: 'slideDown 0.3s ease',
      },
    },
  },
  plugins: [],
}
