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
        'adm-bg':     'var(--adm-bg)',
        'adm-panel':  'var(--adm-panel)',
        'adm-card':   'var(--adm-card)',
        'adm-hover':  'var(--adm-hover)',
        'adm-border': 'var(--adm-border)',
        'adm-bhi':    'var(--adm-bhi)',
        'adm-amber':  'var(--adm-amber)',
        'adm-t1':     'var(--adm-text-1)',
        'adm-t2':     'var(--adm-text-2)',
        'adm-t3':     'var(--adm-text-3)',
        'adm-green':  'var(--adm-green)',
        'adm-red':    'var(--adm-red)',
        'adm-yellow': 'var(--adm-yellow)',
        'adm-blue':   'var(--adm-blue)',
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
