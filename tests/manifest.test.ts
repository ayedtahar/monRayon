import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import manifest from "../src/app/manifest";

const root = fileURLToPath(new URL("..", import.meta.url));
const stylesheet = readFileSync(`${root}src/app/globals.css`, "utf8");

describe("manifest", () => {
  const value = manifest();

  it("déclare ce qu'un navigateur exige pour proposer l'installation", () => {
    expect(value.name).toBeTruthy();
    expect(value.short_name).toBeTruthy();
    expect(value.start_url).toBe("/");
    expect(value.display).toBe("standalone");
  });

  it("fournit les deux tailles d'icône attendues", () => {
    const sizes = (value.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("fournit une icône masquable, que l'écran d'accueil peut rogner", () => {
    expect(
      (value.icons ?? []).some((icon) => icon.purpose === "maskable"),
    ).toBe(true);
  });

  it("référence des fichiers qui existent réellement", () => {
    for (const icon of value.icons ?? []) {
      expect(existsSync(`${root}public${icon.src}`), `${icon.src} manquant`).toBe(true);
    }
  });

  it("reprend les couleurs de la feuille de style", () => {
    // Une dérive ferait clignoter l'écran de démarrage dans une autre teinte.
    const paper = stylesheet.match(/--paper:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(paper).toBeTruthy();
    expect(value.background_color).toBe(paper);
    expect(value.theme_color).toBe(paper);
  });
});
