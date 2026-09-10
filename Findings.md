# Bezpečnostní audit – Fakturomat

Datum auditu: 10. září 2026\
Auditovaná revize: `4a1bce2` plus lokální necommitnuté změny přítomné v
pracovním stromu\
Rozsah: aplikační kód, routy, repository vrstva, migrace, konfigurace, uploady,
generování PDF, autentizace, autorizace a uzamčené závislosti

## Shrnutí

Audit nalezl 2 nálezy s vysokou, 4 se střední a 3 s nízkou severitou. Kritický
nález nebyl identifikován.

| ID   | Nález                                                                                     | Severita | Obtížnost nápravy |
| ---- | ----------------------------------------------------------------------------------------- | -------: | ----------------: |
| F-01 | Libovolný přihlášený uživatel může změnit globální fakturační šablonu pro všechny tenanty |   Vysoká |           Střední |
| F-02 | Limit těla požadavku lze obejít chybějícím `Content-Length`                               |   Vysoká |           Střední |
| F-03 | Přihlášení nemá aplikační throttling a heslo nemá horní limit délky                       |  Střední |           Střední |
| F-04 | Role `OWNER` a `MEMBER` nejsou vynucovány u citlivých operací                             |  Střední |            Vysoká |
| F-05 | Produkční proces je spouštěn s neomezenými Deno oprávněními `-A`                          |  Střední |           Střední |
| F-06 | Bezpečné cookies a HSTS se při chybné konfiguraci vypnou „fail-open“                      |  Střední |             Nízká |
| F-07 | Uploady ověřují pouze deklarovaný MIME typ a několik úvodních bajtů                       |    Nízká |           Střední |
| F-08 | HTML šablony jsou filtrovány regulárními výrazy, které neodpovídají parseru prohlížeče    |    Nízká |           Střední |
| F-09 | Chybí bezpečnostní auditní stopa citlivých akcí                                           |    Nízká |           Střední |

Nejvyšší prioritu má F-01: útočník s jakýmkoli platným účtem může do sdílené
šablony vložit vlastní statické platební instrukce. Faktura jiného subjektu pak
při vystavení načte právě aktuální globální verzi šablony. Výsledkem může být
věrohodné PDF s podvrženým účtem. F-02 umožňuje neautentizovaný útok na
dostupnost, pokud absolutní limit nezajistí reverzní proxy.

## Metodika a omezení

Provedena byla manuální statická analýza hranic důvěry, datových toků a
citlivých operací, hledání tajemství v aktuálním stromu i celé Git historii,
kontrola SQL dotazů, tenantového scope, CSRF, sessions, uploadů, šablon, PDF
rendereru a bankovních credentials. Dále proběhlo:

- `deno task check` – úspěšně;
- `deno task test` – 51 testů úspěšných, 0 neúspěšných, 8 databázových/HTTP
  integračních testů přeskočeno, protože nebyl nastaven `TEST_DATABASE_URL`;
- `deno audit` – pro aktuálně uzamčené závislosti nenalezena žádná známá
  zranitelnost;
- cílený test validátoru šablon – validátor přijal například
  `<div/onload=alert(1)>` a `<table/background=https://attacker.invalid/x>...`;
- hledání běžných formátů API klíčů a privátních klíčů – bez nálezu.

Nebyl proveden dynamický penetrační test běžícího produkčního nasazení,
konfigurace reverzní proxy ani hostitelského systému. Výsledek `deno audit`
znamená pouze, že databáze auditu v okamžiku kontroly neznala zranitelnost pro
uzamčené verze; není důkazem absence dosud neznámých chyb.

## Detailní nálezy

### F-01: Libovolný přihlášený uživatel může změnit globální fakturační šablonu pro všechny tenanty

**Severita:** Vysoká\
**Obtížnost nápravy:** Střední\
**Kategorie:** CWE-862 – Missing Authorization / porušení tenantové integrity

#### Vysvětlení

Middleware šablon kontroluje pouze to, zda je uživatel přihlášen
(`routes/templates/_middleware.ts:3-5`). Vytvoření šablony i nové verze používá
bez dalšího autorizačního rozhodnutí `ctx.state.user!.id`
(`routes/templates/new.tsx:25-38`,
`routes/templates/[templateId]/edit.tsx:48-71`). Repository je globální a při
vytvoření nové verze přepne `current_version_id` sdílené šablony
(`repositories/invoice_template_repository.ts:177-220`).

