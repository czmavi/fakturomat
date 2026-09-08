# Fakturomat

Interní webová aplikace pro správu faktur, nákladových dokladů a bankovních
transakcí více nezávislých subjektů. Projekt používá Deno, Fresh 2, Preact,
TypeScript v strict režimu a PostgreSQL přes `postgres.js`.

Aktuálně jsou dokončené etapy 1 až 4: aplikační bootstrap, migrace, interní
přihlášení, organizace, tenant scope, nastavení subjektu, bankovní účty a
oddělené knihovny kontaktů.

## Lokální spuštění

Požadavky: Deno 2.9+ a PostgreSQL. Vývojovou databázi lze spustit přes Docker:

```sh
docker compose up -d postgres
cp .env.example .env
deno install
deno task db:migrate
deno task user:create
deno task dev
```

Před `user:create` změňte v `.env` e-mail, jméno a zejména bootstrap heslo.
Heslo musí mít alespoň 12 znaků. Po vytvoření uživatele proměnnou
`FAKTUROMAT_ADMIN_PASSWORD` z `.env` odstraňte. Aplikace je dostupná na adrese,
kterou vypíše Vite (standardně `http://localhost:5173`).

Pro produkční sestavení:

```sh
deno task build
deno task start
```

Migrace spouštějte před startem každé nové verze samostatným příkazem
`deno task db:migrate`. Migrační runner používá PostgreSQL advisory lock, takže
je bezpečný i při souběžném spuštění více instancí.

## Proměnné prostředí

- `DATABASE_URL` – povinný PostgreSQL connection string.
- `DATABASE_MAX_CONNECTIONS` – velikost connection poolu, výchozí hodnota `10`.
- `APP_ENV` – `development`, `test` nebo `production`; v produkci přidává
  session a CSRF cookies atribut `Secure`.
- `FAKTUROMAT_ADMIN_EMAIL`, `FAKTUROMAT_ADMIN_NAME` a
  `FAKTUROMAT_ADMIN_PASSWORD` – pouze pro jednorázový příkaz `user:create`.
- `TEST_DATABASE_URL` – volitelná izolovaná PostgreSQL databáze pro integrační
  testy. Bez ní se DB integrační test korektně přeskočí.
- `STORAGE_LOCAL_ROOT` – kořen lokální implementace object storage, výchozí
  hodnota `./data/storage`. Produkční storage lze později vyměnit za jinou
  implementaci stejného rozhraní.

## Vývojové kontroly

```sh
deno task check
deno task test
deno task build
```

`check` spouští formatter check, lint a type check. Integrační testy ověřují
přihlášení, revokaci session, izolaci organizací a celý lifecycle kontaktu.
Vytvořená testovací data po sobě odstraní.

## Architektura

- `routes/` – SSR stránky a HTTP handlery;
- `domain/` – doménové typy a bezpečné primitivy;
- `services/` – auth, session, cookies a CSRF orchestrace;
- `repositories/` – parametrizované databázové dotazy;
- `database/` – PostgreSQL klient a migrační runner;
- `migrations/` – neměnné, verzované SQL migrace;
- `scripts/` – provozní CLI příkazy.

Hesla jsou ukládána pomocí PBKDF2-HMAC-SHA-256 s náhodnou solí a 600 000
iteracemi. V databázi se ukládá pouze SHA-256 hash náhodného session tokenu.
Session má fixní životnost sedm dní a lze ji serverově revokovat. Změnové HTTP
požadavky chrání kontrola originu i double-submit CSRF token.

Business routes používají explicitní scope `/o/:organizationId/...`. Scope
middleware přijme organizaci pouze tehdy, když dotaz současně odpovídá jejímu ID
a membership aktuálního uživatele. Cizí i neplatné ID skončí odpovědí 404.

Logo není uloženo v PostgreSQL. Databáze obsahuje pouze náhodný storage key a
MIME typ. Lokální implementace zapisuje soubory atomicky, odmítá traversal key a
upload přijímá pouze PNG, JPEG nebo WebP do velikosti 2 MB s kontrolou signatury
souboru.

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

## Známá omezení etap 1–4

- Zatím není UI pro změnu nebo obnovu hesla; uživatel se zakládá přes CLI.
- Není implementováno omezení počtu chybných přihlášení ani externí identity
  provider.
- Auth integrační test vyžaduje explicitní `TEST_DATABASE_URL`.
- Pozvání dalších uživatelů a správa memberships zatím nemají UI.
- Výchozí fakturační šablona bude dostupná po implementaci globálních šablon.
- Bankovní účty zatím nemají API napojení; lze je však používat jako manuální
  fakturační údaje. Fio integrace přijde v pozdější etapě.
- Kontakty lze archivovat, ale jejich obnovení z archivu zatím není součástí
  požadovaného workflow.

## Backlog pro v2

- volitelné vícefaktorové přihlášení;
- audit přihlášení a správa aktivních sessions;
- bezpečné obnovení hesla;
- rate limiting sdílený mezi více instancemi;
- externí SSO/OIDC pro případ budoucího rozšíření mimo interní provoz.
