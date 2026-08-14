import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/login",
      disallow: [
        "/api/",
        "/audit",
        "/circuits",
        "/dashboard",
        "/imports",
        "/notifications",
        "/providers",
        "/settings",
        "/setup",
      ],
    },
  };
}
