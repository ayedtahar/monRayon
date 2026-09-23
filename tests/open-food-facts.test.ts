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
});

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
