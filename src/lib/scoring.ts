import type {
  NormalizedProduct,
  OffEnrichment,
  ProductAnalysis,
  ProductScores,
  Recommendation,
  RecommendationKind,
} from "./types";

export const SCORING_CONFIG = {
  compositionWeights: {
    nutriScore: 0.7,
    sugars: 0.3,
  },
  sugarUpperReference: 30,
  missingDataPenalty: 10,
  minimumCompositionCoverage: 0.7,
  minimumPriceConfidence: 0.55,
  minimumPriceMatchConfidence: 0.55,
  qualityPriceWeights: {
    price: 0.5,
    composition: 0.5,
  },
} as const;

const NUTRI_SCORE_VALUES = {
  a: 100,
  b: 75,
  c: 50,
  d: 25,
  e: 0,
} as const;

type EnrichedProduct = NormalizedProduct & {
  off: OffEnrichment | null;
};

function clampScore(value: number) {
  return Math.min(100, Math.max(0, value));
}

function roundScore(value: number) {
  return Math.round(value * 10) / 10;
}

export function calculateCompositionScore(off: OffEnrichment | null): {
  score: number | null;
  coverage: number;
  eligible: boolean;
} {
  if (!off) return { score: null, coverage: 0, eligible: false };

  let weightedTotal = 0;
  let coverage = 0;

  if (off.nutri_score) {
    const weight = SCORING_CONFIG.compositionWeights.nutriScore;
    weightedTotal += NUTRI_SCORE_VALUES[off.nutri_score] * weight;
    coverage += weight;
  }

  if (off.sugars_100g !== null) {
    const weight = SCORING_CONFIG.compositionWeights.sugars;
    const sugarScore =
      100 *
      Math.max(
        0,
        1 - off.sugars_100g / SCORING_CONFIG.sugarUpperReference,
      );
    weightedTotal += sugarScore * weight;
    coverage += weight;
  }

  if (coverage === 0) return { score: null, coverage: 0, eligible: false };

  const missingPenalty = SCORING_CONFIG.missingDataPenalty * (1 - coverage);
  const score = clampScore(weightedTotal / coverage - missingPenalty);

  return {
    score: roundScore(score),
    coverage: roundScore(coverage),
    eligible: coverage >= SCORING_CONFIG.minimumCompositionCoverage,
  };
}

function isPriceEligible(product: EnrichedProduct) {
  return (
    product.price_per_unit !== null &&
    product.price_unit === "kg" &&
    product.price_confidence >= SCORING_CONFIG.minimumPriceConfidence &&
    product.price_product_match_confidence >=
      SCORING_CONFIG.minimumPriceMatchConfidence
  );
}

export function scoreProducts(products: EnrichedProduct[]): ProductAnalysis[] {
  const comparablePrices = products
    .filter(isPriceEligible)
    .map((product) => product.price_per_unit as number);
  const minimumPrice = comparablePrices.length
    ? Math.min(...comparablePrices)
    : null;

  return products.map((product) => {
    const composition = calculateCompositionScore(product.off);
    const priceScore =
      minimumPrice !== null && isPriceEligible(product)
        ? roundScore((100 * minimumPrice) / (product.price_per_unit as number))
        : null;
    const qualityPriceScore =
      priceScore !== null &&
      composition.score !== null &&
      composition.eligible
        ? roundScore(
            priceScore * SCORING_CONFIG.qualityPriceWeights.price +
              composition.score *
                SCORING_CONFIG.qualityPriceWeights.composition,
          )
        : null;

    const scores: ProductScores = {
      price: priceScore,
      composition: composition.score,
      quality_price: qualityPriceScore,
      composition_coverage: composition.coverage,
      composition_eligible: composition.eligible,
    };

    return {
      ...product,
      scores,
      sources: {
        identification: product.off ? "open_food_facts" : "vision",
        price: "vision",
        nutrition: product.off ? "open_food_facts" : null,
      },
    };
  });
}

