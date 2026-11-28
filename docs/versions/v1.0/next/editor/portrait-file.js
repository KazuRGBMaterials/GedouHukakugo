import { FIELD_PORTRAIT_MAX_LENGTH } from "../assets/field-objects.js?v=095";

const allowedTypes = ["image/png", "image/jpeg", "image/webp"];

export async function readPortraitFile(file) {
  if (!allowedTypes.includes(file.type)) throw new Error("PNG、JPEG、WebP画像を選んでください");
  if (file.size > 10_000_000) throw new Error("10MB以下の画像を選んでください");

  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width * height > 28_000_000) {
      throw new Error("画像の縦横サイズを小さくしてください");
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("このブラウザでは画像を変換できません");

    for (const limit of [192, 128, 96]) {
      const scale = Math.min(1, limit / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      // Canvas re-encodes pixels so the selected file's original metadata is not copied.
      const png = canvas.toDataURL("image/png");
      if (png.length <= FIELD_PORTRAIT_MAX_LENGTH) return png;
      const webp = canvas.toDataURL("image/webp", .86);
      if (webp.length <= FIELD_PORTRAIT_MAX_LENGTH) return webp;
    }
    throw new Error("画像を読み込めるサイズに変換できませんでした");
  } finally {
    URL.revokeObjectURL(url);
  }
}
