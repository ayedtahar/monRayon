"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import { applyPriceCorrections, needsPriceReview } from "@/lib/analysis";
import { prepareImageForAnalysis } from "@/lib/client-image";
import { DisplayableError } from "@/lib/errors";
import {
  differsFrom,
  readDraft,
  toDraft,
  UNIT_OPTIONS,
  type Draft,
  type FieldErrors,
} from "@/lib/price-draft";
import type {
  AnalysisResult,
  BoundingBox,
  PriceCorrection,
  ProductAnalysis,
  Recommendation,
  RecommendationKind,
} from "@/lib/types";

type Stage =
  | "capture"
  | "preview"
  | "analyzing"
  | "results"
  | "review"
  | "error";

type Photo = {
  file: File | null;
  url: string;
  name: string;
  demo: boolean;
  objectUrl: boolean;
};

const CATEGORY_META: Record<
  RecommendationKind,
  { label: string; shortLabel: string; icon: string }
> = {
  best_price: { label: "Meilleur prix", shortLabel: "Prix", icon: "€" },
  best_value: {
    label: "Meilleur compromis",
    shortLabel: "Compromis",
    icon: "≈",
  },
  best_composition: {
    label: "Meilleure composition",
    shortLabel: "Composition",
    icon: "✦",
  },
};

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.4 5.4 9.6 3.8h4.8l1.2 1.6H19a2 2 0 0 1 2 2v10.1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.4a2 2 0 0 1 2-2h3.4Z" />
      <circle cx="12" cy="12.4" r="3.7" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 13.5v5.2A2.3 2.3 0 0 0 7.3 21h9.4a2.3 2.3 0 0 0 2.3-2.3v-5.2" />
    </svg>
  );
}

