import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kaalchhaya",
  description: "Time-slider radar for trade rule and HS code changes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
