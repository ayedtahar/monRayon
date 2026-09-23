import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResultsScreen, ReviewScreen } from "@/components/photo-flow";
import { buildAnalysisResult } from "@/lib/analysis";
import type { AnalysisResult, DetectedProduct } from "@/lib/types";

function makeProduct(
  id: string,
  overrides: Partial<DetectedProduct> = {},
): DetectedProduct {
  return {
    id,
    product_name: `Produit ${id}`,
    brand: "Test",
    price: 2.8,
    quantity: "700 g",
    quantity_amount: 700,
    quantity_unit: "g",
    price_per_unit: null,
    price_unit: null,
    barcode: null,
    bounding_box: { x: 0.1, y: 0.2, width: 0.2, height: 0.4 },
    confidence: 1,
    identity_confidence: 1,
    price_confidence: 1,
    price_product_match_confidence: 1,
    promotion_text: null,
    ...overrides,
  };
}

function render(result: AnalysisResult) {
  return renderToStaticMarkup(
    <ReviewScreen
      result={result}
      photo={{
        file: null,
        url: "/demo-shelf.svg",
        name: "rayon",
        demo: true,
        objectUrl: false,
      }}
      onApply={() => {}}
      onCancel={() => {}}
    />,
  );
}

describe("ReviewScreen", () => {
  const result = buildAnalysisResult(
    [
      { product: makeProduct("product-1"), off: null },
      {
        product: makeProduct("product-2", { price: null, price_confidence: 0.3 }),
        off: null,
      },
    ],
    "live",
    10,
  );

  it("affiche une ligne éditable par produit détecté", () => {
    const html = render(result);

    expect(html.match(/class="review-row[ "]/g)).toHaveLength(2);
    expect(html).toContain('id="price-product-1"');
    expect(html).toContain('id="amount-product-2"');
  });

  it("pré-remplit la saisie avec la lecture, virgule comprise", () => {
    const html = render(result);

    expect(html).toContain('value="2,8"');
    expect(html).toContain('value="700"');
  });

  it("remonte et signale la lecture incertaine en premier", () => {
    const html = render(result);

    expect(html.indexOf("Produit product-2")).toBeLessThan(
      html.indexOf("Produit product-1"),
    );
    expect(html).toContain("Lecture incertaine");
  });

  it("propose de revenir aux résultats tant que rien n'est corrigé", () => {
    expect(render(result)).toContain("Revenir aux résultats");
  });

  it("marque un prix déjà confirmé par l'utilisateur", () => {
    const corrected: AnalysisResult = {
      ...result,
      products: result.products.map((product) => ({
        ...product,
        sources: { ...product.sources, price: "user" as const },
      })),
    };

    const html = render(corrected);
    expect(html).toContain("Prix confirmé");
    expect(html).not.toContain("Lecture incertaine");
  });

  it("découpe la photo sur le cadre de chaque produit", () => {
    const html = render(result);

    expect(html).toContain("background-image:url(&quot;/demo-shelf.svg&quot;)");
    expect(html).toContain("background-size:500% 250%");
  });
});

describe("ResultsScreen", () => {
  function renderResults(result: AnalysisResult) {
    return renderToStaticMarkup(
      <ResultsScreen
        result={result}
        photo={{
          file: null,
          url: "/demo-shelf.svg",
          name: "rayon",
          demo: false,
          objectUrl: false,
        }}
        onReset={() => {}}
        onReview={() => {}}
      />,
    );
  }

  it("invite à vérifier quand une lecture de prix est douteuse", () => {
    const html = renderResults(
      buildAnalysisResult(
        [
          { product: makeProduct("product-1"), off: null },
          {
            product: makeProduct("product-2", { price_confidence: 0.3 }),
            off: null,
          },
        ],
        "live",
        10,
      ),
    );

    expect(html).toContain("review-callout");
    expect(html).toContain("1 prix à vérifier");
  });

  it("n'invite pas à vérifier quand toutes les lectures sont nettes", () => {
    const html = renderResults(
      buildAnalysisResult([{ product: makeProduct("product-1"), off: null }], "live", 10),
    );

    expect(html).not.toContain("review-callout");
    expect(html).toContain("Corriger les prix lus");
  });
});
