import { describe, expect, it } from "vitest";

import {
  applyPriceCorrections,
  buildAnalysisResult,
  needsPriceReview,
  toDetectedProduct,
} from "../src/lib/analysis";
import { getDemoAnalysis } from "../src/lib/demo";
import type {
  AnalysisInput,
  DetectedProduct,
  OffEnrichment,
} from "../src/lib/types";

function makeOff(overrides: Partial<OffEnrichment> = {}): OffEnrichment {
  return {
    code: "3017620422003",
    product_name: null,
    brand: null,
    quantity: "500 g",
    nutri_score: "b",
    sugars_100g: 10,
    additives_count: 0,
    additives: [],
    nova_group: 2,
    ingredients_text: "Avoine.",
    match_confidence: 1,
    source_url: null,
    ...overrides,
  };
}

function makeDetected(
  id: string,
  overrides: Partial<DetectedProduct> = {},
): DetectedProduct {
  return {
    id,
    product_name: `Produit ${id}`,
    brand: "Test",
    price: 2,
    quantity: "500 g",
    quantity_amount: 500,
    quantity_unit: "g",
    price_per_unit: null,
    price_unit: null,
    barcode: null,
    bounding_box: { x: 0, y: 0, width: 0.2, height: 0.4 },
    confidence: 1,
    identity_confidence: 1,
    price_confidence: 1,
    price_product_match_confidence: 1,
    promotion_text: null,
    ...overrides,
  };
}

describe("buildAnalysisResult", () => {
  it("garde chaque composition attachée à son produit malgré un produit écarté", () => {
    // Le produit du milieu tombe sous le seuil de confiance. Tant que produit
    // et composition voyagent ensemble, le filtrage ne peut pas les décaler.
    const inputs: AnalysisInput[] = [
      { product: makeDetected("product-1"), off: makeOff({ nutri_score: "a" }) },
      {
        product: makeDetected("product-2", { confidence: 0.2 }),
        off: makeOff({ nutri_score: "e" }),
      },
      { product: makeDetected("product-3"), off: makeOff({ nutri_score: "c" }) },
    ];

    const result = buildAnalysisResult(inputs, "live", 10);

    expect(result.products.map((product) => product.id)).toEqual([
      "product-1",
      "product-3",
    ]);
    expect(result.products[0].off?.nutri_score).toBe("a");
    expect(result.products[1].off?.nutri_score).toBe("c");
  });

  it("calcule le prix au kilo depuis le prix et la quantité", () => {
    const result = buildAnalysisResult(
      [{ product: makeDetected("product-1", { price: 3, quantity_amount: 600 }), off: null }],
      "live",
      10,
    );

    expect(result.products[0].price_per_unit).toBe(5);
    expect(result.products[0].price_unit).toBe("kg");
  });

  it("signale l'origine des données sans écraser une correction en mode démo", () => {
    const result = buildAnalysisResult(
      [
        { product: makeDetected("product-1"), off: makeOff(), corrected: true },
        { product: makeDetected("product-2"), off: makeOff() },
      ],
      "demo",
      10,
    );

    expect(result.products[0].sources.price).toBe("user");
    expect(result.products[1].sources.price).toBe("demo");
    expect(result.products[1].sources.nutrition).toBe("demo");
  });

  it("compte les produits à vérifier dans les métadonnées", () => {
    const result = buildAnalysisResult(
      [
        { product: makeDetected("product-1"), off: null },
        { product: makeDetected("product-2", { price: null }), off: null },
        {
          product: makeDetected("product-3", { price_confidence: 0.4 }),
          off: null,
        },
      ],
      "live",
      10,
    );

    expect(result.meta.products_to_review).toBe(2);
  });
});

describe("needsPriceReview", () => {
  const base = buildAnalysisResult(
    [{ product: makeDetected("product-1"), off: null }],
    "live",
    10,
  ).products[0];

  it("laisse tranquille une lecture nette", () => {
    expect(needsPriceReview(base)).toBe(false);
  });

  it("signale un prix absent", () => {
    expect(needsPriceReview({ ...base, price: null })).toBe(true);
  });

  it("signale une quantité inexploitable pour un prix au kilo", () => {
    expect(needsPriceReview({ ...base, quantity_amount: null })).toBe(true);
  });

  it("signale une association prix-produit douteuse", () => {
    expect(
      needsPriceReview({ ...base, price_product_match_confidence: 0.6 }),
    ).toBe(true);
  });

  it("fait confiance à une saisie de l'utilisateur", () => {
    expect(
      needsPriceReview({
        ...base,
        price: null,
        sources: { ...base.sources, price: "user" },
      }),
    ).toBe(false);
  });
});

