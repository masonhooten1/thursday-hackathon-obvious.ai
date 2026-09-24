/**
 * Image constraints mirroring the identify API contract (POST /api/identify):
 * 415 for undecodable files, 413 for anything larger than 10 MB. The UI
 * pre-validates with these constants so obvious errors surface before a round
 * trip; the API remains the authority.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export interface ImageProblem {
  heading: string;
  detail: string;
}

export function describeImageProblem(file: File): ImageProblem | null {
  if (!isImageFile(file)) {
    return {
      heading: "That file isn't an image",
      detail: "Choose a photo of the plant — JPEG, PNG, or WebP all work.",
    };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      heading: "Photo too large",
      detail: "Photos must be under 10 MB. Choose a smaller image and try again.",
    };
  }
  return null;
}
