import type { InvoiceViewModel } from "@/domain/invoices/invoice_view_model.ts";
import type { Invoice } from "@/domain/invoices/types.ts";
import { formatMoneyForDisplay } from "@/domain/invoices/money.ts";
import {
  generateQrPaymentSvg,
  resolvePaymentIban,
} from "@/services/qr_payment_service.ts";

export class InvoiceViewModelError extends Error {}

function address(snapshot: {
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
}): string {
  return [
    snapshot.street,
    [snapshot.postalCode, snapshot.city].filter(Boolean).join(" "),
    snapshot.country,
  ].filter(Boolean).join(", ");
}

function dateLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("cs-CZ", {
    timeZone: "UTC",
  });
}

function paymentAccount(invoice: Invoice): string {
  const account = invoice.bankAccountSnapshot!;
  if (account.accountNumber && account.bankCode) {
    const prefix = account.accountPrefix ? `${account.accountPrefix}-` : "";
    return `${prefix}${account.accountNumber}/${account.bankCode}`;
  }
  return account.iban ?? "";
}

export async function createInvoiceViewModel(
  invoice: Invoice,
): Promise<InvoiceViewModel> {
  if (
    invoice.status === "DRAFT" || !invoice.number || !invoice.variableSymbol ||
    !invoice.supplierSnapshot || !invoice.customerSnapshot ||
    !invoice.bankAccountSnapshot || !invoice.templateVersionId
  ) {
    throw new InvoiceViewModelError(
      "View model lze vytvořit jen z kompletně vystavené faktury.",
    );
  }
  const iban = resolvePaymentIban(invoice.bankAccountSnapshot);
  const qrSvg = await generateQrPaymentSvg({
    bankAccount: invoice.bankAccountSnapshot,
    amount: invoice.total,
    currency: invoice.currency,
    variableSymbol: invoice.variableSymbol,
    dueDate: invoice.dueDate,
    message: `FAKTURA ${invoice.number}`,
  });
  return {
    supplier: {
      name: invoice.supplierSnapshot.officialName,
      ico: invoice.supplierSnapshot.ico ?? "",
      dic: invoice.supplierSnapshot.dic ?? "",
      address: address(invoice.supplierSnapshot),
      email: invoice.supplierSnapshot.email ?? "",
      phone: invoice.supplierSnapshot.phone ?? "",
      website: invoice.supplierSnapshot.website ?? "",
      logo: invoice.supplierSnapshot.displayName,
    },
    customer: {
      name: invoice.customerSnapshot.name,
      ico: invoice.customerSnapshot.ico ?? "",
      dic: invoice.customerSnapshot.dic ?? "",
      address: address(invoice.customerSnapshot),
    },
    invoice: {
      number: invoice.number,
      issueDate: dateLabel(invoice.issueDate),
      dueDate: dateLabel(invoice.dueDate),
      variableSymbol: invoice.variableSymbol,
      currency: invoice.currency,
      subtotal: formatMoneyForDisplay(invoice.subtotal),
      total: formatMoneyForDisplay(invoice.total),
      note: invoice.note ?? invoice.supplierSnapshot.invoiceFooter ?? "",
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: formatMoneyForDisplay(item.unitPrice),
        total: formatMoneyForDisplay(item.total),
      })),
    },
    payment: {
      account: paymentAccount(invoice),
      iban,
      qrSvg,
    },
  };
}
