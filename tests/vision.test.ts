import { afterEach, describe, expect, it, vi } from "vitest";

import { detectShelfProducts } from "../src/lib/vision";

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("detectShelfProducts", () => {
  it("envoie l'image et demande une sortie JSON structurée", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(validVisionPayload),
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await detectShelfProducts("data:image/jpeg;base64,abc");
    expect(result).toEqual(validVisionPayload);

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.store).toBe(false);
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
    await expect(
      detectShelfProducts("data:image/jpeg;base64,abc"),
    ).rejects.toMatchObject({ code: "missing_api_key", status: 503 });
  });
});