describe("applyPriceCorrections", () => {
  const initial = buildAnalysisResult(
    [
      {
        // Prix mal lu : 12 € au lieu de 1,20 €, avec une confiance basse.
        product: makeDetected("product-1", {
          price: 12,
          quantity_amount: 600,
          price_confidence: 0.5,
        }),
        off: makeOff({ nutri_score: "d", sugars_100g: 28 }),
      },
      {
        product: makeDetected("product-2", { price: 2.8, quantity_amount: 700 }),
        off: makeOff({ nutri_score: "b", sugars_100g: 12 }),
      },
    ],
    "live",
    10,
  );

  it("rejoue le classement avec le prix corrigé", () => {
    expect(
      initial.recommendations.find((item) =>
        item.categories.includes("best_price"),
      )?.product_id,
    ).toBe("product-2");

    const corrected = applyPriceCorrections(initial, [
      {
        product_id: "product-1",
        price: 1.2,
        quantity_amount: 600,
        quantity_unit: "g",
      },
    ]);

    const product = corrected.products.find((item) => item.id === "product-1");
    expect(product?.price_per_unit).toBe(2);
    expect(product?.sources.price).toBe("user");
    expect(product?.price_confidence).toBe(1);
    expect(
      corrected.recommendations.find((item) =>
        item.categories.includes("best_price"),
      )?.product_id,
    ).toBe("product-1");
  });

  it("ne réutilise jamais le prix au kilo lu sur l'étiquette après correction", () => {
    const withLabelPrice = buildAnalysisResult(
      [
        {
          product: makeDetected("product-1", {
            price: null,
            quantity_amount: null,
            quantity_unit: null,
            price_per_unit: 9.9,
            price_unit: "kg",
          }),
          off: null,
        },
      ],
      "live",
      10,
    );
    expect(withLabelPrice.products[0].price_per_unit).toBe(9.9);

    // L'utilisateur donne un prix mais pas de quantité : sans contenance, aucun
    // prix au kilo ne peut être calculé, et l'ancienne étiquette ne fait plus foi.
    const corrected = applyPriceCorrections(withLabelPrice, [
      {
        product_id: "product-1",
        price: 3,
        quantity_amount: null,
        quantity_unit: null,
      },
    ]);

    expect(corrected.products[0].price).toBe(3);
    expect(corrected.products[0].price_per_unit).toBeNull();
    expect(corrected.products[0].scores.price).toBeNull();
  });

  it("conserve les corrections précédentes lors d'un second passage", () => {
    const first = applyPriceCorrections(initial, [
      {
        product_id: "product-1",
        price: 1.2,
        quantity_amount: 600,
        quantity_unit: "g",
      },
    ]);
    const second = applyPriceCorrections(first, [
      {
        product_id: "product-2",
        price: 2.5,
        quantity_amount: 700,
        quantity_unit: "g",
      },
    ]);

    expect(
      second.products.map((product) => product.sources.price),
    ).toEqual(["user", "user"]);
    expect(second.meta.products_to_review).toBe(0);
  });

  it("laisse un produit intact quand aucune correction ne le vise", () => {
    const corrected = applyPriceCorrections(initial, [
      {
        product_id: "product-1",
        price: 1.2,
        quantity_amount: 600,
        quantity_unit: "g",
      },
    ]);
    const untouched = corrected.products.find((item) => item.id === "product-2");

    expect(untouched?.sources.price).toBe("vision");
    expect(untouched?.price).toBe(2.8);
    expect(untouched?.off?.nutri_score).toBe("b");
  });

  it("n'altère pas le classement quand la correction confirme la lecture", () => {
    const demo = getDemoAnalysis();
    const confirmed = applyPriceCorrections(
      demo,
      demo.products.map((product) => ({
        product_id: product.id,
        price: product.price,
        quantity_amount: product.quantity_amount,
        quantity_unit: product.quantity_unit,
      })),
    );

    expect(confirmed.recommendations).toEqual(demo.recommendations);
  });
});

describe("toDetectedProduct", () => {
  it("ne garde que les observations, sans scores ni sources", () => {
    const analysed = getDemoAnalysis().products[0];
    const detected = toDetectedProduct(analysed);

    expect(detected).not.toHaveProperty("scores");
    expect(detected).not.toHaveProperty("sources");
    expect(detected).not.toHaveProperty("off");
    expect(detected.id).toBe(analysed.id);
  });
});
