/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
      },
      textColor: {
        'theme': 'var(--text-primary)',
        'theme-secondary': 'var(--text-secondary)',
        'theme-muted': 'var(--text-muted)',
        'theme-hint': 'var(--text-hint)',
      },
      backgroundColor: {
        'theme-card': 'var(--bg-card)',
        'theme-item': 'var(--bg-item)',
        'theme-item-hover': 'var(--bg-item-hover)',
        'theme-selected': 'var(--bg-selected)',
        'theme-input': 'var(--bg-input)',
      },
      borderColor: {
        'theme': 'var(--border-card)',
        'theme-divider': 'var(--border-divider)',
        'theme-input': 'var(--border-input)',
      },
      boxShadow: {
        'card': '0 2px 8px rgba(0, 0, 0, 0.1)',
        'card-hover': '0 4px 16px rgba(0, 0, 0, 0.15)',
      },
    },
  },
  plugins: [],
}
