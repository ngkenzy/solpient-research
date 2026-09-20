import type { Metadata } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: "SOLPIENT Research",
  description: "See clearly. Invest deliberately.",
  applicationName: "SOLPIENT Research",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "SOLPIENT",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><PwaRegister />{children}</body>
    </html>
  );
}
