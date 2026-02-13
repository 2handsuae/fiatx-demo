/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand-primary': '#3B82F6',    // 更加鲜亮的金融蓝
        'brand-secondary': '#F8FAFC',  // 背景灰
        'brand-dark': '#0F172A',       // 深色模式主色 (Slate 900)
        'brand-accent': '#22D3EE',     // 科技青 (Cyan 400)
        'fin-emerald': '#10B981',      // 金融绿
        'fin-rose': '#F43F5E',         // 金融红
        'fin-dark-bg': '#020617',      // 极深背景 (Slate 950)
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05))',
        'tech-gradient': 'linear-gradient(135deg, #3B82F6 0%, #22D3EE 100%)',
      },
      boxShadow: {
        'glow': '0 0 15px -3px rgba(34, 211, 238, 0.3)',
        'inner-light': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.05)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      fontFamily: {
        'noto-medium': ['"Noto Sans SC"', 'sans-serif', '500'],
        'noto-regular': ['"Noto Sans SC"', 'sans-serif', '400'],
        'mono-fin': ['"JetBrains Mono"', '"Fira Code"', 'monospace'], // 专用金融数字字体
      },
    },
  },
  plugins: [],
}
