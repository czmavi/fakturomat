import { getDb } from "@/database/client.ts";
import type { Sql } from "@/database/d1.ts";
import { type R2Bucket, runtime } from "@/config/runtime.ts";

export class InvoiceDeletionService {
  constructor(
    private readonly sql: Sql = getDb(),
    private readonly documents: Pick<R2Bucket, "delete"> = runtime().DOCUMENTS,
  ) {}

  async deleteForUser(
    input: { organizationId: string; invoiceId: string; userId: string },
  ): Promise<"deleted" | "cleanup_pending" | "not_found"> {
    const authorized = await this.sql.begin(async (tx) => {
      const membership = await tx<{ user_id: string }[]>`
        SELECT user_id FROM organization_memberships WHERE organization_id = ${input.organizationId} AND user_id = ${input.userId}
      `;
      if (!membership[0]) return false;
      const rows = await tx<
        {
          number: string | null;
          number_sequence_id: string;
          issue_date: string;
        }[]
      >`
        SELECT number, number_sequence_id, issue_date FROM invoices
        WHERE id = ${input.invoiceId} AND organization_id = ${input.organizationId}
      `;
      if (!rows[0]) {
        const pending = await tx<
          { storage_key: string }[]
        >`SELECT storage_key FROM invoice_pdf_cleanup WHERE invoice_id = ${input.invoiceId} AND organization_id = ${input.organizationId} LIMIT 1`;
        return pending.length > 0;
      }
      const invoice = rows[0];
      tx.queue(
        tx`INSERT INTO invoice_deletion_permits(invoice_id) VALUES (${input.invoiceId})`,
      );
      tx.queue(tx`
        INSERT INTO invoice_pdf_cleanup(storage_key, organization_id, invoice_id)
        SELECT storage_key, organization_id, invoice_id FROM invoice_documents WHERE invoice_id = ${input.invoiceId}
        UNION ALL
        SELECT storage_key, organization_id, invoice_id FROM invoice_document_revisions WHERE invoice_id = ${input.invoiceId}
      `);
      tx.queue(
        tx`DELETE FROM invoice_document_revisions WHERE invoice_id = ${input.invoiceId}`,
      );
      tx.queue(
        tx`DELETE FROM invoice_documents WHERE invoice_id = ${input.invoiceId}`,
      );
      tx.queue(
        tx`DELETE FROM invoice_items WHERE invoice_id = ${input.invoiceId}`,
      );
      tx.queue(
        tx`DELETE FROM invoice_payments WHERE invoice_id = ${input.invoiceId}`,
      );
      tx.queue(
        tx`DELETE FROM invoices WHERE id = ${input.invoiceId} AND organization_id = ${input.organizationId}`,
      );
      if (invoice.number) {
        tx.queue(
          tx`INSERT INTO released_invoice_numbers(number_sequence_id, year, number) VALUES (${invoice.number_sequence_id}, ${
            Number(invoice.issue_date.slice(0, 4))
          }, ${invoice.number})`,
        );
      }
      return true;
    });
    if (!authorized) return "not_found";
    const pending = await this.sql<{ storage_key: string }[]>`
      SELECT storage_key FROM invoice_pdf_cleanup WHERE invoice_id = ${input.invoiceId} AND organization_id = ${input.organizationId}
    `;
    let failed = false;
    for (const document of pending) {
      try {
        await this.documents.delete(document.storage_key);
        await this
          .sql`DELETE FROM invoice_pdf_cleanup WHERE storage_key = ${document.storage_key}`;
      } catch (error) {
        console.error("Invoice PDF cleanup failed", error);
        failed = true;
      }
    }
    return failed ? "cleanup_pending" : "deleted";
  }
}
