import { createHash, randomUUID } from "node:crypto";

import { getDemoAnalysis } from "@/lib/demo";
import { AppError } from "@/lib/errors";
import { detectImageFormat, SUPPORTED_IMAGE_FORMATS } from "@/lib/image-format";
import { logError, logInfo } from "@/lib/logger";
import { analyzeShelfImage } from "@/lib/pipeline";
import { BUDGET_KEY, clientKey, getLimiters } from "@/lib/rate-limit";
import type { AnalysisResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set<string>(SUPPORTED_IMAGE_FORMATS);

/** Une adresse IP est une donnée personnelle : les logs n'en gardent qu'une empreinte. */
function anonymise(client: string) {
  return createHash("sha256").update(client).digest("hex").slice(0, 8);
}

function formatDelay(seconds: number) {
  if (seconds < 60) return `${seconds} seconde${seconds > 1 ? "s" : ""}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
}

function errorResponse(error: unknown, requestId: string) {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message }, request_id: requestId },
      { status: error.status, headers: error.headers },
    );
  }

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return Response.json(
      {
        error: {
          code: "analysis_timeout",
          message: "L’analyse a pris trop de temps. Réessayez avec une photo plus rapprochée.",
        },
        request_id: requestId,
      },
      { status: 504 },
    );
  }

  return Response.json(
    {
      error: {
        code: "unexpected_error",
        message: "Une erreur inattendue est survenue pendant l’analyse.",
      },
      request_id: requestId,
    },
    { status: 500 },
  );
}

function analysisResponse(result: AnalysisResult, remaining: number) {
  return Response.json(result, {
    headers: { "X-RateLimit-Remaining": String(remaining) },
  });
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const { requests, budget } = getLimiters();
  const client = clientKey(request);

  // Avant toute lecture du corps : un envoi de 12 Mo ne doit pas être
  // intégralement parcouru pour être ensuite refusé.
  const throttle = requests.consume(client);
  if (!throttle.allowed) {
    logInfo("analysis.rate_limited", {
      requestId,
      client: anonymise(client),
      retryAfter: throttle.retryAfterSeconds,
    });
    return errorResponse(
      new AppError(
        "rate_limited",
        `Trop d’analyses en peu de temps. Réessayez dans ${formatDelay(throttle.retryAfterSeconds)}.`,
        429,
        { "Retry-After": String(throttle.retryAfterSeconds) },
      ),
      requestId,
    );
  }

  try {
    const formData = await request.formData();
    const demo = formData.get("demo") === "true";
    logInfo("analysis.started", { requestId, mode: demo ? "demo" : "live" });

    if (demo) {
      const result = getDemoAnalysis();
      logInfo("analysis.completed", {
        requestId,
        mode: "demo",
        products: result.products.length,
        durationMs: Date.now() - startedAt,
      });
      return analysisResponse(result, throttle.remaining);
    }

    const image = formData.get("image");
    if (!(image instanceof File)) {
      throw new AppError("missing_image", "Ajoutez une photo du rayon.", 400);
    }
    if (!ACCEPTED_IMAGE_TYPES.has(image.type)) {
      throw new AppError(
        "unsupported_image",
        "Format non pris en charge. Utilisez une image JPEG, PNG ou WebP.",
        415,
      );
    }
    if (image.size === 0 || image.size > MAX_IMAGE_BYTES) {
      throw new AppError(
        "image_too_large",
        "La photo doit peser moins de 12 Mo.",
        413,
      );
    }

    const bytes = Buffer.from(await image.arrayBuffer());
    // Le type annoncé vient du client et ne prouve rien : on lit la signature
    // du fichier avant d'engager le moindre appel facturé.
    const format = detectImageFormat(bytes);
    if (!format) {
      throw new AppError(
        "unsupported_image",
        "Ce fichier n’est pas une image JPEG, PNG ou WebP.",
        415,
      );
    }

    // Seule une analyse réelle entame le budget : la démonstration ne coûte rien.
    const spend = budget.consume(BUDGET_KEY);
    if (!spend.allowed) {
      logError("analysis.budget_exhausted", {
        requestId,
        retryAfter: spend.retryAfterSeconds,
      });
      throw new AppError(
        "budget_exhausted",
        "Le nombre d’analyses prévu pour aujourd’hui est atteint. La démonstration reste disponible.",
        503,
        { "Retry-After": String(spend.retryAfterSeconds) },
      );
    }

    const imageDataUrl = `data:${format};base64,${bytes.toString("base64")}`;

    try {
      const result = await analyzeShelfImage(imageDataUrl);
      logInfo("analysis.completed", {
        requestId,
        mode: "live",
        products: result.products.length,
        enriched: result.meta.enriched_products,
        durationMs: Date.now() - startedAt,
      });
      return analysisResponse(result, throttle.remaining);
    } catch (error) {
      // Une clé absente n'a déclenché aucun appel facturé : le budget est rendu,
      // sinon une simple erreur de configuration épuiserait le quota du jour.
      if (error instanceof AppError && error.code === "missing_api_key") {
        budget.refund(BUDGET_KEY);
      }
      throw error;
    }
  } catch (error) {
    logError("analysis.failed", {
      requestId,
      error:
        error instanceof AppError
          ? error.code
          : error instanceof Error
            ? error.name
            : "unknown",
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(error, requestId);
  }
}
