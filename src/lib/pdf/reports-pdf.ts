import { jsPDF } from 'jspdf';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE   = { width: 210, height: 297, margin: 14 };
const INNER  = PAGE.width - PAGE.margin * 2;

/** CoreSys brand palette — no blues */
const C = {
  primary:     [0, 103, 79]    as const, // #00674F  dark green (headers, accents)
  secondary:   [62, 187, 158]  as const, // #3EBB9E  teal accent
  deep:        [10, 60, 48]    as const, // #0A3C30  very dark green (stripe)
  text:        [18, 24, 22]    as const, // near-black body text
  muted:       [95, 110, 104]  as const, // subdued labels
  border:      [205, 222, 216] as const, // subtle green-gray border
  surface:     [243, 249, 246] as const, // alternate row / card bg
  softGreen:   [218, 242, 234] as const, // light green card tint
  white:       [255, 255, 255] as const,
  black:       [0,   0,   0]   as const,
  danger:      [198,  54,  54] as const, // red for negatives
  amber:       [180, 130,  30] as const, // amber for warnings
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip Portuguese accented chars — jsPDF uses Latin-1 internally */
function norm(s: string): string {
  return (s ?? '')
    .replace(/[àáâãä]/g,'a').replace(/[ÀÁÂÃÄ]/g,'A')
    .replace(/[èéêë]/g, 'e').replace(/[ÈÉÊË]/g, 'E')
    .replace(/[ìíîï]/g, 'i').replace(/[ÌÍÎÏ]/g, 'I')
    .replace(/[òóôõö]/g,'o').replace(/[ÒÓÔÕÖ]/g,'O')
    .replace(/[ùúûü]/g, 'u').replace(/[ÙÚÛÜ]/g, 'U')
    .replace(/[ç]/g,'c').replace(/[Ç]/g,'C')
    .replace(/[ñ]/g,'n').replace(/[Ñ]/g,'N');
}

function money(v: number): string {
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);
}

function dateBr(v: string): string {
  if (!v) return '-';
  const [y,m,d] = v.slice(0,10).split('-');
  return y&&m&&d ? `${d}/${m}/${y}` : v;
}

function monthBr(v: string): string {
  const [y,m] = v.split('-');
  if (!y||!m) return v;
  return norm(new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(+y,+m-1,1)));
}

type RGB = readonly [number,number,number];

function t(
  doc: jsPDF, value: string,
  x: number, y: number,
  size = 9, bold = false,
  color: RGB = C.text,
  align: 'left'|'right'|'center' = 'left',
) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.text(norm(value), x, y, { align });
}

function wrap(doc: jsPDF, value: string, width: number, size = 8): string[] {
  doc.setFont('helvetica','normal');
  doc.setFontSize(size);
  return doc.splitTextToSize(norm(value)||'-', width) as string[];
}

function fillRect(doc: jsPDF, x:number, y:number, w:number, h:number, fill: RGB, draw?: RGB) {
  doc.setFillColor(...fill);
  if (draw) { doc.setDrawColor(...draw); doc.rect(x,y,w,h,'FD'); }
  else       { doc.rect(x,y,w,h,'F'); }
}

function roundBox(doc:jsPDF, x:number, y:number, w:number, h:number, fill:RGB, draw?: RGB) {
  doc.setFillColor(...fill);
  doc.setDrawColor(...(draw ?? C.border));
  doc.roundedRect(x,y,w,h,3,3, draw ? 'FD' : 'F');
}

function hline(doc:jsPDF, y:number, color: RGB = C.border) {
  doc.setDrawColor(...color);
  doc.line(PAGE.margin, y, PAGE.width-PAGE.margin, y);
}

// ─── Page chrome ─────────────────────────────────────────────────────────────

function drawHeader(doc:jsPDF, data:SalesReportPdfData, pageNumber:number) {
  // Background bar
  fillRect(doc, 0, 0, PAGE.width, 28, C.primary);
  // Bottom accent stripe
  fillRect(doc, 0, 26, PAGE.width, 2, C.secondary);

  // Brand + title (left)
  t(doc,'CoreSys',  PAGE.margin, 10, 8,  true,  C.secondary);
  t(doc,'Relatorio de Vendas', PAGE.margin, 20, 17, true, C.white);

  // Store + page (right)
  t(doc, norm(data.storeName), PAGE.width-PAGE.margin, 10, 8, false, C.white, 'right');
  t(doc, `Pagina ${pageNumber}`,  PAGE.width-PAGE.margin, 20, 8, false, [200,230,220], 'right');

  // Sub-header band (light)
  fillRect(doc, 0, 30, PAGE.width, 14, C.softGreen);
  t(doc, `Periodo: ${monthBr(data.currentMonth)}`,                PAGE.margin, 38, 8, true, C.primary);
  t(doc, `Comparativo: ${monthBr(data.previousMonth)}`,            PAGE.margin+80, 38, 7.5, false, C.muted);
  t(doc, `Gerado em ${norm(data.generatedAt)}`, PAGE.width-PAGE.margin, 38, 7.5, false, C.muted, 'right');
}