function compareCandidates(
  a: ProductAnalysis,
  b: ProductAnalysis,
  score: keyof Pick<ProductScores, "price" | "composition" | "quality_price">,
) {
  const scoreDifference = (b.scores[score] ?? -1) - (a.scores[score] ?? -1);
  if (Math.abs(scoreDifference) > 0.0001) return scoreDifference;

  const coverageDifference =
    b.scores.composition_coverage - a.scores.composition_coverage;
  if (Math.abs(coverageDifference) > 0.0001) return coverageDifference;

  const aPrice = a.price_per_unit ?? Number.POSITIVE_INFINITY;
  const bPrice = b.price_per_unit ?? Number.POSITIVE_INFINITY;
  if (aPrice !== bPrice) return aPrice - bPrice;

  return a.id.localeCompare(b.id, "fr");
}

function winner(
  products: ProductAnalysis[],
  score: keyof Pick<ProductScores, "price" | "composition" | "quality_price">,
) {
  return products
    .filter((product) => {
      if (product.scores[score] === null) return false;
      if (score !== "price" && !product.scores.composition_eligible) return false;
      return true;
    })
    .sort((a, b) => compareCandidates(a, b, score))[0];
}

function formatUnitPrice(product: ProductAnalysis) {
  if (product.price_per_unit === null || product.price_unit === null) return null;
  const amount = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(product.price_per_unit);
  return `${amount} €/${product.price_unit}`;
}

function compositionFacts(product: ProductAnalysis) {
  const facts: string[] = [];
  if (product.off?.nutri_score) {
    facts.push(`Nutri-Score ${product.off.nutri_score.toUpperCase()}`);
  }
  if (product.off?.sugars_100g !== null && product.off?.sugars_100g !== undefined) {
    facts.push(
      `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(product.off.sugars_100g)} g de sucres/100 g`,
    );
  }
  return facts.join(" et ");
}

function createJustification(
  product: ProductAnalysis,
  categories: RecommendationKind[],
  comparableCount: number,
) {
  const unitPrice = formatUnitPrice(product);
  const facts = compositionFacts(product);

  if (categories.length > 1) {
    const reasons = [
      categories.includes("best_price") && unitPrice
        ? `${unitPrice}, prix au kilo le plus bas`
        : null,
      categories.includes("best_composition") && facts
        ? facts
        : null,
      categories.includes("best_value")
        ? "meilleur équilibre calculé entre prix et nutrition"
        : null,
    ].filter(Boolean);
    return `${reasons.join(" ; ")}.`;
  }

  switch (categories[0]) {
    case "best_price":
      return `${unitPrice ?? "Prix unitaire disponible"}, le plus bas parmi ${comparableCount} produits comparables.`;
    case "best_value":
      return `Meilleur équilibre calculé : ${[unitPrice, facts].filter(Boolean).join(", ")}.`;
    case "best_composition":
      return `${facts || "Les données nutritionnelles les plus favorables parmi les produits comparés"}.`;
  }
}

export function selectRecommendations(
  products: ProductAnalysis[],
): Recommendation[] {
  const categoryWinners: Array<{
    category: RecommendationKind;
    product: ProductAnalysis | undefined;
  }> = [
    { category: "best_price", product: winner(products, "price") },
    { category: "best_value", product: winner(products, "quality_price") },
    {
      category: "best_composition",
      product: winner(products, "composition"),
    },
  ];

  const grouped = new Map<
    string,
    { product: ProductAnalysis; categories: RecommendationKind[] }
  >();

  for (const { category, product } of categoryWinners) {
    if (!product) continue;
    const existing = grouped.get(product.id);
    if (existing) existing.categories.push(category);
    else grouped.set(product.id, { product, categories: [category] });
  }

  const comparableCount = products.filter(
    (product) => product.scores.price !== null,
  ).length;

  return Array.from(grouped.values()).map(({ product, categories }) => ({
    product_id: product.id,
    categories,
    justification: createJustification(product, categories, comparableCount),
  }));
}
