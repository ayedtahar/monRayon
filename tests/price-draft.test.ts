import { describe, expect, it } from "vitest";

import { buildAnalysisResult } from "../src/lib/analysis";
import {
  differsFrom,
  MAX_PRICE,
  parseDecimal,
  readDraft,
  toDraft,
} from "../src/lib/price-draft";
import type { DetectedProduct } from "../src/lib/types";

function analysed(overrides: Partial<DetectedProduct> = {}) {
  return buildAnalysisResult(
    [
      {
        product: {
          id: "product-1",
          product_name: "Muesli",
          brand: "Test",
          price: 2.8,
          quantity: "700 g",
          quantity_amount: 700,
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
        },
        off: null,
      },
    ],
    "live",
    5,
  ).products[0];
}

describe("parseDecimal", () => {
  it("accepte la virgule décimale française", () => {
    expect(parseDecimal("1,20", MAX_PRICE)).toEqual({ ok: true, value: 1.2 });
  });

  it("accepte le point décimal", () => {
    expect(parseDecimal("1.20", MAX_PRICE)).toEqual({ ok: true, value: 1.2 });
  });

  it("traite une saisie vide comme une donnée inconnue", () => {
    expect(parseDecimal("   ", MAX_PRICE)).toEqual({ ok: true, value: null });
  });

  it("refuse ce qui n'est pas un nombre", () => {
    expect(parseDecimal("2 euros", MAX_PRICE).ok).toBe(false);
    expect(parseDecimal("1,2,3", MAX_PRICE).ok).toBe(false);
    expect(parseDecimal("-2", MAX_PRICE).ok).toBe(false);
  });

  it("refuse une valeur au-delà des bornes du schéma", () => {
    expect(parseDecimal("1001", MAX_PRICE).ok).toBe(false);
  });
});

describe("readDraft", () => {
  it("convertit une saisie complète en correction", () => {
    const result = readDraft({ price: "1,20", amount: "600", unit: "g" });

    expect(result.valid).toBe(true);
    expect(result.correction).toEqual({
      price: 1.2,
      quantity_amount: 600,
      quantity_unit: "g",
    });
  });

  it("accepte un prix sans contenance", () => {
    const result = readDraft({ price: "3", amount: "", unit: "" });

    expect(result.valid).toBe(true);
    expect(result.correction.quantity_amount).toBeNull();
    expect(result.correction.quantity_unit).toBeNull();
  });

  it("refuse une contenance nulle ou négative", () => {
    expect(readDraft({ price: "3", amount: "0", unit: "g" }).errors.quantity).toBe(
      "La contenance doit être supérieure à 0.",
    );
  });

  it("réclame une unité quand une contenance est saisie", () => {
    expect(readDraft({ price: "3", amount: "600", unit: "" }).errors.quantity).toBe(
      "Choisissez une unité.",
    );
  });

  it("réclame une contenance quand une unité est choisie", () => {
    expect(readDraft({ price: "3", amount: "", unit: "g" }).errors.quantity).toBe(
      "Indiquez la contenance.",
    );
  });

  it("signale séparément un prix illisible", () => {
    const result = readDraft({ price: "gratuit", amount: "600", unit: "g" });

    expect(result.valid).toBe(false);
    expect(result.errors.price).toBeDefined();
    expect(result.errors.quantity).toBeUndefined();
  });
});

describe("toDraft", () => {
  it("affiche les nombres avec la virgule française", () => {
    expect(toDraft(analysed({ price: 1.2 }))).toEqual({
      price: "1,2",
      amount: "700",
      unit: "g",
    });
  });

  it("laisse vide ce qui n'a pas été lu", () => {
    expect(
      toDraft(analysed({ price: null, quantity_amount: null, quantity_unit: null })),
    ).toEqual({ price: "", amount: "", unit: "" });
  });
});

describe("differsFrom", () => {
  const product = analysed();

  it("ignore une saisie identique à la lecture", () => {
    expect(
      differsFrom(product, {
        price: 2.8,
        quantity_amount: 700,
        quantity_unit: "g",
      }),
    ).toBe(false);
  });

  it("détecte un changement d'unité seul", () => {
    expect(
      differsFrom(product, {
        price: 2.8,
        quantity_amount: 700,
        quantity_unit: "ml",
      }),
    ).toBe(true);
  });

  it("boucle avec readDraft sur une saisie inchangée", () => {
    const { correction } = readDraft(toDraft(product));
    expect(differsFrom(product, correction)).toBe(false);
  });
});
