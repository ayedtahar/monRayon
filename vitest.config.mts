import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Aligné sur les chemins de tsconfig.json, pour que les tests puissent
  // importer les composants comme le fait l'application.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: { environment: "node" },
});