function CaptureScreen({
  cameraInput,
  libraryInput,
  onDemo,
  error,
}: {
  cameraInput: React.RefObject<HTMLInputElement | null>;
  libraryInput: React.RefObject<HTMLInputElement | null>;
  onDemo: () => void;
  error: string | null;
}) {
  return (
    <section className="capture-step" aria-labelledby="capture-title">
      <div className="hero-copy">
        <p className="eyebrow">Céréales petit-déjeuner</p>
        <h1 id="capture-title">
          Une photo.
          <br />
          Trois choix clairs.
        </h1>
        <p>
          Cadrez quelques produits avec leurs prix. monRayon vous aide à choisir
          en quelques secondes.
        </p>
      </div>

      <div className="viewfinder" aria-hidden="true">
        <span className="corner corner-top-left" />
        <span className="corner corner-top-right" />
        <span className="corner corner-bottom-left" />
        <span className="corner corner-bottom-right" />
        <div className="shelf shelf-one">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="shelf shelf-two">
          <i />
          <i />
          <i />
        </div>
      </div>

      <div className="tip">
        <span aria-hidden="true">✦</span>
        <p>
          <strong>Conseil</strong> Photographiez 3 à 8 produits de face, avec les
          étiquettes du rayon.
        </p>
      </div>

      <div className="action-stack">
        <button
          className="button button-primary"
          type="button"
          onClick={() => cameraInput.current?.click()}
        >
          <CameraIcon />
          Prendre une photo
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => libraryInput.current?.click()}
        >
          <UploadIcon />
          Importer une photo
        </button>
        <button className="demo-link" type="button" onClick={onDemo}>
          Essayer avec la photo de démonstration
        </button>
      </div>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function PreviewScreen({
  photo,
  onAnalyze,
  onReset,
}: {
  photo: Photo;
  onAnalyze: () => void;
  onReset: () => void;
}) {
  return (
    <section className="photo-step" aria-labelledby="preview-title">
      <div className="step-heading">
        <div className="eyebrow-row">
          <p className="eyebrow">Photo prête</p>
          {photo.demo && <span className="mode-chip">Démo</span>}
        </div>
        <h1 id="preview-title">Le rayon est bien cadré&nbsp;?</h1>
        <p>Les produits et leurs étiquettes de prix doivent être lisibles.</p>
      </div>

      <figure className="preview-card">
        {/* A blob URL is required because a user photo only exists locally. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt="Aperçu du rayon sélectionné" />
        <figcaption>{photo.name}</figcaption>
      </figure>

      <div className="action-stack">
        <button className="button button-primary" type="button" onClick={onAnalyze}>
          Analyser cette photo
        </button>
        <button className="button button-ghost" type="button" onClick={onReset}>
          Choisir une autre photo
        </button>
      </div>

      <p className="privacy-note">
        {photo.demo
          ? "Cette démonstration utilise quatre produits fictifs."
          : "La photo est envoyée uniquement lorsque vous lancez l’analyse."}
      </p>
    </section>
  );
}

/**
 * L'avancement réel côté serveur n'est pas observable depuis le navigateur.
 * Ces étapes suivent donc l'ordre du traitement, pas son avancement exact, et
 * s'espacent au fil du temps plutôt que de se figer au bout de cinq secondes.
 */
const ANALYSIS_STEPS = [
  { label: "Lecture des produits visibles", startsAt: 0 },
  { label: "Association des prix", startsAt: 3 },
  { label: "Recherche des compositions", startsAt: 8 },
  { label: "Calcul des trois choix", startsAt: 14 },
] as const;

/**
 * N'affiche que des messages écrits pour être lus. Un bogue de programmation
 * ou une panne inattendue reste derrière une formule générique : son texte
 * technique n'aiderait personne devant un rayon.
 */
export function analysisErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "L’analyse a pris trop de temps. Réessayez avec une photo plus rapprochée.";
  }
  if (error instanceof DisplayableError) return error.message;
  return "Une erreur inattendue est survenue.";
}

/** Au-delà, mieux vaut le dire que laisser croire à un blocage. */
const SLOW_ANALYSIS_SECONDS = 25;

export function analysisProgress(elapsedSeconds: number) {
  return {
    activeStep: ANALYSIS_STEPS.reduce(
      (current, step, index) => (elapsedSeconds >= step.startsAt ? index : current),
      0,
    ),
    slow: elapsedSeconds >= SLOW_ANALYSIS_SECONDS,
  };
}

export function LoadingScreen({ photo }: { photo: Photo }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    // Mesuré sur l'horloge plutôt qu'en comptant les tics : un onglet mis en
    // arrière-plan ralentit les minuteurs sans ralentir l'analyse.
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1_000));
    }, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const { activeStep, slow } = analysisProgress(elapsed);

  return (
    <section className="loading-step" aria-live="polite" aria-labelledby="loading-title">
      <div className="loading-photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt="Photo en cours d’analyse" />
        <span className="scan-line" aria-hidden="true" />
      </div>
      <p className="eyebrow">Analyse en cours</p>
      <h1 id="loading-title">On regarde le rayon.</h1>
      <ol className="analysis-steps">
        {ANALYSIS_STEPS.map((step, index) => (
          <li
            key={step.label}
            className={
              index < activeStep
                ? "step-complete"
                : index === activeStep
                  ? "step-active"
                  : ""
            }
          >
            <span>{index < activeStep ? "✓" : index + 1}</span>
            {step.label}
          </li>
        ))}
      </ol>
      {/* Masqué aux lecteurs d'écran : la région est annoncée à chaque
          changement, et un compteur de secondes la rendrait bavarde. */}
      <p className="analysis-elapsed" aria-hidden="true">
        {elapsed} s
      </p>
      {slow && (
        <p className="analysis-slow">
          C’est plus long que d’habitude. On attend toujours la réponse du
          service d’analyse.
        </p>
      )}
    </section>
  );
}

