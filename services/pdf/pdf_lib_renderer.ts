import fontkit from "@pdf-lib/fontkit";
import {
  PageSizes,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  type RGB,
  rgb,
} from "pdf-lib";
import type { InvoiceViewModel } from "@/domain/invoices/invoice_view_model.ts";
import type { InvoiceTemplateVersion } from "@/domain/invoices/template_types.ts";

export interface PdfRenderer {
  render(
    viewModel: InvoiceViewModel,
    templateVersion: InvoiceTemplateVersion,
  ): Promise<Uint8Array>;
}

export class PdfRenderingError extends Error {}

const A4 = PageSizes.A4;
const MARGIN = 42;
const CONTENT_WIDTH = A4[0] - MARGIN * 2;
const FOOTER_HEIGHT = 28;
const REGULAR_FONT_SPECIFIER = "dejavu-fonts-ttf/ttf/DejaVuSans.ttf";
const BOLD_FONT_SPECIFIER = "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf";

const INK = rgb(24 / 255, 33 / 255, 28 / 255);
const MUTED = rgb(105 / 255, 115 / 255, 108 / 255);
const BORDER = rgb(217 / 255, 223 / 255, 218 / 255);
const SOFT = rgb(241 / 255, 246 / 255, 242 / 255);
const WHITE = rgb(1, 1, 1);

interface EmbeddedFonts {
  regular: PDFFont;
  bold: PDFFont;
}

interface Theme {
  primary: RGB;
  accent: RGB;
}

function hexColor(value: string): RGB | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const raw = match[1];
  return rgb(
    Number.parseInt(raw.slice(0, 2), 16) / 255,
    Number.parseInt(raw.slice(2, 4), 16) / 255,
    Number.parseInt(raw.slice(4, 6), 16) / 255,
  );
}

function cssVariable(css: string, name: string): RGB | null {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*:\\s*(#[0-9a-f]{6})`, "i").exec(css);
  return match ? hexColor(match[1]) : null;
}

function themeFromTemplate(template: InvoiceTemplateVersion): Theme {
  return {
    primary: cssVariable(template.css, "--pdf-primary") ??
      rgb(24 / 255, 62 / 255, 42 / 255),
    accent: cssVariable(template.css, "--pdf-accent") ??
      rgb(39 / 255, 122 / 255, 76 / 255),
  };
}

async function readFont(specifier: string): Promise<Uint8Array> {
  const url = new URL(import.meta.resolve(specifier));
  return await Deno.readFile(url);
}

async function embedFonts(document: PDFDocument): Promise<EmbeddedFonts> {
  document.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    readFont(REGULAR_FONT_SPECIFIER),
    readFont(BOLD_FONT_SPECIFIER),
  ]);
  const [regular, bold] = await Promise.all([
    document.embedFont(regularBytes, { subset: true }),
    document.embedFont(boldBytes, { subset: true }),
  ]);
  return { regular, bold };
}

function addA4Page(document: PDFDocument): PDFPage {
  const page = document.addPage(A4);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: A4[0],
    height: A4[1],
    color: WHITE,
  });
  return page;
}

function visible(value: string): string {
  return value.trim() || "-";
}

