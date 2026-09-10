import { App, csrf, type Middleware } from "fresh";
import { closeDb, getDb } from "@/database/client.ts";
import { migrate } from "@/database/migrate.ts";
import { hashPassword } from "@/domain/auth/password.ts";
import { PostgresAuthRepository } from "@/repositories/auth_repository.ts";
import { PostgresBankAccountRepository } from "@/repositories/bank_account_repository.ts";
import { PostgresBankConnectionRepository } from "@/repositories/bank_connection_repository.ts";
import { PostgresBankTransactionRepository } from "@/repositories/bank_transaction_repository.ts";
import { PostgresContactRepository } from "@/repositories/contact_repository.ts";
import { PostgresExpenseAttachmentRepository } from "@/repositories/expense_attachment_repository.ts";
import { PostgresExpenseCategoryRepository } from "@/repositories/expense_category_repository.ts";
import { PostgresExpensePaymentRepository } from "@/repositories/expense_payment_repository.ts";
import { PostgresExpenseRepository } from "@/repositories/expense_repository.ts";
import {
  hashSessionToken,
  SESSION_COOKIE_NAME,
} from "@/services/auth_service.ts";
import { BankConnectionService } from "@/services/banking/bank_connection_service.ts";
import { AesGcmCredentialCipher } from "@/services/banking/credential_cipher.ts";
import { CSRF_COOKIE_NAME } from "@/services/csrf_service.ts";
import { readVerifiedExpenseAttachment } from "@/services/expense_attachment_service.ts";
import { requestContextMiddleware } from "@/services/request_context_middleware.ts";
import { MAX_REQUEST_CONTENT_LENGTH } from "@/services/security_headers.ts";
import { getObjectStorage } from "@/services/storage/storage_factory.ts";
import { handler as dashboardHandler } from "@/routes/dashboard.tsx";
import { handler as loginHandler } from "@/routes/login.tsx";
import { handler as logoutHandler } from "@/routes/logout.tsx";
import organizationScopeMiddleware from "@/routes/o/[organizationId]/_middleware.ts";
import { handler as bankingHandler } from "@/routes/o/[organizationId]/banking/index.tsx";
import { handler as editContactHandler } from "@/routes/o/[organizationId]/contacts/[contactId]/edit.tsx";
import { handler as newContactHandler } from "@/routes/o/[organizationId]/contacts/new.tsx";
import { handler as attachmentHandler } from "@/routes/o/[organizationId]/expenses/[expenseId]/attachments/index.ts";
import { handler as newExpenseHandler } from "@/routes/o/[organizationId]/expenses/new.tsx";
import { handler as newOrganizationHandler } from "@/routes/organizations/new.tsx";
import type { State } from "@/utils.ts";

const testDatabaseUrl = Deno.env.get("TEST_DATABASE_URL");
const ORIGIN = "http://fakturomat.test";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function routeMethod(handler: unknown, method: "POST"): Middleware<State> {
  assert(
    typeof handler === "object" && handler !== null && method in handler,
    `route does not implement ${method}`,
  );
  const candidate = (handler as Record<string, unknown>)[method];
  assert(typeof candidate === "function", `route ${method} is not callable`);
  return candidate as Middleware<State>;
}

function responseOnly(handler: unknown): Middleware<State> {
  assert(typeof handler === "function", "route handler is not callable");
  return handler as Middleware<State>;
}

function createHttpTestHandler(): (request: Request) => Promise<Response> {
  const app = new App<State>();
  app.use(csrf());
  app.use(requestContextMiddleware);
  app.get("/_test/context", (ctx) =>
    Response.json({
      authenticated: ctx.state.user !== null,
      csrfToken: ctx.state.csrfToken,
    }));
  app.post("/login", routeMethod(loginHandler, "POST"));
  app.post("/logout", routeMethod(logoutHandler, "POST"));
  app.get("/dashboard", responseOnly(dashboardHandler));
  app.post(
    "/organizations/new",
    routeMethod(newOrganizationHandler, "POST"),
  );
  app.get(
    "/o/:organizationId/probe",
    organizationScopeMiddleware,
    (ctx) => Response.json(ctx.state.currentOrganization),
  );
  app.post(
    "/o/:organizationId/contacts/new",
    organizationScopeMiddleware,
    routeMethod(newContactHandler, "POST"),
  );
  app.post(
    "/o/:organizationId/contacts/:contactId/edit",
    organizationScopeMiddleware,
    routeMethod(editContactHandler, "POST"),
  );
  app.post(
    "/o/:organizationId/expenses/new",
    organizationScopeMiddleware,
    routeMethod(newExpenseHandler, "POST"),
  );
  app.post(
    "/o/:organizationId/expenses/:expenseId/attachments",
    organizationScopeMiddleware,
    routeMethod(attachmentHandler, "POST"),
  );
  app.post(
    "/o/:organizationId/banking",
    organizationScopeMiddleware,
    routeMethod(bankingHandler, "POST"),
  );
  return app.handler();
}

