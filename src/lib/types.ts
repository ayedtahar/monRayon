import { z } from "zod";

export const boundingBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict();

export const detectedProductSchema = z
  .object({
    id: z.string().min(1).max(50),
    product_name: z.string().min(1).max(160),
    brand: z.string().min(1).max(100).nullable(),
    price: z.number().min(0).max(1_000).nullable(),
    quantity: z.string().min(1).max(80).nullable(),
    quantity_amount: z.number().positive().max(100_000).nullable(),
    quantity_unit: z.enum(["g", "kg", "ml", "cl", "l", "unit"]).nullable(),
    price_per_unit: z.number().positive().max(10_000).nullable(),
    price_unit: z.enum(["kg", "l", "unit"]).nullable(),
    barcode: z.string().regex(/^\d{8,14}$/).nullable(),
    bounding_box: boundingBoxSchema,
    confidence: z.number().min(0).max(1),
    identity_confidence: z.number().min(0).max(1),
    price_confidence: z.number().min(0).max(1),
    price_product_match_confidence: z.number().min(0).max(1),
    promotion_text: z.string().min(1).max(160).nullable(),
  })
  .strict();

export const visionResultSchema = z
  .object({
    products: z.array(detectedProductSchema).max(8),
  })
  .strict();

export type BoundingBox = z.infer<typeof boundingBoxSchema>;
export type DetectedProduct = z.infer<typeof detectedProductSchema>;
export type VisionResult = z.infer<typeof visionResultSchema>;
export type PriceUnit = NonNullable<DetectedProduct["price_unit"]>;

export type NormalizedProduct = DetectedProduct & {
  price_per_unit_source: "calculated" | "label" | null;
};

export type OffEnrichment = {
  code: string;
  product_name: string | null;
  brand: string | null;
  quantity: string | null;
  nutri_score: "a" | "b" | "c" | "d" | "e" | null;
  sugars_100g: number | null;
  additives_count: number | null;
  additives: string[];
  nova_group: number | null;
  ingredients_text: string | null;
  match_confidence: number;
  source_url: string | null;
};

export type ProductScores = {
  price: number | null;
  composition: number | null;
  quality_price: number | null;
  composition_coverage: number;
  composition_eligible: boolean;
};

export type ProductAnalysis = NormalizedProduct & {
  off: OffEnrichment | null;
  scores: ProductScores;
  sources: {
    identification: "vision" | "open_food_facts" | "demo";
    price: "vision" | "demo";
    nutrition: "open_food_facts" | "demo" | null;
  };
};

export type RecommendationKind =
  | "best_price"
  | "best_value"
  | "best_composition";

export type Recommendation = {
  product_id: string;
  categories: RecommendationKind[];
  justification: string;
};

export type AnalysisResult = {
  mode: "live" | "demo";
  products: ProductAnalysis[];
  recommendations: Recommendation[];
  warnings: string[];
  meta: {
    detected_products: number;
    enriched_products: number;
    duration_ms: number;
  };
};
