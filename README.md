# Fakturomat

Interní webová aplikace pro správu faktur, nákladových dokladů a bankovních
transakcí více nezávislých subjektů. Projekt používá Deno, Fresh 2, Preact,
TypeScript v strict režimu a PostgreSQL přes `postgres.js`.

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

Požadavky: Deno 2.9+ a PostgreSQL. Vývojovou databázi lze spustit přes Docker:

```sh
docker compose up -d postgres
cp .env.example .env
deno install
deno task migrate:local
deno task user:create
deno task dev
```

Před `user:create` změňte v `.env` e-mail, jméno a zejména bootstrap heslo.
Heslo musí mít alespoň 12 znaků. Po vytvoření uživatele proměnnou
`FAKTUROMAT_ADMIN_PASSWORD` z `.env` odstraňte. Aplikace je dostupná na adrese,
kterou vypíše Vite (standardně `http://localhost:5173`).

Před prvním uložením Fio připojení nastavte v `.env` stálý 32bajtový šifrovací
klíč v Base64, například výstupem `openssl rand -base64 32`. Klíč bezpečně
zálohujte; bez něj uložené tokeny nelze obnovit a jeho změna vyžaduje jejich
nové zadání.

Pro produkční sestavení:

```sh
deno task build
deno task start
```

Migrace spouštějte před startem každé nové verze samostatným příkazem. Migrační
runner používá PostgreSQL advisory lock, takže je bezpečný i při souběžném
spuštění více instancí. Produkční konfigurace, pořadí releasu, reverzní proxy,
zálohy, obnovu a smoke test popisuje [DEPLOYMENT.md](DEPLOYMENT.md).

## Proměnné prostředí

- `DATABASE_URL` – povinný PostgreSQL connection string.
- `DATABASE_MAX_CONNECTIONS` – velikost connection poolu, výchozí hodnota `10`.
- `BETTER_AUTH_URL` – veřejný origin aplikace bez cesty, lokálně například
  `http://localhost:5173`.
- `BETTER_AUTH_SECRET` – náhodný tajný klíč pro podepisování cookies Better
  Auth; vytvořte jej jednou například pomocí `openssl rand -base64 32`.
- `APP_ENV` – `development`, `test` nebo `production`; v produkci přidává
  session a CSRF cookies atribut `Secure`.
- `FAKTUROMAT_ADMIN_EMAIL`, `FAKTUROMAT_ADMIN_NAME` a
  `FAKTUROMAT_ADMIN_PASSWORD` – pouze pro jednorázový příkaz `user:create`.
- `TEST_DATABASE_URL` – volitelná izolovaná PostgreSQL databáze pro integrační
  testy. Bez ní se DB integrační test korektně přeskočí.
- `STORAGE_LOCAL_ROOT` – lokální úložiště log a příloh nákladů, výchozí
  `./data/storage`.
- `LOCAL_STORAGE_PATH` – lokální úložiště PDF faktur, výchozí
  `./data/documents`.
- `S3_BUCKET` – privátní bucket pro PDF faktur. Bez této hodnoty se používá
  disk; s ní je nefunkční S3 konfigurace chybou, nikdy důvodem pro fallback na
  disk.
- `S3_REGION`, případně `AWS_REGION` – region S3, v tomto pořadí. Credentials
  řeší standardní AWS SDK v3 provider chain.
- `BANK_CREDENTIALS_ENCRYPTION_KEY` – povinný 32bajtový Base64 klíč pro
  aplikační AES-256-GCM šifrování bankovních přihlašovacích údajů.

## Vývojové kontroly

```sh
deno task check
deno task test
deno task build
```

Databázové integrační testy spusťte proti samostatné databázi:

```sh
TEST_DATABASE_URL=postgres://fakturomat:fakturomat@127.0.0.1:55433/fakturomat deno task test
```

Testovací URL nikdy nesmí odkazovat na produkční databázi.