function drawFooter(doc:jsPDF) {
  const fy = PAGE.height - 10;
  fillRect(doc, 0, fy-4, PAGE.width, 14, C.softGreen);
  t(doc,'CoreSys ERP - Relatorio de Vendas', PAGE.margin, fy+3, 7, false, C.primary);
  t(doc,'Documento confidencial. Uso interno.', PAGE.width-PAGE.margin, fy+3, 7, false, C.muted, 'right');
}

// ─── Section heading ─────────────────────────────────────────────────────────

function sectionTitle(doc:jsPDF, label:string, y:number) {
  // Left accent bar
  fillRect(doc, PAGE.margin, y-4, 3, 7, C.secondary);
  t(doc, label, PAGE.margin+6, y+1, 11, true, C.primary);
  return y + 7;
}

// ─── KPI cards ───────────────────────────────────────────────────────────────

function drawMetricCards(doc:jsPDF, metrics:PdfMetric[], startY:number): number {
  const gap  = 4;
  const cardW = (INNER - gap) / 2;
  const cardH = 28;

  metrics.forEach((m, i) => {
    const col   = i % 2;
    const row   = Math.floor(i / 2);
    const x     = PAGE.margin + col * (cardW + gap);
    const y     = startY + row * (cardH + gap);

    roundBox(doc, x, y, cardW, cardH, C.surface, C.border);
    // Left accent dot
    fillRect(doc, x, y, 3, cardH, C.secondary);
    t(doc, norm(m.label),      x+7,  y+8,  7.5, true,  C.muted);
    t(doc, norm(m.value),      x+7,  y+18, 13,  true,  C.primary);
    t(doc, norm(m.comparison), x+7,  y+25, 6.8, false, C.muted);
  });

  const rows = Math.ceil(metrics.length / 2);
  return startY + rows * (cardH + gap) + 2;
}

// ─── Bar chart (horizontal) ───────────────────────────────────────────────────

function drawHorizontalBar(
  doc: jsPDF,
  rows: Array<{ label: string; value: number; valueLabel: string }>,
  startY: number,
  maxValue: number,
  barColor: RGB = C.secondary,
  trackColor: RGB = C.softGreen,
): number {
  const barAreaW = INNER * 0.55;
  const labelW   = INNER * 0.30;
  const valW     = INNER * 0.15;
  const rowH     = 9;

  rows.forEach((row, i) => {
    const y   = startY + i * rowH;
    const bg  = i % 2 === 0 ? C.white : C.surface;
    fillRect(doc, PAGE.margin, y, INNER, rowH, bg);

    // Row label
    t(doc, norm(row.label), PAGE.margin+2, y+6.5, 7, false, C.text);

    // Track
    const bx = PAGE.margin + labelW + 2;
    const bw = barAreaW - 4;
    const bh = 4;
    const by = y + (rowH - bh) / 2;
    fillRect(doc, bx, by, bw, bh, trackColor);

    // Bar fill
    const fillW = maxValue > 0 ? (row.value / maxValue) * bw : 0;
    if (fillW > 0) fillRect(doc, bx, by, fillW, bh, barColor);

    // Value label
    t(doc, row.valueLabel, PAGE.margin + labelW + barAreaW + valW - 2, y+6.5, 7, true, C.primary, 'right');
  });

  return startY + rows.length * rowH + 3;
}

// ─── Table ───────────────────────────────────────────────────────────────────

type ColDef = { label: string; x: number; w: number; align?: 'left'|'right'|'center' };

