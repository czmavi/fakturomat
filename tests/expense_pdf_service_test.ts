import {
  ExpensePdfError,
  ExpensePdfService,
  parseInvoiceResult,
  readInvoicePdf,
  verifyRecipient,
} from "@/services/expense_pdf_service.ts";
import {
  createPdfProof,
  verifyPdfProof,
} from "@/services/expense_pdf_proof.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error("Expected rejection");
}
const company = { ico: "12345678", dic: "CZ12345678" };
const recipient = { name: "Odběratel s.r.o.", ...company };
const invoice = {
  isInvoice: true,
  recipient,
  supplierName: "Dodavatel s.r.o.",
  supplierInvoiceNumber: "2026-100",
  issueDate: "2026-10-12",
  taxableSupplyDate: "2026-10-12",
  dueDate: "2026-10-26",
  description: "Hosting",
  currency: "CZK",
  totalAmount: "1210.00",
  vatLines: [{ vatRate: "21", baseAmount: "1000.00", vatAmount: "210.00" }],
};
const file = new File(["%PDF-1.7\ntest"], "invoice.pdf", {
  type: "application/pdf",
});

Deno.test("PDF recipient requires a shared identifier and rejects conflicting identifiers", async () => {
  verifyRecipient(
    { ...recipient, ico: "1234 5678", dic: "cz12345678" },
    company,
  );
  verifyRecipient({ ...recipient, ico: "" }, company);
  await rejects(() =>
    verifyRecipient({ ...recipient, ico: "87654321" }, company)
  );
  await rejects(() =>
    verifyRecipient({ ...recipient, dic: "CZ87654321" }, company)
  );
  await rejects(() =>
    verifyRecipient({ name: recipient.name, ico: "", dic: "" }, company)
  );
  await rejects(() => verifyRecipient(recipient, { ico: null, dic: null }));
});

Deno.test("PDF extraction maps validated fields without inferring payment or contact", async () => {
  const result = parseInvoiceResult(invoice, company);
  assert(
    result.values.supplierName === invoice.supplierName,
    "Supplier was lost",
  );
  assert(result.values.totalAmount === "1210.00", "Total changed");
  assert(
    result.values.paymentDate === "" && result.values.contactId === "",
    "Invented payment or contact",
  );
  assert(result.values.vatLines.length === 1, "VAT lines lost");
  await rejects(() =>
    parseInvoiceResult({ ...invoice, isInvoice: false }, company)
  );
  await rejects(() =>
    parseInvoiceResult({ ...invoice, issueDate: "2026-02-30" }, company)
  );
  await rejects(() =>
    parseInvoiceResult({ ...invoice, totalAmount: "invalid" }, company)
  );
  await rejects(() =>
    parseInvoiceResult({ ...invoice, supplierName: 123 }, company)
  );
  await rejects(() =>
    parseInvoiceResult({ ...invoice, vatLines: [{}] }, company)
  );
});

Deno.test("PDF validates type, size and signature before API call", async () => {
  await readInvoicePdf(file);
  for (
    const invalid of [
      new File([], "empty.pdf"),
      new File(["hello"], "spoof.pdf", { type: "application/pdf" }),
      new File(["%PDF-"], "fake.png", { type: "image/png" }),
      new File([new Uint8Array(20 * 1024 * 1024 + 1)], "big.pdf"),
    ]
  ) {
    await rejects(() => readInvoicePdf(invalid));
  }
});

Deno.test("OpenAI receives PDF with strict schema and server credentials", async () => {
  const fetcher: typeof fetch = (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert(body.store === false, "Response storage enabled");
    assert(body.text.format.strict === true, "Schema is not strict");
    assert(
      body.input[0].content[0].file_data.startsWith(
        "data:application/pdf;base64,",
      ),
      "PDF absent",
    );
    assert(
      !JSON.stringify(body).includes("12345678"),
      "Expected company identity leaked into extraction prompt",
    );
    assert(
      new Headers(init?.headers).get("Authorization") === "Bearer test-key",
      "Authentication missing",
    );
    return Promise.resolve(
      Response.json({
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(invoice) }],
        }],
      }),
    );
  };
  const result = await new ExpensePdfService({
    apiKey: "test-key",
    model: "test-model",
  }, fetcher).extract(file, company);
  assert(result.values.currency === "CZK", "Extraction failed");
});

Deno.test("OpenAI refusal, incomplete result, invalid JSON, rate limit and network failure are safe errors", async () => {
  for (
    const response of [
      Response.json({ error: "secret upstream content" }, { status: 429 }),
      Response.json({ status: "incomplete" }),
      Response.json({
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "refusal", refusal: "no" }],
        }],
      }),
      new Response("invalid"),
    ]
  ) {
    try {
      await new ExpensePdfService(
        { apiKey: "test", model: "test" },
        () => Promise.resolve(response),
      ).extract(file, company);
      throw new Error("Expected failure");
    } catch (error) {
      assert(error instanceof ExpensePdfError, "Not a safe error");
      assert(
        !error.message.includes("secret upstream"),
        "Upstream content exposed",
      );
    }
  }
  await rejects(() =>
    new ExpensePdfService(
      { apiKey: "test", model: "test" },
      () => Promise.reject(new Error("network")),
    ).extract(file, company)
  );
  await rejects(() =>
    new ExpensePdfService({ apiKey: "", model: "test" }).extract(file, company)
  );
});

Deno.test("Signed PDF verification binds bytes, user, organization and current company identifiers", async () => {
  const previous = Deno.env.get("APP_ENV");
  Deno.env.set("APP_ENV", "test");
  try {
    const bytes = await readInvoicePdf(file);
    const token = await createPdfProof(bytes, "org-a", "user-a", recipient);
    await verifyPdfProof(token, bytes, "org-a", "user-a", company);
    await rejects(() =>
      verifyPdfProof(token, bytes, "org-b", "user-a", company)
    );
    await rejects(() =>
      verifyPdfProof(token, bytes, "org-a", "user-b", company)
    );
    await rejects(() =>
      verifyPdfProof(token, new Uint8Array([1]), "org-a", "user-a", company)
    );
    await rejects(() =>
      verifyPdfProof(token, bytes, "org-a", "user-a", {
        ...company,
        ico: "87654321",
      })
    );
    await rejects(() =>
      verifyPdfProof(`x${token}`, bytes, "org-a", "user-a", company)
    );
    await rejects(() => verifyPdfProof("", bytes, "org-a", "user-a", company));
    const originalNow = Date.now;
    try {
      Date.now = () => originalNow() + 61 * 60 * 1000;
      await rejects(() =>
        verifyPdfProof(token, bytes, "org-a", "user-a", company)
      );
    } finally {
      Date.now = originalNow;
    }
  } finally {
    if (previous === undefined) Deno.env.delete("APP_ENV");
    else Deno.env.set("APP_ENV", previous);
  }
});
