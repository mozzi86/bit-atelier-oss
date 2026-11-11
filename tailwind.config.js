/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}", "./packages/*/src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif']
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			// Semantic state colours (light/dark in index.css): text, surface, border.
  			warnung: {
  				DEFAULT: 'hsl(var(--warnung))',
  				flaeche: 'hsl(var(--warnung-flaeche))',
  				rand: 'hsl(var(--warnung-rand))'
  			},
  			erfolg: {
  				DEFAULT: 'hsl(var(--erfolg))',
  				flaeche: 'hsl(var(--erfolg-flaeche))',
  				rand: 'hsl(var(--erfolg-rand))'
  			},
  			hinweis: {
  				DEFAULT: 'hsl(var(--hinweis))',
  				flaeche: 'hsl(var(--hinweis-flaeche))',
  				rand: 'hsl(var(--hinweis-rand))'
  			},
  			fehler: {
  				DEFAULT: 'hsl(var(--fehler))',
  				flaeche: 'hsl(var(--fehler-flaeche))',
  				rand: 'hsl(var(--fehler-rand))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			link: 'hsl(var(--link))',
  			brand: {
  				DEFAULT: 'hsl(var(--brand))',
  				'2': 'hsl(var(--brand-2))',
  				foreground: 'hsl(var(--brand-foreground))'
  			},
  			// Channel green of the existing "Per WhatsApp senden" button (#25D366).
  			// Named so the portal does not carry an arbitrary hex class.
  			whatsapp: '#25D366',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [
  	require("tailwindcss-animate"),
  	// 101-05: work surface of the drawing pages (no page scroll) only on windows that are wide AND tall enough — below
  	// 760 px height the drawing would get too small, normal page scrolling stays. Same media query as the
  	// #hauptinhalt:has([data-arbeitsflaeche]) rule in packages/nova-core/src/index.css (change both together).
  	// 112-01 (foreign review point 4): a VARIANT, not a `screens` entry. An object screen ({ raw: … }) makes Tailwind drop
  	// every min-*/max-* variant ("The `min-*` and `max-*` variants are not supported with a `screens` configuration
  	// containing objects") — since 101-05 `min-[1440px]:inline-flex` of the portfolio chip in Layout.jsx was never
  	// generated. Cascade note: Tailwind 3.4 emits plugin variants BEFORE the responsive ones (sm…2xl, min-*), the old screen
  	// came after 2xl. Checked 08.11.2026: no element combines a ws: utility with a breakpoint utility on the same property,
  	// so nothing changes today — keep it that way (tests/unit/tailwindVarianten-11201.test.js guards it).
  	({ addVariant }) => addVariant("ws", "@media (min-width: 1024px) and (min-height: 760px)"),
  ],
}