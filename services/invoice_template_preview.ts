import type { InvoiceViewModel } from "@/domain/invoices/invoice_view_model.ts";

export function createPreviewInvoiceViewModel(): InvoiceViewModel {
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
      qrSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90" role="img" aria-label="Ukázka QR platby"><rect width="90" height="90" fill="white"/><rect x="5" y="5" width="24" height="24" fill="#183e2a"/><rect x="61" y="5" width="24" height="24" fill="#183e2a"/><rect x="5" y="61" width="24" height="24" fill="#183e2a"/><path d="M38 8h8v8h8v8h-8v8h-8zm0 34h8v8h8v8h-8v8h-8zm22-4h8v8h8v8h-8v8h-8zm10 32h15v15H70z" fill="#183e2a"/></svg>',
    },
  };
}
