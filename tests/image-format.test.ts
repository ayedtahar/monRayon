import { describe, expect, it } from "vitest";

import { detectImageFormat } from "../src/lib/image-format";

function bytes(...values: number[]) {
  return new Uint8Array(values);
}

function ascii(text: string) {
  return Array.from(text, (char) => char.charCodeAt(0));
}

describe("detectImageFormat", () => {
  it("reconnaît un JPEG", () => {
    expect(detectImageFormat(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe("image/jpeg");
  });

  it("reconnaît un PNG", () => {
    expect(
      detectImageFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)),
    ).toBe("image/png");
  });

  it("reconnaît un WebP, dont la marque suit la taille du conteneur", () => {
    expect(
      detectImageFormat(
        bytes(...ascii("RIFF"), 0x24, 0x00, 0x00, 0x00, ...ascii("WEBP"), 0x56),
      ),
    ).toBe("image/webp");
  });

  it("refuse un RIFF qui n'est pas du WebP", () => {
    expect(
      detectImageFormat(
        bytes(...ascii("RIFF"), 0x24, 0x00, 0x00, 0x00, ...ascii("WAVE")),
      ),
    ).toBeNull();
  });

  it("refuse un format non pris en charge", () => {
    expect(detectImageFormat(bytes(...ascii("GIF89a")))).toBeNull();
    expect(detectImageFormat(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull();
  });

  it("refuse un fichier trop court pour porter une signature", () => {
    expect(detectImageFormat(bytes())).toBeNull();
    expect(detectImageFormat(bytes(0xff, 0xd8))).toBeNull();
    expect(detectImageFormat(bytes(...ascii("RIFF"), 0x24))).toBeNull();
  });

  it("ne se fie pas à l'extension ou au type annoncé", () => {
    // Un exécutable renommé en .jpg reste un exécutable.
    expect(detectImageFormat(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
  });
});
