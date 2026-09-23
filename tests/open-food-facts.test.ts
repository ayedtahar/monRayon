import { afterEach, describe, expect, it, vi } from "vitest";

import { lookupOpenFoodFacts } from "../src/lib/open-food-facts";
import type { NormalizedProduct } from "../src/lib/types";

function makeProduct(overrides: Partial<NormalizedProduct> = {}): NormalizedProduct {
  return {
    id: "off-test",
    product_name: "Muesli Fruits",
    brand: "Monts et Graines",
    price: 2.8,
    quantity: "700 g",
    quantity_amount: 700,
    quantity_unit: "g",
    price_per_unit: 4,
    price_unit: "kg",
    price_per_unit_source: "calculated",
    barcode: null,
    bounding_box: { x: 0.1, y: 0.2, width: 0.2, height: 0.4 },
    confidence: 0.9,
    identity_confidence: 0.9,
    price_confidence: 0.9,
    price_product_match_confidence: 0.9,
    promotion_text: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Le cache est global au module : chaque test du cache repart à neuf. */
async function loadLookup() {
  vi.resetModules();
  return (await import("../src/lib/open-food-facts")).lookupOpenFoodFacts;
}

function foundResponse() {
  return new Response(
    JSON.stringify({
      product: {
        code: "8712345678901",
        product_name_fr: "Muesli Fruits",
        brands: "Monts et Graines",
        quantity: "700 g",
        nutriscore_grade: "b",
        nutriments: { sugars_100g: 12 },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function emptyResponse() {
  return new Response(JSON.stringify({ products: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("lookupOpenFoodFacts", () => {
  it("privilégie une référence exacte quand le code-barres est visible", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          product: {
            code: "8712345678901",
            product_name_fr: "Muesli Fruits",
            brands: "Monts et Graines",
            quantity: "700 g",
            nutriscore_grade: "b",
            nutriments: { sugars_100g: "12.5" },
            additives_n: 0,
            additives_tags: [],
            nova_group: "3",
            ingredients_text_fr: "Avoine, raisins, pomme.",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupOpenFoodFacts(
      makeProduct({ id: "barcode-test", barcode: "8712345678901" }),
    );

    expect(fetchMock.mock.calls[0][0]).toContain(
      "/api/v3/product/8712345678901.json",
    );
    expect(result).toMatchObject({
      code: "8712345678901",
      nutri_score: "b",
      sugars_100g: 12.5,
      additives_count: 0,
      nova_group: 3,
      match_confidence: 1,
    });
  });

  it("ignore une correspondance textuelle trop éloignée", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            products: [
              {
                code: "0000000000123",
                product_name_fr: "Jus de tomate",
                brands: "Autre marque",
                quantity: "1 l",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await lookupOpenFoodFacts(
      makeProduct({ id: "poor-match-test", product_name: "Muesli Amandes" }),
    );
    expect(result).toBeNull();
  });
});

const HOUR = 60 * 60 * 1_000;

describe("lookupOpenFoodFacts — cache", () => {
  it("ne redemande pas une fiche déjà connue", async () => {
    const fetchMock = vi.fn().mockResolvedValue(foundResponse());
    vi.stubGlobal("fetch", fetchMock);
    const lookup = await loadLookup();
    const product = makeProduct({ barcode: "8712345678901" });

    await lookup(product, 0);
    await lookup(product, HOUR);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("relit une fiche dont le cache a expiré", async () => {
    const fetchMock = vi.fn().mockResolvedValue(foundResponse());
    vi.stubGlobal("fetch", fetchMock);
    const lookup = await loadLookup();
    const product = makeProduct({ barcode: "8712345678901" });

    await lookup(product, 0);
    await lookup(product, 7 * HOUR);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("oublie vite une recherche infructueuse", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", fetchMock);
    const lookup = await loadLookup();
    const product = makeProduct({ product_name: "Produit introuvable" });

    expect(await lookup(product, 0)).toBeNull();
    // Encore frais dix minutes plus tard, relu ensuite : un échec peut venir
    // d'un incident réseau plutôt que d'un produit absent.
    await lookup(product, 5 * 60 * 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await lookup(product, 20 * 60 * 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("partage une recherche encore en cours entre produits identiques", async () => {
    const fetchMock = vi.fn().mockResolvedValue(foundResponse());
    vi.stubGlobal("fetch", fetchMock);
    const lookup = await loadLookup();
    const product = makeProduct({ barcode: "8712345678901" });

    await Promise.all([lookup(product, 0), lookup(product, 0)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("borne sa mémoire et évince les entrées les plus anciennes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", fetchMock);
    const lookup = await loadLookup();

    const first = makeProduct({ product_name: "Produit numero 0" });
    await lookup(first, 0);
    for (let index = 1; index <= 250; index += 1) {
      await lookup(makeProduct({ product_name: `Produit numero ${index}` }), 0);
    }

    const callsBefore = fetchMock.mock.calls.length;
    await lookup(first, 0);
    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1);
  });
});

describe("User-Agent", () => {
  it("annonce l'application et le contact configuré", async () => {
    vi.stubEnv("OPEN_FOOD_FACTS_CONTACT", "exploitant@exemple.fr");
    const fetchMock = vi.fn().mockResolvedValue(foundResponse());
    vi.stubGlobal("fetch", fetchMock);
    const lookup = await loadLookup();

    await lookup(makeProduct({ barcode: "8712345678901" }), 0);

    expect(fetchMock.mock.calls[0][1].headers["User-Agent"]).toBe(
      "monRayon/0.1.0 (exploitant@exemple.fr)",
    );
  });

  it("reste un en-tête ASCII même si le contact porte des accents", async () => {
    vi.stubEnv("OPEN_FOOD_FACTS_CONTACT", "responsable téléphone ☎");
    const fetchMock = vi.fn().mockResolvedValue(foundResponse());
    vi.stubGlobal("fetch", fetchMock);
    const lookup = await loadLookup();

    await lookup(makeProduct({ barcode: "8712345678901" }), 0);

    const header = fetchMock.mock.calls[0][1].headers["User-Agent"];
    expect(header).toBe("monRayon/0.1.0 (responsable tlphone)");
    expect(/^[\x20-\x7e]+$/.test(header)).toBe(true);
  });

  it("le signale clairement quand aucun contact n'est configuré", async () => {
    vi.stubEnv("OPEN_FOOD_FACTS_CONTACT", "");
    const fetchMock = vi.fn().mockResolvedValue(foundResponse());
    vi.stubGlobal("fetch", fetchMock);
    const lookup = await loadLookup();

    await lookup(makeProduct({ barcode: "8712345678901" }), 0);

    expect(fetchMock.mock.calls[0][1].headers["User-Agent"]).toBe(
      "monRayon/0.1.0 (contact non renseigne)",
    );
  });
});
