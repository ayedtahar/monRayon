import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validVisionPayload = {
  products: [
    {
      id: "product-1",
      product_name: "Muesli Fruits",
      brand: "Marque Test",
      price: 2.8,
      quantity: "700 g",
      quantity_amount: 700,
      quantity_unit: "g",
      price_per_unit: 4,
      price_unit: "kg",
      barcode: null,
      bounding_box: { x: 0.1, y: 0.2, width: 0.25, height: 0.5 },
      confidence: 0.9,
      identity_confidence: 0.85,
      price_confidence: 0.95,
      price_product_match_confidence: 0.9,
      promotion_text: null,
    },
  ],
};

function okResponse() {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: JSON.stringify(validVisionPayload) },
          ],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errorResponse(
  status: number,
  error: { message?: string; param?: string; code?: string },
) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Ce que renvoie l'API quand le modèle n'accepte aucun réglage d'échantillonnage. */
function temperatureRejection(options: { withParam?: boolean } = {}) {
  return errorResponse(400, {
    message: "Unsupported parameter: 'temperature' is not supported with this model.",
    param: options.withParam === false ? undefined : "temperature",
    code: "unsupported_parameter",
  });
}

/** Chaque test repart d'un module neuf : la mémoire des modèles est globale. */
async function loadVision() {
  vi.resetModules();
  return (await import("../src/lib/vision")).detectShelfProducts;
}

function queueResponses(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("detectShelfProducts", () => {
  it("envoie l'image et demande une sortie JSON structurée", async () => {
    const fetchMock = queueResponses(okResponse());
    const detect = await loadVision();

    expect(await detect("data:image/jpeg;base64,abc")).toEqual(validVisionPayload);

    const body = sentBody(fetchMock, 0);
    expect(body.store).toBe(false);
    expect(body.temperature).toBe(0);
    expect(body.input[0].content[1]).toMatchObject({
      type: "input_image",
      image_url: "data:image/jpeg;base64,abc",
      detail: "high",
    });
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      name: "shelf_products",
      strict: true,
    });
  });

  it("refuse l'analyse réelle sans clé serveur", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const detect = await loadVision();

    await expect(detect("data:image/jpeg;base64,abc")).rejects.toMatchObject({
      code: "missing_api_key",
      status: 503,
    });
  });
});

describe("detectShelfProducts — modèle refusant temperature", () => {
  it("réessaie sans le paramètre et rend le résultat", async () => {
    const fetchMock = queueResponses(temperatureRejection(), okResponse());
    const detect = await loadVision();

    expect(await detect("data:image/jpeg;base64,abc")).toEqual(validVisionPayload);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchMock, 0).temperature).toBe(0);
    expect(sentBody(fetchMock, 1)).not.toHaveProperty("temperature");
  });

  it("reconnaît le refus même sans champ param", async () => {
    const fetchMock = queueResponses(
      temperatureRejection({ withParam: false }),
      okResponse(),
    );
    const detect = await loadVision();

    await detect("data:image/jpeg;base64,abc");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("s'en souvient et n'envoie plus qu'une requête pour ce modèle", async () => {
    vi.stubEnv("OPENAI_VISION_MODEL", "modele-sans-temperature");
    const fetchMock = queueResponses(
      temperatureRejection(),
      okResponse(),
      okResponse(),
    );
    const detect = await loadVision();

    await detect("data:image/jpeg;base64,abc");
    await detect("data:image/jpeg;base64,def");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sentBody(fetchMock, 2)).not.toHaveProperty("temperature");
  });

  it("n'applique cette mémoire qu'au modèle concerné", async () => {
    vi.stubEnv("OPENAI_VISION_MODEL", "modele-sans-temperature");
    const fetchMock = queueResponses(
      temperatureRejection(),
      okResponse(),
      okResponse(),
    );
    const detect = await loadVision();
    await detect("data:image/jpeg;base64,abc");

    vi.stubEnv("OPENAI_VISION_MODEL", "autre-modele");
    await detect("data:image/jpeg;base64,def");

    expect(sentBody(fetchMock, 2).temperature).toBe(0);
  });

  it("ne réessaie pas sur un refus sans rapport", async () => {
    const fetchMock = queueResponses(
      errorResponse(400, {
        message: "Invalid image data.",
        param: "input",
        code: "invalid_value",
      }),
    );
    const detect = await loadVision();

    await expect(detect("data:image/jpeg;base64,abc")).rejects.toMatchObject({
      code: "vision_api_error",
      status: 422,
      message: "Invalid image data.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ne réessaie jamais deux fois", async () => {
    const fetchMock = queueResponses(
      temperatureRejection(),
      errorResponse(500, { message: "Le service est indisponible." }),
    );
    const detect = await loadVision();

    await expect(detect("data:image/jpeg;base64,abc")).rejects.toMatchObject({
      code: "vision_api_error",
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