function drawTableHeader(doc:jsPDF, cols:ColDef[], y:number): number {
  fillRect(doc, PAGE.margin, y, INNER, 9, C.primary);
  cols.forEach(c => t(doc, c.label, c.align==='right' ? c.x+c.w : c.x, y+6, 6.7, true, C.white, c.align));
  return y + 9;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function downloadSalesReportPdf(data: SalesReportPdfData): void {
  const doc = new jsPDF({ unit:'mm', format:'a4', orientation:'portrait', compress:true });
  let page = 1;
  let y    = 49; // below header (28px header + 14px sub-band + 7px gap)

  const newPage = () => {
    drawFooter(doc);
    doc.addPage();
    page++;
    drawHeader(doc, data, page);
    y = 49;
  };

  const need = (h: number) => { if (y + h > PAGE.height - 18) newPage(); };

  // ─── Page 1 ───────────────────────────────────────────────────────────────
  drawHeader(doc, data, page);

  // 1. Resumo executivo
  y = sectionTitle(doc, 'Resumo executivo', y);
  y = drawMetricCards(doc, data.metrics, y);
  y += 4;

  // 2. Receita por meio de pagamento
  need(50);
  y = sectionTitle(doc, 'Receita por meio de pagamento', y);

  const totalPay = data.revenueByPayment.reduce((s,r)=>s+r.amount, 0);
  if (data.revenueByPayment.length === 0) {
    roundBox(doc, PAGE.margin, y, INNER, 12, C.surface, C.border);
    t(doc, 'Nenhum registro de pagamento no periodo.', PAGE.margin+6, y+8, 8, false, C.muted);
    y += 16;
  } else {
    // Table header
    const payH = 9 + data.revenueByPayment.length * 9 + 4;
    roundBox(doc, PAGE.margin, y, INNER, payH, C.white, C.border);
    // Header row
    fillRect(doc, PAGE.margin, y, INNER, 9, C.softGreen);
    t(doc,'Forma de pagamento', PAGE.margin+6, y+6.5, 7, true, C.primary);
    t(doc,'Valor',              PAGE.margin+INNER*0.55, y+6.5, 7, true, C.primary);
    t(doc,'Participacao',       PAGE.width-PAGE.margin-6, y+6.5, 7, true, C.primary, 'right');
    y += 9;

    data.revenueByPayment.forEach((row, i) => {
      const bg = i%2===0 ? C.white : C.surface;
      fillRect(doc, PAGE.margin, y, INNER, 9, bg);

      // Mini bar
      const bx = PAGE.margin+INNER*0.52;
      const bw = INNER*0.28;
      const bh = 3;
      const by = y + 3;
      fillRect(doc, bx, by, bw, bh, C.softGreen);
      const pct = totalPay > 0 ? row.amount/totalPay : 0;
      if (pct > 0) fillRect(doc, bx, by, bw*pct, bh, C.secondary);

      t(doc, norm(row.method),             PAGE.margin+6,             y+6.5, 8, true,  C.text);
      t(doc, money(row.amount),            PAGE.margin+INNER*0.55,    y+6.5, 8, false, C.primary);
      t(doc, `${(pct*100).toFixed(1)}%`,   PAGE.width-PAGE.margin-6,  y+6.5, 8, true,  C.secondary, 'right');
      y += 9;
    });

    // Total row
    fillRect(doc, PAGE.margin, y, INNER, 9, C.primary);
    t(doc,'Total',       PAGE.margin+6,           y+6.5, 8, true, C.white);
    t(doc, money(totalPay), PAGE.margin+INNER*0.55, y+6.5, 8, true, C.secondary);
    y += 13;
  }

  // 3. Produtos mais vendidos
  need(60);
  y = sectionTitle(doc, 'Produtos mais vendidos', y);

  if (data.topProducts.length === 0) {
    roundBox(doc, PAGE.margin, y, INNER, 12, C.surface, C.border);
    t(doc,'Nenhuma venda no periodo.', PAGE.margin+6, y+8, 8, false, C.muted);
    y += 16;
  } else {
    const maxQty = Math.max(...data.topProducts.map(r=>r.quantity), 1);

    // Column headers
    fillRect(doc, PAGE.margin, y, INNER, 8, C.softGreen);
    t(doc,'#',          PAGE.margin+4,          y+5.5, 6.5, true, C.primary);
    t(doc,'Produto',    PAGE.margin+12,          y+5.5, 6.5, true, C.primary);
    t(doc,'Volume',     PAGE.margin+INNER*0.44,  y+5.5, 6.5, true, C.primary);
    t(doc,'Qtd',        PAGE.width-PAGE.margin-4, y+5.5, 6.5, true, C.primary, 'right');
    y += 8;

    data.topProducts.slice(0,12).forEach((row,i) => {
      const bg = i%2===0 ? C.white : C.surface;
      fillRect(doc, PAGE.margin, y, INNER, 9, bg);

      t(doc,`${i+1}`,          PAGE.margin+4,            y+6.5, 7,   true,  i===0?C.secondary:C.muted);
      t(doc, wrap(doc,row.name,78,7.5)[0], PAGE.margin+12, y+6.5, 7.5, false, C.text);

      // Bar
      const bx = PAGE.margin+INNER*0.44;
      const bw = INNER*0.44;
      const bh = 3; const by = y+3;
      fillRect(doc, bx, by, bw, bh, C.softGreen);
      const fill = (row.quantity/maxQty)*bw;
      if (fill>0) fillRect(doc, bx, by, fill, bh, i===0?C.secondary:C.primary);

      t(doc,`${row.quantity} un`, PAGE.width-PAGE.margin-4, y+6.5, 7.5, true, C.primary, 'right');
      y += 9;
    });

    // Border around block
    doc.setDrawColor(...C.border);
    doc.rect(PAGE.margin, y - 9*Math.min(data.topProducts.length,12) - 8, INNER, 9*Math.min(data.topProducts.length,12)+8, 'S');
    y += 6;
  }

  // ─── Page 2: Vendas detalhadas ────────────────────────────────────────────
  newPage();
  y = sectionTitle(doc, 'Vendas detalhadas', y);

  // Counter
  t(doc,`${data.sales.length} venda(s) no periodo`, PAGE.width-PAGE.margin, y-2, 8, false, C.muted, 'right');

  const cols: ColDef[] = [
    { label:'Data',      x: PAGE.margin+2,    w:18 },
    { label:'Venda',     x: PAGE.margin+21,   w:24 },
    { label:'Cliente',   x: PAGE.margin+46,   w:35 },
    { label:'Pagamento', x: PAGE.margin+82,   w:28 },
    { label:'Valor',     x: PAGE.margin+111,  w:24, align:'right' },
    { label:'Produtos',  x: PAGE.margin+136,  w:46 },
  ];

  const tblHeader = () => { y = drawTableHeader(doc, cols, y); };
  tblHeader();

  if (data.sales.length === 0) {
    fillRect(doc, PAGE.margin, y, INNER, 14, C.surface);
    t(doc,'Nenhuma venda registrada no periodo selecionado.', PAGE.margin+INNER/2, y+9, 8, false, C.muted, 'center');
    y += 14;
  } else {
    data.sales.forEach((sale, index) => {
      const custLines = wrap(doc, sale.customer, cols[2].w, 7);
      const prodLines = wrap(doc, sale.products,  cols[5].w, 6.5);
      const lines     = Math.max(custLines.length, prodLines.length, 1);
      const rowH      = Math.max(10, Math.min(24, 4+lines*4));

      if (y + rowH > PAGE.height - 18) {
        newPage();
        t(doc,'Vendas detalhadas (cont.)', PAGE.margin, y, 10, true, C.primary);
        y += 6;
        tblHeader();
      }

      const bg: RGB = index%2===0 ? C.white : C.surface;
      fillRect(doc, PAGE.margin, y, INNER, rowH, bg, C.border);

      t(doc, dateBr(sale.date),    cols[0].x, y+6.5, 6.8);
      t(doc, norm(sale.sale),      cols[1].x, y+6.5, 6.8, true);
      custLines.slice(0,3).forEach((l,li)=>t(doc,l, cols[2].x, y+5.5+li*3.7, 6.5));
      t(doc, norm(sale.payment),   cols[3].x, y+6.5, 6.5);
      // Value right-aligned
      doc.setFont('helvetica','bold'); doc.setFontSize(6.8); doc.setTextColor(...C.primary);
      doc.text(money(sale.amount), cols[4].x+cols[4].w, y+6.5, { align:'right' });
      prodLines.slice(0,3).forEach((l,li)=>t(doc,l, cols[5].x, y+5.5+li*3.7, 6.2, false, C.muted));

      y += rowH;
    });
  }

  // ─── Total footer row ─────────────────────────────────────────────────────
  need(18);
  y += 5;
  fillRect(doc, PAGE.margin, y, INNER, 14, C.primary);
  t(doc,'Total do periodo', PAGE.margin+6, y+9.5, 9, true, C.white);
  const total = data.sales.reduce((s,x)=>s+x.amount, 0);
  doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(...C.secondary);
  doc.text(money(total), PAGE.width-PAGE.margin-6, y+9.5, { align:'right' });
  y += 18;

  drawFooter(doc);
  doc.save(`relatorio-vendas-${data.currentMonth}-${new Date().toISOString().slice(0,10)}.pdf`);
}
