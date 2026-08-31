/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 知识库 Markdown / mock 数据通过 fs 读取，需要保证这些目录随 server bundle 一起被追踪
  outputFileTracingIncludes: {
    '/api/**/*': ['./knowledge/**/*', './data/**/*', './config/**/*'],
  },
};

export default nextConfig;
