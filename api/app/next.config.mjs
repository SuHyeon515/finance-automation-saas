/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",            // 프론트가 부르는 경로
        destination: "http://localhost:8000/:path*", // FastAPI로 프록시
      },
    ];
  },
};
export default nextConfig;
