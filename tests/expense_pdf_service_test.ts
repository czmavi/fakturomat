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
  items: [{
    description: "Hosting",
    quantity: "1",
    unit: "ks",
    unitPrice: "1000",
    vatRate: "21",
    totalAmount: "1210",
  }],
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
  for (
    const [field, invalid] of [["issueDate", "2026-02-30"], [
      "totalAmount",
      "invalid",
    ], ["supplierName", 123]] as const
  ) {
    const partial = parseInvoiceResult(
      { ...invoice, [field]: invalid },
      company,
    );
    assert(partial.values[field] === "", `${field} was not cleared`);
    assert(partial.warnings.length > 0, "Missing field warning");
    assert(partial.values.description === "Hosting", "Valid fields lost");
  }
  const vat = parseInvoiceResult({ ...invoice, vatLines: [{}] }, company);
  assert(vat.values.vatLines[0].vatRate === "", "Invalid VAT retained");
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

Deno.test("PDF fetch is called without the service receiver, as required by Workers", async () => {
  let called = false;
  const fetcher: typeof fetch = function (this: unknown, _url, _init) {
    assert(
      this === undefined,
      "Illegal invocation: fetch received service as this",
    );
    called = true;
    return Promise.resolve(Response.json({
      status: "completed",
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(invoice) }],
      }],
    }));
  };
  const result = await new ExpensePdfService(
    { apiKey: "test", model: "test" },
    fetcher,
  ).extract(file, company);
  assert(
    called && result.values.supplierName === invoice.supplierName,
    "Extraction did not complete",
  );
});

Deno.test("Only a real abort or timeout is reported as a timeout", async () => {
  for (const name of ["TimeoutError", "AbortError", "TypeError"]) {
    try {
      await new ExpensePdfService(
        { apiKey: "test", model: "test" },
        () => Promise.reject(new DOMException("synthetic", name)),
      ).extract(file, company);
      throw new Error("Expected error");
    } catch (error) {
      assert(error instanceof ExpensePdfError, "Unexpected error");
      assert(
        error.message.includes("neodpovědělo včas") === (name !== "TypeError"),
        "Wrong timeout classification",
      );
    }
  }
});

Deno.test("Recipient without identifiers can match the full official name", async () => {
  const companyByName = {
    ...company,
    officialName: "Example Development s.r.o.",
  };
  const buyer = { name: " EXAMPLE  Development s. r. o. ", ico: "", dic: "" };
  assert(
    verifyRecipient(buyer, companyByName) === "name",
    "Name fallback failed",
  );
  const result = parseInvoiceResult(
    { ...invoice, recipient: buyer },
    companyByName,
  );
  assert(
    result.recipientVerification === "name",
    "Verification method missing",
  );
  assert(result.recipient.ico === "", "Identifier was invented");
  for (
    const name of [
      "",
      "Example",
      "Example Development a.s.",
      "Other Development s.r.o.",
    ]
  ) {
    await rejects(() => verifyRecipient({ ...buyer, name }, companyByName));
  }
  await rejects(() =>
    verifyRecipient({ ...buyer, ico: "87654321" }, companyByName)
  );
  await rejects(() =>
    verifyRecipient({ ...buyer, dic: "CZ87654321" }, companyByName)
  );
  await rejects(() =>
    verifyRecipient(buyer, { ...companyByName, officialName: "" })
  );
  await rejects(() =>
    verifyRecipient({ ...buyer, ico: "12345678" }, {
      ...companyByName,
      ico: null,
      dic: null,
    })
  );
});

Deno.test("Signed name-only PDF proof is rechecked against current official name on save", async () => {
  const { withRuntime } = await import("@/config/runtime.ts");
  const { testRuntime } = await import("./d1_test_helper.ts");
  const env = testRuntime();
  try {
    await withRuntime(env, async () => {
      const buyer = { name: "Example Development s. r. o.", ico: "", dic: "" };
      const settings = {
        ...company,
        officialName: "Example Development s.r.o.",
      };
      const bytes = await readInvoicePdf(file);
      const token = await createPdfProof(bytes, "org", "user", buyer);
      await verifyPdfProof(token, bytes, "org", "user", settings);
      await rejects(() =>
        verifyPdfProof(token, bytes, "org", "user", {
          ...settings,
          officialName: "Other s.r.o.",
        })
      );
      await rejects(() =>
        verifyPdfProof(token, bytes, "other-org", "user", settings)
      );
    });
  } finally {
    env.DB.sqlite.close();
  }
});

