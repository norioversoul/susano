import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages locate their bundled binaries relative to their own files.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
};

export default nextConfig;
