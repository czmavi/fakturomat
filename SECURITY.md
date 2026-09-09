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

- Hesla používají PBKDF2-HMAC-SHA-256, náhodnou sůl a 600 000 iterací.
- V databázi je pouze SHA-256 hash náhodného 256bitového session tokenu.
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

### HTML, šablony a HTTP

- Preact standardně escapuje uživatelské hodnoty v SSR stránkách.
- Fakturační renderer pracuje pouze s explicitním view modelem a každou skalární
  hodnotu escapuje.
- Editovatelné šablony používají allowlist bezpečných HTML elementů, nepovolují
  JavaScript, inline atribut `style`, zdrojové atributy ani CSS konstrukce pro
  síťový či lokální přístup.
- Preview běží v sandboxovaném iframe. Vykreslený HTML dokument má navíc vlastní
  CSP použitou také při generování PDF.
- Dynamické odpovědi dostávají CSP, zákaz MIME sniffingu, `no-referrer`, COOP,
  CORP, Permissions Policy a zákaz framingu. Produkce přidává HSTS.
- Citlivé HTML, PDF, QR, loga a přílohy používají
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

- Aplikace zatím nemá rate limiting přihlášení. Reverzní proxy musí omezit počet
  pokusů a současně nastavit absolutní limit těla i pro chunked přenos.
- Chybí vícefaktorové přihlášení, obnova hesla, správa aktivních sessions a
  bezpečnostní audit log.
- Globální šablony může spravovat každý přihlášený uživatel.
- Uploady nemají antivirovou kontrolu ani sandbox analýzu obsahu.
- Lokální object storage spoléhá na oprávnění a šifrování hostitelského disku;
  produkční zálohy a alternativní storage musí zajistit provozovatel.
- TLS musí ukončovat důvěryhodná reverzní proxy. `APP_ENV=production` je nutný
  pro `Secure` cookies a HSTS.

Bezpečnostní incident, podezření na únik šifrovacího klíče nebo kompromitaci
databáze vyžaduje výměnu Fio tokenů; samotná rotace klíče existující ciphertexty
nepřešifruje.
