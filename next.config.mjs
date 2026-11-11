/** @type {import('next').NextConfig} */
const isStaticExport =
  process.env.STATIC_EXPORT === "1" ||
  process.env.CF_PAGES === "1" ||
  process.env.WORKERS_CI === "1";

const nextConfig = {
  reactStrictMode: true,
  ...(isStaticExport
    ? {
        output: "export",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
