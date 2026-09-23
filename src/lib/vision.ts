import { AppError } from "./errors";
import { visionResultSchema, type VisionResult } from "./types";

const PRODUCT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    product_name: { type: "string" },
    brand: { type: ["string", "null"] },
    price: { type: ["number", "null"] },
    quantity: { type: ["string", "null"] },
    quantity_amount: { type: ["number", "null"] },
    quantity_unit: {
      type: ["string", "null"],
      enum: ["g", "kg", "ml", "cl", "l", "unit", null],
    },
    price_per_unit: { type: ["number", "null"] },
    price_unit: {
      type: ["string", "null"],
      enum: ["kg", "l", "unit", null],
    },
    barcode: {
      anyOf: [
        { type: "string", pattern: "^\\d{8,14}$" },
        { type: "null" },
      ],
    },
    bounding_box: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
      },
      required: ["x", "y", "width", "height"],
    },
    confidence: { type: "number" },
    identity_confidence: { type: "number" },
    price_confidence: { type: "number" },
    price_product_match_confidence: { type: "number" },
    promotion_text: { type: ["string", "null"] },
  },
  required: [
    "id",
    "product_name",
    "brand",
    "price",
    "quantity",
    "quantity_amount",
    "quantity_unit",
    "price_per_unit",
    "price_unit",
    "barcode",
    "bounding_box",
    "confidence",
    "identity_confidence",
    "price_confidence",
    "price_product_match_confidence",
    "promotion_text",
  ],
} as const;

const VISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    products: {
      type: "array",
      maxItems: 8,
      items: PRODUCT_SCHEMA,
    },
  },
  required: ["products"],
} as const;

const VISION_PROMPT = `Analyse cette photo d'un rayon de céréales de petit-déjeuner en France.

Règles impératives :
- Retourne uniquement les produits alimentaires emballés réellement visibles.
- Regroupe les facings identiques : une référence produit ne doit apparaître qu'une fois.
- Lis le nom, la marque, le prix du paquet, la quantité et le prix au kg affiché quand ils sont lisibles.
- Associe chaque étiquette prix au produit placé directement au-dessus ou désigné par son libellé.
- Utilise le prix promotionnel seulement s'il s'applique immédiatement à un seul paquet. Conserve le texte des autres promotions sans recalculer le prix.
- N'invente jamais une donnée illisible : utilise null et baisse la confiance correspondante.
- Un code-barres ne peut être fourni que si tous ses chiffres sont visibles.
- Donne les prix en euros avec un point décimal.
- quantity_amount est la valeur numérique de la contenance et quantity_unit son unité normalisée.
- Les coordonnées sont relatives à toute l'image, entre 0 et 1, avec origine en haut à gauche. Le cadre entoure le facing le plus lisible du produit.
- Les confiances sont comprises entre 0 et 1.
- Identifie les produits dans l'ordre gauche-droite, haut-bas avec des ids product-1, product-2, etc.`;

type OpenAiResponse = {
  error?: { message?: string };
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
};

function extractOutputText(response: OpenAiResponse) {
  if (typeof response.output_text === "string") return response.output_text;

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" && content.refusal) {
        throw new AppError(
          "vision_refused",
          "L’image n’a pas pu être analysée.",
          422,
        );
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }

  throw new AppError(
    "vision_empty_response",
    "Le service d’analyse n’a renvoyé aucun résultat.",
    502,
  );
}

export async function detectShelfProducts(
  imageDataUrl: string,
): Promise<VisionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "missing_api_key",
      "L’analyse réelle n’est pas configurée. Ajoutez OPENAI_API_KEY ou utilisez la photo de démonstration.",
      503,
    );
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
      store: false,
      temperature: 0,
      max_output_tokens: 4_000,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: VISION_PROMPT },
            { type: "input_image", image_url: imageDataUrl, detail: "high" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "shelf_products",
          strict: true,
          schema: VISION_JSON_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(55_000),
  });

  const body = (await response.json().catch(() => ({}))) as OpenAiResponse;
  if (!response.ok) {
    throw new AppError(
      "vision_api_error",
      body.error?.message || "Le service d’analyse est momentanément indisponible.",
      response.status >= 400 && response.status < 500 ? 422 : 502,
    );
  }

  const outputText = extractOutputText(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new AppError(
      "vision_invalid_json",
      "Le résultat de l’analyse est illisible.",
      502,
    );
  }

  const validated = visionResultSchema.safeParse(parsed);
  if (!validated.success) {
    throw new AppError(
      "vision_invalid_schema",
      "Le résultat de l’analyse est incomplet.",
      502,
    );
  }

  return validated.data;
}