`check` spouští formatter check, lint a type check. Integrační testy ověřují
přihlášení, revokaci session, izolaci organizací, celý lifecycle kontaktu a
souběžné vytváření neměnných verzí šablon. Ověřují také vytvoření a úpravu
konceptu, přesnou desetinnou aritmetiku a souběžné vystavení faktur bez
duplicitních čísel. Po změně kontaktu, subjektu, účtu i šablony test znovu ověří
historické snapshoty. Vytvořená testovací data po sobě odstraní. Samostatné
testy kontrolují přesný SPAYD payload, odvození českého IBANu, validaci
platebních údajů a bezpečný SVG výstup. PDF testy ověřují SHA-256 integritu,
neměnnost metadat i bajtů po změně šablony a úplný rollback vystavení při chybě
rendereru. Evidence nákladů je integračně otestovaná včetně vytvoření, načtení a
úpravy, výchozích a vlastních kategorií, kombinovaných filtrů a odmítnutí cizích
kontaktů i kategorií z jiného subjektu. Testy řádků DPH ověřují více sazeb,
vlastní desetinnou sazbu, nulový počet řádků, přesné součty a povolený rozdíl
proti celkové částce. Přílohy jsou otestované od validace skutečné signatury
přes SHA-256 kontrolu až po odmítnutí čtení a odstranění uživatelem bez
membership. Bankovní testy kontrolují AES-GCM vazbu ciphertextu na konkrétní
subjekt a účet, nepropustnost tokenu do veřejného modelu, tenantovou izolaci
databázových dotazů a read-only GET komunikaci i mapování odpovědí Fio API.
Databázový scénář navíc opakuje import stejného výpisu, kontroluje nulové
duplicity, přesné částky, zachované raw JSON a odmítnutí synchronizace
uživatelem bez membership. Párovací scénář ověřuje automatickou přesnou shodu,
odmítnutí nejednoznačné shody, ruční přiřazení, zrušení vazby a odpovídající
přechody faktury mezi stavy `ISSUED` a `PAID`. Samostatný scénář odchozích
pohybů ověřuje částečné úhrady nákladu, omezení poslední alokace zbývající
částkou, zrušení vazby a tenantovou izolaci. Dashboardové integrační kontroly
ověřují oddělené měnové agregace faktur, nákladů a bankovních pohybů, zbývající
částky nezaplacených faktur, splatnost, dostupný zůstatek, nespárované pohyby a
odmítnutí uživatele bez membership. Samostatné testy pokrývají kalendářní
hranice všech přednastavených i vlastních období. Bezpečnostní regresní testy
ověřují CSP a ostatní hlavičky, produkční HSTS, zachování přísnější politiky
downloadů, limit deklarované velikosti požadavku, CSS escape varianty a
databázové odmítnutí změn či přealokovaných plateb. HTTP integrační scénář navíc
prochází skutečné Fresh middleware a formulářové handlery: ověřuje origin i
double-submit CSRF, bezpečné session cookies a jejich revokaci, limit požadavku,
tenantovou odpověď 404 pro čtení i změnu a kompletní tok přijaté faktury od
kontaktu a dvou DPH řádků přes PDF přílohu až po ruční spárování odchozí
bankovní transakce.

## Architektura

- `routes/` – SSR stránky a HTTP handlery;
- `domain/` – doménové typy a bezpečné primitivy;
- `services/` – integrace Better Auth, cookies a CSRF orchestrace;
- `services/banking/` – šifrování přihlašovacích údajů a provider integrace;
- `repositories/` – parametrizované databázové dotazy;
- `database/` – PostgreSQL klient a migrační runner;
- `migrations/` – neměnné, verzované SQL migrace;
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

Logo není uloženo v PostgreSQL. Databáze obsahuje pouze náhodný storage key a
MIME typ. Lokální implementace zapisuje soubory atomicky, odmítá traversal key a
upload přijímá pouze PNG, JPEG nebo WebP do velikosti 2 MB s kontrolou signatury
souboru.

Výchozí fakturační šablony jsou globální a pouze pro čtení. První úprava vytvoří
vlastní kopii pro aktivní subjekt a každé další uložení její novou neměnnou
verzi. Kopie nejsou dostupné jiným subjektům. PDF má pevný programový layout;
šablona může pomocí CSS proměnných `--pdf-primary` a `--pdf-accent` měnit jeho
barvy. Uložené HTML zůstává kvůli kompatibilitě, ale renderer je neinterpretuje.
PDF náhled je dostupný jen členům příslušného subjektu.

Koncept faktury drží živé reference na kontakt, bankovní účet, číselnou řadu a
šablonu. Dokud je ve stavu `DRAFT`, lze měnit jeho hlavičku i položky. Částky se
v TypeScriptu počítají přes `bigint` v nejmenších měnových jednotkách a v
PostgreSQL se ukládají jako `numeric`, nikdy jako floating point. Definitivní
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

Stávající endpoint `/o/:organizationId/invoices/:invoiceId/document.pdf` ověří
uživatele a organization scope. Lokální PDF vrací přímo po kontrole hashe a
velikosti. Pro S3 vrátí HTTP 302 s novým signed URL na 300 sekund, PDF MIME
typem a bezpečným názvem `faktura-<číslo>.pdf`. Výchozí zobrazení je inline,
`?download=1` použije attachment. Odpovědi se necachují. Postup konfigurace, IAM
oprávnění a testování je v [DOCUMENT_STORAGE.md](DOCUMENT_STORAGE.md).

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

Přílohy nákladů používají lokální object storage abstraction společně s logy.
PostgreSQL drží pouze organization-scoped metadata, původní bezpečně
normalizovaný název, MIME typ, velikost, náhodný storage key a SHA-256. Upload
má limit 20 MB a povoluje pouze PDF, JPEG a PNG po kontrole binární signatury.
Zobrazení i stažení před odesláním kontroluje hash a velikost uloženého objektu;
odstranění chrání CSRF token i tenantový scope.

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

## Migrace

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
- Omezení chybných přihlášení v Better Auth je lokální pro jednu aplikační
  instanci; distribuovaný limit musí zajistit reverzní proxy. Externí identity
  provider není nakonfigurován.
- Auth integrační test vyžaduje explicitní `TEST_DATABASE_URL`.
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

Migrace `0019_invoice_document_storage.sql` doplňuje provider/ETag a odkládá
ověření vydané faktury u nového dokumentu na COMMIT. Původní dokumenty zůstávají
lokální; před upgradem nastavte `LOCAL_STORAGE_PATH` na jejich původní storage
root (obvykle `./data/storage`).
