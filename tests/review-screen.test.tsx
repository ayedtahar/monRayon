import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  analysisProgress,
  LoadingScreen,
  ResultsScreen,
  ReviewScreen,
} from "@/components/photo-flow";
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

describe("LoadingScreen", () => {
  it("suit l'ordre du traitement en s'espaçant dans le temps", () => {
    expect(analysisProgress(0).activeStep).toBe(0);
    expect(analysisProgress(2).activeStep).toBe(0);
    expect(analysisProgress(3).activeStep).toBe(1);
    expect(analysisProgress(13).activeStep).toBe(2);
    expect(analysisProgress(14).activeStep).toBe(3);
  });

  it("reste sur la dernière étape sans la dépasser", () => {
    expect(analysisProgress(600).activeStep).toBe(3);
  });

  it("ne signale une attente longue qu'au-delà du seuil", () => {
    expect(analysisProgress(24).slow).toBe(false);
    expect(analysisProgress(25).slow).toBe(true);
  });

  it("démarre sur la première étape, sans compteur annoncé ni alerte", () => {
    const html = renderToStaticMarkup(
      <LoadingScreen
        photo={{
          file: null,
          url: "/demo-shelf.svg",
          name: "rayon",
          demo: true,
          objectUrl: false,
        }}
      />,
    );

    expect(html).toContain("Lecture des produits visibles");
    expect(html).toContain('class="step-active"');
    expect(html).toContain('aria-hidden="true">0 s</p>');
    expect(html).not.toContain("plus long que d’habitude");
  });
});
