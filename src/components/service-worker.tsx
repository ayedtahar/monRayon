"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker qui rend l'application installable.
 *
 * Uniquement en production : en développement, un worker persistant et le
 * rechargement à chaud s'entendent mal et servent des fichiers périmés.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Après le chargement : l'enregistrement ne doit pas disputer la bande
    // passante au premier rendu.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Un échec d'enregistrement ne doit rien casser : l'application
        // fonctionne sans, elle n'est simplement pas installable.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
