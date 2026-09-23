import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "monRayon — Une photo, trois choix",
    short_name: "monRayon",
    description:
      "Photographiez un rayon et obtenez trois recommandations simples.",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Reprend les jetons --paper de la feuille de style, pour que l'écran de
    // démarrage prolonge l'interface au lieu de clignoter en blanc.
    background_color: "#f5f2e9",
    theme_color: "#f5f2e9",
    categories: ["food", "shopping"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