Deno.test("PDF VAT percentage notation is normalized before validation and form display", () => {
  for (
    const vatRate of [
      "21",
      "21%",
      "21 %",
      "21\u00a0%",
      "21,00 %",
      "21.0000%",
      " 21 % ",
    ]
  ) {
    const result = parseInvoiceResult({
      ...invoice,
      totalAmount: "10018.80",
      vatLines: [{ vatRate, baseAmount: "8280.00", vatAmount: "1738.80" }],
    }, company);
    assert(
      result.values.vatLines[0].vatRate === "21",
      `Not normalized: ${vatRate}`,
    );
    assert(result.values.vatLines[0].baseAmount === "8280.00", "Base changed");
    assert(result.values.vatLines[0].vatAmount === "1738.80", "VAT changed");
    assert(result.values.totalAmount === "10018.80", "Total changed");
  }
  for (const [input, expected] of [["0 %", "0"], ["12,5 %", "12.5"]]) {
    const result = parseInvoiceResult({
      ...invoice,
      vatLines: [{ ...invoice.vatLines[0], vatRate: input }],
    }, company);
    assert(
      result.values.vatLines[0].vatRate === expected,
      "Numeric percentage was misinterpreted",
    );
  }
});

Deno.test("PDF VAT normalization clears malformed or missing rates without losing other values", () => {
  for (
    const vatRate of [
      "",
      "%",
      "21%%",
      "21 % DPH",
      "-21%",
      "21/12%",
      "21.12345%",
      "21 0%",
      "osvobozeno",
    ]
  ) {
    const result = parseInvoiceResult({
      ...invoice,
      vatLines: [{ ...invoice.vatLines[0], vatRate }],
    }, company);
    assert(
      result.values.vatLines[0].vatRate === "",
      "Invalid VAT rate retained",
    );
    assert(
      result.values.vatLines[0].baseAmount === "1000.00",
      "Valid VAT base lost",
    );
    assert(result.warnings.length > 0, "Missing warning");
  }
});

Deno.test("PDF import repairs an invalid IBAN only from a checksum-valid domestic account and warns", () => {
  const result = parseInvoiceResult({
    ...invoice,
    payment: {
      accountNumber: "2114736912/2700",
      iban: "CZ00 2700 0000 0021 1473 6912",
      variableSymbol: "20260803",
      constantSymbol: "",
      specificSymbol: "32825",
    },
  }, company);
  assert(
    result.values.details?.iban === "CZ4027000000002114736912",
    "Wrong derived IBAN",
  );
  assert(result.warnings.length === 1, "Missing warning");
  assert(result.values.details.specificSymbol === "32825", "Symbol changed");
});

Deno.test("PDF import leaves invalid or conflicting accounts empty and retains valid invoice fields", async () => {
  const { normalizeExpenseInput } = await import(
    "@/services/expense_service.ts"
  );
  for (
    const account of [
      { accountNumber: "", iban: "CZ0027000000002114736912" },
      { accountNumber: "124/2700", iban: "invalid" },
      { accountNumber: "2114736912/2700", iban: "CZ6508000000192000145399" },
    ]
  ) {
    const result = parseInvoiceResult({
      ...invoice,
      payment: {
        ...account,
        variableSymbol: "",
        constantSymbol: "",
        specificSymbol: "",
      },
    }, company);
    assert(
      result.values.details?.iban === "" &&
        result.values.details.accountNumber === "",
      "Ambiguous payment was not cleared",
    );
    assert(result.warnings.length === 1, "Missing review warning");
    assert(result.values.vatLines[0].vatRate === "21", "Invoice data lost");
    normalizeExpenseInput(result.values);
  }
});

