import {
  InvoiceTemplateValidationError,
  validateInvoiceTemplate,
} from "@/services/invoice_template_service.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("template validation rejects JavaScript and unknown placeholders", () => {
  const invalidHtml = [
    '<script src="/evil.js"></script>',
    '<img src="x" onerror="alert(1)">',
    "<p>{{customer.secret}}</p>",
    '<img src="https://tracking.example/pixel.png">',
    '<img src="/etc/passwd">',
    '<img srcset="file:///tmp/secret.png">',
    "<svg><foreignObject>unsafe namespace</foreignObject></svg>",
    '<p style="background:red">inline style</p>',
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
  for (
    const css of [
      "body { background: url(https://tracking.example/pixel); }",
      "body { background: u\\72l(https://tracking.example/pixel); }",
      'body { background: image-set("https://tracking.example/pixel" 1x); }',
      "@font-face { src: local(system-ui); }",
    ]
  ) {
    let rejected = false;
    try {
      validateInvoiceTemplate({
        name: "Invalid CSS",
        description: "",
        html: "<p>{{invoice.number}}</p>",
        css,
      });
    } catch (error) {
      rejected = error instanceof InvoiceTemplateValidationError;
    }
    assert(rejected, `unsafe CSS was accepted: ${css}`);
  }
  const valid = validateInvoiceTemplate({
    name: "Print CSS",
    description: "",
    html: "<main><p>{{invoice.number}}</p></main>",
    css: "@page { size: A4; margin: 15mm; } body { color: #18211c; }",
  });
  assert(valid.css.startsWith("@page"), "safe print CSS was rejected");
});
