import type { D1Database, D1Statement } from "@/config/runtime.ts";

export function money(value: string | null): number | null {
  if (value === null) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) throw new Error("Invalid fixed-point amount");
  const units = BigInt(match[2]) * 10000n +
    BigInt((match[3] ?? "").padEnd(4, "0"));
  const signed = match[1] ? -units : units;
  if (
    signed > BigInt(Number.MAX_SAFE_INTEGER) ||
    signed < -BigInt(Number.MAX_SAFE_INTEGER)
  ) throw new Error("Amount exceeds D1 exact integer range");
  return Number(signed);
}
export function decimal(value: number | string): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("D1 aggregate exceeds exact integer range");
  }
  const units = BigInt(value);
  const absolute = units < 0n ? -units : units;
  const fraction = (absolute % 10000n).toString().padStart(4, "0");
  return `${units < 0n ? "-" : ""}${absolute / 10000n}.${
    fraction.endsWith("00") ? fraction.slice(0, 2) : fraction
  }`;
}
const monetary = new Set([
  "amount",
  "total",
  "subtotal",
  "unit_price",
  "total_amount",
  "base_amount",
  "vat_amount",
  "vat_base_total",
  "vat_amount_total",
  "current_balance",
  "paid_amount",
  "remaining_amount",
  "overdue_amount",
  "transaction_remaining",
  "invoice_remaining",
  "expense_remaining",
]);
const booleans = new Set([
  "is_active",
  "is_default",
  "email_verified",
  "allowed",
]);
const json = new Set([
  "supplier_snapshot",
  "customer_snapshot",
  "bank_account_snapshot",
  "raw_data",
]);
function decode(row: Record<string, unknown>) {
  for (const [key, value] of Object.entries(row)) {
    if (value === null) continue;
    if (monetary.has(key)) row[key] = decimal(value as number | string);
    else if (booleans.has(key)) row[key] = Boolean(value);
    else if (key.endsWith("_at")) row[key] = new Date(value as number);
    else if (json.has(key) && typeof value === "string") {
      row[key] = JSON.parse(value);
    } else if (key === "revision" || key === "last_value") {
      row[key] = String(value);
    }
  }
  return row;
}
export class Query<T> implements PromiseLike<T> {
  constructor(
    readonly text: string,
    readonly params: unknown[],
    private readonly execute: (query: Query<T>) => Promise<T>,
  ) {}
  then<TResult1 = T, TResult2 = never>(
    resolve?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute(this).then(resolve, reject);
  }
}
export interface Sql {
  <T = Record<string, unknown>[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Query<T>;
  unsafe<T = Record<string, unknown>[]>(
    text: string,
    params?: unknown[],
  ): Query<T>;
  json(value: unknown): string;
  begin<T>(
    callback: (
      transaction: TransactionSql,
    ) => T | After<T> | Promise<T | After<T>>,
  ): Promise<T>;
  end(options?: unknown): Promise<void>;
}
export interface TransactionSql extends Sql {
  queue<T>(query: Query<T>): Pending<T>;
  after<T>(callback: () => T | Promise<T>): After<T>;
}
export class Pending<T> {
  value!: T;
}
export class After<T> {
  constructor(readonly callback: () => T | Promise<T>) {}
}
function bind(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "boolean") return Number(value);
  if (value === undefined) throw new Error("Undefined SQL parameter");
  return value;
}
/** Prepared SQL only. Transactions plan reads and explicitly queue writes; no I/O side effects in callbacks. */
export function createD1Sql(db: D1Database): Sql {
  function statement(query: { text: string; params: unknown[] }): D1Statement {
    const values: unknown[] = [];
    // SQL source is owned by the application. Replace positional placeholders outside string literals.
    const text = query.text.replace(
      /'(?:''|[^'])*'|\$(\d+)/g,
      (token, index) => {
        if (!index) return token;
        values.push(bind(query.params[Number(index) - 1]));
        return "?";
      },
    );
    return db.prepare(text).bind(...values);
  }
  async function execute<T>(query: Query<T>): Promise<T> {
    const result = await statement(query).all();
    return result.results.map(decode) as T;
  }
  function make(executor: typeof execute): Sql {
    const sql = (<T>(strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = strings[0];
      const params: unknown[] = [];
      values.forEach((value, i) => {
        if (value instanceof Query) {
          if (value.params.length) {
            throw new Error(
              "Only parameter-free SQL fragments can be embedded",
            );
          }
          text += value.text;
        } else {
          params.push(value);
          text += `$${params.length}`;
        }
        text += strings[i + 1];
      });
      return new Query<T>(text, params, executor);
    }) as Sql;
    sql.unsafe = <T>(text: string, params: unknown[] = []) =>
      new Query<T>(text, params, executor);
    sql.json = JSON.stringify;
    sql.end = () => Promise.resolve();
    sql.begin = async <T>(
      callback: (tx: TransactionSql) => T | After<T> | Promise<T | After<T>>,
    ): Promise<T> => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const epoch = await db.prepare(
          "SELECT revision FROM _write_epoch WHERE id = 1",
        ).first<{ revision: number }>();
        if (!epoch) throw new Error("D1 schema has not been migrated");
        const queued: {
          query: { text: string; params: unknown[] };
          pending: Pending<unknown>;
        }[] = [];
        const tx = make(<U>(query: Query<U>): Promise<U> => {
          if (!/^\s*(SELECT|WITH)\b/i.test(query.text)) {
            throw new Error(
              "D1 transaction writes must use transaction.queue()",
            );
          }
          return execute(query);
        }) as TransactionSql;
        tx.queue = <U>(query: Query<U>) => {
          const pending = new Pending<U>();
          queued.push({ query, pending });
          return pending;
        };
        tx.after = (callback) => new After(callback);
        tx.begin = () => {
          throw new Error("Nested D1 transactions are unsupported");
        };
        const value = await callback(tx);
        try {
          // Every application table has revision triggers, including Better Auth writes.
          // The guard and all mutations commit together or all roll back on conflict.
          const result = await db.batch([
            db.prepare(
              "UPDATE _write_guard SET valid = CASE WHEN (SELECT revision FROM _write_epoch WHERE id = 1) = ? THEN 1 ELSE 0 END WHERE id = 1",
            ).bind(epoch.revision),
            ...queued.map(({ query }) => statement(query)),
          ]);
          queued.forEach(({ pending }, i) => {
            pending.value = result[i + 1].results.map(decode);
          });
        } catch (error) {
          if (String(error).includes("transaction_conflict") && attempt < 4) {
            continue;
          }
          throw error;
        }
        return value instanceof After ? await value.callback() : value;
      }
      throw new Error("Concurrent modification; retry the operation");
    };
    return sql;
  }
  return make(execute);
}
