// lib/export-metrics.ts
//
// Реальный экспорт данных дашборда в Excel и PDF. Берёт те же строки
// metricsRows, которые уже показаны на Overview — никаких отдельных
// запросов, экспортируется ровно то, что видит пользователь.
//
// Раньше заголовки колонок/заголовок отчёта были захардкожены на английском
// независимо от языка сайта (T/language в app/dashboard/page.tsx) — экспорт
// на украинском/немецком интерфейсе всё равно выдавал "Date/Revenue/...".
// Теперь оба экспортера принимают language и берут подписи из LABELS ниже.

export type ExportLanguage = "EN" | "UA" | "DE";

interface ExportRow {
  date: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin_pct: number;
  orders: number;
  cac: number | null;
}

const LABELS: Record<ExportLanguage, {
  date: string;
  revenue: string;
  expenses: string;
  profit: string;
  marginPct: string;
  orders: string;
  cac: string;
  sheetName: string;
  reportTitle: string;
  generated: string;
  business: string;
  totalAvgRow: string;
  summaryTitle: string;
  avgMargin: string;
  avgCac: string;
}> = {
  EN: {
    date: "Date",
    revenue: "Revenue",
    expenses: "Expenses",
    profit: "Profit",
    marginPct: "Margin %",
    orders: "Orders",
    cac: "CAC",
    sheetName: "Metrics",
    reportTitle: "Metrics Report",
    generated: "Generated",
    business: "Business",
    totalAvgRow: "Total / Average",
    summaryTitle: "Summary",
    avgMargin: "Average margin",
    avgCac: "Average CAC",
  },
  UA: {
    date: "Дата",
    revenue: "Дохід",
    expenses: "Витрати",
    profit: "Прибуток",
    marginPct: "Маржа %",
    orders: "Замовлення",
    cac: "CAC",
    sheetName: "Метрики",
    reportTitle: "Звіт по метриках",
    generated: "Сформовано",
    business: "Бізнес",
    totalAvgRow: "Разом / Середнє",
    summaryTitle: "Підсумок",
    avgMargin: "Середня маржа",
    avgCac: "Середній CAC",
  },
  DE: {
    date: "Datum",
    revenue: "Umsatz",
    expenses: "Ausgaben",
    profit: "Gewinn",
    marginPct: "Marge %",
    orders: "Bestellungen",
    cac: "CAC",
    sheetName: "Kennzahlen",
    reportTitle: "Kennzahlenbericht",
    generated: "Erstellt",
    business: "Unternehmen",
    totalAvgRow: "Gesamt / Durchschnitt",
    summaryTitle: "Zusammenfassung",
    avgMargin: "Durchschnittliche Marge",
    avgCac: "Durchschnittlicher CAC",
  },
};

// Общая сводка для обоих экспортов (Excel и PDF) — тот же набор цифр, что
// уже считается и показывается на Overview дашборда (totalRevenue,
// totalProfit, avgMargin), и та же идея, что в lib/whatif-report.mjs
// (computeFacts()) для отчётов по доп. услугам: одна функция считает
// сводку, и Excel/PDF просто по-разному её отображают — без ручного
// пересчёта десятков строк тем, кто скачал отчёт.
function computeSummary(rows: ExportRow[]) {
  const totalRevenue = rows.reduce((s, r) => s + (r.revenue || 0), 0);
  const totalExpenses = rows.reduce((s, r) => s + (r.expenses || 0), 0);
  const totalProfit = rows.reduce((s, r) => s + (r.profit || 0), 0);
  const totalOrders = rows.reduce((s, r) => s + (r.orders || 0), 0);
  const avgMarginPct = rows.length
    ? rows.reduce((s, r) => s + (r.margin_pct || 0), 0) / rows.length
    : 0;
  const cacRows = rows.filter((r) => r.cac != null);
  const avgCac = cacRows.length
    ? cacRows.reduce((s, r) => s + (r.cac as number), 0) / cacRows.length
    : null;

  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalExpenses: Number(totalExpenses.toFixed(2)),
    totalProfit: Number(totalProfit.toFixed(2)),
    totalOrders,
    avgMarginPct: Number(avgMarginPct.toFixed(1)),
    avgCac: avgCac != null ? Number(avgCac.toFixed(2)) : null,
  };
}

