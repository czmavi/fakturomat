# PDF faktur: local filesystem a AWS S3

Bez `S3_BUCKET` používá aplikace `LocalDocumentStorage` s cestou
`LOCAL_STORAGE_PATH` (výchozí `./data/documents`). S `S3_BUCKET` používá
`S3DocumentStorage`, region se bere z `S3_REGION`, potom `AWS_REGION`. Start
vypíše pouze `Document storage: local` nebo `Document storage: s3`. Pokud je S3
nakonfigurované, chyba credentials, regionu, dostupnosti nebo kontroly
privátního bucketu zastaví start. K tichému fallbacku na disk nedochází.

AWS SDK v3 dostává pouze `new S3Client({ region })`. Standardní credential
provider chain podporuje env credentials, shared profiles, IAM role a
[Deno Deploy Cloud Connection](https://docs.deno.com/deploy/reference/cloud_connections/).
Neukládáme ani ručně nekopírujeme krátkodobé credentials do klienta.

## Upgrade existující instalace

1. Zálohujte DB i soubory a během upgradu zastavte vystavování faktur.
2. Nastavte `LOCAL_STORAGE_PATH` na původní root, kde už PDF leží, typicky
   `./data/storage` nebo hodnotu dosavadního `STORAGE_LOCAL_ROOT`. Původní klíče
   `organizations/.../invoices/...` zůstávají platné. Alternativně překopírujte
   soubory se zachováním relativních cest do nového rootu.
3. Spusťte `deno task db:migrate`. Migrace `0019_invoice_document_storage.sql`
   přidá `storage_provider` a nullable `etag`, staré řádky označí jako `local` a
   odloží validační trigger nového dokumentu na COMMIT. Ochrana proti změně nebo
   smazání metadat zůstává zachována.
4. Ověřte stažení známého historického PDF. Zapnutí S3 přesouvá pouze **nové**
   uploady. Staré lokální dokumenty vyžadují dostupný původní disk i po zapnutí
   S3; jejich čtení podle DB provideru není fallback při chybě S3.

Migrace souborů mezi providery není automatická. S3 dokumenty vždy vyžadují
nakonfigurovaný původní bucket; samotná změna regionu/bucketu nepřesouvá
objekty. Loga a přílohy nákladů nadále používají `STORAGE_LOCAL_ROOT` a původní
rozhraní `ObjectStorage`. Pro jejich provoz na Deno Deploy je třeba samostatně
zajistit persistentní úložiště; tato změna pokrývá PDF faktur.

## Lokální test bez AWS

Předpoklad: nakonfigurovaná `.env` podle `.env.example`, běžící PostgreSQL a
účet v aplikaci (základní setup viz README).

```sh
deno task db:migrate
S3_BUCKET= LOCAL_STORAGE_PATH=./data/documents deno task --env-file=.env dev
```

Prázdná shellová hodnota přepíše případné `S3_BUCKET` z `.env`. Pro trvalé
lokální nastavení odstraňte `S3_BUCKET` z `.env` i prostředí. Při upgradu
použijte původní root podle předchozí sekce.

Přihlaste se, založte koncept s bankovním účtem a položkou a vystavte jej.
Ověřte soubor `data/documents/invoices/<organizationId>/<invoiceId>/<UUID>.pdf`.
Tlačítko PDF používá stávající chráněný endpoint
`/o/<organizationId>/invoices/<invoiceId>/document.pdf`: odpověď je HTTP 200,
`application/pdf`, `inline` a `Cache-Control: private, no-store`. Varianta
`?download=1` vrací `attachment`. Odhlášený uživatel ani člen jiného subjektu k
souboru přístup nedostane. Adresář není veřejná static cesta.

## Lokální test proti skutečnému AWS S3

1. V AWS vytvořte dedikovaný **privátní** bucket v `eu-central-1`. Zapněte
   všechny čtyři přepínače bucket **Block Public Access**. Doporučené Object
   Ownership je **Bucket owner enforced** (ACL vypnuté). Žádný veřejný bucket
   policy ani ACL.
2. Profilu/roli aplikace přidělte následující IAM policy; nahraďte
   `BUCKET_NAME`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:ListBucket", "s3:GetBucketPublicAccessBlock"],
         "Resource": "arn:aws:s3:::BUCKET_NAME"
       },
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject"],
         "Resource": "arn:aws:s3:::BUCKET_NAME/invoices/*"
       }
     ]
   }
   ```

   `ListBucket` slouží k `HeadBucket` při startu. Kontrola privátnosti vyžaduje
   `GetBucketPublicAccessBlock` a všechny čtyři bucket přepínače i při zapnutém
   account-wide bloku. Aplikace nepotřebuje `DeleteObject` ani `PutObjectAcl`.
   Při SSE-KMS doplňte podle použitého klíče KMS oprávnění pro upload i čtení.
3. Nastavte AWS shared profile přes `aws configure --profile fakturomat-dev`
   (nebo existující SSO profil). Alternativně exportujte standardní
   `AWS_ACCESS_KEY_ID` a `AWS_SECRET_ACCESS_KEY`, pro dočasné credentials také
   `AWS_SESSION_TOKEN`. Nevkládejte je do repozitáře.
4. Spusťte aplikaci:

   ```sh
   deno task db:migrate
   AWS_PROFILE=fakturomat-dev S3_BUCKET=BUCKET_NAME S3_REGION=eu-central-1 deno task --env-file=.env dev
   ```

5. Ověřte `Document storage: s3`, vystavte novou fakturu a v bucketu ověřte
   `invoices/<organizationId>/<invoiceId>/<documentId>.pdf` s
   `Content-Type: application/pdf`. V `invoice_documents` musí být `s3`, klíč,
   SHA-256, velikost a případné ETag; žádná URL ani credentials.
6. Klikněte na PDF. V browser Network ověřte HTTP 302 z chráněného endpointu a
   následný download ze S3. Signed URL obsahuje `X-Amz-Expires=300`; může
   vypršet i dříve s expirací dočasných credentials. Response je PDF s názvem
   faktury, inline, případně attachment pro `?download=1`. URL nepublikujte ani
   nelogujte.
7. Ověřte odmítnutí bez přihlášení a z jiné organizace. Při chybném bucketu nebo
   neplatných credentials musí nový start skončit konfigurační chybou a nesmí
   vytvořit lokální náhradu PDF.

## Deno Deploy

Nakonfigurujte AWS Cloud Connection s rolí a oprávněními uvedenými výše, potom
nastavte `S3_BUCKET` a `S3_REGION` (nebo `AWS_REGION`). Statické AWS access keys
nejsou potřeba. Standardní SDK provider chain získává a obnovuje credentials.
Postup vychází z
[oficiální dokumentace Deno](https://docs.deno.com/deploy/reference/cloud_connections/).

## Atomicita a ověření

Krátká přípravná transakce rezervuje unikátní číslo a snapshot. Poté proběhne
generování PDF, SHA-256, UUID a immutable upload. Teprve další transakce vloží
metadata dokumentu, označí fakturu `ISSUED` a provede COMMIT. Před zápisem znovu
ověří membership, stav konceptu a jeho PostgreSQL revision; souběžná editace
nebo vystavení zabrání uložení neaktuálního PDF. Rezervované číslo se nevrací,
proto neúspěšný pokus může nechat mezeru v číselné řadě.

Selhání uploadu nevytvoří metadata ani vystavenou fakturu. Po úspěšném uploadu a
neúspěšném dokončení DB se zapíše warning s providerem, klíčem a ID dokumentu.
Objekt se automaticky nemaže. S3 používá podmíněný upload `If-None-Match: *`,
lokální úložiště atomické zveřejnění bez přepsání existujícího souboru.

```sh
deno fmt
deno lint
deno check
# Použijte izolovanou testovací DB; testy ji migrují a zapisují do ní.
TEST_DATABASE_URL=postgres://USER:PASSWORD@localhost:PORT/fakturomat_test deno test -A
```

AWS volání jsou v testech mockovaná. DB testy pokrývají uložení metadat,
organization scope skutečného PDF endpointu, odmítnutí před podpisem URL, chybu
uploadu, souběžnou editaci a warning bez mazání při selhání DB transakce. Bez
`TEST_DATABASE_URL` se integrační testy přeskočí.
