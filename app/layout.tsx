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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Theme boot script — runs synchronously before first paint so the
          correct theme is rendered with no flash. Mirrors solpient-money:
          stored "solpient-theme" wins; on first visit (nothing stored) the OS
          prefers-color-scheme decides; fallback is light. The existing
          suppressHydrationWarning on <html> covers the data-theme attribute.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("solpient-theme");if(!t){t=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";}if(t==="dark"){document.documentElement.setAttribute("data-theme","dark");}}catch(e){}})();`,
          }}
        />
      </head>
      <body><PwaRegister />{children}</body>
    </html>
  );
}
