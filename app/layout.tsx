import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://notifyiig.vercel.app"),
  applicationName: "BSCPLC Circuit Notifications",
  title: {
    default: "BSCPLC Circuit Notifications",
    template: "%s | BSCPLC Circuit Notifications",
  },
  description:
    "Secure upstream circuit expiry tracking and notification operations for BSCPLC.",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    type: "website",
    url: "/login",
    siteName: "BSCPLC Circuit Notifications",
    title: "BSCPLC Circuit Notifications",
    description: "Secure upstream circuit expiry tracking and notification operations for BSCPLC.",
  },
  twitter: {
    card: "summary",
    title: "BSCPLC Circuit Notifications",
    description: "Secure upstream circuit expiry tracking and notification operations for BSCPLC.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
