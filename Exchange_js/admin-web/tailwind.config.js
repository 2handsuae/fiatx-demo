/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand-primary': '#2A5CAA',    // 品牌主色
        'brand-secondary': '#F5F7FA',  // 品牌辅色
        'brand-dark': '#1A1A1A',
        'brand-accent': '#00D1FF',
        
        // Admin Dashboard New Palette
        'admin-sidebar-bg': '#1a1a2e',
        'admin-sidebar-text': '#ffffff',
        'admin-sidebar-hover': '#2a2a3a',
        'admin-content-bg': '#f5f5f5',
        'admin-border': '#dddddd',

        // Keep old colors for compatibility if needed, but aim to migrate
        'deep-space': '#121212',
        'deep-sea': '#001a33',
        'neon-blue': '#00f5ff',
        'finance-gold': '#ffd700',
        'card-bg': 'rgba(18, 18, 18, 0.95)',
      },
      fontFamily: {
        'noto-medium': ['"Noto Sans SC"', 'sans-serif', '500'],
        'noto-regular': ['"Noto Sans SC"', 'sans-serif', '400'],
        sans: ['"Noto Sans SC"', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
