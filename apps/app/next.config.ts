/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  allowedDevOrigins: ["http://localhost:3000", "http://localhost:3001"],
  reactStrictMode: false,
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
