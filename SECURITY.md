# Bezpečnostní model

Tento dokument shrnuje audit po etapě 18. Fakturomat je interní více-tenantová
aplikace; není určený k veřejné registraci ani jako účetní systém.

## Hranice důvěry

- Uživatel, session a membership jsou jediným zdrojem aplikační autorizace.
- Každý business objekt se načítá a mění současně podle `organization_id` a
  oprávnění aktuálního uživatele.
- PostgreSQL, aplikační proces, šifrovací klíč a object storage musí běžet v
  důvěryhodné infrastruktuře s omezeným administrátorským přístupem.
- Fio integrace je read-only. Aplikace neobsahuje odesílání platebních příkazů.

## Implementované kontroly

### Přihlášení a sessions

- Účty, přihlašování, cookies a sessions spravuje Better Auth. Nová hesla
  používají jeho `scrypt`; migrované PBKDF2 hashe se ověřují pouze kvůli
  zachování přístupu stávajících uživatelů.
- Session cookie obsahuje Better Authem podepsaný neprůhledný identifikátor;
  serverovou session lze jednotlivě revokovat.
- Session má pevnou sedmidenní platnost, lze ji revokovat a deaktivovaný účet ji
  nemůže použít.
- Session cookie je `HttpOnly`, `SameSite=Lax` a v produkci `Secure`.
- Změnové formuláře chrání kontrola originu i token v `SameSite=Strict` cookie.

### Tenant isolation a databáze

- Business URL mají explicitní scope `/o/:organizationId/...`.
- Middleware a repository dotazy ověřují membership; cizí objekt vracejí jako
  nenalezený.
- Složené cizí klíče brání vazbám mezi objekty různých organizací.
- Parametry uživatele se do SQL předávají parametrizovaně. Použití `unsafe` je
  omezené na statické sloupce a placeholdery s odděleným polem parametrů.
- Databázové triggery chrání obsah vystavených faktur, jejich položky a PDF,
  importované bankovní pohyby, metadata příloh a verze šablon.
- Triggery plateb kontrolují organization scope, směr pohybu, měnu a součet
  alokací vůči bankovní transakci i cílovému dokladu.

### PDF, šablony a HTTP

- Preact standardně escapuje uživatelské hodnoty v SSR stránkách.
- Fakturační renderer kreslí přes `pdf-lib` pouze data z explicitního view
  modelu. Neinterpretuje HTML, nespouští JavaScript ani nenačítá síťové zdroje.
- Z verzované šablony používá jen barvy `--pdf-primary` a `--pdf-accent` ve
  formátu šestiznakového HEX. Uložené HTML je zachováno pouze kvůli
  kompatibilitě a není součástí renderovací cesty.
- Preview vrací stejný typ PDF jako vystavení a je dostupné jen členům subjektu.
- Dynamické odpovědi dostávají CSP, zákaz MIME sniffingu, `no-referrer`, COOP,
  CORP, Permissions Policy a zákaz framingu. Produkce přidává HSTS.
- Citlivé PDF, QR, loga a přílohy používají
  `Cache-Control: private,
  no-store`. Přílohy a dokumenty mají vlastní
  přísnější sandbox CSP.

### Secrets a soubory

- Fio token se validuje, šifruje AES-256-GCM s náhodným IV a identitou
  organizace, účtu a provideru jako authenticated associated data.
- Token se nevrací ve veřejném modelu, nevkládá do HTML a chyby provideru jej
  nezahrnují.
- Uploady mají velikostní limit, allowlist MIME typů a kontrolu binární
  signatury. Storage keys jsou náhodné a chráněné proti path traversal.
- Při čtení PDF a příloh se ověřuje uložená velikost a SHA-256.
- Požadavky s deklarovanou velikostí nad 21 MiB se odmítnou ještě před
  parsováním formuláře.

## Zbytková rizika a provozní požadavky

- Better Auth omezuje frekvenci auth endpointů v paměti instance. Reverzní proxy
  musí navíc omezit počet pokusů napříč instancemi a nastavit absolutní limit
  těla i pro chunked přenos.
- Chybí vícefaktorové přihlášení, obnova hesla, správa aktivních sessions a
  bezpečnostní audit log.
- Globální šablony jsou databázově neměnné; změna uživatele vytvoří tenantovou
  kopii viditelnou pouze členům příslušného subjektu.
- Uploady nemají antivirovou kontrolu ani sandbox analýzu obsahu.
- Lokální object storage spoléhá na oprávnění a šifrování hostitelského disku;
  produkční zálohy a alternativní storage musí zajistit provozovatel.
- TLS musí ukončovat důvěryhodná reverzní proxy. `APP_ENV=production` je nutný
  pro `Secure` cookies a HSTS.

Bezpečnostní incident, podezření na únik šifrovacího klíče nebo kompromitaci
databáze vyžaduje výměnu Fio tokenů; samotná rotace klíče existující ciphertexty
nepřešifruje.
