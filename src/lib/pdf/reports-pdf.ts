import { jsPDF } from 'jspdf';

type PdfMetric = {
  label: string;
  value: string;
  comparison: string;
};

type PdfSaleRow = {
  date: string;
  sale: string;
  customer: string;
  payment: string;
  amount: number;
  products: string;
};

export interface SalesReportPdfData {
  storeName: string;
  currentMonth: string;
  previousMonth: string;
  generatedAt: string;
  metrics: PdfMetric[];
  revenueByPayment: Array<{ method: string; amount: number }>;
  topProducts: Array<{ name: string; quantity: number }>;
  sales: PdfSaleRow[];
}

const PAGE = { width: 210, height: 297, margin: 14 };
const COLORS = {
  text: [31, 41, 55] as const,
  muted: [107, 114, 128] as const,
  primary: [22, 101, 148] as const,
  primarySoft: [239, 246, 255] as const,
  border: [229, 231, 235] as const,
  surface: [249, 250, 251] as const,
  success: [22, 163, 74] as const,
};

function money(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value) || 0);
}

function dateBr(value: string): string {
  if (!value) return '-';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function monthBr(value: string): string {
  const [year, month] = value.split('-');
  if (!year || !month) return value;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
}

function text(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  size = 9,
  bold = false,
  color: readonly [number, number, number] = COLORS.text,
  align: 'left' | 'center' | 'right' = 'left',
) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.text(value, x, y, { align });
}

function fitSingleLine(doc: jsPDF, value: string, maxWidth: number, size = 8, bold = false): string {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const textValue = value || '-';
  if (doc.getTextWidth(textValue) <= maxWidth) return textValue;

  let shortened = textValue;
  while (shortened.length > 1 && doc.getTextWidth(shortened + '…') > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return shortened + '…';
}

function wrapText(doc: jsPDF, value: string, width: number, size = 8): string[] {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size);
  return doc.splitTextToSize(value || '-', width) as string[];
}

function roundedBox(doc: jsPDF, x: number, y: number, w: number, h: number, fill: readonly [number, number, number]) {
  doc.setFillColor(...fill);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(x, y, w, h, 3, 3, 'FD');
}

function drawHeader(doc: jsPDF, data: SalesReportPdfData, pageNumber: number) {
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, PAGE.width, 26, 'F');

  text(doc, 'COREsys', PAGE.margin, 10, 9, true, [255, 255, 255]);
  text(doc, 'Relatório de Vendas', PAGE.margin, 19, 16, true, [255, 255, 255]);
  text(
    doc,
    fitSingleLine(doc, data.storeName, 72, 8),
    PAGE.width - PAGE.margin,
    10,
    8,
    false,
    [255, 255, 255],
    'right',
  );
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(255, 255, 255);
  doc.text(`Página ${pageNumber}`, PAGE.width - PAGE.margin, 19, { align: 'right' });

  text(doc, `Período: ${monthBr(data.currentMonth)}`, PAGE.margin, 35, 8.5, true);
  text(doc, `Comparativo: ${monthBr(data.previousMonth)}`, PAGE.margin, 41, 8, false, COLORS.muted);
  text(
    doc,
    fitSingleLine(doc, `Gerado em ${data.generatedAt}`, 72, 8),
    PAGE.width - PAGE.margin,
    35,
    8,
    false,
    COLORS.muted,
    'right',
  );
  text(
    doc,
    'Documento gerado diretamente a partir dos dados do ERP.',
    PAGE.width - PAGE.margin,
    41,
    8,
    false,
    COLORS.muted,
    'right',
  );
}

function drawFooter(doc: jsPDF) {
  const y = PAGE.height - 9;
  doc.setDrawColor(...COLORS.border);
  doc.line(PAGE.margin, y - 3, PAGE.width - PAGE.margin, y - 3);
  text(doc, 'COREsys - Relatório operacional', PAGE.margin, y, 7, false, COLORS.muted);
}

