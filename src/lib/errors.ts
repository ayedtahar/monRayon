export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    /** En-têtes joints à la réponse, par exemple `Retry-After`. */
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Erreur dont le message est rédigé pour être montré tel quel à la personne.
 *
 * Tout le reste — bogue de programmation, panne inattendue — doit rester
 * derrière un message générique : l'interface n'a aucune raison d'exposer sa
 * mécanique interne, et un message technique n'aide personne devant un rayon.
 */
export class DisplayableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisplayableError";
  }
}
