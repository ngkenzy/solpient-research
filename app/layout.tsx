import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SOLPIENT Research",
  description: "Fundamental investment research that remembers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