Při vystavení faktury se aktuální verze načítá globálně podle
`invoice_template_id`, bez vazby na organizaci nebo oprávnění autora
(`repositories/invoice_repository.ts:468-487`). To je zvlášť nebezpečné, protože
povolené HTML může obsahovat libovolný statický text. Útočník tedy nemusí obejít
XSS filtr: stačí, když do šablony přidá vlastní číslo účtu a vizuálně potlačí
legitimní platební údaje. Následně vystavené faktury jiných organizací mohou
odvádět platby útočníkovi.

Historie verzí omezuje možnost zahlazení změny, ale nezabrání jejímu okamžitému
použití. Již vystavené faktury používají snapshot a zůstávají chráněné; ohrožené
jsou nové faktury vystavené po škodlivé změně.

#### Scénář zneužití

1. Útočník získá libovolný platný aplikační účet, nemusí být členem cílové
   organizace.
2. Odešle platný `POST /templates/{sharedTemplateId}/edit` s vlastní statickou
   platební instrukcí.
3. Repository nastaví útočníkovu verzi jako aktuální.
4. Uživatel jiného tenantu vystaví fakturu, která odkazuje na tuto šablonu.
5. Vygenerované PDF obsahuje podvržené instrukce.

#### Způsob nápravy

- Zavést explicitní instalační roli, například `SYSTEM_ADMIN` nebo samostatné
  oprávnění `invoice_templates:write`.
- Oprávnění kontrolovat serverově v middleware i v repository/service vrstvě;
  samotné skrytí odkazu v UI nestačí.
- Pro běžné organizace preferovat tenantově vlastněné šablony
  (`organization_id`) a samostatně spravovanou, pouze pro čtení dostupnou
  systémovou knihovnu.
- Změnu sdílené šablony nezveřejnit okamžitě: použít draft → review/approval →
  publish, ideálně se čtyřočkovým schválením pro platební dokumenty.
- Organizaci při vystavení navázat na explicitně schválenou verzi, ne vždy na
  globální `current_version_id`.
- Přidat test, že běžný uživatel ani vlastník jedné organizace nemůže
  vytvořit/publikovat globální verzi, a auditní událost každé změny.

### F-02: Limit těla požadavku lze obejít chybějícím `Content-Length`

**Severita:** Vysoká\
**Obtížnost nápravy:** Střední\
**Kategorie:** CWE-400 – Uncontrolled Resource Consumption

#### Vysvětlení

Kontrola velikosti vrací `false`, pokud hlavička `Content-Length` chybí
(`services/security_headers.ts:5-11`). To je běžné například u
`Transfer-Encoding: chunked`. Po této kontrole routy volají
`await ctx.req.formData()` a nechají runtime načíst a rozparsovat celé tělo;
veřejná login routa to dělá ještě před jakoukoli autentizací
(`routes/login.tsx:23-27`).

Útočník, který pošle velmi velké nebo nekončící chunked multipart tělo, tak může
spotřebovat paměť, dočasný disk, CPU a otevřená spojení. Paralelní požadavky
mohou proces shodit nebo vyčerpat jeho kapacitu. Dokumentace správně požaduje
limit na reverzní proxy (`SECURITY.md:65-71`), ale v samotné aplikaci absolutní
limit neexistuje a přímé nebo chybně nakonfigurované nasazení zůstává
zranitelné.

#### Způsob nápravy

- Zavést limitující stream wrapper, který počítá skutečně přijaté bajty a po
  překročení limitu přeruší čtení bez ohledu na `Content-Length`.
- Pokud framework bezpečný streaming limit nepodporuje, pro formulářové routy
  odmítnout těla bez validního `Content-Length` a současně zachovat limit na
  proxy. To je méně univerzální, ale bezpečnější než neomezené čtení.
- Použít nižší limity podle routy: login jednotky KiB, běžné formuláře desítky
  až stovky KiB, logo přibližně 2 MiB a příloha 20 MiB plus malá multipart
  režie.
- Nastavit read/body timeout, limit souběžných požadavků a maximální velikost
  těla také na každé reverzní proxy a load balanceru.
