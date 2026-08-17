import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PUBLIC_DESCRIPTION, PUBLIC_OPEN_GRAPH } from "@/lib/public-metadata";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://notifyiig.vercel.app"),
  applicationName: "BSCPLC Circuit Notifications",
  title: {
    default: "BSCPLC Circuit Notifications",
    template: "%s | BSCPLC Circuit Notifications",
  },
  description: PUBLIC_DESCRIPTION,
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
  openGraph: PUBLIC_OPEN_GRAPH,
  twitter: {
    card: "summary",
    title: "BSCPLC Circuit Notifications",
    description: PUBLIC_DESCRIPTION,
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
