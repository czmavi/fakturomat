import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresInvoiceRepository } from "@/repositories/invoice_repository.ts";
import {
  createInvoiceViewModel,
  InvoiceViewModelError,
} from "@/services/invoice_view_model_service.ts";
import { QrPaymentValidationError } from "@/services/qr_payment_service.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!isUuid(ctx.params.invoiceId)) {
      return new Response("QR Platba nebyla nalezena.", { status: 404 });
    }
    const invoice = await new PostgresInvoiceRepository().findForUser(
      ctx.params.organizationId,
      ctx.params.invoiceId,
      ctx.state.user!.id,
    );
    if (invoice === null) {
      return new Response("QR Platba nebyla nalezena.", { status: 404 });
    }
    try {
      const viewModel = await createInvoiceViewModel(invoice);
      return new Response(viewModel.payment.qrSvg, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Content-Type": "image/svg+xml; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (
        error instanceof InvoiceViewModelError ||
        error instanceof QrPaymentValidationError
      ) {
        return new Response("QR Platbu nelze pro tuto fakturu vytvořit.", {
          status: 422,
        });
      }
      throw error;
    }
  },
});
