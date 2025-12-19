// Extract the Convex deployment URL from the environment
// In Convex, the deployment URL is available via CONVEX_URL or can be derived
const getConvexUrl = () => {
  // Try to get from Convex environment variable (set in Convex dashboard)
  if (process.env.CONVEX_SITE_URL) {
    return process.env.CONVEX_SITE_URL;
  }

  throw new Error(
    "CONVEX_URL or NEXT_PUBLIC_CONVEX_URL must be set. Set it with: npx convex env set CONVEX_URL <your-convex-url>"
  );
};

export default {
  providers: [
    {
      domain: getConvexUrl(),
      applicationID: "convex",
    },
  ],
};
