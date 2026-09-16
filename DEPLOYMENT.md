# Nasazení a provoz

Tento runbook popisuje doporučené nasazení Fakturomatu v1 na jeden aplikační
server za reverzní proxy. PDF faktur podporují lokální disk nebo privátní AWS
S3; loga a přílohy nákladů nadále vyžadují lokální persistentní úložiště.
PostgreSQL a všechny soubory musí mít společný plán zálohování.

Konfigurace S3, IAM, Deno Deploy Cloud Connection a přechod existujících PDF
jsou popsané v [DOCUMENT_STORAGE.md](DOCUMENT_STORAGE.md). Podpora S3 v této
změně pokrývá PDF faktur; pro celý provoz s logy a přílohami na Deno Deploy je
nutné zajistit také jejich persistentní úložiště.

## Provozní topologie

Minimální produkční instalace obsahuje:

- jednu nebo více instancí sestavené Fresh aplikace;
- PostgreSQL 17 v privátní síti;
- persistentní adresář pro loga a přílohy; pro PDF privátní S3 nebo persistentní
  disk;
- reverzní proxy s TLS, limitem těla požadavku a rate limitingem přihlášení.

Soubor `compose.yaml` v repozitáři spouští pouze lokální vývojovou databázi.
Používá známé heslo, publikuje port na hostitele a není produkčním deploymentem.

## Požadavky

- Deno 2.9 nebo novější v rámci řady 2.x;
- PostgreSQL 17; vývoj a integrační testy jsou ověřené proti verzi z
  `compose.yaml`;
- HTTPS doména a reverzní proxy;
- zapisovatelný persistentní adresář pro `STORAGE_LOCAL_ROOT`;
- oddělená testovací databáze pro integrační testy.

Provozní uživatel má mít přístup pouze ke kódu aplikace, storage adresáři a
potřebným síťovým cílům. PostgreSQL ani storage nemají být veřejně dostupné.

## Konfigurace

Produkční proměnné ukládejte do správce tajemství nebo do souboru čitelného jen
provozním uživatelem. Soubor `.env` nepatří do verzovacího systému.

| Proměnná                          | Povinnost            | Význam                                                            |
| --------------------------------- | -------------------- | ----------------------------------------------------------------- |
| `APP_ENV`                         | ano                  | V produkci vždy `production`; zapíná `Secure` cookies a HSTS.     |
| `DATABASE_URL`                    | ano                  | PostgreSQL connection string. Heslo musí být produkční tajemství. |
| `DATABASE_MAX_CONNECTIONS`        | ne                   | Velikost poolu jedné instance, výchozí `10`, rozsah 1–100.        |
| `BETTER_AUTH_URL`                 | ano                  | Veřejný HTTPS origin aplikace bez cesty.                          |
| `BETTER_AUTH_SECRET`              | ano                  | Náhodný tajný klíč Better Auth, minimálně 32 znaků.               |
| `STORAGE_LOCAL_ROOT`              | ano pro loga/přílohy | Absolutní cesta na persistentním svazku.                          |
| `LOCAL_STORAGE_PATH`              | při lokálních PDF    | Výchozí `./data/documents`; při upgradu původní root PDF.         |
| `S3_BUCKET`                       | při S3 PDF           | Privátní bucket; nefunkční konfigurace zastaví start.             |
| `S3_REGION`, `AWS_REGION`         | při S3 PDF           | Region; `S3_REGION` má přednost.                                  |
| `BANK_CREDENTIALS_ENCRYPTION_KEY` | ano pro Fio          | Base64 hodnota dekódující se přesně na 32 bajtů.                  |
| `FAKTUROMAT_ADMIN_EMAIL`          | jen bootstrap        | E-mail uživatele zakládaného přes CLI.                            |
| `FAKTUROMAT_ADMIN_NAME`           | jen bootstrap        | Zobrazované jméno zakládaného uživatele.                          |
| `FAKTUROMAT_ADMIN_PASSWORD`       | jen bootstrap        | Heslo o délce alespoň 12 znaků; po použití odstranit.             |
| `TEST_DATABASE_URL`               | jen testy            | Connection string oddělené databáze, kterou mohou testy měnit.    |

