/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'brand-accent': '#B5BD00', // A cor exata que estava no seu script
                'brand-dark': '#111827',
                'brand-light': '#F9FAFB',
                'brand-gray': {
                    800: '#1F2937',
                    700: '#374151',
                    600: '#4B5563',
                    300: '#D1D5DB',
                }
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'], // Ou 'Roboto' se preferir
            }
        },
    },
    plugins: [],
}