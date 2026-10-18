# Migrace Fakturomatu na Workers D1 a R2

Aplikace je upravená pro Cloudflare Workers, celou databázi v D1 a privátní
soubory v R2. D1 používá SQLite; PostgreSQL už není provozní závislost. Better
Auth sdílí stejnou D1 databázi s fakturací. AWS S3 už aplikace nepoužívá. Tento
postup zahrnuje přenos existujících databázových dat, nasazení a rollback.

## 1 Co připravit

Potřebujete Deno 2.9+, Cloudflare účet s Workers, D1 a R2, přístup k doméně a
přístup ke stávajícímu PostgreSQL pro export. Kvůli velikosti serverového bundlu
s fonty a CPU nárokům generování PDF počítejte s Workers Paid a ověřte aktuální
[limity Workers](https://developers.cloudflare.com/workers/platform/limits/).

Před přepnutím zazálohujte PostgreSQL, původní release, konfiguraci domény a
zejména `BETTER_AUTH_SECRET` a `BANK_CREDENTIALS_ENCRYPTION_KEY`. Oba klíče
přeneste beze změny. Export zachovává ID uživatelů, vazby organizací, heslové
hashe, session i šifrované bankovní tokeny. Změna domény může vyžadovat nové
přihlášení, protože cookies se mezi doménami nepřenášejí.

Migrační skript je určen pro dohodnutý stav **bez uložených souborů**. Pokud
najde dokumenty faktur, přílohy nebo odkazy na loga, zastaví export. Nepřepíše
jejich provider na R2 bez skutečného přenosu bajtů.

## 2 Lokální ověření

```sh
deno install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

V `.dev.vars` nastavte náhodný `BETTER_AUTH_SECRET` a 32bajtový bankovní klíč v
Base64, například výstupem `openssl rand -base64 32`. Pro vývoj ponechte
`APP_ENV=development` a origin `http://localhost:5173`. Nepoužívejte produkční
bankovní tokeny ani produkční DB pro testy.

```sh
deno task migrate:local
deno task user:create --output /tmp/fakturomat-user.sql
deno run -A npm:wrangler d1 execute DB --local --file /tmp/fakturomat-user.sql
```

Bootstrap příkaz čte `FAKTUROMAT_ADMIN_EMAIL`, `FAKTUROMAT_ADMIN_NAME` a
`FAKTUROMAT_ADMIN_PASSWORD` z `.dev.vars`. SQL soubor obsahuje heslový hash, má
oprávnění 0600 a nesmí do Gitu. Po importu soubor i bootstrap heslo odstraňte.
Při migraci už existujícího uživatele bootstrap přeskočte.

```sh
deno task dev
```

Lokální Worker, D1 a R2 používají emulaci Cloudflare; Docker ani lokální
PostgreSQL nejsou potřeba. Stav je v ignorovaném `.wrangler/`. Ověřte:

```sh
deno task check
deno task test
deno task test:startup
```

Běžné testy používají izolované SQLite databáze, včetně rollbacku, konkurenční
změny dat, integrity faktur, R2 a přenosu dat. `test:startup` sestaví aplikaci a
spustí skutečný lokální workerd s izolovaným D1/R2. Nevyužívá produkční
credentials ani persistentní vývojová data. Původní PostgreSQL integrační testy
jsou archivované v `tests/legacy_postgres/`; nejsou vydávané za ověření D1.

## 3 Založení Cloudflare prostředků

```sh
deno run -A npm:wrangler login
deno run -A npm:wrangler d1 create fakturomat
deno run -A npm:wrangler r2 bucket create fakturomat-documents
deno run -A npm:wrangler r2 bucket create fakturomat-files
```

Ve `wrangler.jsonc` nahraďte nulové `database_id` skutečným ID. Zkontrolujte
názvy bucketů a Workeru. Bindingy musí zůstat `DB`, `DOCUMENTS` a `FILES`. Oba
buckety ponechte privátní: nezapínejte `r2.dev` ani veřejnou vlastní doménu.
Staging musí mít vlastní databázi, buckety, secrets a Worker konfiguraci.

Nastavte `BETTER_AUTH_URL` na skutečný HTTPS origin nasazení, například
`https://faktury.example.cz`, a `APP_ENV=production`. Konfigurace v repozitáři
obsahuje lokální zástupnou adresu; před nasazením ji musíte změnit.

```sh
deno run -A npm:wrangler secret put BETTER_AUTH_SECRET
deno run -A npm:wrangler secret put BANK_CREDENTIALS_ENCRYPTION_KEY
# Pouze pokud používáte extrakci nákladových PDF:
deno run -A npm:wrangler secret put OPENAI_API_KEY
```

Případný `OPENAI_EXPENSE_MODEL` patří mezi běžné proměnné. AWS keys,
`DATABASE_URL`, `DATABASE_MAX_CONNECTIONS` a lokální storage cesty nový Worker
nepotřebuje. Deno Deploy Cloud Connection se nepřenáší.

## 4 Přenos PostgreSQL dat do nové prázdné D1

**Na cílové D1 nejprve nespouštějte `deno task migrate`.** Export obsahuje
schéma, data, ochranné triggery a evidenci aplikovaných D1 migrací. Je určen
výhradně do nové prázdné databáze a při kolizi existujícího schématu selže.
Pokud import selže po částečném zápisu, použijte novou prázdnou D1 a import
opakujte; nepokračujte nad nejasně naplněnou databází.

1. Nejprve nacvičte postup se zálohou PostgreSQL a staging D1.
2. Při ostrém přenosu zastavte všechny zápisy do původní aplikace, včetně
   přihlášení a bankovní synchronizace. Nechte doběhnout rozpracované operace.
3. Předejte `SOURCE_DATABASE_URL` do prostředí bezpečným správcem secrets.
   Použijte PostgreSQL connection string s TLS, ideálně účet jen pro čtení.
4. Exportujte data:

   ```sh
   deno task data:export --output /secure/path/fakturomat.import.sql
   ```

   Skript `scripts/export_postgres_to_d1.ts` používá jeden read-only
   repeatable-read snapshot. Nemění PostgreSQL. Odmítá odlišné sloupce
   zdrojového schématu, nebezpečná čísla, odkazy na soubory a neplatné vazby.
   Výsledné SQL před uložením přehraje do izolované SQLite databáze a ověří cizí
   klíče a počty řádků. Cílový soubor nesmí předem existovat.
5. Importujte do D1:

   ```sh
   deno run -A npm:wrangler d1 execute DB --remote --file /secure/path/fakturomat.import.sql
   deno run -A npm:wrangler d1 execute DB --remote --command "PRAGMA foreign_key_check;"
   deno run -A npm:wrangler d1 migrations list DB --remote
   ```

   `foreign_key_check` nesmí vrátit porušení. Obě počáteční migrace musí být
   evidované jako aplikované. Import obsahuje také kontroly počtů všech
   přenášených tabulek; při neshodě skončí chybou. Uložte výpis počtů z exportu
   jako migrační protokol, bez SQL obsahu a credentials.
6. Ověřte přihlášení původním heslem, členství v organizacích, kontakty,
   koncepty faktur, číselné řady, šablony, náklady a bankovní tokeny.

Pokud začínáte úplně bez dat, tento export/import přeskočte a použijte
`deno task migrate` pro nové schéma a bootstrap uživatele z etapy 2 s `--remote`
namísto `--local`.

SQL export obsahuje heslové hashe, aktivní session a šifrované tokeny. Skladujte
jej jako citlivou zálohu s omezeným přístupem; necommitujte jej.

## 5 Nasazení a kontrola

```sh
deno task build
deno run -A npm:wrangler deploy
```

Vite vytváří finální Worker konfiguraci v `_fresh/server/wrangler.json`;
Wrangler ji vybírá přes generovaný `.wrangler/deploy/config.json`. Zdrojový
entrypoint `server.js` používá virtuální Fresh entrypoint, takže build
nevyžaduje výstup předchozího Deno sestavení.

Připojte vlastní doménu v Cloudflare Workers → Settings → Domains & Routes. Před
změnou DNS si uložte původní routing. Pro autentizované stránky, API a chráněné
soubory nepřidávejte plošnou cache; zachovejte `private, no-store`. Veřejné
verzované JS/CSS assety poskytuje Cloudflare assets.

Před otevřením zápisů ověřte na skutečné doméně:

- přihlášení původním heslem, odhlášení a zneplatnění session;
- izolaci organizací a CSRF při formulářích;
- vystavení testovací faktury v testovací organizaci, české znaky, vícestránkové
  PDF a QR platbu;
- stažení PDF přes aplikaci a odmítnutí anonymního/cizího uživatele;
- upload a mazání nákladové přílohy a logo, včetně dostupnosti po redeployi;
- Fio synchronizaci, opakovaný import bez duplicit a párování obou směrů;
- import nákladového PDF, pokud je zapnutý;
- CPU, paměť, DB chyby a odezvu větších operací.

PDF se nyní vrací přímo z autorizovaného endpointu s ověřením velikosti a
SHA-256, nikoli přesměrováním na podepsanou S3 URL. R2 upload faktur používá
podmínku nepřepsání existujícího klíče. Loga a přílohy používají druhý bucket.

## 6 Transakce a provozní omezení

D1 podporuje
[atomické batch operace](https://developers.cloudflare.com/d1/worker-api/d1-database/),
nikoli původní interaktivní PostgreSQL transakce. Repozitáře nejprve načtou
podklady a sestaví plán zápisů. Batch ověří společnou revizi dat a provede
všechny zápisy atomicky. Při konfliktu se plán opakuje nejvýše pětkrát.
Databázové triggery zvyšují revizi také při změnách uživatelů a členství. Při
trvajícím konfliktu operace selže bez částečného zápisu; uživatel ji zopakuje.

Tento konzervativní mechanismus upřednostňuje konzistenci před vysokým souběhem.
Sledujte konflikty a limity počtu dotazů při hromadném bankovním importu.
Případná optimalizace musí zachovat atomické operace a ochrany v DB. PDF se
generuje a ukládá mimo DB batch; při finálním zápisu se znovu kontroluje
oprávnění a revize faktury. Neúspěšné dokončení může zanechat nepřiřazený R2
objekt a mezeru v číselné řadě, nikoli chybně vystavenou fakturu.

Částky se ukládají jako celé desetitisíciny měny. Nejvyšší absolutní jednotlivá
hodnota je 900719925474.0991; mimo bezpečný rozsah selže i načtení součtu.
Převod neprovádí skryté zaokrouhlování. Množství a sazby DPH zůstávají textovými
desetinnými hodnotami a aplikační výpočty používají BigInt.

Better Auth podporuje
[D1 přímo](https://better-auth.com/docs/adapters/other-relational-databases).
Rate limit přihlášení je uložený v D1 a používá hlavičku `CF-Connecting-IP`
dodávanou Cloudflare. Službu provozujte za Workers, kde tuto hlavičku nastavuje
platforma; lokální emulátor není produkčním veřejným serverem.

## 7 Další release zálohy a návrat

Budoucí změny D1 schématu přidávejte jako nové SQL soubory v `migrations/d1/`;
nepřepisujte aplikované migrace. Před releasem zálohujte D1, aplikujte nové
migrace a nasaďte kompatibilní Worker. Původní `migrations/*.sql` slouží jako
historie PostgreSQL a nový runtime je nespouští.

Využijte
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) a
nezávislé exporty DB. R2 objekty zálohujte společně s jejich DB metadaty a
ověřujte obnovu. Secret pro bankovní tokeny zálohujte odděleně.

Do otevření zápisů lze vrátit doménu na původní aplikaci s původní PostgreSQL.
**Po nových zápisech do D1 není samotná změna DNS bezpečný rollback:** původní
PostgreSQL tato data neobsahuje a případná nová PDF jsou v R2. V takovém případě
zastavte zápisy, zachovejte D1/R2 a vraťte kompatibilní Worker release nebo
připravte ověřený zpětný přenos dat. Tento exportér je jednosměrný PostgreSQL →
D1.

Starý hosting, PostgreSQL a případný S3 účet rušte až po akceptaci migrace a
ověření obnovy. Samotné změny v tomto repozitáři prostředky v cloudu nezakládají
ani nepřepínají produkční doménu.

Lokální `deno task dev` nejprve vytvoří build a spustí jej ve Wrangleru na portu
5173 se skutečnými lokálními D1/R2 bindingy. Po změně zdrojů příkaz spusťte
znovu; automatické HMR nyní není zapnuté kvůli nekompatibilitě vývojových
runnerů Fresh a Cloudflare Vite pluginu. `deno task start` spustí již existující
build.