export function downloadSalesReportPdf(data: SalesReportPdfData): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  let page = 1;
  let y = 51;

  const newPage = () => {
    drawFooter(doc);
    doc.addPage();
    page += 1;
    drawHeader(doc, data, page);
    y = 51;
  };

  const ensureSpace = (height: number) => {
    if (y + height > PAGE.height - 17) newPage();
  };

  drawHeader(doc, data, page);

  text(doc, 'Resumo executivo', PAGE.margin, y, 11, true);
  y += 5;

  const gap = 4;
  const cardW = (PAGE.width - PAGE.margin * 2 - gap) / 2;
  const cardH = 28;

  data.metrics.forEach((metric, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = PAGE.margin + col * (cardW + gap);
    const cardY = y + row * (cardH + gap);
    roundedBox(doc, x, cardY, cardW, cardH, COLORS.surface);
    text(doc, metric.label, x + 5, cardY + 8, 7.5, true, COLORS.muted);
    text(doc, metric.value, x + 5, cardY + 17, 12, true);
    text(doc, metric.comparison, x + 5, cardY + 24, 7, false, COLORS.primary);
  });

  y += 2 * (cardH + gap) + 2;
  ensureSpace(42);

  text(doc, 'Receita por meio de pagamento', PAGE.margin, y, 11, true);
  y += 5;

  const paymentRows = data.revenueByPayment.length
    ? data.revenueByPayment
    : [{ method: 'Nenhum registro', amount: 0 }];

  roundedBox(doc, PAGE.margin, y, PAGE.width - PAGE.margin * 2, 8 + paymentRows.length * 8, [255, 255, 255]);
  paymentRows.forEach((row, index) => {
    const rowY = y + 7 + index * 8;
    if (index > 0) {
      doc.setDrawColor(...COLORS.border);
      doc.line(PAGE.margin + 4, rowY - 4, PAGE.width - PAGE.margin - 4, rowY - 4);
    }
    text(doc, row.method, PAGE.margin + 6, rowY, 8, true);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.success);
    doc.text(money(row.amount), PAGE.width - PAGE.margin - 6, rowY, { align: 'right' });
  });
  y += 14 + paymentRows.length * 8;

  ensureSpace(54);
  text(doc, 'Produtos mais vendidos', PAGE.margin, y, 11, true);
  y += 5;

  const productRows = data.topProducts.length
    ? data.topProducts
    : [{ name: 'Nenhuma venda registrada no período', quantity: 0 }];

  roundedBox(doc, PAGE.margin, y, PAGE.width - PAGE.margin * 2, 10 + productRows.length * 8, [255, 255, 255]);
  text(doc, '#', PAGE.margin + 6, y + 7, 7, true, COLORS.muted);
  text(doc, 'Produto', PAGE.margin + 15, y + 7, 7, true, COLORS.muted);
  text(doc, 'Quantidade', PAGE.width - PAGE.margin - 6, y + 7, 7, true, COLORS.muted, 'right');
  productRows.forEach((row, index) => {
    const rowY = y + 14 + index * 8;
    if (index > 0) {
      doc.setDrawColor(...COLORS.border);
      doc.line(PAGE.margin + 4, rowY - 5, PAGE.width - PAGE.margin - 4, rowY - 5);
    }
    text(doc, `${index + 1}`, PAGE.margin + 6, rowY, 8, true);
    text(doc, wrapText(doc, row.name, 127, 8)[0], PAGE.margin + 15, rowY, 8);
    text(doc, `${row.quantity} un`, PAGE.width - PAGE.margin - 6, rowY, 8, true, COLORS.text, 'right');
  });
  y += 16 + productRows.length * 8;

  newPage();

  text(doc, 'Vendas detalhadas', PAGE.margin, y, 11, true);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(`${data.sales.length} venda(s) no período`, PAGE.width - PAGE.margin, y, { align: 'right' });
  y += 5;

  const columns = [
    { label: 'Data', x: PAGE.margin + 2, w: 18 },
    { label: 'Venda', x: PAGE.margin + 21, w: 24 },
    { label: 'Cliente', x: PAGE.margin + 46, w: 35 },
    { label: 'Pagamento', x: PAGE.margin + 82, w: 30 },
    { label: 'Valor', x: PAGE.margin + 113, w: 24 },
    { label: 'Produtos', x: PAGE.margin + 138, w: 44 },
  ];

  const drawTableHeader = () => {
    doc.setFillColor(...COLORS.primarySoft);
    doc.setDrawColor(...COLORS.border);
    doc.rect(PAGE.margin, y, PAGE.width - PAGE.margin * 2, 9, 'FD');
    columns.forEach(col => text(doc, col.label, col.x, y + 6, 6.7, true, COLORS.primary));
    y += 9;
  };

  drawTableHeader();

  data.sales.forEach((sale, index) => {
    const customerLines = wrapText(doc, sale.customer, columns[2].w, 7);
    const productLines = wrapText(doc, sale.products, columns[5].w, 6.8);
    const lines = Math.max(customerLines.length, productLines.length, 1);
    const rowH = Math.max(10, Math.min(23, 4 + lines * 4));

    if (y + rowH > PAGE.height - 18) {
      newPage();
      text(doc, 'Vendas detalhadas - continuação', PAGE.margin, y, 10, true);
      y += 5;
      drawTableHeader();
    }

    if (index % 2 === 1) {
      doc.setFillColor(...COLORS.surface);
      doc.rect(PAGE.margin, y, PAGE.width - PAGE.margin * 2, rowH, 'F');
    }
    doc.setDrawColor(...COLORS.border);
    doc.rect(PAGE.margin, y, PAGE.width - PAGE.margin * 2, rowH, 'S');

    text(doc, dateBr(sale.date), columns[0].x, y + 6, 6.8);
    text(doc, sale.sale, columns[1].x, y + 6, 6.8, true);
    customerLines.slice(0, 4).forEach((line, lineIndex) => text(doc, line, columns[2].x, y + 5 + lineIndex * 3.7, 6.6));
    text(doc, sale.payment, columns[3].x, y + 6, 6.6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...COLORS.text);
    doc.text(money(sale.amount), columns[4].x + columns[4].w, y + 6, { align: 'right' });
    productLines.slice(0, 4).forEach((line, lineIndex) => text(doc, line, columns[5].x, y + 5 + lineIndex * 3.7, 6.2));

    y += rowH;
  });

  ensureSpace(18);
  y += 5;
  roundedBox(doc, PAGE.margin, y, PAGE.width - PAGE.margin * 2, 14, COLORS.primarySoft);
  text(doc, 'Total de vendas no período', PAGE.margin + 6, y + 9, 8, true, COLORS.primary);
  const total = data.sales.reduce((sum, sale) => sum + sale.amount, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.primary);
  doc.text(money(total), PAGE.width - PAGE.margin - 6, y + 9, { align: 'right' });

  drawFooter(doc);
  const filename = `relatorio-vendas-${data.currentMonth}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
