import type { InvoiceViewModel } from "@/domain/invoices/invoice_view_model.ts";

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll(
      "'",
      "&#039;",
    );
}

function renderItems(viewModel: InvoiceViewModel): string {
  return viewModel.invoice.items.map((item) => `
    <tr>
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(item.quantity)}</td>
      <td>${escapeHtml(item.unit)}</td>
      <td>${escapeHtml(item.unitPrice)}</td>
      <td>${escapeHtml(item.total)}</td>
    </tr>
  `).join("");
}

function placeholderPattern(placeholder: string): RegExp {
  const escaped = placeholder.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`{{\\s*${escaped}\\s*}}`, "g");
}

function safeQrSvg(value: string): string {
  const trimmed = value.trim();
  if (
    !trimmed.startsWith("<svg") || !trimmed.endsWith("</svg>") ||
    /<\s*(script|foreignObject)\b|\son[a-z]+\s*=|javascript\s*:/i.test(trimmed)
  ) {
    return "";
  }
  return trimmed;
}

export function renderInvoiceTemplate(
  html: string,
  css: string,
  viewModel: InvoiceViewModel,
): string {
  const values: Record<string, string> = {
    "supplier.name": viewModel.supplier.name,
    "supplier.ico": viewModel.supplier.ico,
    "supplier.dic": viewModel.supplier.dic,
    "supplier.address": viewModel.supplier.address,
    "supplier.email": viewModel.supplier.email,
    "supplier.phone": viewModel.supplier.phone,
    "supplier.website": viewModel.supplier.website,
    "supplier.logo": viewModel.supplier.logo,
    "customer.name": viewModel.customer.name,
    "customer.ico": viewModel.customer.ico,
    "customer.dic": viewModel.customer.dic,
    "customer.address": viewModel.customer.address,
    "invoice.number": viewModel.invoice.number,
    "invoice.issueDate": viewModel.invoice.issueDate,
    "invoice.dueDate": viewModel.invoice.dueDate,
    "invoice.variableSymbol": viewModel.invoice.variableSymbol,
    "invoice.currency": viewModel.invoice.currency,
    "invoice.subtotal": viewModel.invoice.subtotal,
    "invoice.total": viewModel.invoice.total,
    "invoice.note": viewModel.invoice.note,
    "payment.account": viewModel.payment.account,
    "payment.iban": viewModel.payment.iban,
  };

  let rendered = html;
  for (const [placeholder, value] of Object.entries(values)) {
    rendered = rendered.replace(
      placeholderPattern(placeholder),
      escapeHtml(value),
    );
  }
  rendered = rendered.replace(
    placeholderPattern("invoice.items"),
    renderItems(viewModel),
  );
  rendered = rendered.replace(
    placeholderPattern("payment.qr"),
    safeQrSvg(viewModel.payment.qrSvg),
  );

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Faktura ${escapeHtml(viewModel.invoice.number)}</title>
  <style>${css}</style>
</head>
<body>${rendered}</body>
</html>`;
}
