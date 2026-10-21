import type { AresCompany } from "@/domain/ares/types.ts";

// ARES pravniForma uses the ČSÚ legal-form code list, including historical codes.
// https://csu.gov.cz/docs/107508/ab6eff47-5cc9-98bd-3656-ebf3aa1d8a60/33010123q2h01.pdf
const personForms = new Set([
  "101",
  "102",
  "103",
  "104",
  "105",
  "106",
  "107",
  "108",
  "424",
]);
const companyForms = new Set([
  "111",
  "112",
  "113",
  "115",
  "116",
  "117",
  "118",
  "121",
  "141",
  "145",
  "151",
  "161",
  "201",
  "205",
  "231",
  "232",
  "233",
  "234",
  "241",
  "242",
  "251",
  "301",
  "312",
  "313",
  "314",
  "325",
  "326",
  "331",
  "352",
  "353",
  "361",
  "381",
  "391",
  "421",
  "422",
  "423",
  "425",
  "426",
  "501",
  "521",
  "541",
  "601",
  "641",
  "661",
  "704",
  "705",
  "706",
  "707",
  "708",
  "711",
  "715",
  "721",
  "722",
]);

export class AresError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

export async function lookupAres(
  input: string,
  request: typeof fetch = fetch,
): Promise<AresCompany> {
  const ico = input.trim();
  if (!/^\d{8}$/.test(ico)) {
    throw new AresError("IČO musí obsahovat 8 číslic.", 400);
  }
  try {
    const response = await request(
      `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (response.status === 404) {
      throw new AresError("Subjekt s tímto IČO nebyl v ARES nalezen.", 404);
    }
    if (!response.ok) throw new Error("ARES unavailable");
    const data = await response.json();
    if (
      data.ico !== ico || typeof data.obchodniJmeno !== "string" ||
      !data.obchodniJmeno.trim()
    ) {
      throw new Error("Invalid ARES response");
    }
    const address = data.sidlo ?? {};
    const house = text(address.cisloDomovni);
    const orientation = text(address.cisloOrientacni) +
      text(address.cisloOrientacniPismeno);
    const number = [house, orientation].filter(Boolean).join("/");
    const streetName = text(address.nazevUlice);
    const street = streetName
      ? [streetName, number].filter(Boolean).join(" ")
      : [
        text(address.nazevCastiObce) || text(address.nazevObce),
        house
          ? `${address.typCisloDomovni === 2 ? "č. ev." : "č. p."} ${number}`
          : number,
      ].filter(Boolean).join(" ");
    return {
      contactType: personForms.has(text(data.pravniForma))
        ? "PERSON"
        : companyForms.has(text(data.pravniForma))
        ? "COMPANY"
        : null,
      name: data.obchodniJmeno,
      ico,
      dic: text(data.dic),
      street,
      city: text(address.nazevObce),
      postalCode: text(address.psc) || text(address.pscTxt),
      country: /^[A-Z]{2}$/.test(text(address.kodStatu))
        ? text(address.kodStatu)
        : "",
    };
  } catch (error) {
    if (error instanceof AresError) throw error;
    throw new AresError(
      "ARES je momentálně nedostupný. Zkuste to znovu nebo údaje vyplňte ručně.",
      503,
    );
  }
}