Deno.test("Valid PDF payment needs no warning and a valid IBAN can recover a malformed local number", () => {
  for (const accountNumber of ["2114736912/2700", "124/2700"]) {
    const result = parseInvoiceResult({
      ...invoice,
      payment: {
        accountNumber,
        iban: "CZ40 2700 0000 0021 1473 6912",
        variableSymbol: "",
        constantSymbol: "",
        specificSymbol: "",
      },
    }, company);
    assert(
      result.values.details?.accountNumber === "2114736912/2700",
      "Wrong account",
    );
    assert(
      result.warnings.length === (accountNumber === "124/2700" ? 1 : 0),
      "Wrong warning state",
    );
  }
});

Deno.test("Invoice IBAN accepts ordinary and nonbreaking spaces, and reports original AI artifacts", async () => {
  const { prepareImportedPayment } = await import(
    "@/services/expense_payment_import.ts"
  );
  for (const separator of [" ", "\u00a0", "\u202f", "\n"]) {
    const iban = ["CZ40", "2700", "0000", "0021", "1473", "6912"].join(
      separator,
    );
    const result = prepareImportedPayment({
      accountNumber: "2114736912/2700",
      iban,
    });
    assert(
      result.iban === "CZ4027000000002114736912" &&
        result.warnings.length === 0,
      "Valid spaced IBAN rejected",
    );
  }
  const result = prepareImportedPayment({
    accountNumber: "2114736912/2700",
    iban: "CZ40\u200b27000000002114736912",
  });
  assert(
    result.warnings[0].includes("\\u200b"),
    "Invisible character missing from diagnosis",
  );
});

