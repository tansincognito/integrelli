import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        panel: 'var(--color-panel)',
        'panel-raised': 'var(--color-panel-raised)',
        foreground: 'var(--color-foreground)',
        muted: 'var(--color-muted)',
        'muted-strong': 'var(--color-muted-strong)',
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        accent: 'var(--color-accent)',
        'accent-foreground': 'var(--color-accent-foreground)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Inter', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'JetBrains Mono', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.035em',
      },
    },
  },
  plugins: [],
};

export default config;
