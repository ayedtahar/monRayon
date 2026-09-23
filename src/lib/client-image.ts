import { DisplayableError } from "./errors";

const MAX_DIMENSION = 2_000;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    // Un navigateur qui ne sait pas décoder le format — AVIF ou HEIC selon
    // les versions — échoue ici. Le message doit dire quoi faire.
    image.onerror = () =>
      reject(
        new DisplayableError(
          "Ce format d’image n’a pas pu être ouvert. Prenez la photo avec l’appareil, ou enregistrez-la en JPEG.",
        ),
      );
    image.src = url;
  });
}

export async function prepareImageForAnalysis(file: File) {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new DisplayableError("La photo dépasse 20 Mo.");
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new DisplayableError("Impossible de préparer la photo.");
    }
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86),
    );
    if (!blob) throw new DisplayableError("Impossible de convertir la photo.");
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "rayon"}.jpg`, {
      type: "image/jpeg",
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