function textWidth(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

function splitLongWord(
  word: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of word) {
    const candidate = chunk + character;
    if (chunk && textWidth(font, candidate, size) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapText(
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const output: string[] = [];
  for (const paragraph of value.replaceAll("\r", "").split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean).flatMap((
      word,
    ) =>
      textWidth(font, word, size) <= maxWidth
        ? [word]
        : splitLongWord(word, font, size, maxWidth)
    );
    if (words.length === 0) {
      output.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && textWidth(font, candidate, size) > maxWidth) {
        output.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) output.push(line);
  }
  return output.length > 0 ? output : [""];
}

function drawRightText(
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB = INK,
): void {
  page.drawText(text, {
    x: right - textWidth(font, text, size),
    y,
    font,
    size,
    color,
  });
}

function drawLines(
  page: PDFPage,
  lines: string[],
  options: {
    x: number;
    y: number;
    font: PDFFont;
    size: number;
    color?: RGB;
    lineHeight?: number;
  },
): number {
  const lineHeight = options.lineHeight ?? options.size * 1.35;
  let y = options.y;
  for (const line of lines) {
    page.drawText(line, {
      x: options.x,
      y,
      font: options.font,
      size: options.size,
      color: options.color ?? INK,
    });
    y -= lineHeight;
  }
  return y;
}

function drawLabel(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  theme: Theme,
): void {
  page.drawText(text.toLocaleUpperCase("cs-CZ"), {
    x,
    y,
    font,
    size: 7.5,
    color: theme.accent,
  });
}

function drawContinuationHeader(
  page: PDFPage,
  model: InvoiceViewModel,
  fonts: EmbeddedFonts,
  theme: Theme,
): number {
  drawLabel(
    page,
    "Faktura - pokračování",
    MARGIN,
    A4[1] - MARGIN,
    fonts.bold,
    theme,
  );
  drawRightText(
    page,
    model.invoice.number,
    A4[0] - MARGIN,
    A4[1] - MARGIN,
    fonts.bold,
    10,
    theme.primary,
  );
  page.drawLine({
    start: { x: MARGIN, y: A4[1] - MARGIN - 12 },
    end: { x: A4[0] - MARGIN, y: A4[1] - MARGIN - 12 },
    thickness: 1.5,
    color: theme.primary,
  });
  return A4[1] - MARGIN - 36;
}

function drawTableHeader(
  page: PDFPage,
  y: number,
  fonts: EmbeddedFonts,
  theme: Theme,
): number {
  const height = 24;
  page.drawRectangle({
    x: MARGIN,
    y: y - height,
    width: CONTENT_WIDTH,
    height,
    color: SOFT,
  });
  const baseline = y - 15.5;
  const size = 7.5;
  page.drawText("POPIS", {
    x: MARGIN + 8,
    y: baseline,
    font: fonts.bold,
    size,
    color: theme.primary,
  });
  drawRightText(
    page,
    "MNOŽSTVÍ",
    350,
    baseline,
    fonts.bold,
    size,
    theme.primary,
  );
  drawRightText(
    page,
    "JEDNOTKA",
    407,
    baseline,
    fonts.bold,
    size,
    theme.primary,
  );
  drawRightText(page, "CENA", 483, baseline, fonts.bold, size, theme.primary);
  drawRightText(
    page,
    "CELKEM",
    A4[0] - MARGIN - 8,
    baseline,
    fonts.bold,
    size,
    theme.primary,
  );
  return y - height;
}

function drawFirstPageHeader(
  page: PDFPage,
  model: InvoiceViewModel,
  fonts: EmbeddedFonts,
  theme: Theme,
): number {
  const top = A4[1] - MARGIN;
  drawLabel(page, "Faktura", MARGIN, top, fonts.bold, theme);
  page.drawText(model.invoice.number, {
    x: MARGIN,
    y: top - 31,
    font: fonts.bold,
    size: 22,
    color: INK,
  });
  const supplierLines = wrapText(model.supplier.logo, fonts.bold, 11, 180);
  supplierLines.slice(0, 2).forEach((line, index) => {
    drawRightText(
      page,
      line,
      A4[0] - MARGIN,
      top - 4 - index * 15,
      fonts.bold,
      11,
      theme.primary,
    );
  });
  page.drawLine({
    start: { x: MARGIN, y: top - 48 },
    end: { x: A4[0] - MARGIN, y: top - 48 },
    thickness: 2,
    color: theme.primary,
  });

  const partyTop = top - 78;
  const customerX = MARGIN + CONTENT_WIDTH / 2 + 16;
  const partyWidth = CONTENT_WIDTH / 2 - 16;
  drawLabel(page, "Dodavatel", MARGIN, partyTop, fonts.bold, theme);
  drawLabel(page, "Odběratel", customerX, partyTop, fonts.bold, theme);
  page.drawText(model.supplier.name, {
    x: MARGIN,
    y: partyTop - 20,
    font: fonts.bold,
    size: 11,
    color: INK,
  });
  page.drawText(model.customer.name, {
    x: customerX,
    y: partyTop - 20,
    font: fonts.bold,
    size: 11,
    color: INK,
  });
  drawLines(
    page,
    [
      ...wrapText(model.supplier.address, fonts.regular, 8.5, partyWidth),
      `IČO: ${visible(model.supplier.ico)}   DIČ: ${
        visible(model.supplier.dic)
      }`,
      visible(model.supplier.email),
      visible(model.supplier.phone),
    ].slice(0, 5),
    {
      x: MARGIN,
      y: partyTop - 38,
      font: fonts.regular,
      size: 8.5,
      color: MUTED,
      lineHeight: 12.5,
    },
  );
  drawLines(
    page,
    [
      ...wrapText(model.customer.address, fonts.regular, 8.5, partyWidth),
      `IČO: ${visible(model.customer.ico)}   DIČ: ${
        visible(model.customer.dic)
      }`,
    ].slice(0, 5),
    {
      x: customerX,
      y: partyTop - 38,
      font: fonts.regular,
      size: 8.5,
      color: MUTED,
      lineHeight: 12.5,
    },
  );

  const metaY = partyTop - 112;
  page.drawRectangle({
    x: MARGIN,
    y: metaY - 48,
    width: CONTENT_WIDTH,
    height: 48,
    color: SOFT,
  });
  const meta = [
    ["Datum vystavení", model.invoice.issueDate],
    ["Datum splatnosti", model.invoice.dueDate],
    ["Variabilní symbol", model.invoice.variableSymbol],
  ];
  meta.forEach(([label, value], index) => {
    const x = MARGIN + 14 + index * CONTENT_WIDTH / 3;
    page.drawText(label, {
      x,
      y: metaY - 15,
      font: fonts.regular,
      size: 7.5,
      color: MUTED,
    });
    page.drawText(value, {
      x,
      y: metaY - 33,
      font: fonts.bold,
      size: 9.5,
      color: INK,
    });
  });
  return metaY - 72;
}

function drawTotals(
  page: PDFPage,
  y: number,
  model: InvoiceViewModel,
  fonts: EmbeddedFonts,
  theme: Theme,
): number {
  const left = A4[0] - MARGIN - 246;
  page.drawText("Mezisoučet", {
    x: left + 12,
    y: y - 17,
    font: fonts.regular,
    size: 9,
    color: MUTED,
  });
  drawRightText(
    page,
    `${model.invoice.subtotal} ${model.invoice.currency}`,
    A4[0] - MARGIN - 12,
    y - 17,
    fonts.bold,
    9,
  );
  page.drawRectangle({
    x: left,
    y: y - 66,
    width: 246,
    height: 36,
    color: theme.primary,
  });
  page.drawText("Celkem k úhradě", {
    x: left + 12,
    y: y - 53,
    font: fonts.bold,
    size: 10,
    color: WHITE,
  });
  drawRightText(
    page,
    `${model.invoice.total} ${model.invoice.currency}`,
    A4[0] - MARGIN - 12,
    y - 53,
    fonts.bold,
    11,
    WHITE,
  );
  return y - 84;
}

function drawPayment(
  page: PDFPage,
  y: number,
  model: InvoiceViewModel,
  fonts: EmbeddedFonts,
  theme: Theme,
): number {
  const height = 104;
  page.drawRectangle({
    x: MARGIN,
    y: y - height,
    width: CONTENT_WIDTH,
    height,
    borderColor: BORDER,
    borderWidth: 1,
  });
  drawLabel(page, "Platební údaje", MARGIN + 14, y - 20, fonts.bold, theme);
  page.drawText("Účet", {
    x: MARGIN + 14,
    y: y - 42,
    font: fonts.regular,
    size: 8,
    color: MUTED,
  });
  page.drawText(visible(model.payment.account), {
    x: MARGIN + 55,
    y: y - 42,
    font: fonts.bold,
    size: 9,
    color: INK,
  });
  page.drawText("IBAN", {
    x: MARGIN + 14,
    y: y - 61,
    font: fonts.regular,
    size: 8,
    color: MUTED,
  });
  page.drawText(visible(model.payment.iban), {
    x: MARGIN + 55,
    y: y - 61,
    font: fonts.bold,
    size: 9,
    color: INK,
  });
  page.drawText("Naskenujte pro QR platbu", {
    x: MARGIN + 14,
    y: y - 84,
    font: fonts.regular,
    size: 7.5,
    color: MUTED,
  });
  const qrSize = 80;
  const qrX = A4[0] - MARGIN - 91;
  const qrY = y - 96;
  const quietZone = 4;
  const matrix = model.payment.qrMatrix;
  const moduleSize = qrSize / (matrix.size + quietZone * 2);
  page.drawRectangle({
    x: qrX,
    y: qrY,
    width: qrSize,
    height: qrSize,
    color: WHITE,
  });
  for (let row = 0; row < matrix.size; row++) {
    for (let column = 0; column < matrix.size; column++) {
      if (!matrix.data[row * matrix.size + column]) continue;
      page.drawRectangle({
        x: qrX + (column + quietZone) * moduleSize,
        y: qrY + (matrix.size - row - 1 + quietZone) * moduleSize,
        width: moduleSize,
        height: moduleSize,
        color: INK,
      });
    }
  }
  return y - height - 18;
}

function drawNote(
  page: PDFPage,
  y: number,
  model: InvoiceViewModel,
  fonts: EmbeddedFonts,
  theme: Theme,
): number {
  if (!model.invoice.note.trim()) return y;
  drawLabel(page, "Poznámka", MARGIN, y, fonts.bold, theme);
  return drawLines(
    page,
    wrapText(model.invoice.note, fonts.regular, 8.5, CONTENT_WIDTH),
    {
      x: MARGIN,
      y: y - 18,
      font: fonts.regular,
      size: 8.5,
      color: MUTED,
      lineHeight: 12,
    },
  );
}

function drawFooters(
  pages: PDFPage[],
  model: InvoiceViewModel,
  fonts: EmbeddedFonts,
): void {
  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: FOOTER_HEIGHT + 12 },
      end: { x: A4[0] - MARGIN, y: FOOTER_HEIGHT + 12 },
      thickness: 0.6,
      color: BORDER,
    });
    page.drawText(model.supplier.name, {
      x: MARGIN,
      y: FOOTER_HEIGHT,
      font: fonts.regular,
      size: 7,
      color: MUTED,
    });
    drawRightText(
      page,
      `Strana ${index + 1} / ${pages.length}`,
      A4[0] - MARGIN,
      FOOTER_HEIGHT,
      fonts.regular,
      7,
      MUTED,
    );
  });
}

