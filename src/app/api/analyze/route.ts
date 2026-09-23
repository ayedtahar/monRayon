import { randomUUID } from "node:crypto";

import { getDemoAnalysis } from "@/lib/demo";
import { AppError } from "@/lib/errors";
import { logError, logInfo } from "@/lib/logger";
import { analyzeShelfImage } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
// Le client reencode toute photo en JPEG ; les deux autres formats couvrent
// un envoi direct. Le message d'erreur plus bas liste exactement ces formats.
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function errorResponse(error: unknown, requestId: string) {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message }, request_id: requestId },
      { status: error.status },
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

export async function POST(request: Request) {
  const requestId = randomUUID();
  const startedAt = Date.now();

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
      return Response.json(result);
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
    const imageDataUrl = `data:${image.type};base64,${bytes.toString("base64")}`;
    const result = await analyzeShelfImage(imageDataUrl);

    logInfo("analysis.completed", {
      requestId,
      mode: "live",
      products: result.products.length,
      enriched: result.meta.enriched_products,
      durationMs: Date.now() - startedAt,
    });
    return Response.json(result);
  } catch (error) {
    logError("analysis.failed", {
      requestId,
      error: error instanceof Error ? error.name : "unknown",
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(error, requestId);
  }
}

