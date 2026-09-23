import { scoreProducts, selectRecommendations } from "./scoring";
import type {
  AnalysisInput,
  AnalysisResult,
  DetectedProduct,
  PriceCorrection,
  ProductAnalysis,
} from "./types";
import { normalizeUnitPrice } from "./units";

/** En dessous de ce seuil, une lecture est trop incertaine pour être comparée. */
export const MINIMUM_DETECTION_CONFIDENCE = 0.35;

/**
 * Au-dessus des seuils de scoring : un prix peut être assez fiable pour entrer
 * dans le classement tout en méritant une vérification humaine.
 */
export const REVIEW_CONFIG = {
  priceConfidence: 0.75,
  priceMatchConfidence: 0.75,
} as const;

export function isAnalysable(product: DetectedProduct) {
  return product.confidence >= MINIMUM_DETECTION_CONFIDENCE;
}

/**
 * Un produit mérite une vérification quand le prix manque, que la quantité ne
 * permet pas de calculer un prix au kilo, ou que la lecture du prix et son
 * association au produit restent douteuses. Une correction déjà validée par
 * l'utilisateur fait autorité et n'est plus signalée.
 */
export function needsPriceReview(product: ProductAnalysis) {
  if (product.sources.price === "user") return false;
  if (product.price === null) return true;
  if (product.quantity_amount === null || product.quantity_unit === null) return true;
  if (product.price_confidence < REVIEW_CONFIG.priceConfidence) return true;
  return product.price_product_match_confidence < REVIEW_CONFIG.priceMatchConfidence;
}

/** Repart des seules observations, sans les scores ni les sources d'un tour précédent. */
export function toDetectedProduct(product: ProductAnalysis): DetectedProduct {
  return {
    id: product.id,
    product_name: product.product_name,
    brand: product.brand,
    price: product.price,
    quantity: product.quantity,
    quantity_amount: product.quantity_amount,
    quantity_unit: product.quantity_unit,
    price_per_unit: product.price_per_unit,
    price_unit: product.price_unit,
    barcode: product.barcode,
    bounding_box: product.bounding_box,
    confidence: product.confidence,
    identity_confidence: product.identity_confidence,
    price_confidence: product.price_confidence,
    price_product_match_confidence: product.price_product_match_confidence,
    promotion_text: product.promotion_text,
  };
}

/**
 * Chaque produit porte son propre enrichissement : aucun appariement par
 * position de tableau, donc aucun risque de décaler les compositions.
 */
export function buildAnalysisResult(
  inputs: AnalysisInput[],
  mode: AnalysisResult["mode"],
  durationMs: number,
): AnalysisResult {
  const enriched = inputs
    .filter((input) => isAnalysable(input.product))
    .map(({ product, off, corrected }) => {
      const normalized = normalizeUnitPrice(product);
      return {
        ...normalized,
        product_name: off?.product_name || normalized.product_name,
        brand: off?.brand || normalized.brand,
        barcode: off?.code || normalized.barcode,
        off,
        price_source: corrected
          ? ("user" as const)
          : mode === "demo"
            ? ("demo" as const)
            : ("vision" as const),
        identification_source:
          mode === "demo"
            ? ("demo" as const)
            : off
              ? ("open_food_facts" as const)
              : ("vision" as const),
        nutrition_source: off
          ? mode === "demo"
            ? ("demo" as const)
            : ("open_food_facts" as const)
          : null,
      };
    });

  const products = scoreProducts(enriched);
  const recommendations = selectRecommendations(products);
  const warnings: string[] = [];

  if (!products.length) {
    warnings.push(
      "Aucun produit suffisamment lisible n’a été détecté. Rapprochez-vous du rayon.",
    );
  }
  if (products.length && !products.some((product) => product.price_per_unit !== null)) {
    warnings.push("Les prix au kilo n’étaient pas assez lisibles pour être comparés.");
  }
  if (products.length && !products.some((product) => product.off)) {
    warnings.push(
      "Aucune correspondance Open Food Facts assez fiable : la composition reste inconnue.",
    );
  }
  if (products.length && recommendations.length === 0) {
    warnings.push("Les données disponibles ne suffisent pas pour établir un classement fiable.");
  }

  return {
    mode,
    products,
    recommendations,
    warnings,
    meta: {
      detected_products: products.length,
      enriched_products: products.filter((product) => product.off).length,
      duration_ms: durationMs,
      products_to_review: products.filter(needsPriceReview).length,
    },
  };
}

function formatQuantity(
  amount: number | null,
  unit: DetectedProduct["quantity_unit"],
) {
  if (amount === null || unit === null) return null;
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(amount)} ${unit}`;
}

/**
 * Rejoue le classement avec les prix corrigés par l'utilisateur, sans nouvel
 * appel réseau : les compositions Open Food Facts ne dépendent pas du prix.
 * Un produit corrigé voit son prix au kilo recalculé depuis la saisie, jamais
 * repris de l'étiquette lue précédemment.
 */
export function applyPriceCorrections(
  result: AnalysisResult,
  corrections: PriceCorrection[],
  durationMs = result.meta.duration_ms,
): AnalysisResult {
  const byId = new Map(corrections.map((correction) => [correction.product_id, correction]));

  const inputs: AnalysisInput[] = result.products.map((product) => {
    const correction = byId.get(product.id);
    const wasCorrected = product.sources.price === "user";

    if (!correction) {
      return {
        product: toDetectedProduct(product),
        off: product.off,
        corrected: wasCorrected,
      };
    }

    return {
      product: {
        ...toDetectedProduct(product),
        price: correction.price,
        quantity_amount: correction.quantity_amount,
        quantity_unit: correction.quantity_unit,
        quantity: formatQuantity(correction.quantity_amount, correction.quantity_unit),
        price_per_unit: null,
        price_unit: null,
        price_confidence: 1,
        price_product_match_confidence: 1,
      },
      off: product.off,
      corrected: true,
    };
  });

  return buildAnalysisResult(inputs, result.mode, durationMs);
}
