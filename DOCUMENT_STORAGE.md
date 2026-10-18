# Privátní dokumenty v Cloudflare R2

Aplikace používá dva povinné R2 bindingy: `DOCUMENTS` pro neměnné fakturové PDF
a `FILES` pro loga a přílohy nákladů. Buckety nemají veřejnou doménu ani
`r2.dev` přístup. Přístup poskytují autorizované aplikační endpointy.

`R2DocumentStorage` ukládá PDF pod
`invoices/<organizationId>/<invoiceId>/<documentId>.pdf` s podmínkou
`etagDoesNotMatch: "*"`, která zabrání přepsání existujícího objektu. Metadata v
D1 obsahují provider `r2`, klíč, velikost, SHA-256 a ETag. ETag nenahrazuje
obsahovou kontrolu SHA-256.

Endpoint `document.pdf` nejprve ověří přihlášení a členství v organizaci, načte
objekt z R2 a ověří velikost a SHA-256. PDF vrací s
`Content-Type: application/pdf`, `Cache-Control: private, no-store` a
Content-Disposition podle inline/download varianty. Nevytváří veřejné URL ani
přesměrování na AWS S3.

Loga a přílohy využívají `R2ObjectStorage`; přílohy zachovávají kontrolu MIME,
signatury, velikosti, SHA-256 a oprávnění. Mazání přílohy maže objekt z bucketu
`FILES`, nikoli historické PDF z `DOCUMENTS`.

## Atomicita a souběh

Vystavení rezervuje číslo a snapshot v prvním atomickém D1 batchi. Generování
PDF a upload probíhají mimo DB transakci. Druhý batch znovu ověří membership,
stav a revizi konceptu, vloží metadata PDF a vystaví fakturu. Odložené cizí
klíče vyžadují konzistentní finální stav faktury a dokumentu při commitu.

Při selhání uploadu nevznikne vystavená faktura. Při selhání finálního DB zápisu
může zůstat nepřiřazený objekt a mezera v číselné řadě; objekt se automaticky
nemaže. Triggery chrání vystavený obsah, položky a metadata PDF.

## Přechod ze starého úložiště

Aktuální migrace předpokládá prázdná úložiště. Exportér PostgreSQL → D1 odmítne
existující dokumenty, přílohy i logo reference. Pokud se předpoklad změní,
nejprve doplňte přenos bajtů a ověřenou mapu klíčů. Samotná změna provideru v DB
není migrací souborů.

Staré implementace local/S3 zůstávají jako referenční kód pro případný budoucí
přenos; produkční factory je nevybírá a při nedostupném R2 na ně nepřepíná.
Nastavení a provozní kroky viz
[CLOUDFLARE_MIGRATION.md](CLOUDFLARE_MIGRATION.md).
