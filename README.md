# Fakturomat

Interní webová aplikace pro správu faktur, nákladových dokladů a bankovních
transakcí více nezávislých subjektů. Projekt používá Deno, Fresh 2, Preact,
TypeScript v strict režimu a Cloudflare Workers. Celá databáze včetně Better
Auth běží v D1 (SQLite); PDF, loga a přílohy jsou v privátním R2.

Verze v1 je dokončena včetně všech etap 1 až 20: aplikační bootstrap, migrace,
interní přihlášení, organizace, tenant scope, nastavení subjektu, bankovní účty
a oddělené knihovny kontaktů. Součástí jsou také neměnné globální fakturační
šablony s izolovanými kopiemi subjektů a editovatelné koncepty faktur bez DPH.
Každý subjekt má vlastní číselné řady s bezpečným ročním čítačem. Koncept lze
atomicky vystavit; tím získá definitivní číslo a neměnné snapshoty fakturačních
údajů. Vystavená faktura obsahuje lokálně generovanou QR Platbu ve formátu SPAYD
a neměnné PDF. Základní evidence nákladů podporuje přijaté faktury, účtenky a
ostatní výdaje, vlastní kategorie a filtrování. Doklady mohou mít libovolný
počet evidenčních řádků DPH s ručně zadanou desetinnou sazbou, základem a
částkou daně. K nákladu lze nahrát, zobrazit, stáhnout a odstranit PDF, JPEG
nebo PNG přílohy. K bankovnímu účtu lze bezpečně uložit read-only Fio API token;
aplikace má obecné provider rozhraní a klienta pro načtení pohybů z Fio API.
Bankovní sekce podporuje ruční synchronizaci zvoleného období, idempotentní
uložení transakcí, aktuální známý zůstatek a filtrování pohybů. Příchozí platby
se při jednoznačné shodě automaticky párují s fakturami; nejednoznačné případy
lze přiřadit ručně nebo již vytvořené párování zrušit. Odchozí pohyby lze ručně
alokovat na náklady; aplikace hlídá měnu a nepřekročí zbývající částku pohybu
ani dokladu. Organizační dashboard zobrazuje zůstatky připojených účtů, vydané a
neuhrazené faktury, faktury po splatnosti, příjmy, evidované náklady, cashflow a
nespárované bankovní pohyby. Přehled lze filtrovat na tento či minulý měsíc,
aktuální rok nebo vlastní období. Bezpečnostní audit navíc zpevnil HTTP hlavičky
a privátní caching, sandbox šablon, limity požadavků a databázovou integritu
historických i párovacích dat.

## Lokální spuštění

Požadavkem je Deno 2.9+. Lokální D1 a R2 zajišťuje Cloudflare emulátor:

```sh
deno install --frozen-lockfile
cp .dev.vars.example .dev.vars
deno task migrate:local
deno task user:create --output /tmp/fakturomat-user.sql
deno run -A npm:wrangler d1 execute DB --local --file /tmp/fakturomat-user.sql
deno task dev
```

Před vytvořením uživatele nastavte v `.dev.vars` vlastní bootstrap heslo,
`BETTER_AUTH_SECRET` a stabilní 32bajtový Base64
`BANK_CREDENTIALS_ENCRYPTION_KEY`. Po importu uživatele SQL soubor i bootstrap
heslo odstraňte. Aplikace standardně běží na `http://localhost:5173`.

## Nasazení a přenos dat

[Cloudflare migrační návod](CLOUDFLARE_MIGRATION.md) obsahuje založení Workers,
D1 a R2, nastavení secrets, přenos PostgreSQL dat, ověření a rollback.
`deno task data:export --output /secure/path/fakturomat.import.sql` připraví
ověřený SQL import ze zdroje v `SOURCE_DATABASE_URL`. Export vyžaduje stav bez
souborů a zapisuje pouze do nového lokálního souboru, nikoli do zdrojové DB.

Pro nový Worker nastavte bindingy `DB`, `DOCUMENTS`, `FILES`, veřejný origin
`BETTER_AUTH_URL`, `APP_ENV=production` a secrets uvedené výše. Import
nákladových PDF navíc používá `OPENAI_API_KEY` a případně
`OPENAI_EXPENSE_MODEL`.

