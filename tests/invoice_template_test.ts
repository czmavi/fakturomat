import { createPreviewInvoiceViewModel } from "@/services/invoice_template_preview.ts";
import {
  escapeHtml,
  renderInvoiceTemplate,
} from "@/services/invoice_template_renderer.ts";
import {
  InvoiceTemplateValidationError,
  validateInvoiceTemplate,
} from "@/services/invoice_template_service.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("template renderer escapes scalar and item values", () => {
  const viewModel = createPreviewInvoiceViewModel();
  viewModel.supplier.name = '<img src=x onerror="alert(1)">';
  viewModel.invoice.items[0].description = "<script>alert(1)</script>";
  const output = renderInvoiceTemplate(
    "<h1>{{ supplier.name }}</h1><table>{{invoice.items}}</table>{{payment.qr}}",
    "body { color: black; }",
    viewModel,
  );
  assert(!output.includes("<img src=x"), "scalar HTML was not escaped");
  assert(!output.includes("<script>"), "item HTML was not escaped");
  assert(
    output.includes(escapeHtml(viewModel.supplier.name)),
    "escaped scalar is missing",
  );
  assert(output.includes("<svg"), "trusted QR SVG was not rendered");
});

Deno.test("template renderer drops unsafe QR SVG", () => {
  const viewModel = createPreviewInvoiceViewModel();
  viewModel.payment.qrSvg = '<svg onload="alert(1)"></svg>';
  const output = renderInvoiceTemplate("{{payment.qr}}", "", viewModel);
  assert(!output.includes("onload"), "unsafe QR SVG was rendered");
});

Deno.test("template validation rejects JavaScript and unknown placeholders", () => {
  const invalidHtml = [
    '<script src="/evil.js"></script>',
    '<img src="x" onerror="alert(1)">',
    "<p>{{customer.secret}}</p>",
    '<img src="https://tracking.example/pixel.png">',
  ];
  for (const html of invalidHtml) {
    let rejected = false;
    try {
      validateInvoiceTemplate({
        name: "Invalid",
        description: "",
        html,
        css: "",
      });
    } catch (error) {
      rejected = error instanceof InvoiceTemplateValidationError;
    }
    assert(rejected, `unsafe template was accepted: ${html}`);
  }
});

Deno.test("template validation rejects CSS network access", () => {
  let rejected = false;
  try {
    validateInvoiceTemplate({
      name: "Invalid CSS",
      description: "",
      html: "<p>{{invoice.number}}</p>",
      css: "body { background: url(https://tracking.example/pixel); }",
    });
  } catch (error) {
    rejected = error instanceof InvoiceTemplateValidationError;
  }
  assert(rejected, "CSS url() was accepted");
});
