# Nasazení a provoz

Fakturomat běží na Cloudflare Workers, používá D1 pro všechna databázová data
včetně Better Auth a privátní R2 pro PDF, loga a přílohy. Kompletní první
nasazení, přenos PostgreSQL dat a přepnutí domény popisuje
[CLOUDFLARE_MIGRATION.md](CLOUDFLARE_MIGRATION.md).

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
