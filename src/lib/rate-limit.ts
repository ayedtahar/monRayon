export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Fenêtre glissante en mémoire : chaque clé retient l'horodatage de ses
 * requêtes récentes.
 *
 * Volontairement sans dépendance externe, conformément au parti pris du
 * projet (ni base de données, ni service tiers). La contrepartie est assumée :
 * l'état vit dans le processus. Sur plusieurs instances, chacune applique la
 * limite de son côté ; un redémarrage repart de zéro.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    /** Borne la mémoire : le limiteur ne doit pas devenir lui-même une cible. */
    private readonly maxKeys = 10_000,
  ) {}

  private within(key: string, now: number) {
    const threshold = now - this.windowMs;
    return (this.hits.get(key) ?? []).filter((at) => at > threshold);
  }

  /** Purge les clés expirées, au plus une fois par fenêtre. */
  private sweep(now: number) {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    const threshold = now - this.windowMs;
    for (const [key, times] of this.hits) {
      const kept = times.filter((at) => at > threshold);
      if (kept.length) this.hits.set(key, kept);
      else this.hits.delete(key);
    }
  }

  /**
   * `delete` puis `set` aligne l'ordre d'insertion de la Map sur l'ordre
   * d'usage : l'éviction retire alors les clés les moins récentes. Une requête
   * refusée rafraîchit aussi sa clé, sinon évincer un client abusif lui
   * rendrait un compteur neuf.
   */
  private touch(key: string, times: number[]) {
    this.hits.delete(key);
    this.hits.set(key, times);
  }

  private evict() {
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done) return;
      this.hits.delete(oldest.value);
    }
  }

  /** Enregistre la requête si elle passe, et ne consomme rien sinon. */
  consume(key: string, now = Date.now()): RateLimitDecision {
    this.sweep(now);
    const times = this.within(key, now);

    if (times.length >= this.limit) {
      this.touch(key, times);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((times[0] + this.windowMs - now) / 1_000),
        ),
      };
    }

    times.push(now);
    this.touch(key, times);
    this.evict();
    return { allowed: true, remaining: this.limit - times.length };
  }

  /** Rend le jeton le plus récent quand la requête n'a finalement rien coûté. */
  refund(key: string) {
    const times = this.hits.get(key);
    if (!times?.length) return;
    times.pop();
    if (times.length) this.hits.set(key, times);
    else this.hits.delete(key);
  }

  /** Pour l'observabilité et les tests. */
  get trackedKeys() {
    return this.hits.size;
  }
}

export const RATE_LIMIT_DEFAULTS = {
  /** Une personne dans un rayon enchaîne rarement plus de quelques photos. */
  maxRequests: 10,
  windowSeconds: 300,
  /** Plafond de coût : au-delà, le déploiement cesse d'appeler l'API vision. */
  dailyBudget: 200,
} as const;

function readPositiveInt(raw: string | undefined, fallback: number) {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

type EnvSource = Record<string, string | undefined>;

export function readRateLimitConfig(env: EnvSource = process.env) {
  return {
    maxRequests: readPositiveInt(env.RATE_LIMIT_MAX, RATE_LIMIT_DEFAULTS.maxRequests),
    windowMs:
      readPositiveInt(env.RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_DEFAULTS.windowSeconds) *
      1_000,
    dailyBudget: readPositiveInt(
      env.DAILY_ANALYSIS_BUDGET,
      RATE_LIMIT_DEFAULTS.dailyBudget,
    ),
  };
}

const DAY_MS = 24 * 60 * 60 * 1_000;

let limiters: { requests: SlidingWindowLimiter; budget: SlidingWindowLimiter } | null =
  null;

export function getLimiters() {
  if (!limiters) {
    const config = readRateLimitConfig();
    limiters = {
      requests: new SlidingWindowLimiter(config.maxRequests, config.windowMs),
      // Un seul compteur global : le budget est celui du déploiement.
      budget: new SlidingWindowLimiter(config.dailyBudget, DAY_MS, 1),
    };
  }
  return limiters;
}

export const BUDGET_KEY = "deployment";

/**
 * Derrière un proxy de confiance (Vercel, Nginx), `x-forwarded-for` identifie
 * le client. En direct, l'en-tête est falsifiable et absent en local : tout le
 * monde partage alors le même compartiment. Le plafond de budget reste le vrai
 * garde-fou sur le coût.
 */
export function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}
