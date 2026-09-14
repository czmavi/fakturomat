import { PDFDocument } from "pdf-lib";
import type { InvoiceTemplateVersion } from "@/domain/invoices/template_types.ts";
import { createPreviewInvoiceViewModel } from "@/services/invoice_template_preview.ts";
import { PdfLibRenderer } from "@/services/pdf/pdf_lib_renderer.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function template(css = ""): InvoiceTemplateVersion {
  return {
    id: crypto.randomUUID(),
    invoiceTemplateId: crypto.randomUUID(),
    version: 1,
    html: "<script>This HTML must never be rendered</script>",
    css,
    createdBy: null,
    createdAt: new Date("2026-09-14T00:00:00Z"),
  };
}

Deno.test("pdf-lib renderer creates a readable A4 invoice with metadata", async () => {
  const version = template(
    ":root { --pdf-primary: #183e2a; --pdf-accent: #277a4c; }",
  );
  Object.defineProperty(version, "html", {
    get() {
      throw new Error("PDF renderer must not interpret template HTML");
    },
  });
  const bytes = await new PdfLibRenderer().render(
    await createPreviewInvoiceViewModel(),
    version,
  );

  assert(
    new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-",
    "renderer did not create a PDF",
  );
  const document = await PDFDocument.load(bytes);
  assert(document.getPageCount() === 1, "preview invoice is not one page");
  assert(document.getTitle() === "Faktura 2026-0001", "PDF title is missing");
  assert(
    document.getAuthor() === "Studio Sever s.r.o.",
    "PDF author is missing",
  );
  assert(
    document.getPage(0).getSize().width === 595.28,
    "PDF does not use A4 width",
  );
});

Deno.test("pdf-lib renderer paginates long invoices", async () => {
  const model = await createPreviewInvoiceViewModel();
  model.invoice.items = Array.from({ length: 80 }, (_, index) => ({
    description: `Položka ${index + 1} s delším českým popisem účtované služby`,
    quantity: "1",
    unit: "ks",
    unitPrice: "1 000,00",
    total: "1 000,00",
  }));

  const bytes = await new PdfLibRenderer().render(model, template());
  const document = await PDFDocument.load(bytes);
  assert(document.getPageCount() >= 4, "long invoice was not paginated");
});
