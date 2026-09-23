import { describe, expect, it } from "vitest";

import {
  clientKey,
  RATE_LIMIT_DEFAULTS,
  readRateLimitConfig,
  SlidingWindowLimiter,
} from "../src/lib/rate-limit";

const WINDOW = 60_000;

describe("SlidingWindowLimiter", () => {
  it("laisse passer jusqu'à la limite", () => {
    const limiter = new SlidingWindowLimiter(3, WINDOW);

    expect(limiter.consume("a", 0)).toEqual({ allowed: true, remaining: 2 });
    expect(limiter.consume("a", 1)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume("a", 2)).toEqual({ allowed: true, remaining: 0 });
  });

  it("refuse la requête suivante et annonce l'attente", () => {
    const limiter = new SlidingWindowLimiter(2, WINDOW);
    limiter.consume("a", 0);
    limiter.consume("a", 1_000);

    expect(limiter.consume("a", 2_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 58,
    });
  });

  it("ne consomme rien quand elle refuse", () => {
    const limiter = new SlidingWindowLimiter(1, WINDOW);
    limiter.consume("a", 0);

    // Une rafale de refus ne doit pas repousser la réouverture.
    for (let at = 1_000; at <= 10_000; at += 1_000) limiter.consume("a", at);

    expect(limiter.consume("a", WINDOW + 1)).toEqual({
      allowed: true,
      remaining: 0,
    });
  });

  it("rouvre au fil du glissement de la fenêtre", () => {
    const limiter = new SlidingWindowLimiter(2, WINDOW);
    limiter.consume("a", 0);
    limiter.consume("a", 30_000);

    expect(limiter.consume("a", 45_000).allowed).toBe(false);
    // La première requête sort de la fenêtre, une place se libère.
    expect(limiter.consume("a", 60_001)).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.consume("a", 60_002).allowed).toBe(false);
  });

  it("garde les compteurs des clés indépendants", () => {
    const limiter = new SlidingWindowLimiter(1, WINDOW);
    limiter.consume("a", 0);

    expect(limiter.consume("b", 0).allowed).toBe(true);
    expect(limiter.consume("a", 0).allowed).toBe(false);
  });

  it("rend un jeton sur remboursement", () => {
    const limiter = new SlidingWindowLimiter(1, WINDOW);
    limiter.consume("a", 0);
    expect(limiter.consume("a", 1).allowed).toBe(false);

    limiter.refund("a");
    expect(limiter.consume("a", 2).allowed).toBe(true);
  });

  it("ignore un remboursement sans jeton", () => {
    const limiter = new SlidingWindowLimiter(1, WINDOW);
    limiter.refund("jamais-vue");

    expect(limiter.trackedKeys).toBe(0);
    expect(limiter.consume("jamais-vue", 0).allowed).toBe(true);
  });

  it("borne sa mémoire quand les clés se multiplient", () => {
    const limiter = new SlidingWindowLimiter(5, WINDOW, 10);
    for (let index = 0; index < 500; index += 1) {
      limiter.consume(`client-${index}`, index);
    }

    expect(limiter.trackedKeys).toBeLessThanOrEqual(10);
  });

  it("n'évince pas un client refusé, qui repartirait avec un compteur neuf", () => {
    const limiter = new SlidingWindowLimiter(1, WINDOW, 3);
    limiter.consume("abusif", 0);
    expect(limiter.consume("abusif", 1).allowed).toBe(false);

    // D'autres clés arrivent et débordent la capacité ; « abusif » insiste.
    for (let index = 0; index < 20; index += 1) {
      limiter.consume(`autre-${index}`, 2 + index);
      limiter.consume("abusif", 2 + index);
    }

    expect(limiter.consume("abusif", 100).allowed).toBe(false);
  });

  it("oublie une clé dont toutes les requêtes ont expiré", () => {
    const limiter = new SlidingWindowLimiter(2, WINDOW);
    limiter.consume("a", 0);
    expect(limiter.trackedKeys).toBe(1);

    // Le balayage n'a lieu qu'une fois par fenêtre écoulée.
    limiter.consume("b", WINDOW + 1);
    expect(limiter.trackedKeys).toBe(1);
  });
});

describe("readRateLimitConfig", () => {
  it("applique les valeurs par défaut sans configuration", () => {
    expect(readRateLimitConfig({})).toEqual({
      maxRequests: RATE_LIMIT_DEFAULTS.maxRequests,
      windowMs: RATE_LIMIT_DEFAULTS.windowSeconds * 1_000,
      dailyBudget: RATE_LIMIT_DEFAULTS.dailyBudget,
    });
  });

  it("lit la configuration de l'environnement", () => {
    expect(
      readRateLimitConfig({
        RATE_LIMIT_MAX: "3",
        RATE_LIMIT_WINDOW_SECONDS: "60",
        DAILY_ANALYSIS_BUDGET: "25",
      }),
    ).toEqual({ maxRequests: 3, windowMs: 60_000, dailyBudget: 25 });
  });

  it("retombe sur les valeurs par défaut devant une saisie inexploitable", () => {
    const config = readRateLimitConfig({
      RATE_LIMIT_MAX: "0",
      RATE_LIMIT_WINDOW_SECONDS: "beaucoup",
      DAILY_ANALYSIS_BUDGET: "-5",
    });

    expect(config.maxRequests).toBe(RATE_LIMIT_DEFAULTS.maxRequests);
    expect(config.windowMs).toBe(RATE_LIMIT_DEFAULTS.windowSeconds * 1_000);
    expect(config.dailyBudget).toBe(RATE_LIMIT_DEFAULTS.dailyBudget);
  });
});

describe("clientKey", () => {
  function withHeaders(headers: Record<string, string>) {
    return clientKey(new Request("https://exemple.fr/api/analyze", { headers }));
  }

  it("retient la première adresse de x-forwarded-for", () => {
    expect(
      withHeaders({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" }),
    ).toBe("203.0.113.7");
  });

  it("se rabat sur x-real-ip", () => {
    expect(withHeaders({ "x-real-ip": "203.0.113.9" })).toBe("203.0.113.9");
  });

  it("regroupe les requêtes sans en-tête sous une clé partagée", () => {
    expect(withHeaders({})).toBe("unknown");
    expect(withHeaders({ "x-forwarded-for": "  " })).toBe("unknown");
  });
});
