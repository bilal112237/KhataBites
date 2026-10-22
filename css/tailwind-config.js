tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        canvas: '#FAF8F5',
        surface: '#FFFFFF',
        oat: '#F3EFEA',
        ink: '#18181B',
        muted: '#52525B',
        subtle: '#71717A',
        terracotta: {
          50: '#FFF5F2',
          100: '#FFE8E0',
          500: '#D94E28',
          600: '#C2410C',
          700: '#9A3412',
        },
        emerald: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          600: '#15803D',
          700: '#166534',
        }
      }
    }
  }
};
