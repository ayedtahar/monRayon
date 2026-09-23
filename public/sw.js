// Service worker minimal : il rend l'application installable et lui permet de
// s'ouvrir hors ligne, sans jamais mettre en cache une analyse.
//
// L'analyse a besoin du reseau par nature. L'objectif n'est donc pas de faire
// fonctionner monRayon hors ligne, mais que l'application s'ouvre et explique
// ce qui manque, plutot que d'afficher une page d'erreur du navigateur.

const CACHE = "monrayon-v1";
const SHELL_URL = "/";

// Ressources stables, utiles des le premier ecran.
const STATIC_PATHS = new Set([
  "/demo-shelf.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL_URL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function cacheCopy(request, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy));
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Une analyse ne doit jamais etre servie depuis le cache : le resultat
  // depend de la photo envoyee, et la route est comptabilisee cote serveur.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Reseau d'abord : la page installee ne doit pas rester figee sur une
    // version ancienne tant que le reseau repond.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(SHELL_URL, copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(SHELL_URL)
            .then((cached) => cached || Response.error()),
        ),
    );
    return;
  }

  // Les ressources de build portent une empreinte dans leur nom : leur contenu
  // ne change jamais, le cache peut repondre directement.
  if (url.pathname.startsWith("/_next/static/") || STATIC_PATHS.has(url.pathname)) {
    event.respondWith(
      caches
        .match(request)
        .then(
          (cached) => cached || fetch(request).then((response) => cacheCopy(request, response)),
        ),
    );
  }
});
