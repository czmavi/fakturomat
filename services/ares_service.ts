import type { AresCompany } from "@/domain/ares/types.ts";

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
