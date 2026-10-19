import {
  isHeicHeader,
  MAX_INVOICE_FILE_SIZE,
  readInvoiceFile,
} from "@/domain/expenses/files.ts";

export async function prepareInvoiceFile(file: File): Promise<File> {
  if (!file.size || file.size > MAX_INVOICE_FILE_SIZE) {
    throw new Error("Vyberte soubor o velikosti nejvýše 20 MB.");
  }
  const header = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  if (isHeicHeader(header)) {
    try {
      const { heicTo } = await import("heic-to/csp");
      const blob = await heicTo({
        blob: file,
        type: "image/jpeg",
        quality: 0.95,
      });
      const converted = new File(
        [blob],
        file.name.replace(/\.(heic|heif)$/i, "").slice(0, 240) + ".jpg",
        { type: "image/jpeg", lastModified: file.lastModified },
      );
      await readInvoiceFile(converted);
      return converted;
    } catch {
      throw new Error(
        "HEIC/HEIF se nepodařilo převést na JPEG do 20 MB. Zkuste jinou fotografii nebo export do JPG.",
      );
    }
  }
  const { mimeType } = await readInvoiceFile(file);
  return file.type === mimeType ? file : new File([file], file.name, {
    type: mimeType,
    lastModified: file.lastModified,
  });
}

export function assignInvoiceFile(input: HTMLInputElement, file: File | null) {
  if (!file) {
    input.value = "";
    return;
  }
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
}
