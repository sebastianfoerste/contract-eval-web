import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contract Review Evidence Lab",
  description: "Run synthetic contract evaluations, inspect evidence and compare reproducible scores.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
