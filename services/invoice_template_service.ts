import {
  type InvoiceTemplate,
  type InvoiceTemplateInput,
  type InvoiceTemplateVersion,
  TEMPLATE_PLACEHOLDERS,
} from "@/domain/invoices/template_types.ts";
import type { InvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";

export class InvoiceTemplateValidationError extends Error {}

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
  if (
    /<\s*(script|style|iframe|object|embed|link|meta|base|form)\b/i.test(html)
  ) {
    throw new InvoiceTemplateValidationError("HTML obsahuje zakázaný element.");
  }
  if (/\son[a-z]+\s*=/i.test(html) || /javascript\s*:/i.test(html)) {
    throw new InvoiceTemplateValidationError(
      "JavaScript není v šablonách povolen.",
    );
  }
  if (/\b(?:src|href)\s*=\s*(?:["']\s*)?(?:https?:|\/\/|data:)/i.test(html)) {
    throw new InvoiceTemplateValidationError(
      "Šablona nesmí načítat externí zdroje.",
    );
  }
  if (/\bstyle\s*=\s*["'][^"']*url\s*\(/i.test(html)) {
    throw new InvoiceTemplateValidationError(
      "Inline styl nesmí načítat externí zdroje.",
    );
  }
  if (
    /[<>]/.test(css) ||
    /@import|expression\s*\(|javascript\s*:|url\s*\(/i.test(css)
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
