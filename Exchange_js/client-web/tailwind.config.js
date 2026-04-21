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
        // ── Desert Monolith palette (FIATX) ───────────────────────────
        'fx-obsidian': '#0B0908',   // primary background — warm near-black
        'fx-ink':       '#141110',  // surface
        'fx-charcoal':  '#1E1A16',  // elevated card
        'fx-shadow':    '#2A231C',  // hovered row
        'fx-sand':      '#F5EDE0',  // primary text, warm ivory
        'fx-dune':      '#C8B896',  // secondary text
        'fx-dust':      '#8B7B6A',  // tertiary / muted
        'fx-brass':     '#C89B3C',  // primary accent — restrained gold
        'fx-copper':    '#B07530',  // darker hover
        'fx-ember':     '#E5B85F',  // highlight
        'fx-sage':      '#739477',  // positive
        'fx-rust':      '#B85A4A',  // destructive / error
        'fx-rule':      'rgba(245, 237, 224, 0.08)', // hairline borders

        // ── Legacy tokens kept for dashboard screens still using them ─
        'brand-primary':   '#C89B3C',
        'brand-secondary': '#F5EDE0',
        'brand-dark':      '#0B0908',
        'brand-accent':    '#E5B85F',
        'fin-emerald':     '#739477',
        'fin-rose':        '#B85A4A',
        'fin-dark-bg':     '#0B0908',
      },
      fontFamily: {
        // Distinctive serif display — Fraunces variable
        'display':    ['"Fraunces"', 'Georgia', 'serif'],
        // Characterful grotesk for body
        'sans':       ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        // Mono for every number, timestamp, address, label
        'mono':       ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        // legacy
        'noto-medium':  ['"IBM Plex Sans"', 'sans-serif', '500'],
        'noto-regular': ['"IBM Plex Sans"', 'sans-serif', '400'],
        'mono-fin':     ['"IBM Plex Mono"', 'monospace'],
      },
      letterSpacing: {
        'cap': '0.14em',
        'caps': '0.18em',
      },
      backgroundImage: {
        'fx-grain': "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0.96  0 0 0 0 0.93  0 0 0 0 0.88  0 0 0 0.035 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        'fx-vignette': 'radial-gradient(ellipse at center, transparent 0%, rgba(11,9,8,0.6) 100%)',
      },
      boxShadow: {
        'fx-hairline': 'inset 0 0 0 1px rgba(245, 237, 224, 0.08)',
        'fx-brass':    '0 0 0 1px rgba(200, 155, 60, 0.3), 0 8px 24px -12px rgba(200, 155, 60, 0.4)',
      },
      animation: {
        'fx-drift':  'fx-drift 30s linear infinite',
        'fx-pulse':  'fx-pulse 4s ease-in-out infinite',
        'fx-scroll': 'fx-scroll 60s linear infinite',
      },
      keyframes: {
        'fx-drift': {
          '0%':   { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '180px 180px' },
        },
        'fx-pulse': {
          '0%, 100%': { opacity: '0.4' },
          '50%':      { opacity: '0.9' },
        },
        'fx-scroll': {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
    },
  },
  plugins: [],
}
