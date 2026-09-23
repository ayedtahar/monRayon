import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VisionResult } from "../src/lib/types";

/** Une lecture nette, mais dont l'identité est trop faible pour déclencher un
 *  appel Open Food Facts : le test reste hors réseau. */
const VISION_STUB: VisionResult = {
  products: [
    {
      id: "product-1",
      product_name: "Muesli",
      brand: "Test",
      price: 2.8,
      quantity: "700 g",
      quantity_amount: 700,
      quantity_unit: "g",
      price_per_unit: null,
      price_unit: null,
      barcode: null,
      bounding_box: { x: 0.1, y: 0.2, width: 0.2, height: 0.4 },
      confidence: 0.9,
      identity_confidence: 0.4,
      price_confidence: 0.9,
      price_product_match_confidence: 0.9,
      promotion_text: null,
    },
  ],
};

async function loadRoute(
  env: Record<string, string>,
  vision?: () => Promise<VisionResult>,
) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  if (vision) {
    vi.doMock("../src/lib/vision", () => ({ detectShelfProducts: vision }));
  }
  return import("../src/app/api/analyze/route");
}

function demoRequest(client = "203.0.113.1") {
  const body = new FormData();
  body.set("demo", "true");
  return new Request("https://exemple.fr/api/analyze", {
    method: "POST",
    body,
    headers: { "x-forwarded-for": client },
  });
}

function photoRequest(client = "203.0.113.1") {
  const body = new FormData();
  body.set(
    "image",
    new File([new Uint8Array([0xff, 0xd8, 0xff])], "rayon.jpg", {
      type: "image/jpeg",
    }),
  );
  return new Request("https://exemple.fr/api/analyze", {
    method: "POST",
    body,
    headers: { "x-forwarded-for": client },
  });
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("../src/lib/vision");
  vi.restoreAllMocks();
});

describe("POST /api/analyze — limitation de débit", () => {
  it("annonce le quota restant sur une réponse servie", async () => {
    const { POST } = await loadRoute({ RATE_LIMIT_MAX: "3" });
    const response = await POST(demoRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("2");
  });

  it("refuse au-delà de la limite, avec le délai d'attente", async () => {
    const { POST } = await loadRoute({
      RATE_LIMIT_MAX: "2",
      RATE_LIMIT_WINDOW_SECONDS: "300",
    });

    expect((await POST(demoRequest())).status).toBe(200);
    expect((await POST(demoRequest())).status).toBe(200);

    const refused = await POST(demoRequest());
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);

    const payload = await refused.json();
    expect(payload.error.code).toBe("rate_limited");
    expect(payload.error.message).toContain("Réessayez dans");
    expect(payload.request_id).toBeTruthy();
  });

  it("compte chaque client séparément", async () => {
    const { POST } = await loadRoute({ RATE_LIMIT_MAX: "1" });

    expect((await POST(demoRequest("203.0.113.1"))).status).toBe(200);
    expect((await POST(demoRequest("203.0.113.1"))).status).toBe(429);
    expect((await POST(demoRequest("198.51.100.4"))).status).toBe(200);
  });

  it("refuse avant de lire le corps de la requête", async () => {
    const { POST } = await loadRoute({ RATE_LIMIT_MAX: "1" });
    await POST(demoRequest());

    const request = photoRequest();
    const response = await POST(request);

    expect(response.status).toBe(429);
    // Le corps n'a pas été consommé : rien n'a été parcouru pour rien.
    expect(request.bodyUsed).toBe(false);
  });
});

describe("POST /api/analyze — plafond de budget", () => {
  it("laisse la démonstration hors budget", async () => {
    const { POST } = await loadRoute({
      RATE_LIMIT_MAX: "10",
      DAILY_ANALYSIS_BUDGET: "1",
    });

    for (let index = 0; index < 5; index += 1) {
      expect((await POST(demoRequest())).status).toBe(200);
    }
  });

  it("refuse une analyse réelle une fois le budget du jour épuisé", async () => {
    const { POST } = await loadRoute(
      { RATE_LIMIT_MAX: "10", DAILY_ANALYSIS_BUDGET: "1", OPENAI_API_KEY: "test" },
      async () => VISION_STUB,
    );

    expect((await POST(photoRequest())).status).toBe(200);

    const refused = await POST(photoRequest());
    expect(refused.status).toBe(503);
    expect((await refused.json()).error.code).toBe("budget_exhausted");
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);

    // La démonstration reste accessible, comme le promet le message.
    expect((await POST(demoRequest())).status).toBe(200);
  });

  it("ne facture pas au budget une analyse qui n'a jamais atteint l'API", async () => {
    const { POST } = await loadRoute({
      RATE_LIMIT_MAX: "10",
      DAILY_ANALYSIS_BUDGET: "1",
      OPENAI_API_KEY: "",
    });

    const first = await POST(photoRequest());
    expect(first.status).toBe(503);
    expect((await first.json()).error.code).toBe("missing_api_key");

    // Sans remboursement, la seconde tentative masquerait la cause réelle
    // derrière un budget épuisé.
    const second = await POST(photoRequest());
    expect((await second.json()).error.code).toBe("missing_api_key");
  });

  it("rejette un contenu qui n'est pas une image, malgré un type annoncé valide", async () => {
    const { POST } = await loadRoute(
      { RATE_LIMIT_MAX: "10", DAILY_ANALYSIS_BUDGET: "1", OPENAI_API_KEY: "test" },
      async () => VISION_STUB,
    );

    const body = new FormData();
    // Un fichier quelconque présenté comme une photo JPEG.
    body.set(
      "image",
      new File([new TextEncoder().encode("GIF89a...")], "rayon.jpg", {
        type: "image/jpeg",
      }),
    );
    const rejected = await POST(
      new Request("https://exemple.fr/api/analyze", { method: "POST", body }),
    );

    expect(rejected.status).toBe(415);
    expect((await rejected.json()).error.code).toBe("unsupported_image");
    // Le budget n'a pas bougé : une vraie photo passe encore.
    expect((await POST(photoRequest())).status).toBe(200);
  });

  it("rejette un format non pris en charge sans entamer le budget", async () => {
    const { POST } = await loadRoute(
      { RATE_LIMIT_MAX: "10", DAILY_ANALYSIS_BUDGET: "1", OPENAI_API_KEY: "test" },
      async () => VISION_STUB,
    );

    const body = new FormData();
    body.set("image", new File([new Uint8Array([0x47])], "rayon.gif", { type: "image/gif" }));
    const rejected = await POST(
      new Request("https://exemple.fr/api/analyze", { method: "POST", body }),
    );

    expect(rejected.status).toBe(415);
    expect((await POST(photoRequest())).status).toBe(200);
  });
});
