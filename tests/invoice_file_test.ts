import {
  invoiceFileType,
  isHeicHeader,
  readInvoiceFile,
} from "@/domain/expenses/files.ts";
import { assert, rejects } from "./d1_test_helper.ts";

Deno.test("Invoice uploads identify file contents and reject spoofed or unsupported formats", async () => {
  for (
    const [bytes, type, extension] of [
      [new TextEncoder().encode("%PDF-1.7"), "application/pdf", "pdf"],
      [new Uint8Array([255, 216, 255, 224]), "image/jpeg", "jpg"],
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png", "png"],
    ] as const
  ) {
    const result = await readInvoiceFile(
      new File([bytes], `invoice.${extension}`, { type }),
    );
    assert(result.mimeType === type && result.extension === extension);
    assert(
      (await readInvoiceFile(new File([bytes], "invoice", { type: "" })))
        .mimeType === type,
    );
    await rejects(() =>
      readInvoiceFile(
        new File([bytes], "fake", {
          type: type === "image/png" ? "image/jpeg" : "image/png",
        }),
      )
    );
  }
  assert(invoiceFileType(new TextEncoder().encode("<svg>")) === null);
  await rejects(() =>
    readInvoiceFile(new File([], "empty.png", { type: "image/png" }))
  );
  await rejects(() =>
    readInvoiceFile(new File(["fake"], "photo.heic", { type: "image/heic" }))
  );
});

Deno.test("HEIC is identified from its ISO container, including an empty browser MIME type", () => {
  const bytes = new Uint8Array(24);
  new DataView(bytes.buffer).setUint32(0, 24);
  bytes.set(new TextEncoder().encode("ftypheic"), 4);
  assert(isHeicHeader(bytes));
  bytes.set(new TextEncoder().encode("mif1"), 8);
  assert(isHeicHeader(bytes));
  bytes.set(new TextEncoder().encode("avif"), 8);
  assert(!isHeicHeader(bytes));
  assert(!isHeicHeader(bytes.slice(0, 8)));
});
