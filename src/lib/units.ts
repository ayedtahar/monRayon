import type { DetectedProduct, NormalizedProduct, PriceUnit } from "./types";

const ROUNDING_FACTOR = 100;

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * ROUNDING_FACTOR) / ROUNDING_FACTOR;
}

export function calculatePricePerUnit(
  price: number | null,
  amount: number | null,
  unit: DetectedProduct["quantity_unit"],
): { value: number; unit: PriceUnit } | null {
  if (price === null || amount === null || amount <= 0 || unit === null) return null;

  let baseAmount: number;
  let priceUnit: PriceUnit;

  switch (unit) {
    case "g":
      baseAmount = amount / 1_000;
      priceUnit = "kg";
      break;
    case "kg":
      baseAmount = amount;
      priceUnit = "kg";
      break;
    case "ml":
      baseAmount = amount / 1_000;
      priceUnit = "l";
      break;
    case "cl":
      baseAmount = amount / 100;
      priceUnit = "l";
      break;
    case "l":
      baseAmount = amount;
      priceUnit = "l";
      break;
    case "unit":
      baseAmount = amount;
      priceUnit = "unit";
      break;
  }

  if (!Number.isFinite(baseAmount) || baseAmount <= 0) return null;
  return { value: roundCurrency(price / baseAmount), unit: priceUnit };
}

export function normalizeUnitPrice(product: DetectedProduct): NormalizedProduct {
  const calculated = calculatePricePerUnit(
    product.price,
    product.quantity_amount,
    product.quantity_unit,
  );

  if (calculated) {
    return {
      ...product,
      price_per_unit: calculated.value,
      price_unit: calculated.unit,
      price_per_unit_source: "calculated",
    };
  }

  if (product.price_per_unit !== null && product.price_unit !== null) {
    return {
      ...product,
      price_per_unit: roundCurrency(product.price_per_unit),
      price_per_unit_source: "label",
    };
  }

  return {
    ...product,
    price_per_unit: null,
    price_unit: null,
    price_per_unit_source: null,
  };
}

