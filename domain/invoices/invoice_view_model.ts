export interface InvoiceViewModel {
  supplier: {
    name: string;
    ico: string;
    dic: string;
    address: string;
    email: string;
    phone: string;
    website: string;
    logo: string;
  };
  customer: {
    name: string;
    ico: string;
    dic: string;
    address: string;
  };
  invoice: {
    number: string;
    issueDate: string;
    dueDate: string;
    variableSymbol: string;
    currency: string;
    subtotal: string;
    total: string;
    note: string;
    items: Array<{
      description: string;
      quantity: string;
      unit: string;
      unitPrice: string;
      total: string;
    }>;
  };
  payment: {
    account: string;
    iban: string;
    qrSvg: string;
  };
}