function cookieValue(response: Response, name: string): string {
  for (const setCookie of response.headers.getSetCookie()) {
    const match = setCookie.match(new RegExp(`(?:^|\\s)${name}=([^;]*)`));
    if (match) return match[1];
  }
  throw new Error(`Response did not set cookie ${name}`);
}

function formRequest(
  path: string,
  cookie: string,
  values: URLSearchParams,
  origin = ORIGIN,
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { cookie, origin },
    body: values,
  });
}

async function csrfSession(
  handler: (request: Request) => Promise<Response>,
): Promise<{ token: string; cookie: string }> {
  const response = await handler(new Request(`${ORIGIN}/_test/context`));
  assert(response.status === 200, "CSRF bootstrap did not reach the router");
  const token = cookieValue(response, CSRF_COOKIE_NAME);
  return { token, cookie: `${CSRF_COOKIE_NAME}=${token}` };
}

async function login(
  handler: (request: Request) => Promise<Response>,
  email: string,
  password: string,
): Promise<{
  csrfToken: string;
  cookie: string;
  rawSessionToken: string;
  response: Response;
}> {
  const csrfState = await csrfSession(handler);
  const values = new URLSearchParams({
    csrf_token: csrfState.token,
    email,
    password,
  });
  const response = await handler(
    formRequest("/login", csrfState.cookie, values),
  );
  assert(response.status === 303, `login returned ${response.status}`);
  const rawSessionToken = cookieValue(response, SESSION_COOKIE_NAME);
  return {
    csrfToken: csrfState.token,
    cookie: `${csrfState.cookie}; ${SESSION_COOKIE_NAME}=${rawSessionToken}`,
    rawSessionToken,
    response,
  };
}

function idFromLocation(response: Response, segment: string): string {
  const location = response.headers.get("location");
  assert(location !== null, "redirect is missing Location");
  const match = new URL(location, ORIGIN).pathname.match(
    new RegExp(`/${segment}/([0-9a-f-]{36})$`),
  );
  assert(match !== null, `unexpected redirect location ${location}`);
  return match[1];
}

