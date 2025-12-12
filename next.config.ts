
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
      // 2. Google User Content (for Google Sign-In profiles)
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
      // 3. The Luxury Network
      {
        protocol: 'https',
        hostname: 'www.theluxurynetwork.ae',
        port: '',
        pathname: '/**',
      },
      // 4. Media Office AE
      {
        protocol: 'https',
        hostname: 'www.mediaoffice.ae',
        port: '',
        pathname: '/**',
      },
      // 5. Shopify CDN
      {
        protocol: 'https',
        hostname: 'cdn.shopify.com',
        port: '',
        pathname: '/**',
      },
      // 6. Padel Magazine
      {
        protocol: 'https',
        hostname: 'padelmagazine.fr',
        port: '',
        pathname: '/**',
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
