import {
  type InvoiceTemplate,
  type InvoiceTemplateInput,
  type InvoiceTemplateVersion,
  TEMPLATE_PLACEHOLDERS,
} from "@/domain/invoices/template_types.ts";
import type { InvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";

export class InvoiceTemplateValidationError extends Error {}

const ALLOWED_HTML_ELEMENTS = new Set([
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "col",
  "colgroup",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
]);

export function validateInvoiceTemplate(input: InvoiceTemplateInput): {
  name: string;
  description: string | null;
  html: string;
  css: string;
} {
  const name = input.name.trim();
  const description = input.description.trim() || null;
  const html = input.html.trim();
  const css = input.css.trim();

  if (name.length < 2 || name.length > 120) {
    throw new InvoiceTemplateValidationError("Název musí mít 2 až 120 znaků.");
  }
  if (description && description.length > 500) {
    throw new InvoiceTemplateValidationError(
      "Popis může mít nejvýše 500 znaků.",
    );
  }
  if (html.length === 0 || html.length > 100_000 || css.length > 100_000) {
    throw new InvoiceTemplateValidationError(
      "HTML nebo CSS šablony má neplatnou délku.",
    );
  }
  for (const match of html.matchAll(/<\s*\/?\s*([a-z][a-z0-9-]*)\b/gi)) {
    if (!ALLOWED_HTML_ELEMENTS.has(match[1].toLocaleLowerCase("en-US"))) {
      throw new InvoiceTemplateValidationError(
        "HTML obsahuje nepovolený element.",
      );
    }
  }
  if (/\son[a-z]+\s*=/i.test(html) || /javascript\s*:/i.test(html)) {
    throw new InvoiceTemplateValidationError(
      "JavaScript není v šablonách povolen.",
    );
  }
  if (/\b(?:src|srcset|href|xlink:href|poster)\s*=/i.test(html)) {
    throw new InvoiceTemplateValidationError(
      "Šablona nesmí načítat externí ani lokální zdroje.",
    );
  }
  if (/\bstyle\s*=/i.test(html)) {
    throw new InvoiceTemplateValidationError(
      "Inline style atribut není v šablonách povolen.",
    );
  }
  if (
    /[<>\\]/.test(css) || /@(?!page\b)/i.test(css) ||
    /expression\s*\(|(?:javascript|https?|file|data)\s*:|url\s*\(|image-set\s*\(/i
      .test(css)
  ) {
    throw new InvoiceTemplateValidationError(
      "CSS obsahuje zakázanou konstrukci.",
    );
  }

  const allowed = new Set<string>(TEMPLATE_PLACEHOLDERS);
  for (const match of html.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
    if (!allowed.has(match[1])) {
      throw new InvoiceTemplateValidationError(
        `Neznámý placeholder: ${match[1]}`,
      );
    }
  }
  return { name, description, html, css };
}

export class InvoiceTemplateService {
  constructor(private readonly repository: InvoiceTemplateRepository) {}

  async create(
    input: InvoiceTemplateInput & { userId: string },
  ): Promise<InvoiceTemplate> {
    const validated = validateInvoiceTemplate(input);
    return await this.repository.create({
      ...validated,
      id: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      createdBy: input.userId,
    });
  }

  async createVersion(
    input: InvoiceTemplateInput & {
      templateId: string;
      userId: string;
    },
  ): Promise<InvoiceTemplateVersion | null> {
    const validated = validateInvoiceTemplate(input);
    return await this.repository.createVersion({
      ...validated,
      templateId: input.templateId,
      versionId: crypto.randomUUID(),
      createdBy: input.userId,
    });
  }
}