export class PdfLibRenderer implements PdfRenderer {
  async render(
    model: InvoiceViewModel,
    templateVersion: InvoiceTemplateVersion,
  ): Promise<Uint8Array> {
    try {
      const document = await PDFDocument.create();
      document.setTitle(`Faktura ${model.invoice.number}`);
      document.setAuthor(model.supplier.name);
      document.setCreator("Fakturomat");
      document.setProducer("pdf-lib");
      const fonts = await embedFonts(document);
      const theme = themeFromTemplate(templateVersion);
      let page = addA4Page(document);
      let y = drawFirstPageHeader(page, model, fonts, theme);
      y = drawTableHeader(page, y, fonts, theme);

      for (const item of model.invoice.items) {
        const descriptionLines = wrapText(
          visible(item.description),
          fonts.regular,
          8.5,
          215,
        );
        const rowHeight = Math.max(30, 12 + descriptionLines.length * 11);
        if (y - rowHeight < FOOTER_HEIGHT + 38) {
          page = addA4Page(document);
          y = drawContinuationHeader(page, model, fonts, theme);
          y = drawTableHeader(page, y, fonts, theme);
        }
        const baseline = y - 18;
        drawLines(page, descriptionLines, {
          x: MARGIN + 8,
          y: baseline,
          font: fonts.regular,
          size: 8.5,
          lineHeight: 11,
        });
        drawRightText(
          page,
          visible(item.quantity),
          350,
          baseline,
          fonts.regular,
          8.5,
        );
        drawRightText(
          page,
          visible(item.unit),
          407,
          baseline,
          fonts.regular,
          8.5,
        );
        drawRightText(page, item.unitPrice, 483, baseline, fonts.regular, 8.5);
        drawRightText(
          page,
          item.total,
          A4[0] - MARGIN - 8,
          baseline,
          fonts.bold,
          8.5,
        );
        page.drawLine({
          start: { x: MARGIN, y: y - rowHeight },
          end: { x: A4[0] - MARGIN, y: y - rowHeight },
          thickness: 0.6,
          color: BORDER,
        });
        y -= rowHeight;
      }

      if (y < 302) {
        page = addA4Page(document);
        y = drawContinuationHeader(page, model, fonts, theme);
      }
      y = drawTotals(page, y - 10, model, fonts, theme);
      y = drawPayment(page, y, model, fonts, theme);
      drawNote(page, y, model, fonts, theme);
      drawFooters(document.getPages(), model, fonts);
      return await document.save({ useObjectStreams: true });
    } catch (error) {
      if (error instanceof PdfRenderingError) throw error;
      throw new PdfRenderingError("PDF se nepodařilo vygenerovat.", {
        cause: error,
      });
    }
  }
}
