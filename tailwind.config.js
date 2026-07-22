/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ['class'],
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: [
  				'var(--font-display)'
  			],
        display: [
          'var(--font-display)'
        ],
        serif: [
          'var(--font-serif)'
        ],
        mono: [
          'var(--font-mono)'
        ]
  		},
  		borderRadius: {
  			lg: 'var(--radius-modals)',
  			md: 'var(--radius-cards)',
  			sm: 'var(--radius-buttons)'
  		},
  		colors: {
        void: 'rgb(var(--color-void-rgb) / <alpha-value>)',
        charcoal: 'rgb(var(--color-charcoal-rgb) / <alpha-value>)',
        graphite: 'rgb(var(--color-graphite-rgb) / <alpha-value>)',
        slate: 'rgb(var(--color-slate-rgb) / <alpha-value>)',
        iron: 'rgb(var(--color-iron-rgb) / <alpha-value>)',
        ash: 'rgb(var(--color-ash-rgb) / <alpha-value>)',
        fog: 'rgb(var(--color-fog-rgb) / <alpha-value>)',
        pearl: 'rgb(var(--color-pearl-rgb) / <alpha-value>)',
        chalk: 'rgb(var(--color-chalk-rgb) / <alpha-value>)',
        ember: 'rgb(var(--color-ember-rgb) / <alpha-value>)',
        amber: 'rgb(var(--color-amber-rgb) / <alpha-value>)',
        forest: 'rgb(var(--color-forest-rgb) / <alpha-value>)',
        verdant: 'rgb(var(--color-verdant-rgb) / <alpha-value>)',
        crimson: 'rgb(var(--color-crimson-rgb) / <alpha-value>)',
        danger: 'rgb(var(--color-danger-rgb) / <alpha-value>)',
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
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
    	keyframes: {
    		typing: {
    			'0%, 100%': {
    				transform: 'translateY(0)',
    				opacity: '0.5'
    			},
    			'50%': {
    				transform: 'translateY(-2px)',
    				opacity: '1'
    			}
    		},
    		'loading-dots': {
    			'0%, 100%': {
    				opacity: '0'
    			},
    			'50%': {
    				opacity: '1'
    			}
    		},
    		wave: {
    			'0%, 100%': {
    				transform: 'scaleY(1)'
    			},
    			'50%': {
    				transform: 'scaleY(0.6)'
    			}
    		},
    		blink: {
    			'0%, 100%': {
    				opacity: '1'
    			},
    			'50%': {
    				opacity: '0'
    			}
    		},
    		'text-blink': {
    			'0%, 100%': {
    				color: 'var(--primary)'
    			},
    			'50%': {
    				color: 'var(--muted-foreground)'
    			}
    		},
    		'bounce-dots': {
    			'0%, 100%': {
    				transform: 'scale(0.8)',
    				opacity: '0.5'
    			},
    			'50%': {
    				transform: 'scale(1.2)',
    				opacity: '1'
    			}
    		},
    		'thin-pulse': {
    			'0%, 100%': {
    				transform: 'scale(0.95)',
    				opacity: '0.8'
    			},
    			'50%': {
    				transform: 'scale(1.05)',
    				opacity: '0.4'
    			}
    		},
    		'pulse-dot': {
    			'0%, 100%': {
    				transform: 'scale(1)',
    				opacity: '0.8'
    			},
    			'50%': {
    				transform: 'scale(1.5)',
    				opacity: '1'
    			}
    		},
    		'shimmer-text': {
    			'0%': {
    				backgroundPosition: '150% center'
    			},
    			'100%': {
    				backgroundPosition: '-150% center'
    			}
    		},
    		'wave-bars': {
    			'0%, 100%': {
    				transform: 'scaleY(1)',
    				opacity: '0.5'
    			},
    			'50%': {
    				transform: 'scaleY(0.6)',
    				opacity: '1'
    			}
    		},
    		shimmer: {
    			'0%': {
    				backgroundPosition: '200% 50%'
    			},
    			'100%': {
    				backgroundPosition: '-200% 50%'
    			}
    		},
    		'spinner-fade': {
    			'0%': {
    				opacity: '0'
    			},
    			'100%': {
    				opacity: '1'
    			}
    		}
    	}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
