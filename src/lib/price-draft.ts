import type { DetectedProduct, PriceCorrection, ProductAnalysis } from "./types";

export type QuantityUnit = NonNullable<DetectedProduct["quantity_unit"]>;

export const UNIT_OPTIONS: Array<{ value: QuantityUnit; label: string }> = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "cl", label: "cl" },
  { value: "l", label: "L" },
  { value: "unit", label: "unité" },
];

/** Bornes du schéma de détection : une saisie ne doit pas produire l'impossible. */
export const MAX_PRICE = 1_000;
export const MAX_QUANTITY = 100_000;

export type Draft = { price: string; amount: string; unit: string };
export type FieldErrors = { price?: string; quantity?: string };

function toInputValue(value: number | null) {
  return value === null ? "" : String(value).replace(".", ",");
}

export function toDraft(product: ProductAnalysis): Draft {
  return {
    price: toInputValue(product.price),
    amount: toInputValue(product.quantity_amount),
    unit: product.quantity_unit ?? "",
  };
}

type ParsedNumber =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/** Accepte la virgule décimale française ; une saisie vide vaut « inconnu ». */
export function parseDecimal(raw: string, max: number): ParsedNumber {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const normalized = trimmed.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, error: "Chiffres uniquement, virgule acceptée." };
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value > max) {
    return { ok: false, error: "Valeur hors de portée." };
  }
  return { ok: true, value };
}

/**
 * Traduit une saisie en correction exploitable. Une contenance sans unité, ou
 * l'inverse, ne donne aucun prix au kilo : on le dit plutôt que de deviner.
 */
export function readDraft(draft: Draft) {
  const price = parseDecimal(draft.price, MAX_PRICE);
  const amount = parseDecimal(draft.amount, MAX_QUANTITY);
  const errors: FieldErrors = {};

  if (!price.ok) errors.price = price.error;
  if (!amount.ok) errors.quantity = amount.error;

  const amountValue = amount.ok ? amount.value : null;
  if (!errors.quantity) {
    if (amountValue !== null && amountValue <= 0) {
      errors.quantity = "La contenance doit être supérieure à 0.";
    } else if (amountValue !== null && !draft.unit) {
      errors.quantity = "Choisissez une unité.";
    } else if (amountValue === null && draft.unit) {
      errors.quantity = "Indiquez la contenance.";
    }
  }

  return {
    errors,
    valid: Object.keys(errors).length === 0,
    correction: {
      price: price.ok ? price.value : null,
      quantity_amount: amountValue,
      quantity_unit: (amountValue === null ? null : draft.unit || null) as
        | QuantityUnit
        | null,
    },
  };
}

export function differsFrom(
  product: ProductAnalysis,
  correction: Omit<PriceCorrection, "product_id">,
) {
  return (
    correction.price !== product.price ||
    correction.quantity_amount !== product.quantity_amount ||
    correction.quantity_unit !== product.quantity_unit
  );
}
