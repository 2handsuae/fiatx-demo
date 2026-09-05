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
        // Legacy — keep for DashboardLayout / sidebar (migrated separately)
        'brand-primary':       '#2A5CAA',
        'brand-secondary':     '#F5F7FA',
        'brand-dark':          '#1A1A1A',
        'brand-accent':        '#00D1FF',
        'admin-sidebar-bg':    '#1a1a2e',
        'admin-sidebar-text':  '#ffffff',
        'admin-sidebar-hover': '#2a2a3a',
        'admin-content-bg':    '#f5f5f5',
        'admin-border':        '#dddddd',
        'deep-space':          '#121212',
        'deep-sea':            '#001a33',
        'neon-blue':           '#00f5ff',
        'finance-gold':        '#ffd700',
        'card-bg':             'rgba(18, 18, 18, 0.95)',

        // ── New admin design system ─────────────────────────────
        'adm-bg':     'rgb(var(--adm-bg) / <alpha-value>)',
        'adm-panel':  'rgb(var(--adm-panel) / <alpha-value>)',
        'adm-card':   'rgb(var(--adm-card) / <alpha-value>)',
        'adm-hover':  'rgb(var(--adm-hover) / <alpha-value>)',
        'adm-border': 'rgb(var(--adm-border) / <alpha-value>)',
        'adm-bhi':    'rgb(var(--adm-bhi) / <alpha-value>)',
        'adm-amber':  'rgb(var(--adm-amber) / <alpha-value>)',
        'adm-t1':     'rgb(var(--adm-text-1) / <alpha-value>)',
        'adm-t2':     'rgb(var(--adm-text-2) / <alpha-value>)',
        'adm-t3':     'rgb(var(--adm-text-3) / <alpha-value>)',
        'adm-green':  'rgb(var(--adm-green) / <alpha-value>)',
        'adm-red':    'rgb(var(--adm-red) / <alpha-value>)',
        'adm-yellow': 'rgb(var(--adm-yellow) / <alpha-value>)',
        'adm-blue':   'rgb(var(--adm-blue) / <alpha-value>)',
      },
      fontFamily: {
        'noto-medium':  ['"Noto Sans SC"', 'sans-serif', '500'],
        'noto-regular': ['"Noto Sans SC"', 'sans-serif', '400'],
        sans:  ['"Noto Sans SC"', 'Inter', 'system-ui', 'sans-serif'],
        mono:  ['"JetBrains Mono"', '"SF Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