```sh
deno task build
deno run -A npm:wrangler deploy
```

## Vývojové kontroly

```sh
deno task check
deno task test
deno task test:startup
```

Testy D1 používají izolovanou SQLite databázi a nevyžadují `TEST_DATABASE_URL`.
Pokrývají přihlášení, tenant scope, vystavení PDF, integritu, párování plateb,
rollback, opakování při konfliktu a převod dat. Startup test používá skutečný
workerd s lokální D1 a R2. Historické PostgreSQL integrační scénáře jsou
archivované v `tests/legacy_postgres/` a nejsou součástí aktivní sady.

## Architektura

- `routes/` – SSR stránky a HTTP handlery;
- `domain/` – doménové typy a bezpečné primitivy;
- `services/` – integrace Better Auth, cookies a CSRF orchestrace;
- `services/banking/` – šifrování přihlašovacích údajů a provider integrace;
- `repositories/` – parametrizované databázové dotazy;
- `database/` – D1 SQL klient, atomické plány zápisů a převod částek;
- `migrations/d1/` – SQLite schéma a integritní triggery;
- `migrations/*.sql` – historické PostgreSQL migrace;
- `scripts/` – provozní CLI příkazy.

## Dokumentace

- [DEPLOYMENT.md](DEPLOYMENT.md) – produkční konfigurace, release postup,
  reverzní proxy, zálohy, obnova, monitoring a bezpečnostní checklist;
- [SECURITY.md](SECURITY.md) – hranice důvěry, implementované kontroly a
  zbytková rizika;
- [BACKLOG.md](BACKLOG.md) – samostatně prioritizované kandidáty pro v2 a trvalé
  produktové non-goals.

Přihlášení, účty, cookies a sessions spravuje Better Auth. Nová hesla používají
jeho výchozí `scrypt`; účty migrované z původní implementace mohou do změny
hesla dál používat původní PBKDF2 hash. Session má fixní životnost sedm dní a
lze ji serverově revokovat. Změnové HTTP požadavky chrání kontrola originu i
double-submit CSRF token.

Business routes používají explicitní scope `/o/:organizationId/...`. Scope
middleware přijme organizaci pouze tehdy, když dotaz současně odpovídá jejímu ID
a membership aktuálního uživatele. Cizí i neplatné ID skončí odpovědí 404.

Logo je uložené v privátním R2; D1 obsahuje pouze náhodný storage key a MIME
typ. Upload přijímá PNG, JPEG nebo WebP do 2 MB s kontrolou signatury a klíče.

Výchozí fakturační šablony jsou globální a pouze pro čtení. První úprava vytvoří
vlastní kopii pro aktivní subjekt a každé další uložení její novou neměnnou
verzi. Kopie nejsou dostupné jiným subjektům. PDF má pevný programový layout;
šablona může pomocí CSS proměnných `--pdf-primary` a `--pdf-accent` měnit jeho
barvy. Uložené HTML zůstává kvůli kompatibilitě, ale renderer je neinterpretuje.
PDF náhled je dostupný jen členům příslušného subjektu.

Koncept faktury drží živé reference na kontakt, bankovní účet, číselnou řadu a
šablonu. Dokud je ve stavu `DRAFT`, lze měnit jeho hlavičku i položky. Částky se
v TypeScriptu počítají přes `bigint` v nejmenších měnových jednotkách a v D1 se
ukládají jako celé desetitisíciny měny, nikdy jako floating point. Definitivní
číslo, snapshoty a konkrétní verze šablony se doplní společně v jedné databázové
transakci při vystavení. Databázové triggery následně blokují změny obsahu i
položek vystavené faktury.

QR Platba vzniká lokálně bez externího API. Pro český účet bez zadaného IBANu
aplikace IBAN bezpečně odvodí, sestaví kanonický SPAYD payload s částkou, měnou,
variabilním symbolem, splatností a zprávou a vykreslí jej jako SVG pro chráněný
endpoint a jako ostrou vektorovou matici přímo v PDF.

