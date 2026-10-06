/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Production stack traces (e.g. the "removeChild" crash reports going to /health/client-error)
  // were only ever minified function names (a1, a2, a5...) with no file/line -- impossible to
  // actually pin down, which is why earlier fixes were guesses instead of a real diagnosis.
  // Shipping source maps lets a real stack trace be decoded the next time this happens.
  productionBrowserSourceMaps: true,
  webpack: (config) => {
    // pdfjs-dist optionally requires node-canvas; not needed in the browser.
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
