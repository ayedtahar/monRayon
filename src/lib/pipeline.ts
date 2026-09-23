import { buildAnalysisResult, isAnalysable } from "./analysis";
import { lookupOpenFoodFacts } from "./open-food-facts";
import type { AnalysisInput } from "./types";
import { normalizeUnitPrice } from "./units";
import { detectShelfProducts } from "./vision";

/**
 * Orchestration serveur : lecture de l'image, puis enrichissement des seules
 * lectures exploitables. Chaque enrichissement reste attaché à son produit.
 */
export async function analyzeShelfImage(imageDataUrl: string) {
  const startedAt = Date.now();
  const detection = await detectShelfProducts(imageDataUrl);
  const analysable = detection.products.filter(isAnalysable).map(normalizeUnitPrice);

  const inputs: AnalysisInput[] = await Promise.all(
    analysable.map(async (product) => ({
      product,
      off: await lookupOpenFoodFacts(product),
    })),
  );

  return buildAnalysisResult(inputs, "live", Date.now() - startedAt);
}
