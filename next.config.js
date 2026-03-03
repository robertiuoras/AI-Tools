/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'interviewcoder.co', pathname: '/**' },
      { protocol: 'http', hostname: 'interviewcoder.co', pathname: '/**' },
      { protocol: 'https', hostname: 'cdn.prod.website-files.com', pathname: '/**' },
      { protocol: 'http', hostname: 'cdn.prod.website-files.com', pathname: '/**' },
      { protocol: 'https', hostname: 'www.ai21.com', pathname: '/**' },
      { protocol: 'http', hostname: 'www.ai21.com', pathname: '/**' },
      // Add more tool logo hostnames here as needed
    ],
  },
}

module.exports = nextConfig

