import type { NormalizedProduct, OffEnrichment } from "./types";

const OFF_BASE_URL =
  process.env.OPEN_FOOD_FACTS_BASE_URL || "https://world.openfoodfacts.org";
const OFF_FIELDS = [
  "code",
  "product_name",
  "product_name_fr",
  "brands",
  "quantity",
  "nutriscore_grade",
  "nutrition_grades",
  "nutriments",
  "additives_n",
  "additives_tags",
  "nova_group",
  "ingredients_text",
  "ingredients_text_fr",
].join(",");

type OffProduct = {
  code?: string;
  product_name?: string;
  product_name_fr?: string;
  brands?: string;
  quantity?: string;
  nutriscore_grade?: string;
  nutrition_grades?: string;
  nutriments?: { sugars_100g?: number | string };
  additives_n?: number | string;
  additives_tags?: string[];
  nova_group?: number | string;
  ingredients_text?: string;
  ingredients_text_fr?: string;
};

const cache = new Map<string, Promise<OffEnrichment | null>>();

function normalizeText(value: string | null | undefined) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "de",
  "des",
  "du",
  "le",
  "la",
  "les",
  "aux",
  "avec",
  "cereales",
  "cereal",
]);

function tokens(value: string | null | undefined) {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

function overlapScore(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / left.size;
}

function asFiniteNumber(value: number | string | undefined) {
  if (value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeNutriScore(value: string | undefined) {
  const normalized = value?.toLowerCase();
  return normalized && ["a", "b", "c", "d", "e"].includes(normalized)
    ? (normalized as "a" | "b" | "c" | "d" | "e")
    : null;
}

function productDisplayName(product: OffProduct) {
  return product.product_name_fr || product.product_name || null;
}

function calculateMatchConfidence(
  detected: NormalizedProduct,
  candidate: OffProduct,
) {
  const detectedName = tokens(detected.product_name);
  const candidateName = tokens(productDisplayName(candidate));
  const nameScore = overlapScore(detectedName, candidateName);

  const detectedBrand = normalizeText(detected.brand);
  const candidateBrand = normalizeText(candidate.brands);
  const brandKnown = Boolean(detectedBrand && candidateBrand);
  const brandScore = brandKnown
    ? candidateBrand.includes(detectedBrand) || detectedBrand.includes(candidateBrand)
      ? 1
      : 0
    : 0;

  const detectedQuantity = normalizeText(detected.quantity);
  const candidateQuantity = normalizeText(candidate.quantity);
  const quantityKnown = Boolean(detectedQuantity && candidateQuantity);
  const quantityScore = quantityKnown
    ? detectedQuantity === candidateQuantity ||
      candidateQuantity.includes(detectedQuantity) ||
      detectedQuantity.includes(candidateQuantity)
      ? 1
      : 0
    : 0;

  let totalWeight = 0.65;
  let weightedScore = nameScore * 0.65;
  if (brandKnown) {
    totalWeight += 0.25;
    weightedScore += brandScore * 0.25;
  }
  if (quantityKnown) {
    totalWeight += 0.1;
    weightedScore += quantityScore * 0.1;
  }

  return {
    score: weightedScore / totalWeight,
    nameScore,
    brandScore,
  };
}

function toEnrichment(
  product: OffProduct,
  matchConfidence: number,
): OffEnrichment | null {
  const code = product.code?.replace(/\D/g, "");
  if (!code) return null;

  const additivesCount = asFiniteNumber(product.additives_n);
  const novaGroup = asFiniteNumber(product.nova_group);

  return {
    code,
    product_name: productDisplayName(product),
    brand: product.brands || null,
    quantity: product.quantity || null,
    nutri_score: normalizeNutriScore(
      product.nutriscore_grade || product.nutrition_grades,
    ),
    sugars_100g: asFiniteNumber(product.nutriments?.sugars_100g),
    additives_count: additivesCount === null ? null : Math.max(0, additivesCount),
    additives: Array.isArray(product.additives_tags)
      ? product.additives_tags
      : [],
    nova_group:
      novaGroup !== null && novaGroup >= 1 && novaGroup <= 4
        ? novaGroup
        : null,
    ingredients_text:
      product.ingredients_text_fr || product.ingredients_text || null,
    match_confidence: Math.round(matchConfidence * 100) / 100,
    source_url: `${OFF_BASE_URL}/product/${code}`,
  };
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "monRayon/0.1.0 (portfolio prototype)",
    },
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) return null;
  return response.json() as Promise<unknown>;
}

async function findByBarcode(barcode: string) {
  const url = `${OFF_BASE_URL}/api/v3/product/${encodeURIComponent(barcode)}.json?fields=${encodeURIComponent(OFF_FIELDS)}`;
  const data = (await fetchJson(url)) as { product?: OffProduct } | null;
  return data?.product || null;
}

async function searchCandidates(product: NormalizedProduct) {
  const terms = [product.brand, product.product_name, product.quantity]
    .filter(Boolean)
    .join(" ");
  if (!terms.trim()) return [];

  const params = new URLSearchParams({
    search_terms: terms,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "5",
    fields: OFF_FIELDS,
  });
  const data = (await fetchJson(
    `${OFF_BASE_URL}/cgi/search.pl?${params.toString()}`,
  )) as { products?: OffProduct[] } | null;
  return Array.isArray(data?.products) ? data.products : [];
}

async function lookupUncached(product: NormalizedProduct) {
  try {
    if (product.barcode) {
      const exact = await findByBarcode(product.barcode);
      if (exact) return toEnrichment(exact, 1);
    }

    if (product.identity_confidence < 0.45) return null;
    const candidates = await searchCandidates(product);
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        ...calculateMatchConfidence(product, candidate),
      }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];

    if (!best || best.score < 0.55 || best.nameScore < 0.34) return null;
    if (product.brand && best.brandScore === 0 && best.score < 0.7) return null;
    return toEnrichment(best.candidate, best.score);
  } catch {
    return null;
  }
}

export function lookupOpenFoodFacts(product: NormalizedProduct) {
  const key = product.barcode || normalizeText(
    `${product.brand || ""} ${product.product_name} ${product.quantity || ""}`,
  );
  const existing = cache.get(key);
  if (existing) return existing;

  if (cache.size >= 100) cache.clear();
  const request = lookupUncached(product);
  cache.set(key, request);
  return request;
}