Šifrovací klíč vytvořte jednou, například:

```sh
openssl rand -base64 32
```

Klíč bezpečně zazálohujte. Jeho ztráta znemožní načíst uložené Fio tokeny. Pouhá
výměna klíče existující tokeny nepřešifruje; před rotací je nutné připravit
řízené nové zadání všech tokenů.

Příklad produkčního prostředí bez bootstrap údajů:

```dotenv
APP_ENV=production
DATABASE_URL=postgres://fakturomat:strong-password@db.internal:5432/fakturomat
DATABASE_MAX_CONNECTIONS=10
BETTER_AUTH_URL=https://faktury.example.cz
BETTER_AUTH_SECRET=base64-encoded-random-secret
STORAGE_LOCAL_ROOT=/var/lib/fakturomat/storage
BANK_CREDENTIALS_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

## Příprava releasu

Ze stejného commitu, který bude nasazen, spusťte:

```sh
deno install --frozen-lockfile
deno task check
TEST_DATABASE_URL=postgres://test-user:test-password@127.0.0.1:5432/fakturomat_test deno task test
deno task build
```

`TEST_DATABASE_URL` nikdy nesmí ukazovat na produkční databázi. Úspěšný build
vytvoří serverový vstup `_fresh/server.js` a klientské assety v `_fresh/`.

## První nasazení

1. Vytvořte produkční databázi, databázového uživatele a persistentní storage
   adresář.
2. Nainstalujte Deno a závislosti projektu.
3. Nastavte produkční proměnné prostředí.
4. Aplikujte migrace před spuštěním aplikace:

   ```sh
   deno run -A --env-file=/etc/fakturomat.env database/migrate.ts
   ```

5. Sestavte aplikaci:

   ```sh
   deno task build
   ```

6. Jednorázově založte prvního uživatele. Bootstrap heslo poté odstraňte ze
   všech konfiguračních souborů a historie správce tajemství:

   ```sh
   deno run -A --env-file=/etc/fakturomat-bootstrap.env scripts/create_user.ts
   ```

7. Spusťte server. Projektová task poslouchá standardně na `0.0.0.0:8000`:

   ```sh
   deno task start
   ```

Proměnné musí procesu dodat správce služby. `deno task start` samo produkční env
soubor nenačítá.

## Správa procesu

Proces spouštějte pod samostatným neprivilegovaným uživatelem. Minimální systemd
jednotka může vypadat takto; cesty upravte podle instalace:

```ini
[Unit]
Description=Fakturomat
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=fakturomat
Group=fakturomat
WorkingDirectory=/opt/fakturomat/current
EnvironmentFile=/etc/fakturomat.env
ExecStart=/usr/bin/deno task start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Po změně jednotky proveďte `systemctl daemon-reload`, službu spusťte a povolte
její start po rebootu. Ověřte, že její uživatel může zapisovat do
`STORAGE_LOCAL_ROOT`.

## Reverzní proxy

Proxy musí:

- ukončovat TLS a přesměrovat HTTP na HTTPS;
- zachovat původní `Host` a předat `X-Forwarded-For` a `X-Forwarded-Proto`;
- omezit tělo požadavku nejvýše na 21 MiB, včetně chunked přenosu;
- omezit počet požadavků na `/login` podle zdrojové adresy;
- nastavit rozumné connect, read a send timeouty;
- nepřepisovat bezpečnostní hlavičky aplikace slabšími hodnotami.

Příklad základního Nginx upstreamu (TLS certifikáty a `limit_req_zone` patří do
globální konfigurace):

