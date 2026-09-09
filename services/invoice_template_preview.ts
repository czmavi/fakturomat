import type { InvoiceViewModel } from "@/domain/invoices/invoice_view_model.ts";
import { generateQrPaymentSvg } from "@/services/qr_payment_service.ts";

export async function createPreviewInvoiceViewModel(): Promise<
  InvoiceViewModel
> {
  const qrSvg = await generateQrPaymentSvg({
    bankAccount: {
      name: "Hlavní účet",
      bankName: "Fio banka",
      accountPrefix: null,
      accountNumber: "2900000001",
      bankCode: "2010",
      iban: "CZ6320100000002900000001",
      bic: "FIOBCZPPXXX",
      currency: "CZK",
    },
    amount: "18500.00",
    currency: "CZK",
    variableSymbol: "20260001",
    dueDate: "2026-09-22",
    message: "FAKTURA 2026-0001",
  });
  return {
    supplier: {
      name: "Studio Sever s.r.o.",
      ico: "12345678",
      dic: "CZ12345678",
      address: "Dlouhá 12, 110 00 Praha 1, CZ",
      email: "fakturace@studio-sever.test",
      phone: "+420 777 123 456",
      website: "studio-sever.test",
      logo: "STUDIO SEVER",
    },
    customer: {
      name: "Ukázkový zákazník s.r.o.",
      ico: "87654321",
      dic: "CZ87654321",
      address: "Náměstí 5, 602 00 Brno, CZ",
    },
    invoice: {
      number: "2026-0001",
      issueDate: "8. 9. 2026",
      dueDate: "22. 9. 2026",
      variableSymbol: "20260001",
      currency: "CZK",
      subtotal: "18 500,00",
      total: "18 500,00",
      note: "Děkujeme za spolupráci.",
      items: [
        {
          description: "Návrh a realizace webu",
          quantity: "1",
          unit: "projekt",
          unitPrice: "15 000,00",
          total: "15 000,00",
        },
        {
          description: "Technická konzultace",
          quantity: "5",
          unit: "hod",
          unitPrice: "700,00",
          total: "3 500,00",
        },
      ],
    },
    payment: {
      account: "2900000001/2010",
      iban: "CZ6320100000002900000001",
      qrSvg,
    },
  };
}