Při vystavení se v krátké transakci rezervuje číslo a připraví snapshot faktury
včetně konkrétní verze šablony. `pdf-lib` vytvoří PDF přímo v procesu, bez
Chromia nebo HTML rendereru. Českou diakritiku zajišťuje vložený DejaVu Sans a
QR matice je součástí dokumentu. `DocumentStorage` uloží PDF mimo DB transakci
pod klíčem `invoices/{organizationId}/{invoiceId}/{documentId}.pdf`. Až po
uploadu další transakce vloží metadata a označí fakturu jako vystavenou; předtím
znovu ověří membership a nezměněný koncept. Selhání ponechá fakturu konceptem.
Rezervované číslo se nevrací, takže neúspěšné pokusy mohou zanechat mezery v
řadě.

`invoice_documents` obsahuje provider, klíč, SHA-256, velikost a volitelné ETag;
nikdy signed URL ani credentials. Triggery chrání neměnnost dokumentu. Pokud
upload uspěje a dokončení v DB selže, aplikace vypíše warning s identifikací
orphaned objektu a nemaže jej.

Endpoint `/o/:organizationId/invoices/:invoiceId/document.pdf` ověří uživatele a
organization scope, načte PDF z R2 a zkontroluje SHA-256 a velikost. Výchozí
zobrazení je inline, `?download=1` použije attachment. Odpovědi se necachují.
Podrobnosti jsou v [DOCUMENT_STORAGE.md](DOCUMENT_STORAGE.md).

Náklady jsou vedené jako jednoduchá interní evidence v tabulkách `expenses` a
`expense_categories`. Kontakt i kategorie jsou volitelné, ale případná vazba je
v databázi vynucena v rámci stejné organizace. Všechny čtecí i změnové dotazy
navíc ověřují membership uživatele. Nový subjekt automaticky dostane sedm
výchozích kategorií; vlastní kategorie lze spravovat a deaktivovat bez ztráty
historických vazeb.

Řádky DPH se ukládají společně s nákladem v jedné transakci. Sazba má až čtyři
desetinná místa a není omezena na přednastavené české hodnoty. Základy, DPH i
celková částka používají přesnou money abstraction. Formulář i detail zobrazují
součty základů a daně; rozdíl oproti celkové částce vyvolá upozornění, ale
neblokuje uložení ručně opsaných hodnot.

Přílohy nákladů používají privátní R2 společně s logy. D1 drží pouze
organization-scoped metadata, původní bezpečně normalizovaný název, MIME typ,
velikost, náhodný storage key a SHA-256. Upload má limit 20 MB a povoluje pouze
PDF, JPEG a PNG po kontrole binární signatury. Zobrazení i stažení před
odesláním kontroluje hash a velikost uloženého objektu; odstranění chrání CSRF
token i tenantový scope.

Bankovní účet a jeho API připojení jsou oddělené modely. Fio token se před
uložením šifruje AES-256-GCM s náhodným IV a s identitou organizace, účtu a
provideru jako authenticated associated data. Server token nikdy nevkládá do
veřejného modelu ani do HTML; prázdné pole při úpravě zachová existující token.
Fio provider používá výhradně read-only endpoint pro pohyby za období. Připojení
lze zapnout, vypnout nebo úplně odstranit.

Ruční synchronizace nejprve načte výpis mimo databázovou transakci. Teprve po
ověření, že měna a dostupná identita účtu odpovídají nakonfigurovanému účtu,
uloží celý výsledek atomicky. Unikátní kombinace provideru, účtu a ID pohybu
zajišťuje idempotenci opakovaného importu. Částky jsou `numeric(19,4)`, původní
provider data zůstávají v `jsonb` a úspěšná synchronizace aktualizuje zůstatek,
datum a stav připojení. Jedna ruční dávka je kvůli předvídatelnosti omezena na
90 dní; starší historii lze načíst po navazujících obdobích.

