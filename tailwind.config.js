/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        // RaahSaathi brand palette. Pink carries safety/identity, teal carries
        // trust/verification, green carries sustainability.
        brand: {
          pink: '#db2777',
          'pink-dark': '#be185d',
          'pink-light': '#fce7f3',
          teal: '#0d9488',
          'teal-dark': '#0f766e',
          'teal-light': '#ccfbf1',
          green: '#16a34a',
          'green-dark': '#15803d',
          'green-light': '#dcfce7',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      keyframes: {
        // Full-screen flash for an inbound distress alert. Kept to a ~1s cycle:
        // fast enough to demand attention, slow enough to stay below the 3Hz
        // photosensitive-seizure threshold.
        'alert-flash': {
          '0%, 100%': { backgroundColor: 'rgba(190, 18, 60, 0.96)' },
          '50%': { backgroundColor: 'rgba(244, 63, 94, 0.88)' },
        },
        'ping-slow': {
          '0%': { transform: 'scale(1)', opacity: '0.7' },
          '75%, 100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        'slide-up': {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'alert-flash': 'alert-flash 1s ease-in-out infinite',
        'ping-slow': 'ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'slide-up': 'slide-up 220ms ease-out',
      },
    },
  },
  plugins: [],
};