Deno.test("Invoice images are sent as high-detail image inputs, not PDF files", async () => {
  for (
    const [bytes, type] of [[
      new Uint8Array([255, 216, 255, 224]),
      "image/jpeg",
    ], [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ]] as const
  ) {
    const image = new File([bytes], "invoice", { type });
    let called = false;
    const service = new ExpensePdfService(
      { apiKey: "test", model: "test" },
      (_url, init) => {
        called = true;
        const content = JSON.parse(String(init?.body)).input[0].content[0];
        assert(
          content.type === "input_image" && content.detail === "high",
          "Wrong image payload",
        );
        assert(
          content.image_url === `data:${type};base64,${bytes.toBase64()}`,
          "Wrong image bytes",
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
      },
    );
    const result = await service.extract(image, company);
    assert(
      called && result.values.supplierName === invoice.supplierName,
      "Image extraction failed",
    );
  }
});

const lineItem = {
  description: "Hosting",
  quantity: "1",
  unit: "ks",
  unitPrice: "1000",
  vatRate: "21 %",
  totalAmount: "1210",
};

Deno.test("Currency aliases normalize before display and invalid fields do not discard items", () => {
  for (const currency of ["Kč", " Kč ", "kc", "czk"]) {
    const result = parseInvoiceResult({
      ...invoice,
      currency,
      items: [lineItem],
    }, company);
    assert(result.values.currency === "CZK", "Currency alias not normalized");
    assert(
      result.itemTotalCheck.status === "match",
      "Correct sum not confirmed",
    );
  }
  const result = parseInvoiceResult({
    ...invoice,
    currency: "???",
    dueDate: "yesterday",
    items: [{ ...lineItem, quantity: "unknown", vatRate: "broken" }],
    payment: { variableSymbol: "abc" },
  }, company);
  assert(
    result.values.currency === "" && result.values.dueDate === "",
    "Bad fields retained",
  );
  assert(
    result.values.details?.items[0].description === "Hosting",
    "Item discarded",
  );
  assert(
    result.values.details.items[0].quantity === "" &&
      result.values.details.items[0].vatRate === "",
    "Bad item fields retained",
  );
  assert(
    result.values.details.items[0].totalAmount === "1210.00",
    "Valid item total lost",
  );
  assert(
    result.values.details.variableSymbol === "",
    "Invalid symbol retained",
  );
  assert(result.warnings.length >= 5, "Not all failures reported");
});

Deno.test("Item reconciliation excludes explicit signed rounding and never tolerates unexplained discrepancies", () => {
  for (
    const [totalAmount, roundingAmount] of [["1210.00", ""], [
      "1210.49",
      "+0.49",
    ], ["1209.51", "-0,49"]]
  ) {
    const result = parseInvoiceResult({
      ...invoice,
      items: [lineItem],
      totalAmount,
      roundingAmount,
    }, company);
    assert(
      result.itemTotalCheck.status === "match",
      `Rounding failed: ${roundingAmount}`,
    );
  }
  for (const totalAmount of ["1210.01", "1211.00", "1500"]) {
    const result = parseInvoiceResult({
      ...invoice,
      items: [lineItem],
      totalAmount,
    }, company);
    assert(result.itemTotalCheck.status === "mismatch", "Discrepancy hidden");
    assert(
      result.itemTotalCheck.message.includes("Rozdíl"),
      "Difference missing",
    );
    assert(
      result.values.details?.items.length === 1,
      "Mismatch discarded item",
    );
  }
  const rounded = parseInvoiceResult({
    ...invoice,
    totalAmount: "1210.40",
    items: [lineItem, {
      ...lineItem,
      description: "Haléřové vyrovnání",
      totalAmount: "0.40",
    }],
  }, company);
  assert(
    rounded.values.details?.items.length === 1 &&
      rounded.itemTotalCheck.status === "match",
    "Rounding counted as an item",
  );
  const badRounding = parseInvoiceResult({
    ...invoice,
    items: [lineItem],
    roundingAmount: "100",
  }, company);
  assert(
    badRounding.itemTotalCheck.status === "unavailable",
    "Large discrepancy disguised as rounding",
  );
});

Deno.test("Incomplete photographed invoice retains its item and reports missing totals", () => {
  // The supplied photo is page 1/2 and prints a net price, not a grand total.
  const result = parseInvoiceResult({
    ...invoice,
    currency: "",
    totalAmount: "",
    vatLines: [],
    items: [{
      ...lineItem,
      description: "Záloha na vozidlo",
      unitPrice: "2 078 000,83",
      totalAmount: "",
    }],
  }, company);
  assert(
    result.values.currency === "" && result.values.totalAmount === "",
    "Missing totals invented",
  );
  assert(
    result.values.details?.items[0].unitPrice === "2078000.83",
    "Printed net price lost",
  );
  assert(
    result.values.details.items[0].totalAmount === "",
    "Gross line price invented",
  );
  assert(
    result.itemTotalCheck.status === "unavailable",
    "Incomplete invoice reported as reconciled",
  );
});

Deno.test("Item reconciliation uses exact minor units and detects missing or malformed lines", () => {
  const precise = parseInvoiceResult({
    ...invoice,
    totalAmount: "0.30",
    items: [{ ...lineItem, totalAmount: "0.1" }, {
      ...lineItem,
      totalAmount: "0.2",
    }],
  }, company);
  assert(
    precise.itemTotalCheck.status === "match",
    "Floating point comparison used",
  );
  for (
    const items of [[], null, [lineItem, null], [{
      ...lineItem,
      totalAmount: "broken",
    }]]
  ) {
    const result = parseInvoiceResult({ ...invoice, items }, company);
    assert(
      result.itemTotalCheck.status === "unavailable",
      "Incomplete item sum accepted",
    );
  }
});

Deno.test("Repeated rounding is excluded once and unknown ISO-like currency is not guessed", () => {
  const result = parseInvoiceResult({
    ...invoice,
    currency: "XYZ",
    totalAmount: "1210.50",
    roundingAmount: "+0,50",
    items: [lineItem, {
      ...lineItem,
      description: "Zaokrouhlení",
      totalAmount: "0.5",
    }],
  }, company);
  assert(result.values.currency === "", "Unknown currency accepted");
  assert(
    result.itemTotalCheck.status === "match",
    "Rounding counted twice or formatting mismatch",
  );
});
