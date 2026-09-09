import { toFileUrl } from "@std/path";

export interface PdfRenderer {
  render(html: string): Promise<Uint8Array>;
}

export class PdfRenderingError extends Error {}

const CHROMIUM_CANDIDATES = Deno.build.os === "darwin"
  ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  : [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];

function isExecutableFile(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

export function resolveChromiumExecutablePath(): string {
  const configured = Deno.env.get("CHROMIUM_EXECUTABLE_PATH")?.trim();
  if (configured) return configured;
  const detected = CHROMIUM_CANDIDATES.find(isExecutableFile);
  if (detected) return detected;
  throw new PdfRenderingError(
    "Chromium nebyl nalezen. Nastavte CHROMIUM_EXECUTABLE_PATH.",
  );
}

const TIMEOUT = Symbol("timeout");

export class ChromiumPdfRenderer implements PdfRenderer {
  constructor(
    private readonly executablePath?: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async render(html: string): Promise<Uint8Array> {
    const directory = await Deno.makeTempDir({ prefix: "fakturomat-pdf-" });
    const htmlPath = `${directory}/invoice.html`;
    const pdfPath = `${directory}/invoice.pdf`;
    try {
      const executablePath = this.executablePath ??
        resolveChromiumExecutablePath();
      await Deno.writeTextFile(htmlPath, html);
      const process = new Deno.Command(executablePath, {
        args: [
          "--headless=new",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-extensions",
          "--disable-gpu",
          "--disable-sync",
          "--metrics-recording-only",
          "--mute-audio",
          "--no-first-run",
          "--no-pdf-header-footer",
          "--incognito",
          `--print-to-pdf=${pdfPath}`,
          toFileUrl(htmlPath).href,
        ],
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const outputPromise = process.output();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
        timeoutId = setTimeout(() => {
          try {
            process.kill("SIGKILL");
          } catch {
            // The process may have exited between the race and kill().
          }
          resolve(TIMEOUT);
        }, this.timeoutMs);
      });
      const result = await Promise.race([outputPromise, timeoutPromise]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (result === TIMEOUT) {
        await outputPromise.catch(() => undefined);
        throw new PdfRenderingError("Generování PDF překročilo časový limit.");
      }
      if (!result.success) {
        const stderr = new TextDecoder().decode(result.stderr).trim();
        throw new PdfRenderingError(
          `Chromium nedokončil generování PDF${
            stderr ? `: ${stderr.slice(0, 500)}` : "."
          }`,
        );
      }
      const pdf = await Deno.readFile(pdfPath);
      if (
        pdf.length < 5 || new TextDecoder().decode(pdf.subarray(0, 5)) !==
          "%PDF-"
      ) {
        throw new PdfRenderingError("Chromium nevytvořil platný PDF dokument.");
      }
      return pdf;
    } catch (error) {
      if (error instanceof PdfRenderingError) throw error;
      throw new PdfRenderingError("PDF se nepodařilo vygenerovat.", {
        cause: error,
      });
    } finally {
      await Deno.remove(directory, { recursive: true }).catch(() => undefined);
    }
  }
}
