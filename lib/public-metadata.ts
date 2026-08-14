import type { Metadata } from "next";

export const PUBLIC_DESCRIPTION =
  "Secure upstream circuit expiry tracking and notification operations for BSCPLC.";

export const PUBLIC_OPEN_GRAPH = {
  type: "website",
  url: "/login",
  siteName: "BSCPLC Circuit Notifications",
  title: "BSCPLC Circuit Notifications",
  description: PUBLIC_DESCRIPTION,
} satisfies NonNullable<Metadata["openGraph"]>;