Deno.test({
  name:
    "HTTP integration: auth, CSRF, tenant scope and received expense workflow",
  ignore: testDatabaseUrl === undefined,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const previousDatabaseUrl = Deno.env.get("DATABASE_URL");
    const previousAppEnv = Deno.env.get("APP_ENV");
    const previousStorageRoot = Deno.env.get("STORAGE_LOCAL_ROOT");
    const storageRoot = await Deno.makeTempDir({ prefix: "fakturomat-http-" });
    Deno.env.set("DATABASE_URL", testDatabaseUrl!);
    Deno.env.set("APP_ENV", "test");
    Deno.env.set("STORAGE_LOCAL_ROOT", storageRoot);
    await migrate();

    const sql = getDb();
    const authRepository = new PostgresAuthRepository(sql);
    const ownerId = crypto.randomUUID();
    const outsiderId = crypto.randomUUID();
    const ownerEmail = `http-owner-${ownerId}@example.test`;
    const outsiderEmail = `http-outsider-${outsiderId}@example.test`;
    let organizationId: string | null = null;

    try {
      const password = "integration-password";
      const passwordHash = await hashPassword(password, 10_000);
      await authRepository.createUser({
        id: ownerId,
        email: ownerEmail,
        displayName: "HTTP owner",
        passwordHash,
      });
      await authRepository.createUser({
        id: outsiderId,
        email: outsiderEmail,
        displayName: "HTTP outsider",
        passwordHash,
      });

      const handler = createHttpTestHandler();
      const ownerCsrf = await csrfSession(handler);
      const crossOriginLogin = await handler(
        formRequest(
          "/login",
          ownerCsrf.cookie,
          new URLSearchParams({
            csrf_token: ownerCsrf.token,
            email: ownerEmail,
            password,
          }),
          "https://attacker.example",
        ),
      );
      assert(
        crossOriginLogin.status === 403,
        "cross-origin login POST bypassed Fresh CSRF protection",
      );

      const oversized = await handler(
        new Request(`${ORIGIN}/login`, {
          method: "POST",
          headers: {
            cookie: ownerCsrf.cookie,
            origin: ORIGIN,
            "content-length": String(MAX_REQUEST_CONTENT_LENGTH + 1),
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "csrf_token=x",
        }),
      );
      assert(oversized.status === 413, "oversized request was not rejected");
      assert(
        oversized.headers.get("x-content-type-options") === "nosniff",
        "oversized response is missing security headers",
      );

      const owner = await login(handler, ownerEmail, password);
      assert(
        owner.response.headers.get("location")?.endsWith("/dashboard") ??
          false,
        "login did not redirect to dashboard",
      );
      assert(
        owner.response.headers.getSetCookie().some((cookie) =>
          cookie.startsWith(`${SESSION_COOKIE_NAME}=`) &&
          cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax")
        ),
        "session cookie is missing security attributes",
      );
      assert(
        owner.response.headers.get("content-security-policy") !== null,
        "authenticated response is missing CSP",
      );

      const organizationResponse = await handler(formRequest(
        "/organizations/new",
        owner.cookie,
        new URLSearchParams({
          csrf_token: owner.csrfToken,
          type: "SRO",
          official_name: "HTTP Workflow s.r.o.",
          display_name: "HTTP Workflow",
        }),
      ));
      assert(
        organizationResponse.status === 303,
        `organization creation returned ${organizationResponse.status}`,
      );
      const organizationLocation = organizationResponse.headers.get(
        "location",
      );
      assert(organizationLocation !== null, "organization redirect is missing");
      const organizationMatch = new URL(organizationLocation, ORIGIN).pathname
        .match(/^\/o\/([0-9a-f-]{36})\/dashboard$/);
      assert(organizationMatch !== null, "organization redirect is malformed");
      organizationId = organizationMatch[1];

      const dashboardResponse = await handler(
        new Request(
          `${ORIGIN}/dashboard`,
          { headers: { cookie: owner.cookie } },
        ),
      );
      assert(
        dashboardResponse.status === 302 &&
          dashboardResponse.headers.get("location")?.includes(
              `/o/${organizationId}/dashboard`,
            ) === true,
        "dashboard did not select the user's organization",
      );

      const contactResponse = await handler(formRequest(
        `/o/${organizationId}/contacts/new`,
        owner.cookie,
        new URLSearchParams({
          csrf_token: owner.csrfToken,
          type: "COMPANY",
          name: "HTTP Supplier s.r.o.",
          ico: "12345678",
          street: "Dodavatelská 12",
          city: "Praha",
          postal_code: "110 00",
          country: "CZ",
          email: "supplier@example.test",
          default_due_days: "14",
        }),
      ));
      assert(
        contactResponse.status === 303,
        "contact was not created over HTTP",
      );
      const contactId = idFromLocation(contactResponse, "contacts");

      const outsider = await login(handler, outsiderEmail, password);
      const foreignRead = await handler(
        new Request(
          `${ORIGIN}/o/${organizationId}/probe`,
          { headers: { cookie: outsider.cookie } },
        ),
      );
      assert(
        foreignRead.status === 404,
        "organization middleware exposed a foreign tenant",
      );
      const foreignUpdate = await handler(formRequest(
        `/o/${organizationId}/contacts/${contactId}/edit`,
        outsider.cookie,
        new URLSearchParams({
          csrf_token: outsider.csrfToken,
          type: "COMPANY",
          name: "Hijacked supplier",
          country: "CZ",
        }),
      ));
      assert(
        foreignUpdate.status === 404,
        "organization middleware allowed a foreign tenant update",
      );
      assert(
        (await new PostgresContactRepository(sql).findForUser(
          organizationId,
          contactId,
          ownerId,
        ))?.name === "HTTP Supplier s.r.o.",
        "foreign update changed the contact",
      );

      const categories = await new PostgresExpenseCategoryRepository(sql)
        .listForUser(organizationId, ownerId, true);
      const category = categories.find((item) => item.name === "Ostatní");
      assert(category !== undefined, "default expense category is missing");
      const expenseValues = new URLSearchParams({
        csrf_token: owner.csrfToken,
        contact_id: contactId,
        document_type: "INVOICE",
        supplier_name: "HTTP Supplier s.r.o.",
        supplier_invoice_number: "PF-HTTP-19",
        issue_date: "2026-09-09",
        taxable_supply_date: "2026-09-09",
        due_date: "2026-09-23",
        payment_date: "",
        description: "Kompletní HTTP integrační tok",
        category_id: category.id,
        currency: "CZK",
        total_amount: "1770",
        note: "Etapa 19",
      });
      expenseValues.append("vat_rate", "21");
      expenseValues.append("vat_base_amount", "1000");
      expenseValues.append("vat_amount", "210");
      expenseValues.append("vat_rate", "12");
      expenseValues.append("vat_base_amount", "500");
      expenseValues.append("vat_amount", "60");
      const expenseResponse = await handler(formRequest(
        `/o/${organizationId}/expenses/new`,
        owner.cookie,
        expenseValues,
      ));
      assert(
        expenseResponse.status === 303,
        "expense was not created over HTTP",
      );
      const expenseId = idFromLocation(expenseResponse, "expenses");
      const expenseRepository = new PostgresExpenseRepository(sql);
      const expense = await expenseRepository.findForUser(
        organizationId,
        expenseId,
        ownerId,
      );
      assert(
        expense?.totalAmount === "1770.00" && expense.vatLines.length === 2 &&
          expense.vatBaseTotal === "1500.00" &&
          expense.vatAmountTotal === "270.00",
        "HTTP expense did not preserve total and VAT lines",
      );

      const attachmentForm = new FormData();
      attachmentForm.set("csrf_token", owner.csrfToken);
      attachmentForm.set(
        "attachment",
        new File(["%PDF-1.7\nHTTP received invoice"], "doklad.pdf", {
          type: "application/pdf",
        }),
      );
      const attachmentResponse = await handler(
        new Request(
          `${ORIGIN}/o/${organizationId}/expenses/${expenseId}/attachments`,
          {
            method: "POST",
            headers: { cookie: owner.cookie, origin: ORIGIN },
            body: attachmentForm,
          },
        ),
      );
      assert(
        attachmentResponse.status === 303 &&
          attachmentResponse.headers.get("location")?.includes(
              "attachment_uploaded=1",
            ) === true,
        "PDF attachment was not uploaded over HTTP",
      );
      const attachments = await new PostgresExpenseAttachmentRepository(sql)
        .listForExpenseForUser(organizationId, expenseId, ownerId);
      assert(attachments.length === 1, "attachment metadata is missing");
      const attachmentBytes = await readVerifiedExpenseAttachment(
        getObjectStorage(),
        attachments[0],
      );
      assert(
        new TextDecoder().decode(attachmentBytes) ===
          "%PDF-1.7\nHTTP received invoice",
        "stored HTTP attachment failed integrity verification",
      );

      const bankAccount = await new PostgresBankAccountRepository(sql)
        .createForUser({
          id: crypto.randomUUID(),
          organizationId,
          userId: ownerId,
          name: "HTTP expense account",
          bankName: "Test bank",
          accountPrefix: null,
          accountNumber: "123456789",
          bankCode: "0100",
          iban: null,
          bic: null,
          currency: "CZK",
          isDefault: true,
          isActive: true,
        });
      assert(bankAccount !== null, "bank account setup failed");
      const connectionRepository = new PostgresBankConnectionRepository(sql);
      const connection = await new BankConnectionService(
        connectionRepository,
        new AesGcmCredentialCipher(new Uint8Array(32).fill(29)),
      ).configureFio({
        organizationId,
        bankAccountId: bankAccount.id,
        userId: ownerId,
        token: "HttpWorkflowFioToken123456",
        enabled: true,
      });
      assert(connection !== null, "bank connection setup failed");
      const transactionRepository = new PostgresBankTransactionRepository(sql);
      const transactionBatch = {
        organizationId,
        bankAccountId: bankAccount.id,
        userId: ownerId,
        provider: "FIO" as const,
        transactions: [{
          providerTransactionId: "http-expense-payment-19",
          bookingDate: "2026-09-10",
          amount: "-1770.0000",
          currency: "CZK",
          counterpartyAccount: "987654321",
          counterpartyBankCode: "0300",
          counterpartyName: "HTTP Supplier s.r.o.",
          variableSymbol: "19",
          constantSymbol: null,
          specificSymbol: null,
          message: "Úhrada PF-HTTP-19",
          rawData: { source: "http-integration" },
        }],
        balance: null,
      };
      assert(
        (await transactionRepository.importForUser(transactionBatch))
              ?.inserted === 1 &&
          (await transactionRepository.importForUser(transactionBatch))
              ?.inserted === 0,
        "repeated bank import was not idempotent",
      );
      const transactions = await transactionRepository.listForUser({
        organizationId,
        userId: ownerId,
        bankAccountId: bankAccount.id,
        direction: "OUTGOING",
        dateFrom: null,
        dateTo: null,
      });
      assert(transactions.length === 1, "imported transaction is missing");
      const matchResponse = await handler(formRequest(
        `/o/${organizationId}/banking`,
        owner.cookie,
        new URLSearchParams({
          csrf_token: owner.csrfToken,
          intent: "manual_expense_match",
          bank_transaction_id: transactions[0].id,
          expense_id: expenseId,
        }),
      ));
      assert(
        matchResponse.status === 303 &&
          matchResponse.headers.get("location")?.includes(
              "expense_matched=1",
            ) === true,
        "expense was not matched over the banking HTTP handler",
      );
      const payments = await new PostgresExpensePaymentRepository(sql)
        .listForExpenseForUser(organizationId, expenseId, ownerId);
      assert(
        payments.length === 1 && payments[0].amount === "1770.0000",
        "manual HTTP expense match persisted an incorrect allocation",
      );

      const badLogout = await handler(formRequest(
        "/logout",
        owner.cookie,
        new URLSearchParams({ csrf_token: outsider.csrfToken }),
      ));
      assert(badLogout.status === 403, "logout accepted a foreign CSRF token");
      assert(
        await authRepository.findSessionUser(
          await hashSessionToken(owner.rawSessionToken),
        ) !== null,
        "failed CSRF logout revoked the session",
      );
      const logoutResponse = await handler(formRequest(
        "/logout",
        owner.cookie,
        new URLSearchParams({ csrf_token: owner.csrfToken }),
      ));
      assert(logoutResponse.status === 303, "valid logout did not redirect");
      assert(
        logoutResponse.headers.getSetCookie().some((cookie) =>
          cookie.startsWith(`${SESSION_COOKIE_NAME}=`) &&
          cookie.includes("Max-Age=0")
        ),
        "logout did not expire the session cookie",
      );
      assert(
        await authRepository.findSessionUser(
          await hashSessionToken(owner.rawSessionToken),
        ) === null,
        "logout did not revoke the server-side session",
      );
    } finally {
      if (organizationId !== null) {
        await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
      }
      await sql`DELETE FROM users WHERE id IN (${ownerId}, ${outsiderId})`;
      await closeDb();
      await Deno.remove(storageRoot, { recursive: true });
      if (previousDatabaseUrl === undefined) Deno.env.delete("DATABASE_URL");
      else Deno.env.set("DATABASE_URL", previousDatabaseUrl);
      if (previousAppEnv === undefined) Deno.env.delete("APP_ENV");
      else Deno.env.set("APP_ENV", previousAppEnv);
      if (previousStorageRoot === undefined) {
        Deno.env.delete("STORAGE_LOCAL_ROOT");
      } else {
        Deno.env.set("STORAGE_LOCAL_ROOT", previousStorageRoot);
      }
    }
  },
});
