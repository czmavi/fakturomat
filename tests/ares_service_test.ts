import { AresError, lookupAres } from "@/services/ares_service.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

const company = {
  ico: "00123456",
  obchodniJmeno: "Ukázková firma",
  dic: "CZ00123456",
  sidlo: {
    nazevUlice: "Dlouhá",
    cisloDomovni: 12,
    cisloOrientacni: 3,
    cisloOrientacniPismeno: "a",
    nazevObce: "Praha",
    psc: 11000,
    kodStatu: "CZ",
  },
};

Deno.test("ARES maps identity and Czech address, preserving leading zeros", async () => {
  const result = await lookupAres(" 00123456 ", (url) => {
    assert(String(url).endsWith("/00123456"), "wrong endpoint");
    return Promise.resolve(Response.json(company));
  });
  assert(result.name === company.obchodniJmeno, "missing name");
  assert(result.ico === "00123456", "lost leading zeros");
  assert(result.dic === company.dic, "missing DIČ");
  assert(result.street === "Dlouhá 12/3a", "wrong street");
  assert(
    result.city === "Praha" && result.postalCode === "11000" &&
      result.country === "CZ",
    "wrong address",
  );
});

Deno.test("ARES supports address without street and does not invent DIČ", async () => {
  const result = await lookupAres(
    "00123456",
    () =>
      Promise.resolve(Response.json({
        ...company,
        dic: undefined,
        sidlo: {
          nazevObce: "Lhota",
          cisloDomovni: 5,
          typCisloDomovni: 2,
          kodStatu: "CZ",
        },
      })),
  );
  assert(result.street === "Lhota č. ev. 5", "wrong evidence number");
  assert(result.dic === "", "invented DIČ");
});

Deno.test("ARES rejects invalid IČO before contacting upstream", async () => {
  try {
    await lookupAres("../123", () => {
      throw new Error("must not fetch");
    });
    throw new Error("accepted invalid IČO");
  } catch (error) {
    assert(
      error instanceof AresError && error.status === 400,
      "wrong validation error",
    );
  }
});

Deno.test("ARES handles missing, unavailable and malformed responses", async () => {
  for (
    const [response, status] of [
      [new Response(null, { status: 404 }), 404],
      [new Response(null, { status: 429 }), 503],
      [Response.json({ ...company, ico: "99999999" }), 503],
      [Response.json(null), 503],
    ] as const
  ) {
    try {
      await lookupAres("00123456", () => Promise.resolve(response));
      throw new Error("accepted error response");
    } catch (error) {
      assert(
        error instanceof AresError && error.status === status,
        "wrong error status",
      );
    }
  }
});

Deno.test("ARES reports network failure as temporary unavailability", async () => {
  try {
    await lookupAres(
      "00123456",
      () => Promise.reject(new Error("network error")),
    );
    throw new Error("accepted network error");
  } catch (error) {
    assert(
      error instanceof AresError && error.status === 503,
      "wrong network error",
    );
  }
});
