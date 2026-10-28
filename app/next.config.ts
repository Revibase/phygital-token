import type { NextConfig } from 'next';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const nextConfig: NextConfig = {
	transpilePackages: ['phygital-token-sdk'],
	images: { unoptimized: true }
};

export default nextConfig;

void initOpenNextCloudflareForDev();
