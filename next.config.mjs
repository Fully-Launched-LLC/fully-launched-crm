/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Marketplace branch was renamed to Ecommerce (migration 008); keep old
  // bookmarks and links working. Query string (?view=table) is carried over.
  async redirects() {
    return [
      {
        source: "/projects/marketplace",
        destination: "/projects/ecommerce",
        permanent: false,
      },
      // Sales (and Lead Finder before it) is now the Leads tab. ?lead= (opens History)
      // and ?run= (opens a search) are carried over. /lead-finder/audit is a
      // different path and isn't redirected.
      { source: "/sales", destination: "/leads", permanent: false },
      { source: "/lead-finder", destination: "/leads", permanent: false },
    ];
  },
};

export default nextConfig;
