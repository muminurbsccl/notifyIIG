import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "BSCPLC Circuit Notifications",
    template: "%s | BSCPLC Circuit Notifications",
  },
  description:
    "Secure upstream circuit expiry tracking and notification operations for BSCPLC.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