Párování plateb nepoužívá AI. Automatická vazba vznikne pouze pro jedinou
vystavenou fakturu stejné organizace, pokud přesně odpovídá variabilní symbol,
měna i částka. Dva nebo více kandidátů se automaticky nepřiřadí. Návrhy v UI
jsou deterministicky řazené podle shody variabilního symbolu a zbývající částky.
Samostatná tabulka `invoice_payments` dovoluje více plateb k faktuře i rozdělení
jednoho pohybu mezi více faktur; současné UI alokuje menší ze zbývajících
částek. Vytvoření či odstranění vazby a přepočet stavu faktury proběhnou
atomicky.

Odchozí bankovní pohyby se ručně párují přes samostatnou tabulku
`expense_payments`. Návrhy jsou deterministické podle měny, variabilního symbolu
odvozeného z čísla dodavatelského dokladu a zbývající částky; automatická vazba
se nevytváří. Jedna transakce může být rozdělená mezi více nákladů a jeden
náklad uhrazený více transakcemi. Alokace vždy použije menší ze zbývajících
částek a vzniká i zaniká v databázové transakci. Ručně evidované datum úhrady
nákladu se párováním nemění.

Dashboard používá samostatný read-only repository a všechny agregace omezuje
současně `organization_id` a membership uživatele. Vydané faktury nezahrnují
koncepty ani stornované doklady, neuhrazené částky zohledňují dílčí platby a
náklady používají datum vystavení dokladu, případně datum vytvoření, pokud
vystavení chybí. Příjmy jsou kladné bankovní pohyby a cashflow je čistý součet
všech bankovních pohybů ve zvoleném období. Částky různých měn se nikdy
nesčítají dohromady.

HTTP a databázové závěry etapy 18 jsou popsané v [SECURITY.md](SECURITY.md),
včetně hranic důvěry, implementovaných kontrol, zbytkových rizik a provozních
požadavků na TLS, rate limiting a maximální velikost těla na reverzní proxy.

## Historie PostgreSQL migrací

Následující seznam dokumentuje původní databázi. Nové nasazení používá
`migrations/d1/`; provozní postup je v `CLOUDFLARE_MIGRATION.md`.

- `0001_auth.sql` – tabulky `users` a `sessions`, unikátní a aktivní session
  indexy a integritní constraints.
- `0002_organizations.sql` – tabulky `organizations` a
  `organization_memberships`, role `OWNER`/`MEMBER`, vazby a index pro výpis
  subjektů uživatele.
- `0003_organization_settings_bank_accounts.sql` – fakturační profil subjektu,
  reference na logo a tabulka `bank_accounts` včetně constraintu jediného
  výchozího účtu na subjekt.
- `0004_contacts.sql` – organization-scoped kontakty, archivace a indexy pro
  výpis a hledání.
- `0005_invoice_templates.sql` – globální šablony, neměnné verze, profesionální
  výchozí šablona a její vazba na nastavení subjektu.
- `0006_invoice_drafts_number_sequences.sql` – koncepty a položky faktur,
  organization-scoped číselné řady, roční čítače, přesné částky a integritní
  vazby mezi tenant daty.
- `0007_issue_invoice_snapshots.sql` – audit vystavení a databázová ochrana
  neměnného obsahu a položek vystavených faktur.
- `0008_invoice_documents.sql` – organization-scoped metadata PDF dokumentů,
  kontrolní hash, vazba na fakturu a databázová ochrana neměnnosti.
- `0009_expenses.sql` – základní evidence přijatých faktur, účtenek a ostatních
  nákladů, organization-scoped kategorie, výchozí kategorie a tenantové vazby.
- `0010_expense_vat_lines.sql` – organization-scoped evidenční řádky DPH,
  desetinné sazby, přesné základy a částky daně v pořadí podle dokladu.
- `0011_expense_attachments.sql` – organization-scoped metadata příloh nákladů,
  bezpečné storage keys, kontrolní hash, velikost a MIME constraints.
- `0012_bank_connections.sql` – oddělená Fio připojení bankovních účtů,
  šifrované credentials, stav synchronizace a tenantově bezpečné vazby.
- `0013_bank_transactions.sql` – přesné organization-scoped bankovní pohyby, raw
  provider data, idempotentní unikátní klíč a údaje o posledním zůstatku.
