/** @type {import('next').NextConfig} */
const securityHeaders = [
    {
        key: "Content-Security-Policy",
        value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https://apis.google.com https://www.gstatic.com https://*.firebaseapp.com https://*.web.app; worker-src 'self' blob: https://www.gstatic.com https://apis.google.com; child-src 'self' blob: https://*.firebaseapp.com https://*.web.app https://accounts.google.com https://appleid.apple.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://*.googleapis.com https://*.googleusercontent.com https://firebasestorage.googleapis.com https://lh3.googleusercontent.com https://*; connect-src 'self' https://*.googleapis.com https://*.googleusercontent.com https://lh3.googleusercontent.com https://firebasestorage.googleapis.com https://*.firebaseio.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com wss://*.firebaseio.com wss://*.firestore.googleapis.com https://*.firebaseapp.com https://*.web.app https://appleid.apple.com https://api.pwnedpasswords.com ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*; frame-src 'self' https://*.firebaseapp.com https://*.web.app https://accounts.google.com https://appleid.apple.com; object-src 'none'; base-uri 'self'; form-action 'self';",
    },
    {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
    },
    {
        key: "X-Frame-Options",
        value: "DENY",
    },
    {
        key: "X-Content-Type-Options",
        value: "nosniff",
    },
    {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
    },
    {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=()",
    },
    {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin-allow-popups",
    },
];

const nextConfig = {
    serverExternalPackages: ["firebase-admin"],
    productionBrowserSourceMaps: false,
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "firebasestorage.googleapis.com",
                port: "",
                pathname: "/**",
            },
            {
                protocol: "https",
                hostname: "lh3.googleusercontent.com",
                port: "",
                pathname: "/**",
            },
            {
                protocol: "https",
                hostname: "www.theluxurynetwork.ae",
                port: "",
                pathname: "/**",
            },
            {
                protocol: "https",
                hostname: "www.mediaoffice.ae",
                port: "",
                pathname: "/**",
            },
            {
                protocol: "https",
                hostname: "cdn.shopify.com",
                port: "",
                pathname: "/**",
            },
            {
                protocol: "https",
                hostname: "padelmagazine.fr",
                port: "",
                pathname: "/**",
            },
            {
                protocol: "https",
                hostname: "**",
            },
        ],
    },
    allowedDevOrigins: [
        "*.sisko.replit.dev",
        "*.replit.dev",
        "*.repl.co",
        "localhost:5000",
        "127.0.0.1:5000",
    ],
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
            {
                source: "/auth/login",
                destination: "/auth/signin",
                permanent: false,
            },
        ];
    },
    async headers() {
        return [
            {
                source: "/(.*)",
                headers: securityHeaders,
            },
        ];
    },
};

export default nextConfig;