// jsPDF-локаль для new Date().toLocaleString() в подписи "Generated ..." —
// тот же принцип, что и в lib/service-report-pdf.mjs (там это уже чинили,
// см. коммент про dateLocale), иначе дата в PDF всегда была б en-US.
const DATE_LOCALE: Record<ExportLanguage, string> = {
  EN: "en-US",
  UA: "uk-UA",
  DE: "de-DE",
};

function fileBaseName(businessName: string) {
  const safe = (businessName || "rivant").trim().replace(/[^a-zA-Z0-9\-_]+/g, "-").toLowerCase() || "rivant";
  const date = new Date().toISOString().slice(0, 10);
  return `${safe}-metrics-${date}`;
}

export async function exportMetricsToExcel(rows: ExportRow[], businessName: string, language: ExportLanguage = "EN") {
  // Динамический import — xlsx довольно тяжёлый, незачем грузить его в
  // основной бандл дашборда, если человек ни разу не жал "Export".
  const XLSX = await import("xlsx");
  const L = LABELS[language] || LABELS.EN;

  const data = rows.map((r) => ({
    [L.date]: r.date,
    [L.revenue]: r.revenue,
    [L.expenses]: r.expenses,
    [L.profit]: r.profit,
    [L.marginPct]: r.margin_pct,
    [L.orders]: r.orders,
    [L.cac]: r.cac ?? "",
  }));

  // Итоговая строка (сумма revenue/expenses/profit/orders, среднее по
  // margin_pct и cac) — раньше экспорт заканчивался на последней дневной
  // строке, и человек, скачавший отчёт для бухгалтера/инвестора, вручную
  // пересчитывал эти же цифры, хотя сайт их уже посчитал (Overview).
  const summary = computeSummary(rows);
  data.push({
    [L.date]: L.totalAvgRow,
    [L.revenue]: summary.totalRevenue,
    [L.expenses]: summary.totalExpenses,
    [L.profit]: summary.totalProfit,
    [L.marginPct]: summary.avgMarginPct,
    [L.orders]: summary.totalOrders,
    [L.cac]: summary.avgCac ?? "",
  });

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, L.sheetName);
  XLSX.writeFile(wb, `${fileBaseName(businessName)}.xlsx`);
}

// Fetch'ит .ttf из /public/fonts и конвертирует в base64 для
// doc.addFileToVFS — тот же шрифт (NotoSans), что и в серверном
// lib/service-report-pdf.mjs, нужен потому что стандартные шрифты jsPDF
// (helvetica и т.п.) не содержат кириллицу — без этого украинские подписи
// в PDF превращались бы в пустые прямоугольники.
async function fetchFontBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    // Конвертация чанками, чтобы не упереться в лимит аргументов
    // String.fromCharCode(...bytes) на больших файлах (шрифт ~420KB).
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  } catch (e) {
    console.error("Failed to load font for PDF export:", e);
    return null;
  }
}

