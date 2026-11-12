/** @type {import('next').NextConfig} */
const isStaticExport =
  process.env.STATIC_EXPORT === "1" ||
  process.env.CF_PAGES === "1" ||
  process.env.WORKERS_CI === "1";

const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_RAMA_STATIC: isStaticExport ? "1" : "0" },
  ...(isStaticExport
    ? {
        output: "export",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
