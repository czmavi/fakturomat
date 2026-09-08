CREATE TABLE invoice_templates (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_templates_name_not_empty CHECK (length(trim(name)) > 0)
);

CREATE TABLE invoice_template_versions (
  id uuid PRIMARY KEY,
  invoice_template_id uuid NOT NULL
    REFERENCES invoice_templates (id) ON DELETE RESTRICT,
  version integer NOT NULL,
  html text NOT NULL,
  css text NOT NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_template_versions_version_positive CHECK (version > 0),
  CONSTRAINT invoice_template_versions_html_not_empty CHECK (length(trim(html)) > 0),
  UNIQUE (invoice_template_id, version),
  UNIQUE (invoice_template_id, id)
);

ALTER TABLE invoice_templates
  ADD COLUMN current_version_id uuid,
  ADD CONSTRAINT invoice_templates_current_version_fk
    FOREIGN KEY (id, current_version_id)
    REFERENCES invoice_template_versions (invoice_template_id, id)
    DEFERRABLE INITIALLY DEFERRED;

INSERT INTO invoice_templates (id, name, description)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  'Čistá profesionální',
  'Výchozí jednostránková šablona pro faktury bez DPH.'
);

INSERT INTO invoice_template_versions (
  id, invoice_template_id, version, html, css
)
VALUES (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  1,
  $template_html$
<main class="invoice">
  <header class="invoice-header">
    <section>
      <p class="eyebrow">FAKTURA</p>
      <h1>{{invoice.number}}</h1>
    </section>
    <section class="supplier-logo">{{supplier.logo}}</section>
  </header>

  <section class="parties">
    <div>
      <p class="label">Dodavatel</p>
      <h2>{{supplier.name}}</h2>
      <p>{{supplier.address}}</p>
      <p>IČO: {{supplier.ico}} &nbsp; DIČ: {{supplier.dic}}</p>
      <p>{{supplier.email}} &nbsp; {{supplier.phone}}</p>
      <p>{{supplier.website}}</p>
    </div>
    <div>
      <p class="label">Odběratel</p>
      <h2>{{customer.name}}</h2>
      <p>{{customer.address}}</p>
      <p>IČO: {{customer.ico}} &nbsp; DIČ: {{customer.dic}}</p>
    </div>
  </section>

  <section class="meta">
    <div><span>Datum vystavení</span><strong>{{invoice.issueDate}}</strong></div>
    <div><span>Datum splatnosti</span><strong>{{invoice.dueDate}}</strong></div>
    <div><span>Variabilní symbol</span><strong>{{invoice.variableSymbol}}</strong></div>
  </section>

  <table>
    <thead><tr><th>Popis</th><th>Množství</th><th>Jednotka</th><th>Cena</th><th>Celkem</th></tr></thead>
    <tbody>{{invoice.items}}</tbody>
  </table>

  <section class="totals">
    <div><span>Mezisoučet</span><strong>{{invoice.subtotal}} {{invoice.currency}}</strong></div>
    <div class="grand-total"><span>Celkem k úhradě</span><strong>{{invoice.total}} {{invoice.currency}}</strong></div>
  </section>

  <section class="payment">
    <div>
      <p class="label">Platební údaje</p>
      <p>Účet: <strong>{{payment.account}}</strong></p>
      <p>IBAN: <strong>{{payment.iban}}</strong></p>
    </div>
    <div class="qr">{{payment.qr}}</div>
  </section>

  <section class="note"><span>Poznámka</span><p>{{invoice.note}}</p></section>
</main>
  $template_html$,
  $template_css$
@page { size: A4; margin: 15mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #18211c; background: #fff; font-family: Arial, sans-serif; font-size: 12px; line-height: 1.5; }
.invoice { width: 100%; }
.invoice-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 22px; border-bottom: 2px solid #183e2a; }
.eyebrow, .label { margin: 0 0 5px; color: #277a4c; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 0; font-size: 30px; letter-spacing: -.03em; }
h2 { margin: 0 0 5px; font-size: 16px; }
p { margin: 2px 0; }
.supplier-logo { max-width: 150px; max-height: 60px; text-align: right; }
.supplier-logo img { max-width: 150px; max-height: 60px; object-fit: contain; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 35px; padding: 25px 0; }
.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 14px; background: #f1f6f2; border-radius: 8px; }
.meta div, .totals div { display: flex; justify-content: space-between; gap: 10px; }
.meta span, .totals span, .note span { color: #69736c; }
table { width: 100%; margin-top: 24px; border-collapse: collapse; }
th { padding: 9px 8px; border-bottom: 1px solid #b9c4bb; color: #69736c; font-size: 10px; text-align: left; text-transform: uppercase; }
td { padding: 11px 8px; border-bottom: 1px solid #e0e5e1; }
th:not(:first-child), td:not(:first-child) { text-align: right; }
.totals { width: 48%; margin: 18px 0 0 auto; }
.totals div { padding: 5px 8px; }
.totals .grand-total { margin-top: 5px; padding: 12px; color: #fff; background: #183e2a; border-radius: 8px; font-size: 15px; }
.payment { display: flex; justify-content: space-between; align-items: center; margin-top: 28px; padding: 18px; border: 1px solid #d9dfda; border-radius: 8px; }
.qr svg { width: 90px; height: 90px; }
.note { margin-top: 22px; padding-top: 15px; border-top: 1px solid #e0e5e1; }
  $template_css$
);

UPDATE invoice_templates
SET current_version_id = '10000000-0000-4000-8000-000000000002'
WHERE id = '10000000-0000-4000-8000-000000000001';

ALTER TABLE organizations
  ADD COLUMN default_invoice_template_id uuid NOT NULL
    DEFAULT '10000000-0000-4000-8000-000000000001'
    REFERENCES invoice_templates (id) ON DELETE RESTRICT;
