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
      // Leads and Lead Finder became one Sales tab. ?lead= (opens History)
      // and ?run= (opens a search) are carried over. /lead-finder/audit is a
      // different path and isn't redirected.
      { source: "/leads", destination: "/sales", permanent: false },
      { source: "/lead-finder", destination: "/sales", permanent: false },
    ];
  },
};

export default nextConfig;
