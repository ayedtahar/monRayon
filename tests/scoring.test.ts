import { describe, expect, it } from "vitest";

import { getDemoAnalysis } from "../src/lib/demo";
import {
  calculateCompositionScore,
  scoreProducts,
  selectRecommendations,
} from "../src/lib/scoring";
import type { NormalizedProduct, OffEnrichment } from "../src/lib/types";

function makeOff(
  overrides: Partial<OffEnrichment> = {},
): OffEnrichment {
  return {
    code: "3017620422003",
    product_name: "Céréales test",
    brand: "Test",
    quantity: "500 g",
    nutri_score: "b",
    sugars_100g: 10,
    additives_count: 0,
    additives: [],
    nova_group: 2,
    ingredients_text: "Avoine.",
    match_confidence: 1,
    source_url: "https://world.openfoodfacts.org/product/3017620422003",
    ...overrides,
  };
}

function makeProduct(
  id: string,
  pricePerKg: number | null,
  off: OffEnrichment | null = makeOff(),
) {
  const product: NormalizedProduct & { off: OffEnrichment | null } = {
    id,
    product_name: `Produit ${id}`,
    brand: "Test",
    price: pricePerKg === null ? null : pricePerKg / 2,
    quantity: "500 g",
    quantity_amount: 500,
    quantity_unit: "g",
    price_per_unit: pricePerKg,
    price_unit: pricePerKg === null ? null : "kg",
    price_per_unit_source: pricePerKg === null ? null : "calculated",
    barcode: null,
    bounding_box: { x: 0, y: 0, width: 0.2, height: 0.4 },
    confidence: 1,
    identity_confidence: 1,
    price_confidence: 1,
    price_product_match_confidence: 1,
    promotion_text: null,
    off,
  };
  return product;
}

describe("calculateCompositionScore", () => {
  it("attribue 100 à un Nutri-Score A sans sucres", () => {
    expect(
      calculateCompositionScore(makeOff({ nutri_score: "a", sugars_100g: 0 })),
    ).toEqual({ score: 100, coverage: 1, eligible: true });
  });

  it("applique une légère pénalité quand les sucres manquent", () => {
    expect(
      calculateCompositionScore(makeOff({ nutri_score: "b", sugars_100g: null })),
    ).toEqual({ score: 72, coverage: 0.7, eligible: true });
  });

  it("n'autorise pas une recommandation basée uniquement sur les sucres", () => {
    const result = calculateCompositionScore(
      makeOff({ nutri_score: null, sugars_100g: 10 }),
    );
    expect(result.coverage).toBe(0.3);
    expect(result.eligible).toBe(false);
    expect(result.score).toBe(59.7);
  });

  it("conserve les données absentes comme inconnues", () => {
    expect(calculateCompositionScore(null)).toEqual({
      score: null,
      coverage: 0,
      eligible: false,
    });
  });
});

describe("scoreProducts", () => {
  it("normalise le prix par rapport au produit le moins cher", () => {
    const scored = scoreProducts([
      makeProduct("a", 3),
      makeProduct("b", 4),
      makeProduct("c", 6),
    ]);

    expect(scored.map((product) => product.scores.price)).toEqual([100, 75, 50]);
  });

  it("n'invente pas de score prix quand le prix manque", () => {
    const [product] = scoreProducts([makeProduct("unknown", null)]);
    expect(product.scores.price).toBeNull();
    expect(product.scores.quality_price).toBeNull();
  });

  it("regroupe les catégories si le même produit gagne plusieurs classements", () => {
    const products = scoreProducts([
      makeProduct("winner", 3, makeOff({ nutri_score: "a", sugars_100g: 0 })),
      makeProduct("other", 6, makeOff({ nutri_score: "d", sugars_100g: 25 })),
    ]);
    const recommendations = selectRecommendations(products);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].categories).toEqual([
      "best_price",
      "best_value",
      "best_composition",
    ]);
  });
});

describe("mode démonstration", () => {
  it("produit trois gagnants distincts et déterministes", () => {
    const result = getDemoAnalysis();
    const winners = Object.fromEntries(
      result.recommendations.flatMap((recommendation) =>
        recommendation.categories.map((category) => [
          category,
          recommendation.product_id,
        ]),
      ),
    );

    expect(winners).toEqual({
      best_price: "product-1",
      best_value: "product-2",
      best_composition: "product-3",
    });
  });
});

