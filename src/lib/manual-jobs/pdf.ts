import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type ManualJobPdfWorker = {
  name: string;
  percentageBasisPoints: number;
  amountCents: number;
};

function ascii(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[^\x20-\x7e]/gu, "?")
    .trim();
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function percentage(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

export async function composeManualJobPdf(input: {
  prismNumber: string;
  valueCents: number;
  creatorName: string;
  dateLabel: string;
  workers: ManualJobPdfWorker[];
}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);

  const margin = 56;
  const labelX = margin;
  const valueX = margin + 150;
  let y = 728;

  page.drawText("TRABAJO ENTREGADO", { x: margin, y, size: 22, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 34;
  page.drawLine({
    start: { x: margin, y },
    end: { x: 612 - margin, y },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85),
  });
  y -= 26;

  const field = (label: string, value: string, gap = 22) => {
    page.drawText(label, { x: labelX, y, size: 11, font: bold, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(ascii(value), { x: valueX, y, size: 11, font: regular, color: rgb(0.1, 0.1, 0.1) });
    y -= gap;
  };

  field("PRISM", input.prismNumber);
  field("Fecha", input.dateLabel);
  field("Tecnico", input.creatorName);
  field("Valor total", money(input.valueCents), 30);

  page.drawText("Reparto", { x: margin, y, size: 13, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 24;

  const nameX = margin;
  const pctX = margin + 320;
  const amountX = margin + 410;
  for (const worker of input.workers) {
    page.drawText(ascii(worker.name), { x: nameX, y, size: 11, font: regular, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(percentage(worker.percentageBasisPoints), { x: pctX, y, size: 11, font: regular, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(money(worker.amountCents), { x: amountX, y, size: 11, font: regular, color: rgb(0.1, 0.1, 0.1) });
    y -= 18;
  }

  return await document.save();
}