- `0014_invoice_payments.sql` – organization-scoped vazby bankovních pohybů na
  faktury, přesné alokované částky a rozlišení automatické a ruční shody.
- `0015_expense_payments.sql` – organization-scoped vazby odchozích bankovních
  pohybů na náklady a přesné částečné alokace.
- `0016_security_integrity_hardening.sql` – neměnnost bankovních pohybů, příloh
  a verzí šablon, zákaz nulových pohybů a databázová validace platebních
  alokací.
- `0017_organization_invoice_templates.sql` – tenantové kopie fakturačních
  šablon, izolace mezi subjekty a databázová ochrana globálních předloh proti
  změně.
- `0018_better_auth.sql` – převod hesel do Better Auth účtů, doplnění jeho
  uživatelských polí a nahrazení původních sessions tabulkami Better Auth.

## Známá omezení v1

- Zatím není UI pro změnu nebo obnovu hesla; uživatel se zakládá přes CLI.
- Externí identity provider není nakonfigurován. Rate limit Better Auth je v D1.
- Pozvání dalších uživatelů a správa memberships zatím nemají UI.
- Správa instalační knihovny globálních šablon nemá UI; subjekty upravují pouze
  své vlastní kopie.
- Faktury vystavené před nasazením migrace `0008` se automaticky zpětně
  nerenderují; nově vystavené faktury už PDF dostanou vždy.
- Dashboard pracuje s nominálními částkami po jednotlivých měnách; neprovádí
  kurzové přepočty ani účetní či daňové výpočty.
- Kontakty lze archivovat, ale jejich obnovení z archivu zatím není součástí
  požadovaného workflow.
- Kontrola příloh ověřuje velikost, MIME typ, binární signaturu a integritu, ale
  neobsahuje antivirovou kontrolu ani OCR.

## Backlog pro v2

Prioritizovaný seznam provozních, bezpečnostních a produktových pokračování je v
[BACKLOG.md](BACKLOG.md). Účetnictví, daňová podání, sklad a platební příkazy
zůstávají mimo zamýšlený produkt.

Původní migrace `0019_invoice_document_storage.sql` zavedla local/S3 metadata.
Přenos do současné D1/R2 architektury popisuje `CLOUDFLARE_MIGRATION.md`.

## Náklady z PDF faktur

Na stránce **Náklady → Přidat náklad** vyberte PDF (nejvýše 20 MB) a použijte
**Načíst a ověřit fakturu**. Server odešle PDF do OpenAI Responses API se
strukturovaným výstupem, předvyplní dodavatele, číslo dokladu, data, popis,
měnu, celkovou částku a rozpis DPH. Před uložením údaje zkontrolujte a případně
upravte. Původní PDF se uloží jako příloha společně s nákladem.

Na serveru nastavte `OPENAI_API_KEY`; volitelný `OPENAI_EXPENSE_MODEL` má
výchozí hodnotu `gpt-4.1-mini`. Klíč se neposílá do prohlížeče. Integrace
používá
[`input_file`](https://developers.openai.com/api/docs/guides/file-inputs) a
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
`store: false` a timeout 90 sekund.

Odběratel musí mít shodné IČO nebo DIČ s právě vybranou firmou (firmou v URL).
Pokud jsou na obou stranách uvedené oba identifikátory, musí se shodovat oba.
Ignorují se pouze mezery a velikost písmen. Samotný název firmy nestačí. Neshoda
nebo chybějící identifikátory import zastaví. Nejde o kontrolu existence firmy v
registru ARES. Ověření je podepsané, vázané na soubor, firmu a uživatele, platí
jednu hodinu a při uložení se porovnává s aktuálním nastavením firmy. Po chybě
odeslaného formuláře je nutné PDF vybrat a načíst znovu.

Lokální `deno task dev` nejprve vytvoří build a spustí jej ve Wrangleru na portu
5173 se skutečnými lokálními D1/R2 bindingy. Po změně zdrojů příkaz spusťte
znovu; automatické HMR nyní není zapnuté kvůli nekompatibilitě vývojových
runnerů Fresh a Cloudflare Vite pluginu. `deno task start` spustí již existující
build.
