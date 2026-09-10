# Backlog pro v2

Tento seznam odděluje dokončený rozsah v1 od možného dalšího vývoje. Položky
nejsou příslibem implementace; před zahájením je potřeba znovu určit prioritu,
rozsah a bezpečnostní dopady.

## P0 — provoz a bezpečnost

- **Rate limiting v aplikaci nebo sdíleném úložišti:** ochrana přihlášení nesmí
  při více instancích záviset pouze na paměti jednoho procesu. Do té doby je
  povinný limit na reverzní proxy.
- **Změna a obnova hesla:** bezpečný tok s jednorázovým časově omezeným tokenem,
  revokací ostatních sessions a auditní stopou.
- **Správa aktivních sessions:** seznam zařízení, poslední aktivita, revokace
  jedné nebo všech sessions.
- **MFA:** alespoň TOTP s recovery kódy a potvrzením citlivých změn.
- **Auditní log:** přihlášení, změny membership, nastavení subjektu, vystavení a
  zrušení faktury, změny bankovního připojení, synchronizace a párování.
- **Role pro globální šablony:** změnu šablon omezit na instalačního
  administrátora; dnes je může spravovat každý přihlášený uživatel.
- **Health/readiness endpointy a strukturované logy:** zvlášť dostupnost
  procesu, databáze, storage a Chromium bez zveřejnění citlivých detailů.

## P1 — správa uživatelů a organizací

- UI pro pozvání uživatele, přijetí pozvánky a odebrání membership.
- Jednoduché role `OWNER` a `MEMBER` v UI včetně pravidla, že organizace nesmí
  přijít o posledního vlastníka.
- Přenos vlastnictví subjektu s opětovným ověřením identity.
- Kopírování kontaktu do jiného subjektu jako explicitní vytvoření nové kopie,
  bez skrytého sdílení budoucích změn.
- Obnovení archivovaného kontaktu a lepší správa duplicit.

## P1 — provozní odolnost

- S3-kompatibilní implementace object storage se server-side encryption,
  verzováním a lifecycle pravidly.
- Nástroj pro kontrolu osiřelých objektů a rozdílů mezi databázovými metadaty a
  storage.
- Antivirová kontrola uploadů a karanténa před zpřístupněním souboru.
- Automatizovaný, pravidelně ověřovaný backup/restore proces pro databázi,
  storage a šifrovací klíč.
- Metriky, alerting a tracing pro HTTP, PostgreSQL, PDF renderer a Fio sync.
- Dokumentovaný postup rotace Fio šifrovacího klíče s přešifrováním credentials.

## P1 — bankovnictví a párování

- Plánovaná Fio synchronizace přes samostatný worker s distribuovaným lockem,
  retry politikou, exponenciálním backoffem a auditním výsledkem každého běhu.
- Přehlednější UX částečných plateb a rozdělení jednoho pohybu mezi více
  dokladů.
- Hromadná kontrola navržených shod bez oslabení současných deterministických
  pravidel.
- Export nespárovaných pohybů a ruční označení položky jako zkontrolované.
- Bezpečné opětovné zadání nebo odpojení expirovaného Fio tokenu.

## P2 — fakturace a evidence nákladů

- Workflow storna vydané faktury s důvodem, auditní stopou a jasným dopadem na
  existující platby; historický dokument musí zůstat neměnný.
- Dobropisy a vazba na původní doklad po samostatném doménovém návrhu.
- Odeslání PDF e-mailem přes vyměnitelný provider, frontu a audit doručení.
- Export faktur, nákladů a plateb do CSV nebo standardizovaného výměnného
  formátu.
- Vlastní dashboardové pohledy a export agregací bez označení za účetní nebo
  daňový výsledek.
- Přístupnější a mobilně pohodlnější práce s dlouhými seznamy a párováním.

## Vyžaduje samostatné rozhodnutí o rozsahu

Následující témata byla z v1 výslovně vynechána. Nezačínat je jako drobné
rozšíření existujících formulářů; každé potřebuje samostatnou analýzu datového
modelu, legislativních očekávání a migrace:

- DPH na vydaných fakturách;
- reverse-charge a OSS workflow;
- recurring invoices;
- OCR nebo automatické vytěžování přijatých dokladů;
- další bankovní integrace, například KB nebo PSD2;
- složitější RBAC nebo externí SSO/OIDC.

## Trvale mimo zamýšlený produkt

Fakturomat nemá být účetní software. Bez nového produktového rozhodnutí zůstává
mimo rozsah:

- podvojné účetnictví, hlavní kniha, rozvaha a účetní závěrka;
- přiznání k DPH, kontrolní hlášení a automatické daňové výpočty;
- skladové hospodářství;
- vytváření nebo odesílání platebních příkazů.

Při výběru další položky preferujte malý vertikální řez s migrací, tenantově
scopovaným repository, business službou, SSR workflow a integračním testem.