- Doplnit integrační test s chunked tělem bez `Content-Length`, který po
  překročení limitu očekává `413` a ověří ukončení streamu.

### F-03: Přihlášení nemá aplikační throttling a heslo nemá horní limit délky

**Severita:** Střední\
**Obtížnost nápravy:** Střední\
**Kategorie:** CWE-307 – Improper Restriction of Excessive Authentication
Attempts; CWE-400

#### Vysvětlení

Každý neúspěšný login provede PBKDF2 s 600 000 iteracemi, včetně pokusu na
neexistující účet (`services/auth_service.ts:39-52`). To správně omezuje časový
user-enumeration rozdíl, ale bez throttlingu současně vytváří nákladný veřejný
endpoint. Login routa nepoužívá rate limiter (`routes/login.tsx:23-43`) a heslo
je před PBKDF2 přijato bez horního limitu; celé se kóduje do paměti
(`domain/auth/password.ts:19-35`).

Útočník může provádět credential stuffing a zároveň vysokým počtem souběžných
PBKDF2 výpočtů vyčerpat CPU. Dlouhá hesla zvyšují spotřebu paměti. Povinný proxy
limit popsaný v dokumentaci je užitečný, ale není vlastností kódu a při více IP
adresách nebo přímém přístupu může být nedostatečný.

#### Způsob nápravy

- Přidat distribuovaný limiter sdílený všemi instancemi, kombinující
  účet/normalizovaný e-mail, zdrojovou IP a globální kapacitní limit.
- Použít progresivní zpoždění nebo krátkodobé blokování a odpověď `429` s
  `Retry-After`; nezavádět snadno zneužitelné trvalé zamykání účtu pouze podle
  e-mailu.
- Nastavit rozumný horní limit hesla před PBKDF2, například 256 nebo 1 024
  bajtů, a malý limit celého login requestu.
- Monitorovat neúspěšné pokusy bez logování zadaného hesla a upozorňovat na
  distribuované útoky.
- Zachovat generickou chybovou zprávu a dummy hash, které jsou implementované
  správně.

