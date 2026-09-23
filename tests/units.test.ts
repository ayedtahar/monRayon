import { describe, expect, it } from "vitest";

import { calculatePricePerUnit, normalizeUnitPrice } from "../src/lib/units";
import type { DetectedProduct } from "../src/lib/types";

describe("calculatePricePerUnit", () => {
  it.each([
    [3.9, 1, "kg", { value: 3.9, unit: "kg" }],
    [1.95, 500, "g", { value: 3.9, unit: "kg" }],
    [2.4, 75, "cl", { value: 3.2, unit: "l" }],
    [5, 10, "unit", { value: 0.5, unit: "unit" }],
  ] as const)(
    "calcule le prix de référence pour %s € et %s %s",
    (price, amount, unit, expected) => {
      expect(calculatePricePerUnit(price, amount, unit)).toEqual(expected);
    },
  );

  it("renvoie null si la quantité est inconnue", () => {
    expect(calculatePricePerUnit(2.5, null, null)).toBeNull();
  });
});

describe("normalizeUnitPrice", () => {
  it("préfère le calcul déterministe à la valeur OCR affichée", () => {
    const product: DetectedProduct = {
      id: "product-1",
      product_name: "Muesli",
      brand: null,
      price: 3,
      quantity: "500 g",
      quantity_amount: 500,
      quantity_unit: "g",
      price_per_unit: 60,
      price_unit: "kg",
      barcode: null,
      bounding_box: { x: 0, y: 0, width: 0.2, height: 0.4 },
      confidence: 1,
      identity_confidence: 1,
      price_confidence: 1,
      price_product_match_confidence: 1,
      promotion_text: null,
    };

    expect(normalizeUnitPrice(product)).toMatchObject({
      price_per_unit: 6,
      price_unit: "kg",
      price_per_unit_source: "calculated",
    });
  });
});

