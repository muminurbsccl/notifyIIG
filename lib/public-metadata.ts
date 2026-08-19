import type { Metadata } from "next";

export const PUBLIC_DESCRIPTION =
  "BSCPLC IPT NotifySystem — notification system for service renewal, tracking upstream circuit expiries for BSCPLC.";

export const PUBLIC_OPEN_GRAPH = {
  type: "website",
  url: "/login",
  siteName: "BSCPLC IPT NotifySystem",
  title: "BSCPLC IPT NotifySystem",
  description: PUBLIC_DESCRIPTION,
} satisfies NonNullable<Metadata["openGraph"]>;