OWASP výslovně doporučuje login throttling jako ochranu proti hádání hesel:
[Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

### F-04: Role `OWNER` a `MEMBER` nejsou vynucovány u citlivých operací

**Severita:** Střední\
**Obtížnost nápravy:** Vysoká\
**Kategorie:** CWE-862 – Missing Authorization

#### Vysvětlení

Datový model explicitně rozlišuje role `OWNER` a `MEMBER`
(`migrations/0002_organizations.sql:16-25`), ale organizační middleware pouze
ověří existenci membership (`routes/o/[organizationId]/_middleware.ts:14-26`).
Stejný vzorec pokračuje v repository vrstvě: změna fakturačních údajů kontroluje
jen `user_id` membership
(`repositories/organization_settings_repository.ts:99-133`) a běžný člen může
také nahradit nebo odstranit šifrované bankovní credentials
(`repositories/bank_connection_repository.ts:180-227`,
`routes/o/[organizationId]/settings/bank-accounts/[bankAccountId]/connection.tsx:61-116`).

Pokud má `MEMBER` představovat nižší oprávnění než `OWNER`, jedná se o
vertikální eskalaci oprávnění. Člen může změnit právní a platební identitu
organizace, bankovní účty, Fio token, výchozí číselné řady a další citlivé
nastavení. V současné verzi neexistuje UI pro pozvání členů, takže praktické
zneužití vyžaduje, aby membership již existovala například po ručním
provisioningu. Jakmile existuje, útok je triviální.

Pokud mají mít obě role záměrně stejná práva, je nutné to označit za vědomé
produktové rozhodnutí a roli nepoužívat jako zdánlivou bezpečnostní hranici.
Současný model jinak budoucí správu členství snadno otevře s nebezpečnými
implicitními právy.

#### Způsob nápravy

- Nejprve schválit matici oprávnění pro každý typ objektu a akce. Minimálně
  změna identity organizace, bankovních účtů/credentials, členství a vlastnictví
  má být pouze pro `OWNER` nebo užší oprávnění.
- Přenést rozhodnutí do centrální policy vrstvy a současně ho vynucovat v SQL
  podmínkách; routa ani klientské UI nesmí být jedinou kontrolou.
- Použít deny-by-default: nová mutující routa nemá být dostupná, dokud
  explicitně neuvede požadované oprávnění.
- Přidat integrační testy pro každou roli a citlivou akci, včetně přímého POST
  požadavku bez použití UI.
- Před zavedením pozvánek nebo membership UI tuto opravu považovat za release
  blocker.

Relevantní doporučení:
[OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

### F-05: Produkční proces je spouštěn s neomezenými Deno oprávněními `-A`

**Severita:** Střední\
**Obtížnost nápravy:** Střední\
**Kategorie:** CWE-250 – Execution with Unnecessary Privileges

#### Vysvětlení

Task `start` používá `deno serve -A _fresh/server.js` (`deno.json:3-11`). `-A`
vypíná Deno sandbox a dává aplikaci i všem načteným závislostem neomezený
přístup k souborům, síti, environmentu, FFI a spouštění procesů. To samo
nevytváří počáteční vstup do systému, ale dramaticky zvětšuje dopad případné
budoucí RCE nebo kompromitované závislosti: útočník může číst všechna tajemství
dostupná OS uživateli, zapisovat mimo storage, komunikovat s libovolnou sítí a
spouštět další programy.

PDF renderer legitimně potřebuje spustit Chromium
(`services/pdf/chromium_pdf_renderer.ts:44-70`), ale to nevyžaduje plošné `-A`.
Je zároveň nutné počítat s tím, že subprocess běží mimo Deno sandbox, a proto
musí být izolován také operačním systémem.

#### Způsob nápravy

- Nahradit `-A` explicitním allowlistem: pouze potřebné env proměnné, databázový
  a Fio endpoint, naslouchací port, adresář `_fresh`, konkrétní storage a
  dočasný adresář a přesná cesta ke Chromiu.
- Výslovně zakázat nepotřebné `ffi`, obecné `run`, obecný filesystem a síťové
  cíle.
- Nejprve spustit staging s `DENO_AUDIT_PERMISSIONS` a z auditního logu odvodit
  minimální sadu oprávnění.
- Chromium spouštět v samostatném kontejneru/službě nebo s OS sandboxem,
  omezenou sítí, read-only root filesystemem, privátním `/tmp`, limitem
  paměti/CPU a neprivilegovaným uživatelem.
- Runtime používat s uzamčenými a předem staženými závislostmi.

Deno uvádí, že `--allow-all` bezpečnostní sandbox zcela vypíná, a doporučuje
oprávnění omezit na konkrétní zdroje:
[Deno permissions](https://docs.deno.com/runtime/reference/permissions/),
[Deno deployment guidance](https://docs.deno.com/runtime/deploy/).

### F-06: Bezpečné cookies a HSTS se při chybné konfiguraci vypnou „fail-open“

**Severita:** Střední\
**Obtížnost nápravy:** Nízká\
**Kategorie:** CWE-16 – Configuration; CWE-319 – Cleartext Transmission of
Sensitive Information

#### Vysvětlení

Pokud `APP_ENV` není nastaveno, aplikace automaticky zvolí `development`
(`config/env.ts:3-8`). Cookie helper přidá `Secure` pouze při přesné hodnotě
`production` (`services/cookie_service.ts:23-36`) a HSTS je řízeno stejnou
podmínkou (`services/security_headers.ts:71-75`). Produkční server spuštěný bez
jediné proměnné tak pokračuje bez chyby, ale session cookie může být odeslána i
přes HTTP a prohlížeč nedostane HSTS.

Zneužití vyžaduje chybu nasazení a možnost dosáhnout aplikace přes nešifrovaný
kanál nebo aktivního síťového útočníka. Runbook sice `APP_ENV=production`
požaduje (`SECURITY.md:78-79`), ale bezpečnostně významná vlastnost nemá záviset
na snadno přehlédnuté volitelné proměnné.

#### Způsob nápravy

- V produkčním buildu/start tasku vyžadovat explicitní `APP_ENV`; chybějící
  hodnotu ukončit při startu místo fallbacku.
- Přidat startup self-check, který v produkčním režimu odmítne neplatnou
  kombinaci trusted proxy/TLS konfigurace.
- Produkční session cookie přejmenovat s prefixem `__Host-`, zachovat `Path=/`,
  neuvádět `Domain` a vždy přidat `Secure`, `HttpOnly` a vhodné `SameSite`.
- Doplnit deployment test, který na skutečné HTTPS adrese kontroluje cookie
  atributy, HSTS a HTTP→HTTPS redirect.

Prefix `__Host-` v podporovaných prohlížečích vynucuje `Secure`, host-only scope
a `Path=/`:
[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

### F-07: Uploady ověřují pouze deklarovaný MIME typ a několik úvodních bajtů

**Severita:** Nízká\
**Obtížnost nápravy:** Střední\
**Kategorie:** CWE-434 – Unrestricted Upload of File with Dangerous Type

#### Vysvětlení

Přílohy přijímají klientem dodaný MIME typ a jako obsahovou kontrolu porovnají
jen prvních 3–8 bajtů (`services/expense_attachment_service.ts:29-42`,
`services/expense_attachment_service.ts:77-99`). Logo používá obdobnou kontrolu
prvních bajtů (`services/organization_settings_service.ts:18-49`). Soubor s
platnou signaturou a škodlivým, polyglotním nebo poškozeným zbytkem proto
projde.

Riziko přímého same-origin XSS snižuje náhodný storage key, autorizované
stahování, `nosniff`, explicitní MIME a sandbox CSP
(`routes/o/[organizationId]/expenses/[expenseId]/attachments/[attachmentId]/index.ts:33-48`).
Soubor však může stále zneužít chybu PDF/image parseru klienta nebo být přenesen
mimo aplikaci jako malware. Nález je proto nízký, nikoli nulový.

#### Způsob nápravy

- Obrázky plně dekódovat bezpečnou knihovnou, ověřit limity rozměrů/pixelů a
  znovu je zakódovat do čistého výstupu.
- PDF zpracovat validujícím parserem; podle rizika použít Content Disarm and
  Reconstruction (CDR).
- Přidat antivirovou/sandbox kontrolu a stav `QUARANTINED`; soubor zpřístupnit
  až po úspěšném výsledku.
- Výchozí zobrazení příloh nastavit na `attachment`, pokud není inline náhled
  nutný.
- Přidat uživatelské a organizační kvóty na počet a celkovou velikost souborů.

OWASP upozorňuje, že kontrola signatury nesmí být používána samostatně a
doporučuje více vrstev včetně parseru, antiviru/CDR a limitů:
[File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

### F-08: HTML šablony jsou filtrovány regulárními výrazy, které neodpovídají parseru prohlížeče

**Severita:** Nízká\
**Obtížnost nápravy:** Střední\
**Kategorie:** CWE-79 – Improper Neutralization of Input During Web Page
Generation (obrana do hloubky)

#### Vysvětlení

Validátor hledá elementy a nebezpečné atributy samostatnými regulárními výrazy
(`services/invoice_template_service.ts:80-105`). HTML parser však přijímá i jiné
oddělovače atributů. Auditní test potvrdil, že validátor akceptuje například:

```html
<div /onload=alert(1)>x</div>
<table /background=https://attacker.invalid/x>
  <tr>
    <td>x</td>
  </tr>
</table>
```

První vstup prohlížeč interpretuje jako event handler a druhý využívá historický
síťový atribut, který není na denylistu. V současném kódu brání praktickému
spuštění skriptu a načtení sítě silná CSP v HTTP hlavičce, další CSP ve
výsledném HTML a sandboxovaný iframe (`services/security_headers.ts:14-26`,
`routes/templates/[templateId]/index.tsx:68-83`). Proto je aktuální severita
nízká. Validátor ale neplní deklarovanou vlastnost a jediná budoucí regrese CSP
by z této chyby mohla udělat stored XSS nebo únik lokálních dat z Chromium
rendereru.

#### Způsob nápravy

- Nahradit regexový filtr standardním HTML parserem a zavedenou sanitizační
  knihovnou.
- Použít pozitivní allowlist nejen elementů, ale i atributů; pro každý element
  povolit pouze skutečně potřebné atributy, typicky `class`, případně bezpečné
  tabulkové atributy.
- Sanitizovat parsed DOM a následně jej znovu serializovat; nepoužívat blacklist
  URL nebo event atributů.
- Zachovat současnou CSP a sandbox jako nezávislou obrannou vrstvu.
- Přidat mutation-XSS corpus a regresní testy pro `/`, řídicí znaky, entity,
  chybně vnořené tagy, historické URL atributy a parser repair.

### F-09: Chybí bezpečnostní auditní stopa citlivých akcí

**Severita:** Nízká\
**Obtížnost nápravy:** Střední\
**Kategorie:** CWE-778 – Insufficient Logging

#### Vysvětlení

Aplikace neukládá strukturované bezpečnostní události pro přihlášení, změny
globálních šablon, identity organizace, bankovních credentials, vystavení
faktury, párování plateb nebo práci s přílohami. Nedostatek je uveden i v
projektové dokumentaci (`SECURITY.md:72-75`, `BACKLOG.md:12-20`).

Nejde o přímou cestu k průniku, ale výrazně zhoršuje detekci a vyšetření F-01,
kompromitovaného účtu nebo vnitřního útočníka. Neměnná historie šablon obsahuje
autora verze, což je užitečné, ale nepokrývá pokusy, výsledek akce, request
kontext ani další citlivé objekty.

#### Způsob nápravy

- Ukládat append-only události minimálně s časem, aktérem, organizací, akcí,
  typem a ID cíle, výsledkem, request/correlation ID a bezpečně odvozenou
  zdrojovou adresou.
- Nikdy nelogovat hesla, session tokeny, CSRF tokeny, Fio token ani celé
  connection stringy.
- Audit ukládat odděleně od běžných aplikačních dat nebo jej alespoň chránit
  před změnou aplikační rolí; exportovat do centrálního logovacího systému s
  retenční politikou.
- Alertovat na publikaci globální šablony, změnu bankovního napojení, opakované
  neúspěšné login pokusy a chyby integrity souborů.
- Přidat administrátorské rozhraní a postup pro pravidelnou kontrolu.

## Ověřené silné stránky

Následující kontroly byly při statické analýze nalezeny a v dostupných testech
fungovaly:

- session token má vysokou entropii, v databázi je pouze jeho SHA-256 hash,
  session má pevnou expiraci a lze ji revokovat;
- hesla používají PBKDF2-HMAC-SHA-256 s náhodnou solí a 600 000 iteracemi; login
  odpověď je generická a dummy hash omezuje jednoduchou enumeraci účtů;
- CSRF kombinuje origin kontrolu Fresh middleware a náhodný double-submit token
  porovnávaný konstantním časem;
- business repository dotazy důsledně kombinují `organization_id` s membership,
  čímž dobře brání horizontálnímu IDOR mezi organizacemi;
- uživatelské SQL hodnoty jsou parametrizované; nalezená použití `unsafe`
  skládají statické části a generované placeholdery, nikoli uživatelský SQL
  text;
- Fio token je šifrován AES-256-GCM s náhodným IV a tenant/account/provider
  kontextem jako AAD a nevrací se do veřejného view modelu;
- storage klíče jsou generované aplikací a lokální storage kontroluje únik mimo
  kořenový adresář;
- přílohy a PDF mají kontrolu velikosti a SHA-256 při čtení, citlivé odpovědi
  používají `private, no-store`, `nosniff` a přísnou CSP;
- hodnoty faktur vstupující do HTML šablony jsou escapované, preview běží v
  sandbox iframe a PDF HTML zakazuje skript i síťové zdroje pomocí CSP;
- aktuální `deno.lock` neměl podle `deno audit` v době auditu známou
  zranitelnost;
- nebyly nalezeny hard-coded produkční secrets ani běžné formáty privátních
  klíčů v Git historii.

## Doporučené pořadí nápravy

1. Zablokovat zápis globálních šablon pro běžné účty a připnout organizace ke
   schváleným verzím (F-01).
2. Prosadit skutečný streaming limit těla a ověřit limit na proxy (F-02).
3. Zavést throttling loginu a horní limit hesla (F-03).
4. Schválit a vynutit autorizační matici `OWNER`/`MEMBER` před zpřístupněním
   správy členství (F-04).
5. Omezit runtime oprávnění a udělat produkční konfiguraci fail-closed (F-05,
   F-06).
6. Nahradit regex sanitizaci parserem, posílit upload pipeline a doplnit auditní
   log (F-07 až F-09).
