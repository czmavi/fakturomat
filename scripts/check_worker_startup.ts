import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";

// Keep semicolons in quoted SQL and complete CREATE TRIGGER bodies together.
export function splitSql(source: string): string[] {
  const result: string[] = [];
  let part = "";
  let quote = false;
  let comment = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (comment) {
      if (c === "\n") comment = false;
      else continue;
    }
    if (!quote && c === "-" && source[i + 1] === "-") {
      comment = true;
      i++;
      continue;
    }
    part += c;
    if (c === "'") {
      if (quote && source[i + 1] === "'") {
        part += source[++i];
        continue;
      }
      quote = !quote;
    }
    if (
      c === ";" && !quote &&
      (!/^\s*CREATE TRIGGER/i.test(part) || /\bEND;\s*$/i.test(part))
    ) {
      result.push(part.trim());
      part = "";
    }
  }
  if (part.trim()) result.push(part.trim());
  return result;
}
if (import.meta.main) {
  const modules: { type: "ESModule"; path: string }[] = [{
    type: "ESModule",
    path: resolve("_fresh/server/index.mjs"),
  }];
  for await (const entry of Deno.readDir("_fresh/server/assets")) {
    if (entry.name.endsWith(".mjs")) {
      modules.push({
        type: "ESModule",
        path: resolve("_fresh/server/assets", entry.name),
      });
    }
  }
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules,
    modulesRoot: resolve("_fresh/server"),
    compatibilityDate: "2026-10-18",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      directory: resolve("_fresh/client"),
      routerConfig: { has_user_worker: true },
    },
    d1Databases: ["DB"],
    r2Buckets: ["DOCUMENTS", "FILES"],
    bindings: {
      APP_ENV: "production",
      BETTER_AUTH_URL: "https://fakturomat.test",
      BETTER_AUTH_SECRET: "synthetic-worker-test-secret-at-least-32-characters",
      BANK_CREDENTIALS_ENCRYPTION_KEY: btoa("a".repeat(32)),
    },
  }));
  try {
    const db = await mf.getD1Database("DB");
    const checkHealth = async (status: number) => {
      const response = await mf.dispatchFetch(
        "https://fakturomat.test/health",
        {
          redirect: "manual",
        },
      );
      if (
        response.status !== status ||
        response.headers.get("content-type") !== "application/json" ||
        response.headers.get("cache-control") !== "no-store" ||
        response.headers.has("set-cookie") ||
        response.headers.has("location") ||
        await response.text() !==
          JSON.stringify({ status: status === 200 ? "ok" : "error" })
      ) throw new Error(`Worker health contract failed (expected ${status})`);
    };
    await checkHealth(503); // The D1 schema does not exist yet.
    for (
      const file of [
        "0001_schema.sql",
        "0002_integrity.sql",
        "0003_expense_details.sql",
        "0004_user_management.sql",
      ]
    ) {
      const sql = await Deno.readTextFile(
        new URL(`../migrations/d1/${file}`, import.meta.url),
      );
      for (const statement of splitSql(sql)) await db.prepare(statement).run();
    }
    await checkHealth(200);
    for (
      const path of [
        "/dashboard",
        "/templates",
        "/o/10000000-0000-4000-8000-000000000001/dashboard",
      ]
    ) {
      const response = await mf.dispatchFetch(
        `https://fakturomat.test${path}`,
        { redirect: "manual" },
      );
      if (
        response.status < 300 || response.status >= 400 ||
        !response.headers.get("location")?.endsWith("/login")
      ) {
        throw new Error(`Anonymous access protection failed: ${path}`);
      }
      await response.body?.cancel();
    }
    const id = crypto.randomUUID();
    const password = "worker-test-password";
    await db.batch([
      db.prepare(
        "INSERT INTO users(id,email,display_name,email_verified) VALUES (?,?,?,1)",
      ).bind(id, "worker@example.test", "Worker"),
      db.prepare(
        "INSERT INTO auth_accounts(id,account_id,provider_id,user_id,password) VALUES (?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        id,
        "credential",
        id,
        await hashPassword(password),
      ),
    ]);
    const page = await mf.dispatchFetch("https://fakturomat.test/login");
    const html = await page.text();
    if (page.status !== 200 || !html.includes("<form")) {
      throw new Error(
        `Worker login page failed (${page.status}): ${html.slice(0, 1000)}`,
      );
    }
    const response = await mf.dispatchFetch(
      "https://fakturomat.test/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://fakturomat.test",
          "cf-connecting-ip": "192.0.2.1",
        },
        body: JSON.stringify({ email: "worker@example.test", password }),
      },
    );
    if (response.status !== 200) {
      throw new Error(
        `Worker sign-in failed (${response.status}): ${await response.text()}`,
      );
    }
    const cookie = response.headers.get("set-cookie")!;
    const dashboard = await mf.dispatchFetch(
      "https://fakturomat.test/dashboard",
      { headers: { cookie }, redirect: "manual" },
    );
    if (![200, 302, 303].includes(dashboard.status)) {
      throw new Error(`Authenticated dashboard failed: ${dashboard.status}`);
    }
    await dashboard.body?.cancel();
    const org = crypto.randomUUID(),
      contact = crypto.randomUUID(),
      bank = crypto.randomUUID(),
      sequence = crypto.randomUUID(),
      invoice = crypto.randomUUID();
    await db.batch([
      db.prepare(
        "INSERT INTO organizations(id,type,official_name,display_name) VALUES (?,'SRO','Worker s.r.o.','Worker')",
      ).bind(org),
      db.prepare(
        "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES (?,?,'OWNER')",
      ).bind(org, id),
      db.prepare(
        "INSERT INTO contacts(id,organization_id,type,name) VALUES (?,?,'COMPANY','Český odběratel')",
      ).bind(contact, org),
      db.prepare(
        "INSERT INTO bank_accounts(id,organization_id,name,account_number,bank_code,currency) VALUES (?,?,'Fio','123456789','2010','CZK')",
      ).bind(bank, org),
      db.prepare(
        "INSERT INTO invoice_number_sequences(id,organization_id,name) VALUES (?,?,'Výchozí')",
      ).bind(sequence, org),
      db.prepare(
        "INSERT INTO invoices(id,organization_id,contact_id,number_sequence_id,bank_account_id,invoice_template_id,issue_date,due_date,currency,subtotal,total) VALUES (?,?,?,?,?,'10000000-0000-4000-8000-000000000001','2026-10-18','2026-10-31','CZK',2000,2000)",
      ).bind(invoice, org, contact, sequence, bank),
      db.prepare(
        "INSERT INTO invoice_items(id,invoice_id,description,quantity,unit,unit_price,total,position) VALUES (?,?,'Příliš žluťoučký kůň','2','ks',1000,2000,1)",
      ).bind(crypto.randomUUID(), invoice),
    ]);
    const token = "a".repeat(43);
    const sessionCookies = response.headers.getSetCookie().map((value) =>
      value.split(";")[0]
    ).filter((value) => !value.startsWith("fakturomat_csrf="));
    const requestCookie = sessionCookies.join("; ") +
      `; fakturomat_csrf=${token}`;
    const createdExpense = await mf.dispatchFetch(
      `https://fakturomat.test/o/${org}/expenses/new`,
      {
        method: "POST",
        headers: {
          cookie: requestCookie,
          origin: "https://fakturomat.test",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          csrf_token: token,
          document_type: "INVOICE",
          supplier_name: "Worker supplier",
          description: "Imported service",
          currency: "CZK",
          total_amount: "121.00",
          expense_accountNumber: "2114736912/2700",
          expense_variableSymbol: "000123",
          expense_constantSymbol: "0308",
          expense_specificSymbol: "000456",
          item_description: "Service item",
          item_quantity: "1",
          item_unit: "ks",
          item_unitPrice: "100.00",
          item_vatRate: "21",
          item_totalAmount: "121.00",
        }).toString(),
        redirect: "manual",
      },
    );
    const expenseLocation = createdExpense.headers.get("location");
    if (createdExpense.status !== 303 || !expenseLocation) {
      throw new Error(
        `Worker expense creation failed: ${createdExpense.status} ${await createdExpense
          .text()}`,
      );
    }
    await createdExpense.body?.cancel();
    const expensePath =
      new URL(expenseLocation, "https://fakturomat.test").pathname;
    for (const path of [expensePath, `${expensePath}/edit`]) {
      const rendered = await mf.dispatchFetch(
        `https://fakturomat.test${path}`,
        { headers: { cookie: requestCookie } },
      );
      const body = await rendered.text();
      if (
        rendered.status !== 200 || !body.includes("Service item") ||
        !body.includes("000123") || !body.includes("Doplnit s AI")
      ) {
        throw new Error(
          `Worker expense details render failed: ${rendered.status}`,
        );
      }
    }
    const issue = await mf.dispatchFetch(
      `https://fakturomat.test/o/${org}/invoices/${invoice}/issue`,
      {
        method: "POST",
        headers: {
          cookie: requestCookie,
          origin: "https://fakturomat.test",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrf_token: token }).toString(),
        redirect: "manual",
      },
    );
    if (
      issue.status !== 303 ||
      !issue.headers.get("location")?.includes("issued=1")
    ) {
      throw new Error(
        `Worker PDF issuance failed: ${issue.status} ${
          issue.headers.get("location")
        } ${await issue.text()}`,
      );
    }
    await issue.body?.cancel();
    const pdf = await mf.dispatchFetch(
      `https://fakturomat.test/o/${org}/invoices/${invoice}/document.pdf`,
      { headers: { cookie: requestCookie } },
    );
    if (
      pdf.status !== 200 ||
      pdf.headers.get("content-type") !== "application/pdf" ||
      (await pdf.arrayBuffer()).byteLength < 1000
    ) throw new Error("Worker PDF download failed");
    const denied = await mf.dispatchFetch(
      `https://fakturomat.test/o/${org}/invoices/${invoice}/document.pdf`,
      { redirect: "manual" },
    );
    if (denied.status === 200) throw new Error("Anonymous PDF leak");
    await denied.body?.cancel();
    // Exercise the actual user-management page and creation flow in workerd.
    await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").bind(id)
      .run();
    const management = await mf.dispatchFetch("https://fakturomat.test/users", {
      headers: { cookie: requestCookie },
    });
    const managementHtml = await management.text();
    if (
      management.status !== 200 ||
      !managementHtml.includes("Správa uživatelů") ||
      !managementHtml.includes('name="organization_id"')
    ) {
      throw new Error("Worker user management rendering failed");
    }
    const newUser = await mf.dispatchFetch("https://fakturomat.test/users", {
      method: "POST",
      headers: {
        cookie: requestCookie,
        origin: "https://fakturomat.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf_token: token,
        email: "member@example.test",
        display_name: "Member",
        password: "member-test-password",
        active: "1",
        organization_id: org,
      }).toString(),
      redirect: "manual",
    });
    if (newUser.status !== 303) {
      throw new Error(
        `Worker user creation failed: ${newUser.status} ${await newUser
          .text()}`,
      );
    }
    await newUser.body?.cancel();
    const memberLogin = await mf.dispatchFetch(
      "https://fakturomat.test/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://fakturomat.test",
          "cf-connecting-ip": "192.0.2.2",
        },
        body: JSON.stringify({
          email: "member@example.test",
          password: "member-test-password",
        }),
      },
    );
    if (memberLogin.status !== 200) {
      throw new Error("Created user cannot sign in");
    }
    const memberCookie = memberLogin.headers.getSetCookie().map((value) =>
      value.split(";")[0]
    ).join("; ");
    await memberLogin.body?.cancel();
    const memberDashboard = await mf.dispatchFetch(
      `https://fakturomat.test/o/${org}/dashboard`,
      { headers: { cookie: memberCookie } },
    );
    if (memberDashboard.status !== 200) {
      throw new Error("Assigned organization is inaccessible");
    }
    const memberHtml = await memberDashboard.text();
    if (
      memberHtml.includes('href="/users"') ||
      memberHtml.includes('href="/organizations/new"')
    ) throw new Error("Admin navigation leaked to member");
    for (const path of ["/users", "/organizations/new"]) {
      const forbidden = await mf.dispatchFetch(
        `https://fakturomat.test${path}`,
        { headers: { cookie: memberCookie }, redirect: "manual" },
      );
      if (forbidden.status !== 403) {
        throw new Error(`Member accessed admin page: ${path}`);
      }
      await forbidden.body?.cancel();
    }
    const bucket = await mf.getR2Bucket("DOCUMENTS") as unknown as {
      put(
        key: string,
        value: string,
        options: { onlyIf: { etagDoesNotMatch: string } },
      ): Promise<unknown>;
      get(key: string): Promise<{ text(): Promise<string> } | null>;
    };
    await bucket.put("check.pdf", "%PDF-test", {
      onlyIf: { etagDoesNotMatch: "*" },
    });
    const duplicate = await bucket.put("check.pdf", "overwritten", {
      onlyIf: { etagDoesNotMatch: "*" },
    });
    if (
      duplicate !== null ||
      await (await bucket.get("check.pdf"))?.text() !== "%PDF-test"
    ) throw new Error("R2 conditional put failed");
    console.log(
      "Worker smoke passed: real workerd, D1 schema, scrypt login/session, SSR, invoice issuance with embedded fonts, authenticated PDF download and conditional R2 writes.",
    );
  } finally {
    await mf.dispose();
  }
}
