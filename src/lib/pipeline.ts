import { detectShelfProducts } from "./vision";
import { lookupOpenFoodFacts } from "./open-food-facts";
import { scoreProducts, selectRecommendations } from "./scoring";
import type {
  AnalysisResult,
  DetectedProduct,
  OffEnrichment,
} from "./types";
import { normalizeUnitPrice } from "./units";

export function buildAnalysisResult(
  detectedProducts: DetectedProduct[],
  enrichments: Array<OffEnrichment | null>,
  mode: AnalysisResult["mode"],
  durationMs: number,
): AnalysisResult {
  const normalized = detectedProducts
    .filter((product) => product.confidence >= 0.35)
    .map(normalizeUnitPrice);
  const enriched = normalized.map((product, index) => {
    const off = enrichments[index] || null;
    return {
      ...product,
      product_name: off?.product_name || product.product_name,
      brand: off?.brand || product.brand,
      barcode: off?.code || product.barcode,
      off,
    };
  });
  const products = scoreProducts(enriched).map((product) =>
    mode === "demo"
      ? {
          ...product,
          sources: {
            identification: "demo" as const,
            price: "demo" as const,
            nutrition: "demo" as const,
          },
        }
      : product,
  );
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
    },
  };
}

export async function analyzeShelfImage(imageDataUrl: string) {
  const startedAt = Date.now();
  const detection = await detectShelfProducts(imageDataUrl);
  const normalized = detection.products
    .filter((product) => product.confidence >= 0.35)
    .map(normalizeUnitPrice);
  const enrichments = await Promise.all(
    normalized.map((product) => lookupOpenFoodFacts(product)),
  );
  return buildAnalysisResult(
    detection.products,
    enrichments,
    "live",
    Date.now() - startedAt,
  );
}
