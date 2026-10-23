# Nasazení a provoz

Fakturomat běží na Cloudflare Workers, používá D1 pro všechna databázová data
včetně Better Auth a privátní R2 pro PDF, loga a přílohy. Kompletní první
nasazení, přenos PostgreSQL dat a přepnutí domény popisuje
[CLOUDFLARE_MIGRATION.md](CLOUDFLARE_MIGRATION.md).

## Automatické nasazení z GitHubu

Workflow [deploy.yml](.github/workflows/deploy.yml) se spouští při každém pushi
(nebo merge pull requestu) do `main`. Ruční spuštění je v GitHub → Actions →
Deploy production → Run workflow, také pouze pro `main`.

### Jednorázové nastavení

1. V Cloudflare vytvořte API token ze šablony **Edit Cloudflare Workers**.
   Omezte jej na účet, ve kterém je Worker `fakturomat`, a ověřte oprávnění
   **Account → Workers Scripts → Edit**, **Account → D1 → Edit** a **Account →
   Workers R2 Storage → Edit**. Ponechte potřebná oprávnění šablony pro čtení
   účtu. Doménu připojte předem ručně; workflow DNS ani routy nezakládá.
   [Oficiální postup Cloudflare](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
2. Zkopírujte Cloudflare **Account ID** z přehledu účtu. Není to Zone ID ani D1
   ID.
3. V
   [nastavení environments repozitáře](https://github.com/czmavi/fakturomat/settings/environments)
   vytvořte environment `production`. Přidejte dvě **Environment secrets**:

   | Název                   | Hodnota               |
   | ----------------------- | --------------------- |
   | `CLOUDFLARE_API_TOKEN`  | API token z kroku 1   |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

   Povolte nasazování pouze z větve `main`. Pro plně automatický deploy
   nezapínejte required reviewers ani čekací dobu. Repository secrets stejného
   jména lze použít také, pokud environments váš GitHub plán nepodporuje.
4. Ve `wrangler.jsonc` musí být správná produkční D1 pod bindingem `DB`, R2
   buckety `DOCUMENTS` a `FILES`, `APP_ENV=production` a
   `BETTER_AUTH_URL=https://fakturomat.caretsix.com`. Prostředky musí již
   existovat. Doména musí být připojena k Workeru a veřejný `/health` dostupný
   bez Access přihlášení či challenge, viz níže.
5. U Workeru jednorázově nastavte `BETTER_AUTH_SECRET`,
   `BANK_CREDENTIALS_ENCRYPTION_KEY` a případně `OPENAI_API_KEY` pomocí
   `wrangler secret put` nebo v Cloudflare dashboardu. Existující hodnoty
   ponechte. Workflow je nevytváří ani neobnovuje; `.dev.vars` se do GitHubu
   neposílá. Testovací uživatel se vytváří pouze jednou podle předchozího
   postupu, nikoli při každém deployi.
6. Pokud už máte zapnuté automatické nasazování přes Cloudflare Workers Builds,
   vypněte je pro tento Worker, aby jeden push nespouštěl dvě nasazení.
7. Commitněte a pushněte změny do `main` (nebo je mergněte přes pull request).
   Průběh sledujte v
   [GitHub Actions](https://github.com/czmavi/fakturomat/actions).

### Co se provede při pushi

Workflow nainstaluje Deno 2.9.7 a závislosti podle lockfile, spustí formátování,
lint, typy a všechny testy, sestaví aplikaci a ověří ji v izolovaném workerd.
Teprve potom s produkčním tokenem aplikuje dosud neprovedené D1 migrace a nasadí
přesně tento build z `_fresh/server/wrangler.json`. Nakonec až šestkrát ověří
veřejný `/health`: HTTP 200, správný JSON, no-store, bez redirectu či cookies.
Kontrola dostupnosti sama nepotvrzuje, kterou verzi kódu obsluhuje doména.

Nasazení se nepřekrývají a nový push nepřeruší probíhající migraci. Chyba
kontrol nebo migrace zastaví deploy. Chyba healthchecku označí workflow jako
neúspěšné, ale již nasazený Worker ani migrace se automaticky nevracejí zpět. D1
migrace proto pište zpětně kompatibilně se stávající verzí aplikace. Workflow
neprovádí import PostgreSQL, reset databáze ani opakované vytváření uživatelů.

## Běžný release

1. Ověřte `deno task check`, `deno task test` a `deno task test:startup`.
2. Zkontrolujte cílovou Cloudflare konfiguraci, D1 ID, bucket bindingy a veřejný
   `BETTER_AUTH_URL`. Staging a produkce musí mít oddělené prostředky.
3. Zazálohujte D1 a R2, uchovejte bankovní šifrovací klíč a auth secret.
4. Nové D1 migrace aplikujte pomocí `deno task migrate`. Při prvním importu
   PostgreSQL použijte místo toho samostatný postup v migračním návodu.
5. Spusťte `deno task deploy`. Pro produkční HTTPS nastavte
   `APP_ENV=production`.
6. Ověřte login, organizace, vystavení a stažení PDF, přílohy a bankovní import.

Migrace jsou v `migrations/d1/`. PostgreSQL migrace v kořeni `migrations/` jsou
pouze historické a nejsou součástí nového releasu.

## Konfigurace

Bindingy `DB`, `DOCUMENTS` a `FILES` jsou povinné. Tajemství jsou
`BETTER_AUTH_SECRET`, `BANK_CREDENTIALS_ENCRYPTION_KEY` a případně
`OPENAI_API_KEY`. `OPENAI_EXPENSE_MODEL` je volitelná běžná proměnná. AWS
credentials, PostgreSQL URL ani lokální storage cesty se v runtime nepoužívají.

Při lokálním vývoji používejte `.dev.vars`, nikoli původní `.env`. Pro čistou
instalaci spusťte `deno task migrate:local`, vygenerujte SQL uživatele pomocí
`deno task user:create --output /tmp/fakturomat-user.sql` a importujte je přes
Wrangler D1 execute. Potom spusťte `deno task dev`.

## Monitoring a obnova

Sledujte Worker chyby a CPU, D1 chyby a konflikty transakcí, selhání R2 a stáří
posledního bankovního importu. Podepsané bankovní tokeny, credentials, SQL
exporty ani obsah dokladů nepatří do logů. Chráněné odpovědi necachujte.

Při vyčerpání pěti pokusů o zápis při souběžných změnách se operace ukončí bez
částečného DB zápisu. Velké importy sledujte vůči limitům D1/Workers. Neúspěšné
vystavení po uploadu může zanechat R2 objekt bez DB reference; čistěte jej až po
kontrole proti DB a s ochrannou lhůtou pro běžící operace.

Zálohujte D1 a oba R2 buckety společně a testujte obnovu. Využívejte D1 Time
Travel jako doplněk záloh. Worker rollback nevrací změny databáze ani R2. Po
přijetí nových dat v D1 nelze bezpečně přepnout zpět na starou PostgreSQL bez
zpětného přenosu těchto dat.

Lokální `deno task dev` nejprve vytvoří build a spustí jej ve Wrangleru na portu
5173 se skutečnými lokálními D1/R2 bindingy. Po změně zdrojů příkaz spusťte
znovu; automatické HMR nyní není zapnuté kvůli nekompatibilitě vývojových
runnerů Fresh a Cloudflare Vite pluginu. `deno task start` spustí již existující
build.

## CaretSix Control healthcheck

Veřejný `GET https://fakturomat.caretsix.com/health` vrací přímo JSON
`{"status":"ok"}` s HTTP 200, nebo `{"status":"error"}` s HTTP 503. Obě odpovědi
mají `Content-Type: application/json` a `Cache-Control: no-store`. Endpoint
nevyžaduje přihlášení ani token, nenačítá session a nevytváří cookies. Výjimka z
načítání autentizace platí pouze pro metodu GET a přesnou cestu `/health`.

Každý požadavek čte jediný záznam `_write_epoch` v D1 (ověří i inicializaci
schématu) a souběžně provádí R2 HEAD pro klíč `__health_probe__` v bucketech
DOCUMENTS a FILES. Objekt nemusí existovat; chybějící objekt je zdravý výsledek.
Kontroly nic nezapisují, nestahují soubory, negenerují PDF a nevolají banku ani
OpenAI. Společný limit odpovědi je 3 sekundy. D1/R2 bindingy nepřijímají
AbortSignal; při timeoutu odpověď skončí 503, rozběhnuté read-only operace se
mohou dokončit na pozadí. Kontrola čtení nepotvrzuje schopnost zapisovat. Při
selhání Worker loguje důvod (`timeout` nebo `dependency_error`), uplynulý čas a
stav každého bindingu (`pending`, `ok`, `error`), bez původních chybových zpráv
či citlivých údajů. Timeout externího monitoru nastavte nad 3 sekundy
(doporučeně alespoň 5 sekund).

Nasazení: `deno task deploy`; nejsou potřeba nové secrets ani DB migrace. V
CaretSix Control nastavte výše uvedenou HTTPS URL, metodu GET a očekávaný
status 200. Ověřte bez cookies a bez následování přesměrování:

```sh
curl -i --max-time 5 https://fakturomat.caretsix.com/health
```

Pokud je před aplikací Cloudflare Access, přidejte veřejnou výjimku pouze pro
host `fakturomat.caretsix.com` a přesnou cestu `/health` (ne `/health/*` ani
celý web). Stejně úzce případně upravte WAF/challenge a redirect pravidla. V
Cache Rules zajistěte pro tento host a přesnou cestu bypass cache, pokud
existuje pravidlo přepisující origin Cache-Control. Kód tyto vnější ochrany ani
pravidla nemění. Lokální test ve workerd ověřuje routing, zdravý a chybový stav
i ochranu ostatních cest; nenahrazuje ověření na produkční doméně po nasazení.

## Nasazení správy uživatelů

Před nasazením buildu se správou uživatelů aplikujte D1 migraci
`0004_user_management.sql`. Určený správce je existující aktivní účet
`mail@martinvich.net`; migrace nikoho dalšího nepovyšuje. Před nasazením ověřte,
že účet existuje a po migraci má `is_admin = 1`. Přístup k současným i novým
organizacím zajišťují členství a databázové triggery. Nové běžné účty mají
výchozí `is_admin = 0` a zakládají se přes `/users`.
