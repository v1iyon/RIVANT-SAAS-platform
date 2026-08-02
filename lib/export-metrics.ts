// lib/export-metrics.ts
//
// Реальный экспорт данных дашборда в Excel и PDF. Берёт те же строки
// metricsRows, которые уже показаны на Overview — никаких отдельных
// запросов, экспортируется ровно то, что видит пользователь.

interface ExportRow {
  date: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin_pct: number;
  orders: number;
  cac: number | null;
}

function fileBaseName(businessName: string) {
  const safe = (businessName || "rivant").trim().replace(/[^a-zA-Z0-9\-_]+/g, "-").toLowerCase() || "rivant";
  const date = new Date().toISOString().slice(0, 10);
  return `${safe}-metrics-${date}`;
}

export async function exportMetricsToExcel(rows: ExportRow[], businessName: string) {
  // Динамический import — xlsx довольно тяжёлый, незачем грузить его в
  // основной бандл дашборда, если человек ни разу не жал "Export".
  const XLSX = await import("xlsx");

  const data = rows.map((r) => ({
    Date: r.date,
    Revenue: r.revenue,
    Expenses: r.expenses,
    Profit: r.profit,
    "Margin %": r.margin_pct,
    Orders: r.orders,
    CAC: r.cac ?? "",
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Metrics");
  XLSX.writeFile(wb, `${fileBaseName(businessName)}.xlsx`);
}

export async function exportMetricsToPdf(rows: ExportRow[], businessName: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text(`${businessName || "Business"} — Metrics Report`, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString()} · Rivant`, 14, 22);

  autoTable(doc, {
    startY: 28,
    head: [["Date", "Revenue", "Expenses", "Profit", "Margin %", "Orders", "CAC"]],
    body: rows.map((r) => [
      r.date,
      `$${r.revenue.toLocaleString()}`,
      `$${r.expenses.toLocaleString()}`,
      `$${r.profit.toLocaleString()}`,
      `${r.margin_pct}%`,
      String(r.orders),
      r.cac != null ? `$${r.cac}` : "—",
    ]),
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 8 },
  });

  doc.save(`${fileBaseName(businessName)}.pdf`);
}