function formatPrice(value: number | null) {
  if (value === null) return "Prix inconnu";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatUnitPrice(product: ProductAnalysis) {
  if (product.price_per_unit === null || product.price_unit === null) {
    return "Prix unitaire inconnu";
  }
  const amount = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(product.price_per_unit);
  return `${amount} €/${product.price_unit}`;
}

function NutriScore({ product }: { product: ProductAnalysis }) {
  const grade = product.off?.nutri_score;
  if (!grade) return <span className="unknown-value">Nutri-Score inconnu</span>;
  return (
    <span className={`nutri-score nutri-${grade}`}>
      Nutri-Score <strong>{grade.toUpperCase()}</strong>
    </span>
  );
}

function ResultCard({
  recommendation,
  product,
}: {
  recommendation: Recommendation;
  product: ProductAnalysis;
}) {
  const primaryCategory = recommendation.categories[0];
  return (
    <article className={`result-card category-${primaryCategory}`}>
      <div className="category-list">
        {recommendation.categories.map((category) => (
          <span className="category-badge" key={category}>
            <i aria-hidden="true">{CATEGORY_META[category].icon}</i>
            {CATEGORY_META[category].label}
          </span>
        ))}
      </div>
      <div className="result-card-title">
        <div>
          <h2>{product.product_name}</h2>
          <p>{product.brand || "Marque inconnue"}</p>
        </div>
        <span className="confidence" title="Confiance de reconnaissance">
          {Math.round(product.confidence * 100)}%
        </span>
      </div>
      <div className="product-facts">
        <div>
          <span>Prix</span>
          <strong>{formatPrice(product.price)}</strong>
        </div>
        <div>
          <span>Comparaison</span>
          <strong>{formatUnitPrice(product)}</strong>
        </div>
        <div>
          <span>Nutrition</span>
          <NutriScore product={product} />
        </div>
      </div>
      <p className="justification">{recommendation.justification}</p>
      {product.promotion_text && (
        <p className="promotion-note">Promotion visible : {product.promotion_text}</p>
      )}
      {product.off && (
        <p className="composition-detail">
          {product.off.sugars_100g !== null
            ? `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(product.off.sugars_100g)} g de sucres/100 g`
            : "Sucres inconnus"}
          <span aria-hidden="true">·</span>
          {product.off.additives_count !== null
            ? product.off.additives_count === 0
              ? "Aucun additif déclaré"
              : `${product.off.additives_count} additif${product.off.additives_count > 1 ? "s" : ""} déclaré${product.off.additives_count > 1 ? "s" : ""}`
            : "Additifs inconnus"}
        </p>
      )}
    </article>
  );
}

export function ResultsScreen({
  result,
  photo,
  onReset,
  onReview,
}: {
  result: AnalysisResult;
  photo: Photo;
  onReset: () => void;
  onReview: () => void;
}) {
  const recommendationEntries = result.recommendations.flatMap((recommendation) => {
    const product = result.products.find(
      (candidate) => candidate.id === recommendation.product_id,
    );
    return product ? [{ recommendation, product }] : [];
  });
  const recommendationsByProduct = new Map(
    recommendationEntries.map(({ recommendation }) => [
      recommendation.product_id,
      recommendation,
    ]),
  );

  return (
    <section className="results-step" aria-labelledby="results-title">
      <div className="results-heading">
        <div>
          <div className="eyebrow-row">
            <p className="eyebrow">3 choix maximum</p>
            {result.mode === "demo" && <span className="mode-chip">Démo</span>}
          </div>
          <h1 id="results-title">Nos choix dans ce rayon</h1>
        </div>
        <p>
          {result.meta.detected_products} produit
          {result.meta.detected_products > 1 ? "s" : ""} comparé
          {result.meta.detected_products > 1 ? "s" : ""}
        </p>
      </div>

      <div className="result-photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt="Produits recommandés dans le rayon" />
        {result.products.map((product) => {
          const recommendation = recommendationsByProduct.get(product.id);
          if (!recommendation) return null;
          const category = recommendation.categories[0];
          return (
            <span
              className={`product-overlay overlay-${category}`}
              key={product.id}
              style={{
                left: `${product.bounding_box.x * 100}%`,
                top: `${product.bounding_box.y * 100}%`,
                width: `${product.bounding_box.width * 100}%`,
                height: `${product.bounding_box.height * 100}%`,
              }}
            >
              <span className="overlay-label">
                {recommendation.categories
                  .map((item) => CATEGORY_META[item].shortLabel)
                  .join(" + ")}
              </span>
            </span>
          );
        })}
      </div>

      {recommendationEntries.length ? (
        <div className="results-list">
          {recommendationEntries.map(({ recommendation, product }) => (
            <ResultCard
              key={recommendation.product_id}
              recommendation={recommendation}
              product={product}
            />
          ))}
        </div>
      ) : (
        <div className="empty-results">
          <strong>Pas assez de données fiables</strong>
          <p>Essayez une photo plus proche, avec les prix bien visibles.</p>
        </div>
      )}

      {result.meta.products_to_review > 0 && (
        <button className="review-callout" type="button" onClick={onReview}>
          <span className="review-callout-icon" aria-hidden="true">
            ?
          </span>
          <span>
            <strong>
              {result.meta.products_to_review} prix à vérifier
            </strong>
            Une étiquette mal lue fausse tout le classement. Corrigez-la en dix
            secondes.
          </span>
          <span className="review-callout-arrow" aria-hidden="true">
            →
          </span>
        </button>
      )}

      {result.warnings.length > 0 && (
        <div className="warnings" role="status">
          {result.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

      <div className="results-footer">
        <button className="button button-primary" type="button" onClick={onReset}>
          Analyser un autre rayon
        </button>
        {result.products.length > 0 && (
          <button
            className="button button-secondary"
            type="button"
            onClick={onReview}
          >
            Corriger les prix lus
          </button>
        )}
        <p>
          {result.mode === "demo"
            ? "Produits et données fictifs pour démonstration."
            : "Données nutritionnelles : Open Food Facts, lorsqu’une correspondance fiable existe."}
        </p>
      </div>
    </section>
  );
}

/**
 * Découpe la photo sur le cadre du produit, pour que la personne voie de quel
 * paquet on parle sans avoir à relire toute l'image.
 */
function cropStyle(url: string, box: BoundingBox): React.CSSProperties {
  const offset = (position: number, size: number) =>
    size >= 1 ? 50 : Math.min(100, Math.max(0, (position / (1 - size)) * 100));

  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${100 / box.width}% ${100 / box.height}%`,
    backgroundPosition: `${offset(box.x, box.width)}% ${offset(box.y, box.height)}%`,
  };
}

function ReviewRow({
  product,
  draft,
  errors,
  flagged,
  photoUrl,
  onChange,
}: {
  product: ProductAnalysis;
  draft: Draft;
  errors: FieldErrors;
  flagged: boolean;
  photoUrl: string;
  onChange: (draft: Draft) => void;
}) {
  const priceId = `price-${product.id}`;
  const amountId = `amount-${product.id}`;
  const unitId = `unit-${product.id}`;

  return (
    <li className={`review-row${flagged ? " review-row-flagged" : ""}`}>
      <div className="review-row-head">
        <span
          className="review-thumb"
          style={cropStyle(photoUrl, product.bounding_box)}
          role="img"
          aria-label={`Vue rapprochée de ${product.product_name}`}
        />
        <div className="review-identity">
          <strong>{product.product_name}</strong>
          <span>{product.brand || "Marque inconnue"}</span>
          {flagged && (
            <span className="review-flag">Lecture incertaine</span>
          )}
          {product.sources.price === "user" && (
            <span className="review-flag review-flag-done">Prix confirmé</span>
          )}
        </div>
      </div>

      <div className="review-fields">
        <div className="review-field">
          <label htmlFor={priceId}>Prix du paquet</label>
          <div className="review-input">
            <input
              id={priceId}
              inputMode="decimal"
              autoComplete="off"
              placeholder="—"
              value={draft.price}
              aria-invalid={Boolean(errors.price)}
              onChange={(event) =>
                onChange({ ...draft, price: event.target.value })
              }
            />
            <span aria-hidden="true">€</span>
          </div>
        </div>

        <div className="review-field">
          <label htmlFor={amountId}>Contenance</label>
          <div className="review-input">
            <input
              id={amountId}
              inputMode="decimal"
              autoComplete="off"
              placeholder="—"
              value={draft.amount}
              aria-invalid={Boolean(errors.quantity)}
              onChange={(event) =>
                onChange({ ...draft, amount: event.target.value })
              }
            />
            <select
              id={unitId}
              aria-label="Unité de contenance"
              value={draft.unit}
              onChange={(event) =>
                onChange({ ...draft, unit: event.target.value })
              }
            >
              <option value="">unité ?</option>
              {UNIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {(errors.price || errors.quantity) && (
        <p className="review-error" role="alert">
          {errors.price || errors.quantity}
        </p>
      )}
    </li>
  );
}

export function ReviewScreen({
  result,
  photo,
  onApply,
  onCancel,
}: {
  result: AnalysisResult;
  photo: Photo;
  onApply: (corrections: PriceCorrection[]) => void;
  onCancel: () => void;
}) {
  const flagged = useMemo(
    () => new Set(result.products.filter(needsPriceReview).map((item) => item.id)),
    [result.products],
  );
  // Les lectures douteuses remontent en tête, sans perdre l'ordre du rayon.
  const ordered = useMemo(
    () =>
      [...result.products].sort(
        (a, b) => Number(flagged.has(b.id)) - Number(flagged.has(a.id)),
      ),
    [result.products, flagged],
  );

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(result.products.map((item) => [item.id, toDraft(item)])),
  );

  const rows = ordered.map((product) => {
    const draft = drafts[product.id] ?? toDraft(product);
    return { product, draft, ...readDraft(draft) };
  });

  const invalidCount = rows.filter((row) => !row.valid).length;
  const changedCount = rows.filter(
    (row) => row.valid && differsFrom(row.product, row.correction),
  ).length;

  function submit() {
    if (invalidCount > 0) return;
    onApply(
      rows
        .filter((row) => differsFrom(row.product, row.correction))
        .map((row) => ({ product_id: row.product.id, ...row.correction })),
    );
  }

  return (
    <section className="review-step" aria-labelledby="review-title">
      <div className="step-heading">
        <div className="eyebrow-row">
          <p className="eyebrow">Vérification</p>
          {result.mode === "demo" && <span className="mode-chip">Démo</span>}
        </div>
        <h1 id="review-title">Ces prix sont-ils les bons&nbsp;?</h1>
        <p>
          Corrigez ce qui a été mal lu. Le classement est recalculé aussitôt,
          sans renvoyer la photo.
        </p>
      </div>

      <ul className="review-list">
        {rows.map((row) => (
          <ReviewRow
            key={row.product.id}
            product={row.product}
            draft={row.draft}
            errors={row.errors}
            flagged={flagged.has(row.product.id)}
            photoUrl={photo.url}
            onChange={(draft) =>
              setDrafts((current) => ({ ...current, [row.product.id]: draft }))
            }
          />
        ))}
      </ul>

      <p className="review-hint">
        Laissez un champ vide si la donnée est inconnue. Sans contenance, le
        prix au kilo ne peut pas être calculé et le produit sort de la
        comparaison des prix.
      </p>

      <div className="action-stack">
        <button
          className="button button-primary"
          type="button"
          onClick={submit}
          disabled={invalidCount > 0}
        >
          {changedCount > 0
            ? `Recalculer avec ${changedCount} correction${changedCount > 1 ? "s" : ""}`
            : "Revenir aux résultats"}
        </button>
        <button className="button button-ghost" type="button" onClick={onCancel}>
          Annuler
        </button>
      </div>

      {invalidCount > 0 && (
        <p className="error-message" role="alert">
          Corrigez la saisie signalée avant de recalculer.
        </p>
      )}
    </section>
  );
}

function ErrorScreen({
  message,
  onRetry,
  onDemo,
  onReset,
}: {
  message: string;
  onRetry: () => void;
  onDemo: () => void;
  onReset: () => void;
}) {
  return (
    <section className="failure-step" role="alert">
      <span className="failure-icon" aria-hidden="true">
        !
      </span>
      <p className="eyebrow">Analyse interrompue</p>
      <h1>On n’a pas pu lire ce rayon.</h1>
      <p>{message}</p>
      <div className="action-stack">
        <button className="button button-primary" type="button" onClick={onRetry}>
          Réessayer
        </button>
        <button className="button button-secondary" type="button" onClick={onDemo}>
          Voir la démonstration
        </button>
        <button className="button button-ghost" type="button" onClick={onReset}>
          Choisir une autre photo
        </button>
      </div>
    </section>
  );
}

export function PhotoFlow() {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [stage, setStage] = useState<Stage>("capture");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (photo?.objectUrl) URL.revokeObjectURL(photo.url);
    };
  }, [photo]);

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Ce fichier n’est pas une image.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("La photo dépasse 20 Mo.");
      return;
    }

    setError(null);
    setResult(null);
    setPhoto({
      file,
      url: URL.createObjectURL(file),
      name: file.name,
      demo: false,
      objectUrl: true,
    });
    setStage("preview");
  }

  function loadDemo() {
    setError(null);
    setResult(null);
    setPhoto({
      file: null,
      url: "/demo-shelf.svg",
      name: "Rayon de démonstration — produits fictifs",
      demo: true,
      objectUrl: false,
    });
    setStage("preview");
  }

  /** Le recalcul est local : les compositions déjà récupérées restent valables. */
  function applyCorrections(corrections: PriceCorrection[]) {
    if (corrections.length) {
      setResult((current) =>
        current ? applyPriceCorrections(current, corrections) : current,
      );
    }
    setStage("results");
  }

  function reset() {
    setPhoto(null);
    setResult(null);
    setError(null);
    setStage("capture");
  }

  async function analyze() {
    if (!photo) return;
    setError(null);
    setStage("analyzing");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 70_000);

    try {
      const formData = new FormData();
      if (photo.demo) {
        formData.set("demo", "true");
      } else if (photo.file) {
        const prepared = await prepareImageForAnalysis(photo.file);
        formData.set("image", prepared);
      }

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | AnalysisResult
        | { error?: { message?: string } }
        | null;

      if (!response.ok) {
        // Les messages d'erreur de la route sont rédigés pour être lus.
        const message =
          payload && "error" in payload ? payload.error?.message : null;
        throw new DisplayableError(
          message || "L’analyse est momentanément indisponible.",
        );
      }

      setResult(payload as AnalysisResult);
      setStage("results");
    } catch (analysisError) {
      setError(analysisErrorMessage(analysisError));
      setStage("error");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return (
    <>
      {stage === "capture" && (
        <CaptureScreen
          cameraInput={cameraInput}
          libraryInput={libraryInput}
          onDemo={loadDemo}
          error={error}
        />
      )}
      {stage === "preview" && photo && (
        <PreviewScreen photo={photo} onAnalyze={analyze} onReset={reset} />
      )}
      {stage === "analyzing" && photo && <LoadingScreen photo={photo} />}
      {stage === "results" && photo && result && (
        <ResultsScreen
          result={result}
          photo={photo}
          onReset={reset}
          onReview={() => setStage("review")}
        />
      )}
      {stage === "review" && photo && result && (
        <ReviewScreen
          result={result}
          photo={photo}
          onApply={applyCorrections}
          onCancel={() => setStage("results")}
        />
      )}
      {stage === "error" && photo && (
        <ErrorScreen
          message={error || "Une erreur inattendue est survenue."}
          onRetry={analyze}
          onDemo={loadDemo}
          onReset={reset}
        />
      )}

      <input
        ref={cameraInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={selectPhoto}
        aria-label="Prendre une photo du rayon"
      />
      <input
        ref={libraryInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={selectPhoto}
        aria-label="Importer une photo du rayon"
      />
    </>
  );
}