```nginx
upstream fakturomat {
    server 127.0.0.1:8000;
}

server {
    listen 443 ssl;
    server_name faktury.example.cz;
    client_max_body_size 21m;

    location = /login {
        limit_req zone=fakturomat_login burst=10 nodelay;
        proxy_pass http://fakturomat;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://fakturomat;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Například zóna pro přihlášení v `http` bloku může začínat konzervativním limitem
pěti požadavků za minutu:

```nginx
limit_req_zone $binary_remote_addr zone=fakturomat_login:10m rate=5r/m;
```

Limit dolaďte podle reálného provozu a monitorujte odmítnuté požadavky.

## Upgrade

Migrace `0018_better_auth.sql` zachová uživatele i jejich hesla, ale odstraní
původní sessions. Při jejím nasazení proto budou všichni právě přihlášení
uživatelé jednorázově odhlášeni. `BETTER_AUTH_SECRET` musí být před prvním
startem nastavený a při dalších releasech zůstat stejný.

Každý release nasazujte v tomto pořadí:

1. vytvořit konzistentní zálohu databáze, storage a šifrovacího klíče;
2. připravit nový kód a spustit `deno install --frozen-lockfile`;
3. spustit `deno task check`, testy proti testovací databázi a
   `deno task build`;
4. krátce zastavit zápisy nebo celou aplikační službu;
5. aplikovat `database/migrate.ts` s produkční konfigurací;
6. přepnout na nový build a restartovat službu;
7. provést smoke test a sledovat aplikační i proxy logy.

Migrační runner používá PostgreSQL advisory lock a každou dávku provádí v
transakci. Down migrace nejsou implementované. Návrat na starší kód je bezpečný
jen tehdy, pokud rozumí již aplikovanému schématu; jinak je nutné obnovit
předmigrační zálohu databáze i odpovídající storage.

## Smoke test po nasazení

Ověřte minimálně:

1. `/login` vrací HTML přes HTTPS a odpověď obsahuje CSP, HSTS a
   `X-Content-Type-Options: nosniff`;
2. přihlášení vytvoří cookie `HttpOnly; Secure; SameSite=Lax`;
3. přepnutí mezi dvěma organizacemi nezobrazí data druhého subjektu;
4. dashboard, kontakty, faktury, náklady, bankovnictví a nastavení lze načíst;
5. existující známé PDF faktury lze stáhnout a otevřít;
6. existující známou přílohu nákladu lze stáhnout a otevřít;
7. Fio synchronizace funguje pouze na účtu s platným read-only tokenem;
8. opakovaná synchronizace nevytvoří duplicitní pohyby.

Mutující end-to-end kontrolu vytvoření a vystavení faktury provádějte ve staging
prostředí. Vystavené faktury a jejich dokumenty jsou záměrně neměnné a produkční
smoke test je nemá vytvářet jako dočasná data.

## Zálohy a obnova

Úplná záloha se skládá ze tří neoddělitelných částí:

1. PostgreSQL dump;
2. obsah adresářů `STORAGE_LOCAL_ROOT`, `LOCAL_STORAGE_PATH` a případně S3
   bucketu;
3. `BANK_CREDENTIALS_ENCRYPTION_KEY` uložený odděleně a šifrovaně.

Databáze obsahuje metadata a SHA-256 souborů, zatímco jejich bajty jsou ve
storage. Pro konzistentní zálohu zastavte aplikační zápisy, vytvořte databázový
dump i snapshot storage a teprve potom zápisy obnovte. Pravidelně zkoušejte
obnovu do izolovaného prostředí a ověřte stažení historického PDF i přílohy.

Při obnově použijte stejnou trojici databáze, storage a klíče, nasaďte
odpovídající verzi kódu, spusťte zbývající migrace a proveďte smoke test.
Samotná databáze bez storage není úplná záloha.

## Monitoring a údržba

Sledujte alespoň:

- dostupnost `/login`, latenci a počet HTTP 5xx;
- neúspěšná přihlášení a zásahy rate limitu na proxy;
- volné místo storage a databáze a paměť spotřebovanou při generování PDF;
- stav PostgreSQL spojení a vyčerpání connection poolu;
- selhání a stáří poslední Fio synchronizace;
- chyby generování PDF a kontroly integrity souborů;
- stáří poslední úspěšné zálohy a posledního testu obnovy.

Při horizontálním škálování počítejte `DATABASE_MAX_CONNECTIONS` za každou
instanci. Lokální storage musí být buď sdílená a konzistentní, nebo nahrazená
objektovým úložištěm implementujícím stávající abstraction; samostatné lokální
disky více instancí nejsou bezpečné.

## Bezpečnostní checklist

- `APP_ENV=production` je skutečně nastaveno;
- databáze a aplikační port nejsou veřejně dostupné;
- TLS certifikát je platný a HTTP se přesměrovává na HTTPS;
- přihlášení má rate limit a proxy omezuje tělo i chunked přenos;
- storage a env soubor mají minimální filesystemová oprávnění;
- Fio token je read-only a šifrovací klíč není v repozitáři ani logu;
- bootstrap heslo bylo po vytvoření uživatele odstraněno;
- zálohy jsou šifrované a jejich obnova byla prakticky ověřena;
- před každým releasem proběhly migrace, testy a smoke test.

Podrobnosti k implementovaným kontrolám a zbytkovým rizikům jsou v
[SECURITY.md](SECURITY.md).

## Diagnostika migrací v Deno Deploy / Neon

Pre-deploy command nastavte na `deno task migrate`. Tento příkaz používá pouze
proměnné předané prostředím; `.env` automaticky nenačítá. Lokální varianta je
`deno task migrate:local`, která `.env` načte explicitně. Již exportované
proměnné mají přednost před `.env`.

Pro migrace lze nastavit `DATABASE_MIGRATION_URL`; pokud chybí, použije se
`DATABASE_URL`. Běžná aplikace stále používá pouze `DATABASE_URL`. Migrátor
vytváří vlastní připojení s limitem 1 a po dokončení ho zavře.

U Neonu ponechte aplikaci pooled URL, ale pro `DATABASE_MIGRATION_URL` použijte
přímý hostname bez `-pooler`. Migrátor používá sessionový `pg_advisory_lock`,
který transaction pooling nepodporuje; známý Neon pooler proto odmítne ještě
před připojením. Viz
[Neon connection pooling](https://neon.com/docs/connect/connection-pooling). Pro
použitý klient `postgres.js` nastavte URL například takto:

```text
DATABASE_MIGRATION_URL=postgresql://USER:PASSWORD@DIRECT_HOST/DATABASE?sslmode=verify-full
```

Nepřidávejte libpq parametr `channel_binding=require`: instalovaný `postgres.js`
jej nepodporuje a předává ho jako serverový parametr. `sslmode=verify-full`
zachovává TLS s ověřením certifikátu a hostname; nejde o zapnutí channel
bindingu.

Při startu migrátor vypíše `Migration database target`: název použité proměnné,
skutečné hosty/porty po parsování klientem, Deno timeline a ID revize.
Nevypisuje uživatele, heslo, název databáze ani celý connection string. Pokud
log uvádí `127.0.0.1`, jde o efektivní konfiguraci tohoto procesu, nikoliv o S3.

Připojení lze ověřit bez aplikování migrací:

```sh
deno task migrate --check
# Lokálně s explicitním načtením .env:
deno task migrate:local --check
```

Kontrola provede pouze `SELECT 1`. Pokud Neon hostname v diagnostice souhlasí,
ale samotná chyba stále uvádí localhost, je třeba ověřit DNS/síťové směrování
běžícího procesu. Samotná hodnota uložená v dashboardu neprokazuje použitý cíl.
