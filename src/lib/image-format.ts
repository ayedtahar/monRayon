/**
 * Formats réellement acceptés par l'analyse. Le client reencode toute photo en
 * JPEG ; PNG et WebP couvrent un envoi direct.
 *
 * Cette liste suit ce que l'API vision sait lire, et rien d'autre. Un format
 * que le téléphone produit couramment mais qu'elle ignore — AVIF, HEIC —
 * n'a donc pas sa place ici : l'ajouter ferait échouer l'appel plus loin,
 * après avoir consommé le budget. Ces photos passent par la conversion en
 * JPEG du navigateur, dans `client-image.ts`.
 */
export const SUPPORTED_IMAGE_FORMATS = ["image/jpeg", "image/png", "image/webp"] as const;

export type SupportedImageFormat = (typeof SUPPORTED_IMAGE_FORMATS)[number];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP", après la taille du conteneur

/**
 * Le type déclaré par le navigateur vient du client et ne prouve rien. On lit
 * la signature du fichier pour savoir ce qu'on s'apprête réellement à envoyer
 * à une API facturée.
 */
export function detectImageFormat(bytes: Uint8Array): SupportedImageFormat | null {
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "image/webp";
  return null;
}
