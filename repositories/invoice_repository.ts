import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  BankAccountSnapshot,
  CustomerSnapshot,
  Invoice,
  InvoiceItem,
  InvoiceStatus,
  InvoiceSummary,
  NormalizedInvoiceDraftInput,
  SupplierSnapshot,
} from "@/domain/invoices/types.ts";
import {
  allocateNextInvoiceNumber,
} from "@/repositories/invoice_number_sequence_repository.ts";
import type { InvoiceNumberSequence } from "@/domain/invoices/number_sequence_types.ts";
import type {
  InvoiceDocumentPreparer,
  PreparedInvoiceDocument,
} from "@/domain/invoices/invoice_document.ts";
import type { InvoiceTemplateVersion } from "@/domain/invoices/template_types.ts";
import {
  createSpaydPayload,
  QrPaymentValidationError,
} from "@/services/qr_payment_service.ts";

interface InvoiceRow {
  id: string;
  organization_id: string;
  contact_id: string;
  contact_name: string;
  number_sequence_id: string;
  number_sequence_name: string;
  bank_account_id: string | null;
  bank_account_name: string | null;
  invoice_template_id: string;
  invoice_template_name: string;
  template_version_id: string | null;
  template_version_number: number | null;
  number: string | null;
  variable_symbol: string | null;
  status: InvoiceStatus;
  issue_date: string | Date;
  due_date: string | Date;
  currency: string;
  subtotal: string;
  total: string;
  note: string | null;
  supplier_snapshot: SupplierSnapshot | null;
  customer_snapshot: CustomerSnapshot | null;
  bank_account_snapshot: BankAccountSnapshot | null;
  issued_at: Date | null;
  issued_by: string | null;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ItemRow {
  id: string;
  invoice_id: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total: string;
  position: number;
}

interface DraftIssueRow {
  id: string;
  status: InvoiceStatus;
  contact_id: string;
  number_sequence_id: string;
  bank_account_id: string | null;
  invoice_template_id: string;
  variable_symbol: string | null;
  issue_date: string | Date;
  due_date: string | Date;
  currency: string;
  total: string;
}

interface SupplierRow {
  official_name: string;
  display_name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  logo_storage_key: string | null;
  logo_mime_type: string | null;
  invoice_footer: string | null;
}

interface CustomerRow {
  type: string;
  name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  email: string | null;
  phone: string | null;
}

interface BankAccountRow {
  name: string;
  bank_name: string | null;
  account_prefix: string | null;
  account_number: string | null;
  bank_code: string | null;
  iban: string | null;
  bic: string | null;
  currency: string;
}

interface IssueSequenceRow {
  id: string;
  organization_id: string;
  name: string;
  prefix: string;
  padding: number;
  is_default: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceRepository {
  listForUser(input: {
    organizationId: string;
    userId: string;
    status: InvoiceStatus | null;
  }): Promise<InvoiceSummary[]>;
  findForUser(
    organizationId: string,
    invoiceId: string,
    userId: string,
  ): Promise<Invoice | null>;
  createDraftForUser(
    input: NormalizedInvoiceDraftInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Invoice | null>;
  updateDraftForUser(
    input: NormalizedInvoiceDraftInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Invoice | null>;
  issueForUser(input: {
    organizationId: string;
    invoiceId: string;
    userId: string;
  }, documentPreparer: InvoiceDocumentPreparer): Promise<IssueInvoiceResult>;
}

export type IssueInvoiceResult =
  | { kind: "issued"; invoice: Invoice }
  | { kind: "not_found" }
  | { kind: "not_draft" }
  | { kind: "bank_account_required" }
  | { kind: "bank_account_currency_mismatch" }
  | { kind: "qr_payment_unavailable" }
  | { kind: "pdf_generation_failed" }
  | { kind: "reference_unavailable" };

const INVOICE_SELECT = `
  invoices.id, invoices.organization_id, invoices.contact_id,
  CASE
    WHEN invoices.customer_snapshot IS NULL THEN contacts.name
    ELSE invoices.customer_snapshot->>'name'
  END AS contact_name,
  invoices.number_sequence_id,
  sequences.name AS number_sequence_name, invoices.bank_account_id,
  CASE
    WHEN invoices.bank_account_snapshot IS NULL THEN bank_accounts.name
    ELSE invoices.bank_account_snapshot->>'name'
  END AS bank_account_name,
  invoices.invoice_template_id,
  templates.name AS invoice_template_name, invoices.template_version_id,
  selected_version.version AS template_version_number,
  invoices.number, invoices.variable_symbol, invoices.status,
  invoices.issue_date, invoices.due_date, invoices.currency,
  invoices.subtotal::text, invoices.total::text, invoices.note,
  invoices.supplier_snapshot, invoices.customer_snapshot,
  invoices.bank_account_snapshot, invoices.issued_at, invoices.issued_by,
  invoices.paid_at, invoices.created_at, invoices.updated_at
`;

const INVOICE_JOINS = `
  JOIN contacts
    ON contacts.id = invoices.contact_id
    AND contacts.organization_id = invoices.organization_id
  JOIN invoice_number_sequences AS sequences
    ON sequences.id = invoices.number_sequence_id
    AND sequences.organization_id = invoices.organization_id
  LEFT JOIN bank_accounts
    ON bank_accounts.id = invoices.bank_account_id
    AND bank_accounts.organization_id = invoices.organization_id
  JOIN invoice_templates AS templates
    ON templates.id = invoices.invoice_template_id
  LEFT JOIN invoice_template_versions AS selected_version
    ON selected_version.id = invoices.template_version_id
    AND selected_version.invoice_template_id = invoices.invoice_template_id
  JOIN organization_memberships AS memberships
    ON memberships.organization_id = invoices.organization_id
`;

function dateString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

function summaryFromRow(row: InvoiceRow): InvoiceSummary {
  return {
    id: row.id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    numberSequenceId: row.number_sequence_id,
    numberSequenceName: row.number_sequence_name,
    bankAccountId: row.bank_account_id,
    bankAccountName: row.bank_account_name,
    invoiceTemplateId: row.invoice_template_id,
    invoiceTemplateName: row.invoice_template_name,
    templateVersionId: row.template_version_id,
    templateVersionNumber: row.template_version_number,
    number: row.number,
    variableSymbol: row.variable_symbol,
    status: row.status,
    issueDate: dateString(row.issue_date),
    dueDate: dateString(row.due_date),
    currency: row.currency,
    subtotal: row.subtotal,
    total: row.total,
    note: row.note,
    supplierSnapshot: row.supplier_snapshot,
    customerSnapshot: row.customer_snapshot,
    bankAccountSnapshot: row.bank_account_snapshot,
    issuedAt: row.issued_at,
    issuedBy: row.issued_by,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemFromRow(row: ItemRow): InvoiceItem {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: row.unit_price,
    total: row.total,
    position: row.position,
  };
}

export class PostgresInvoiceRepository implements InvoiceRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async listForUser(input: {
    organizationId: string;
    userId: string;
    status: InvoiceStatus | null;
  }): Promise<InvoiceSummary[]> {
    const rows = await this.sql.unsafe<InvoiceRow[]>(
      `
      SELECT ${INVOICE_SELECT}
      FROM invoices
      ${INVOICE_JOINS}
      WHERE invoices.organization_id = $1
        AND memberships.user_id = $2
        AND ($3::text IS NULL OR invoices.status = $3)
      ORDER BY invoices.issue_date DESC, invoices.created_at DESC, invoices.id
    `,
      [input.organizationId, input.userId, input.status],
    );
    return rows.map(summaryFromRow);
  }

  async findForUser(
    organizationId: string,
    invoiceId: string,
    userId: string,
  ): Promise<Invoice | null> {
    const rows = await this.sql.unsafe<InvoiceRow[]>(
      `
      SELECT ${INVOICE_SELECT}
      FROM invoices
      ${INVOICE_JOINS}
      WHERE invoices.id = $1 AND invoices.organization_id = $2
        AND memberships.user_id = $3
      LIMIT 1
    `,
      [invoiceId, organizationId, userId],
    );
    if (!rows[0]) return null;
    const items = await this.sql<ItemRow[]>`
      SELECT id, invoice_id, description, quantity::text, unit,
        unit_price::text, total::text, position
      FROM invoice_items
      WHERE invoice_id = ${invoiceId}
      ORDER BY position
    `;
    return { ...summaryFromRow(rows[0]), items: items.map(itemFromRow) };
  }

  async createDraftForUser(
    input: NormalizedInvoiceDraftInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Invoice | null> {
    return await this.sql.begin(async (transaction) => {
      if (!await this.referencesAreAvailable(transaction, input, true)) {
        return null;
      }
      await transaction`
        INSERT INTO invoices (
          id, organization_id, contact_id, number_sequence_id,
          bank_account_id, invoice_template_id, variable_symbol, status,
          issue_date, due_date, currency, subtotal, total, note
        ) VALUES (
          ${input.id}, ${input.organizationId}, ${input.contactId},
          ${input.numberSequenceId}, ${input.bankAccountId},
          ${input.invoiceTemplateId}, ${input.variableSymbol}, 'DRAFT',
          ${input.issueDate}, ${input.dueDate}, ${input.currency},
          ${input.subtotal}, ${input.total}, ${input.note}
        )
      `;
      await this.insertItems(transaction, input.id, input.items);
      return await this.findInTransaction(
        transaction,
        input.organizationId,
        input.id,
        input.userId,
      );
    });
  }

  async updateDraftForUser(
    input: NormalizedInvoiceDraftInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Invoice | null> {
    return await this.sql.begin(async (transaction) => {
      const current = await transaction<{ id: string }[]>`
        SELECT invoices.id
        FROM invoices
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = invoices.organization_id
        WHERE invoices.id = ${input.id}
          AND invoices.organization_id = ${input.organizationId}
          AND memberships.user_id = ${input.userId}
          AND invoices.status = 'DRAFT'
        FOR UPDATE OF invoices
      `;
      if (!current[0]) return null;
      if (!await this.referencesAreAvailable(transaction, input, false)) {
        return null;
      }

      await transaction`
        UPDATE invoices
        SET contact_id = ${input.contactId},
          number_sequence_id = ${input.numberSequenceId},
          bank_account_id = ${input.bankAccountId},
          invoice_template_id = ${input.invoiceTemplateId},
          variable_symbol = ${input.variableSymbol},
          issue_date = ${input.issueDate}, due_date = ${input.dueDate},
          currency = ${input.currency}, subtotal = ${input.subtotal},
          total = ${input.total}, note = ${input.note}, updated_at = now()
        WHERE id = ${input.id} AND organization_id = ${input.organizationId}
      `;
      await transaction`
        DELETE FROM invoice_items WHERE invoice_id = ${input.id}
      `;
      await this.insertItems(transaction, input.id, input.items);
      return await this.findInTransaction(
        transaction,
        input.organizationId,
        input.id,
        input.userId,
      );
    });
  }

  async issueForUser(input: {
    organizationId: string;
    invoiceId: string;
    userId: string;
  }, documentPreparer: InvoiceDocumentPreparer): Promise<IssueInvoiceResult> {
    let preparedDocument: PreparedInvoiceDocument | null = null;
    try {
      return await this.sql.begin(async (transaction) => {
        const drafts = await transaction<DraftIssueRow[]>`
        SELECT invoices.id, invoices.status, invoices.contact_id,
          invoices.number_sequence_id, invoices.bank_account_id,
          invoices.invoice_template_id, invoices.variable_symbol,
          invoices.issue_date, invoices.due_date, invoices.currency,
          invoices.total::text
        FROM invoices
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = invoices.organization_id
        WHERE invoices.id = ${input.invoiceId}
          AND invoices.organization_id = ${input.organizationId}
          AND memberships.user_id = ${input.userId}
        FOR UPDATE OF invoices
      `;
        const draft = drafts[0];
        if (!draft) return { kind: "not_found" };
        if (draft.status !== "DRAFT") return { kind: "not_draft" };
        if (draft.bank_account_id === null) {
          return { kind: "bank_account_required" };
        }

        const suppliers = await transaction<SupplierRow[]>`
        SELECT official_name, display_name, ico, dic, street, city,
          postal_code, country, email, phone, website, logo_storage_key,
          logo_mime_type, invoice_footer
        FROM organizations
        WHERE id = ${input.organizationId}
        FOR SHARE
      `;
        const customers = await transaction<CustomerRow[]>`
        SELECT type, name, ico, dic, street, city, postal_code, country,
          email, phone
        FROM contacts
        WHERE id = ${draft.contact_id}
          AND organization_id = ${input.organizationId}
        FOR SHARE
      `;
        const bankAccounts = await transaction<BankAccountRow[]>`
        SELECT name, bank_name, account_prefix, account_number, bank_code,
          iban, bic, currency
        FROM bank_accounts
        WHERE id = ${draft.bank_account_id}
          AND organization_id = ${input.organizationId}
          AND is_active
        FOR SHARE
      `;
        const sequences = await transaction<IssueSequenceRow[]>`
        SELECT id, organization_id, name, prefix, padding, is_default,
          is_active, created_at, updated_at
        FROM invoice_number_sequences
        WHERE id = ${draft.number_sequence_id}
          AND organization_id = ${input.organizationId}
          AND is_active
        FOR SHARE
      `;
        const templateVersions = await transaction<
          Array<{
            id: string;
            invoice_template_id: string;
            version: number;
            html: string;
            css: string;
            created_by: string | null;
            created_at: Date;
          }>
        >`
        SELECT versions.id, versions.invoice_template_id, versions.version,
          versions.html, versions.css, versions.created_by, versions.created_at
        FROM invoice_templates AS templates
        JOIN invoice_template_versions AS versions
          ON versions.id = templates.current_version_id
          AND versions.invoice_template_id = templates.id
        WHERE templates.id = ${draft.invoice_template_id}
          AND templates.is_active
        FOR SHARE OF templates, versions
      `;
        const lockedItems = await transaction<{ id: string }[]>`
        SELECT id FROM invoice_items
        WHERE invoice_id = ${draft.id}
        FOR SHARE
      `;
        if (
          !suppliers[0] || !customers[0] || !bankAccounts[0] || !sequences[0] ||
          !templateVersions[0] || lockedItems.length === 0
        ) {
          return { kind: "reference_unavailable" };
        }
        if (bankAccounts[0].currency !== draft.currency) {
          return { kind: "bank_account_currency_mismatch" };
        }

        const supplierSnapshot: SupplierSnapshot = {
          officialName: suppliers[0].official_name,
          displayName: suppliers[0].display_name,
          ico: suppliers[0].ico,
          dic: suppliers[0].dic,
          street: suppliers[0].street,
          city: suppliers[0].city,
          postalCode: suppliers[0].postal_code,
          country: suppliers[0].country,
          email: suppliers[0].email,
          phone: suppliers[0].phone,
          website: suppliers[0].website,
          logoStorageKey: suppliers[0].logo_storage_key,
          logoMimeType: suppliers[0].logo_mime_type,
          invoiceFooter: suppliers[0].invoice_footer,
        };
        const customerSnapshot: CustomerSnapshot = {
          type: customers[0].type,
          name: customers[0].name,
          ico: customers[0].ico,
          dic: customers[0].dic,
          street: customers[0].street,
          city: customers[0].city,
          postalCode: customers[0].postal_code,
          country: customers[0].country,
          email: customers[0].email,
          phone: customers[0].phone,
        };
        const bankAccountSnapshot: BankAccountSnapshot = {
          name: bankAccounts[0].name,
          bankName: bankAccounts[0].bank_name,
          accountPrefix: bankAccounts[0].account_prefix,
          accountNumber: bankAccounts[0].account_number,
          bankCode: bankAccounts[0].bank_code,
          iban: bankAccounts[0].iban,
          bic: bankAccounts[0].bic,
          currency: bankAccounts[0].currency,
        };
        const sequence: InvoiceNumberSequence = {
          id: sequences[0].id,
          organizationId: sequences[0].organization_id,
          name: sequences[0].name,
          prefix: sequences[0].prefix,
          padding: sequences[0].padding,
          isDefault: sequences[0].is_default,
          isActive: sequences[0].is_active,
          createdAt: sequences[0].created_at,
          updatedAt: sequences[0].updated_at,
        };
        try {
          createSpaydPayload({
            bankAccount: bankAccountSnapshot,
            amount: draft.total,
            currency: draft.currency,
            variableSymbol: draft.variable_symbol ?? "1",
            dueDate: dateString(draft.due_date),
            message: "FAKTURA",
          });
        } catch (error) {
          if (error instanceof QrPaymentValidationError) {
            return { kind: "qr_payment_unavailable" };
          }
          throw error;
        }
        const year = Number(dateString(draft.issue_date).slice(0, 4));
        const number = await allocateNextInvoiceNumber(
          transaction,
          sequence,
          year,
        );
        const derivedVariableSymbol = number.replaceAll(/\D/g, "").slice(-10);
        const variableSymbol = draft.variable_symbol ?? derivedVariableSymbol;

        await transaction`
        UPDATE invoices
        SET number = ${number}, variable_symbol = ${variableSymbol},
          supplier_snapshot = ${transaction.json(supplierSnapshot)},
          customer_snapshot = ${transaction.json(customerSnapshot)},
          bank_account_snapshot = ${transaction.json(bankAccountSnapshot)},
          template_version_id = ${templateVersions[0].id}, status = 'ISSUED',
          issued_at = now(), issued_by = ${input.userId}, updated_at = now()
        WHERE id = ${draft.id} AND organization_id = ${input.organizationId}
          AND status = 'DRAFT'
      `;
        const invoice = await this.findInTransaction(
          transaction,
          input.organizationId,
          draft.id,
          input.userId,
        );
        if (!invoice) throw new Error("Issued invoice could not be loaded");
        const templateVersion: InvoiceTemplateVersion = {
          id: templateVersions[0].id,
          invoiceTemplateId: templateVersions[0].invoice_template_id,
          version: templateVersions[0].version,
          html: templateVersions[0].html,
          css: templateVersions[0].css,
          createdBy: templateVersions[0].created_by,
          createdAt: templateVersions[0].created_at,
        };
        preparedDocument = await documentPreparer.prepare(
          invoice,
          templateVersion,
        );
        await transaction`
        INSERT INTO invoice_documents (
          id, organization_id, invoice_id, type, storage_key, sha256, size
        ) VALUES (
          ${preparedDocument.id}, ${input.organizationId}, ${draft.id},
          ${preparedDocument.type}, ${preparedDocument.storageKey},
          ${preparedDocument.sha256}, ${preparedDocument.size}
        )
      `;
        return { kind: "issued", invoice };
      });
    } catch (error) {
      if (preparedDocument !== null) {
        try {
          await documentPreparer.discard(preparedDocument);
        } catch {
          console.error(
            "Rolled back invoice PDF could not be removed from object storage.",
          );
        }
      }
      throw error;
    }
  }

  private async referencesAreAvailable(
    sql: TransactionSql,
    input: NormalizedInvoiceDraftInput & {
      organizationId: string;
      userId: string;
    },
    activeOnly: boolean,
  ): Promise<boolean> {
    const rows = await sql<{ allowed: boolean }[]>`
      SELECT
        EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = ${input.organizationId}
            AND user_id = ${input.userId}
        )
        AND EXISTS (
          SELECT 1 FROM contacts
          WHERE id = ${input.contactId}
            AND organization_id = ${input.organizationId}
            AND (${!activeOnly} OR archived_at IS NULL)
        )
        AND EXISTS (
          SELECT 1 FROM invoice_number_sequences
          WHERE id = ${input.numberSequenceId}
            AND organization_id = ${input.organizationId}
            AND (${!activeOnly} OR is_active)
        )
        AND EXISTS (
          SELECT 1 FROM invoice_templates
          WHERE id = ${input.invoiceTemplateId}
            AND (${!activeOnly} OR is_active)
        )
        AND (
          ${input.bankAccountId}::uuid IS NULL OR EXISTS (
            SELECT 1 FROM bank_accounts
            WHERE id = ${input.bankAccountId}
              AND organization_id = ${input.organizationId}
              AND (${!activeOnly} OR is_active)
          )
        ) AS allowed
    `;
    return rows[0].allowed;
  }

  private async insertItems(
    sql: TransactionSql,
    invoiceId: string,
    items: NormalizedInvoiceDraftInput["items"],
  ): Promise<void> {
    for (const item of items) {
      await sql`
        INSERT INTO invoice_items (
          id, invoice_id, description, quantity, unit, unit_price, total,
          position
        ) VALUES (
          ${item.id}, ${invoiceId}, ${item.description}, ${item.quantity},
          ${item.unit}, ${item.unitPrice}, ${item.total}, ${item.position}
        )
      `;
    }
  }

  private async findInTransaction(
    sql: TransactionSql,
    organizationId: string,
    invoiceId: string,
    userId: string,
  ): Promise<Invoice | null> {
    const rows = await sql.unsafe<InvoiceRow[]>(
      `
      SELECT ${INVOICE_SELECT}
      FROM invoices
      ${INVOICE_JOINS}
      WHERE invoices.id = $1 AND invoices.organization_id = $2
        AND memberships.user_id = $3
      LIMIT 1
    `,
      [invoiceId, organizationId, userId],
    );
    if (!rows[0]) return null;
    const itemRows = await sql<ItemRow[]>`
      SELECT id, invoice_id, description, quantity::text, unit,
        unit_price::text, total::text, position
      FROM invoice_items
      WHERE invoice_id = ${invoiceId}
      ORDER BY position
    `;
    return { ...summaryFromRow(rows[0]), items: itemRows.map(itemFromRow) };
  }
}
