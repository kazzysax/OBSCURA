/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@obscura/core", "@obscura/store", "@obscura/mock", "@obscura/settlement"],
  webpack(config, { isServer }) {
    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };
    if (isServer) {
      // node:sqlite is a Node builtin webpack doesn't know yet; load it at runtime.
      config.externals.push(({ request }, cb) => (request === "node:sqlite" ? cb(null, "commonjs node:sqlite") : cb()));
    }
    return config;
  },
};
export default nextConfig;
