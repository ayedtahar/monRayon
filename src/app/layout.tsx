import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistrar } from "@/components/service-worker";

import "./globals.css";

export const metadata: Metadata = {
  title: "monRayon — Une photo, trois choix",
  description:
    "Photographiez un rayon et obtenez trois recommandations simples.",
  applicationName: "monRayon",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "monRayon", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f2e9",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
