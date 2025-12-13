/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'firebasestorage.googleapis.com',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'lh3.googleusercontent.com',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'www.theluxurynetwork.ae',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'www.mediaoffice.ae',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'cdn.shopify.com',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'padelmagazine.fr',
                port: '',
                pathname: '/**',
            },
            // Allow general HTTPS if really needed, but explicit is better. 
            // Keeping this as fallback for user uploaded avatars from external sources if any.
            {
                protocol: 'https',
                hostname: '**',
            }
        ],
    },
    allowedDevOrigins: [
        "*.sisko.replit.dev",
        "*.replit.dev",
        "*.repl.co",
        "localhost:5000",
        "127.0.0.1:5000",
    ],
    // 1. ADDED: Redirects to fix the blank /login and /signin pages
    async redirects() {
        return [
            {
                source: "/login",
                destination: "/auth/signin",
                permanent: true,
            },
            {
                source: "/signin",
                destination: "/auth/signin",
                permanent: true,
            },
        ];
    },
    async headers() {
        return [
            {
                source: "/(.*)",
                headers: [
                    {
                        key: "Cross-Origin-Opener-Policy",
                        value: "same-origin-allow-popups",
                    },
                ],
            },
        ];
    },
};

export default nextConfig;