export async function exportMetricsToPdf(rows: ExportRow[], businessName: string, language: ExportLanguage = "EN") {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const L = LABELS[language] || LABELS.EN;

  const doc = new jsPDF();

  // Реальный логотип (не просто текст "Rivant") — /icon8.png лежит в public/,
  // грузим и конвертируем в data URL, чтобы вставить через doc.addImage.
  let logoDataUrl: string | null = null;
  try {
    const res = await fetch("/icon08.png");
    const blob = await res.blob();
    logoDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Failed to load logo for PDF export:", e);
  }

  // Регистрируем NotoSans (кириллица/умляуты) вместо стандартного helvetica —
  // без этого UA/DE подписи ниже могли бы не отрендериться корректно.
  // Если шрифт не загрузился (сеть/404) — тихо остаёмся на helvetica,
  // чтобы экспорт EN-версии не сломался из-за недоступного файла.
  let bodyFont = "helvetica";
  let boldFont = "helvetica";
  const [regularBase64, boldBase64] = await Promise.all([
    fetchFontBase64("/fonts/NotoSans-Regular.ttf"),
    fetchFontBase64("/fonts/NotoSans-Bold.ttf"),
  ]);
  if (regularBase64 && boldBase64) {
    try {
      doc.addFileToVFS("NotoSans-Regular.ttf", regularBase64);
      doc.addFileToVFS("NotoSans-Bold.ttf", boldBase64);
      doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
      doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
      bodyFont = "NotoSans";
      boldFont = "NotoSans";
    } catch (e) {
      console.error("Failed to embed NotoSans font in PDF:", e);
    }
  }

  // icon08.png реальный размер 711×351 (≈2.03:1) — раньше вставлялся как
  // 32×8 (4:1), из-за чего логотип и мелкий, и растянутый по горизонтали.
  // 36×17.8 сохраняет реальную пропорцию и по размеру ближе к тому, как
  // логотип выглядит в шапке настоящего делового отчёта (не игрушечный
  // значок и не на полстраницы).
  let titleY = 16;
  if (logoDataUrl) {
    try {
      const logoWidth = 36;
      const logoHeight = 17.8;
      doc.addImage(logoDataUrl, "PNG", 14, 10, logoWidth, logoHeight);
      titleY = 10 + logoHeight + 8;
    } catch (e) {
      console.error("Failed to embed logo in PDF:", e);
    }
  }

  doc.setFont(boldFont, "bold");
  doc.setFontSize(16);
  doc.text(`${businessName || L.business} — ${L.reportTitle}`, 14, titleY);
  doc.setFont(bodyFont, "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`${L.generated} ${new Date().toLocaleString(DATE_LOCALE[language] || "en-US")} · Rivant`, 14, titleY + 6);

  // Сводка над таблицей — тот же визуальный паттерн (двухколоночная
  // key/value autoTable), что уже используется в lib/service-report-pdf.mjs
  // для отчётов по доп. услугам ("AI-реконструкция"/"AI-дайджест"). Раньше
  // основной дашборд-экспорт этой сводки не имел вовсе — только построчная
  // таблица день-за-днём.
  const summary = computeSummary(rows);
  autoTable(doc, {
    startY: titleY + 12,
    head: [[L.summaryTitle, ""]],
    body: [
      [L.revenue, `$${summary.totalRevenue.toLocaleString()}`],
      [L.expenses, `$${summary.totalExpenses.toLocaleString()}`],
      [L.profit, `$${summary.totalProfit.toLocaleString()}`],
      [L.avgMargin, `${summary.avgMarginPct}%`],
      [L.orders, String(summary.totalOrders)],
      [L.avgCac, summary.avgCac != null ? `$${summary.avgCac}` : "—"],
    ],
    headStyles: { fillColor: [37, 99, 235], font: boldFont },
    styles: { fontSize: 8, font: bodyFont },
    columnStyles: { 0: { fontStyle: "bold" } },
  });

  const tableStartY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 8 : titleY + 12;

  autoTable(doc, {
    startY: tableStartY,
    head: [[L.date, L.revenue, L.expenses, L.profit, L.marginPct, L.orders, L.cac]],
    body: rows.map((r) => [
      r.date,
      `$${r.revenue.toLocaleString()}`,
      `$${r.expenses.toLocaleString()}`,
      `$${r.profit.toLocaleString()}`,
      `${r.margin_pct}%`,
      String(r.orders),
      r.cac != null ? `$${r.cac}` : "—",
    ]),
    headStyles: { fillColor: [37, 99, 235], font: boldFont },
    styles: { fontSize: 8, font: bodyFont },
  });

  doc.save(`${fileBaseName(businessName)}.pdf`);
}