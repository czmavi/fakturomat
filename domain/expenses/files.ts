import type { ExpenseAttachmentMimeType } from "./attachment.ts";

export const MAX_INVOICE_FILE_SIZE = 20 * 1024 * 1024;
export const INVOICE_FILE_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif";

export function invoiceFileType(
  bytes: Uint8Array,
): ExpenseAttachmentMimeType | null {
  if (
    bytes.length >= 5 &&
    new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-"
  ) return "application/pdf";
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
  ) return "image/png";
  if (
    bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 &&
    bytes[2] === 255
  ) return "image/jpeg";
  return null;
}
export function isHeicHeader(bytes: Uint8Array): boolean {
  if (
    bytes.length < 16 ||
    new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp"
  ) return false;
  const brands = new Set([
    "heic",
    "heix",
    "hevc",
    "hevx",
    "heim",
    "heis",
    "hevm",
    "hevs",
    "mif1",
    "msf1",
  ]);
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(0);
  for (
    let offset = 8;
    offset + 4 <= Math.min(size, bytes.length);
    offset += 4
  ) {
    if (
      offset !== 12 &&
      brands.has(new TextDecoder().decode(bytes.subarray(offset, offset + 4)))
    ) return true;
  }
  return false;
}
export function invoiceExtension(type: ExpenseAttachmentMimeType): string {
  return type === "application/pdf"
    ? "pdf"
    : type === "image/png"
    ? "png"
    : "jpg";
}

export async function readInvoiceFile(file: File) {
  if (!file.size || file.size > MAX_INVOICE_FILE_SIZE) {
    throw new Error("Doklad musí být neprázdný soubor do 20 MB.");
  }
  if (!file.name || file.name.length > 255) {
    throw new Error("Název souboru musí mít 1 až 255 znaků.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = invoiceFileType(bytes);
  if (
    !mimeType ||
    (file.type && file.type !== "application/octet-stream" &&
      file.type !== mimeType)
  ) {
    throw new Error(
      "Vyberte platné PDF, JPG nebo PNG. HEIC/HEIF se musí nejprve převést na JPEG v prohlížeči.",
    );
  }
  return { bytes, mimeType, extension: invoiceExtension(mimeType) };
}
