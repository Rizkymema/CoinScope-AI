import type { Config } from 'tailwindcss'

/**
 * Obsidian workstation design system.
 * One font family, one accent, solid surfaces, hairline borders.
 * The `ink` / `signal` scales are remapped here so existing class names
 * inherit the system without per-file colour edits.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Single family across display, body and numeric data.
        sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        // hairlines
        line: {
          DEFAULT: 'rgba(255,255,255,0.06)',
          strong: 'rgba(255,255,255,0.12)',
        },
        // surface ramp
        ink: {
          950: '#050814',
          900: '#0a0e1c',
          850: '#0e1426',
          800: '#141b30',
          700: '#1c2540',
          600: '#2b3654',
        },
        // brand accent (action beacon only)
        signal: {
          DEFAULT: '#00d2ff',
          soft: '#4de0ff',
          muted: '#0093b5',
        },
        // semantic status
        pos: '#34d399',
        neg: '#f87171',
        warn: '#fbbf24',
        info: '#a78bfa',

        border: 'rgba(255,255,255,0.06)',
        input: 'rgba(255,255,255,0.06)',
        ring: '#00d2ff',
        background: '#050814',
        foreground: '#f1f5f9',
        primary: {
          DEFAULT: '#00d2ff',
          foreground: '#050814',
        },
        secondary: {
          DEFAULT: '#0e1426',
          foreground: '#f1f5f9',
        },
        destructive: {
          DEFAULT: '#f87171',
          foreground: '#050814',
        },
        muted: {
          DEFAULT: '#0e1426',
          foreground: '#94a3b8',
        },
        accent: {
          DEFAULT: '#0e1426',
          foreground: '#f1f5f9',
        },
        popover: {
          DEFAULT: '#0a0e1c',
          foreground: '#f1f5f9',
        },
        card: {
          DEFAULT: '#0a0e1c',
          foreground: '#f1f5f9',
        },
      },
      borderRadius: {
        DEFAULT: '8px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '12px',
        '3xl': '12px',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-in 200ms cubic-bezier(0.4, 0, 0.2, 1) both',
      },
    },
  },
  plugins: [],
}

export default config
