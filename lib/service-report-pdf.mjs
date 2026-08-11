// lib/service-report-pdf.mjs
//
// Раніше "AI-Реконструкція минулого" ($199) і "AI-Дайджест ефективності"
// ($49/міс) доставлялись як звичайний текст у Telegram/email (див. старий
// коментар у whatif-report.mjs). За такі гроші клієнт очікує документ, а не
// повідомлення в чаті — тут генеруємо справжній PDF-звіт із тим самим
// брендингом (логотип), що й в /Огляд → Export.
//
// ВАЖЛИВО: це серверний (Node, без DOM) варіант — на відміну від
// lib/export-metrics.ts (браузерний, викликає doc.save() і fetch("/icon...")
// відносним шляхом). Тут логотип читається напряму з файлової системи, а
// результат повертається як Buffer, а не тригерить завантаження.

import { readFileSync } from "fs";
import { join } from "path";

function loadLogoDataUrl() {
  try {
    const bytes = readFileSync(join(process.cwd(), "public", "icon08.png"));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch (e) {
    console.error("service-report-pdf: failed to load logo:", e.message);
    return null;
  }
}

function loadFontData(fontFile) {
  try {
    return readFileSync(join(process.cwd(), "public", "fonts", fontFile)).toString("base64");
  } catch (e) {
    console.error("service-report-pdf: failed to load font:", e.message);
    return null;
  }
}

const TITLES = {
  whatif_analysis: {
    UA: "AI-Реконструкція минулого",
    EN: "AI Historical Reconstruction",
    DE: "KI-Rekonstruktion der Vergangenheit",
  },
  monthly_digest: {
    UA: "AI-Дайджест ефективності",
    EN: "AI Performance Digest",
    DE: "KI-Leistungs-Digest",
  },
};

const LABELS = {
  UA: {
    period: "Період",
    revenue: "Виручка за період",
    orders: "Замовлень",
    avgMargin: "Середня маржа",
    marginChange: "Зміна маржі за період",
    topChannel: "Найбільший канал витрат",
    generated: "Сформовано",
    disclaimer: "Це факти на основі ваших даних, без рекомендацій — рішення за вами.",
  },
  EN: {
    period: "Period",
    revenue: "Revenue for period",
    orders: "Orders",
    avgMargin: "Average margin",
    marginChange: "Margin change over period",
    topChannel: "Top expense channel",
    generated: "Generated",
    disclaimer: "These are facts based on your data, no recommendations — the decision is yours.",
  },
  DE: {
    period: "Zeitraum",
    revenue: "Umsatz im Zeitraum",
    orders: "Bestellungen",
    avgMargin: "Durchschnittliche Marge",
    marginChange: "Margenänderung im Zeitraum",
    topChannel: "Größter Ausgabenkanal",
    generated: "Erstellt",
    disclaimer: "Dies sind Fakten basierend auf Ihren Daten, ohne Empfehlungen — die Entscheidung liegt bei Ihnen.",
  },
};

// Повертає { buffer, filename } — Buffer йде і в Telegram sendDocument
// (multipart), і в Resend email (base64 attachment).
export async function renderServiceReportPdf({ businessName, serviceType, facts, narrative, language, metrics = [], expensesBySource = {} }) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const lang = LABELS[language] ? language : "EN";
  const L = LABELS[lang];
  const title = TITLES[serviceType]?.[lang] || TITLES[serviceType]?.EN || "RIVANT Report";

  const doc = new jsPDF();
  const logoDataUrl = loadLogoDataUrl();
  const regularFont = loadFontData("NotoSans-Regular.ttf");
  const boldFont = loadFontData("NotoSans-Bold.ttf");
  if (regularFont && boldFont) {
    doc.addFileToVFS("NotoSans-Regular.ttf", regularFont);
    doc.addFileToVFS("NotoSans-Bold.ttf", boldFont);
    doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
    doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
    doc.setFont("NotoSans", "normal");
  }

  let titleY = 16;
  if (logoDataUrl) {
    try {
      const logoWidth = 36;
      const logoHeight = 17.8; // icon08.png реальна пропорція 711×351 ≈ 2.03:1
      doc.addImage(logoDataUrl, "PNG", 14, 10, logoWidth, logoHeight);
      titleY = 10 + logoHeight + 10;
    } catch (e) {
      console.error("service-report-pdf: failed to embed logo:", e.message);
    }
  }

  doc.setFont("NotoSans", "bold");
  doc.setFontSize(17);
  doc.setTextColor(20);
  doc.text(title, 14, titleY);
  doc.setFontSize(11);
  doc.setFont("NotoSans", "normal");
  doc.setTextColor(100);
  doc.text(businessName || "Business", 14, titleY + 7);
  doc.setFontSize(9);
  doc.setTextColor(140);
  doc.text(`${L.generated} ${new Date().toLocaleString()} · RIVANT`, 14, titleY + 13);

  const rows = [
    [L.period, `${facts.periodStart} — ${facts.periodEnd}`],
    [L.revenue, `$${facts.totalRevenue.toLocaleString()}`],
    [L.orders, String(facts.totalOrders)],
    [L.avgMargin, `${facts.avgMarginPct}%`],
    [L.marginChange, `${facts.marginChangePct > 0 ? "+" : ""}${facts.marginChangePct}%`],
  ];
  if (facts.topChannel) {
    rows.push([L.topChannel, `${facts.topChannel.name} ($${facts.topChannel.spend.toLocaleString()})`]);
  }

  autoTable(doc, {
    startY: titleY + 22,
    body: rows,
    theme: "plain",
    styles: { font: "NotoSans", fontSize: 11, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: "bold", textColor: [80, 80, 80] }, 1: { textColor: [20, 20, 20] } },
  });

  const afterTableY = doc.lastAutoTable.finalY + 12;
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(12);
  doc.setTextColor(30);
  doc.text(lang === "UA" ? "Ключові висновки" : lang === "DE" ? "Wichtigste Erkenntnisse" : "Key findings", 14, afterTableY);
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(11);
  const narrativeLines = doc.splitTextToSize(narrative || "", 180);
  doc.text(narrativeLines, 14, afterTableY + 7);

  const disclaimerY = afterTableY + narrativeLines.length * 5.5 + 17;
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(doc.splitTextToSize(L.disclaimer, 180), 14, disclaimerY);

  if (serviceType === "whatif_analysis") {
    doc.addPage();
    doc.setFont("NotoSans", "bold");
    doc.setFontSize(16);
    doc.setTextColor(20);
    doc.text(lang === "UA" ? "Динаміка показників" : lang === "DE" ? "Kennzahlenentwicklung" : "Performance trends", 14, 18);
    doc.setFont("NotoSans", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(lang === "UA" ? "Щоденні дані, використані для реконструкції" : lang === "DE" ? "Tagesdaten der Rekonstruktion" : "Daily data used in the reconstruction", 14, 25);
    const dailyRows = metrics.map((m) => [
      m.date,
      `$${Number(m.revenue || 0).toLocaleString()}`,
      `$${Number(m.cost || 0).toLocaleString()}`,
      `${Number(m.margin_pct || 0).toFixed(1)}%`,
      String(m.orders || 0),
    ]);
    autoTable(doc, {
      startY: 32,
      head: [[lang === "UA" ? "Дата" : "Date", lang === "UA" ? "Виручка" : "Revenue", lang === "UA" ? "Витрати" : "Costs", lang === "UA" ? "Маржа" : "Margin", lang === "UA" ? "Замовлення" : "Orders"]],
      body: dailyRows,
      styles: { font: "NotoSans", fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [18, 66, 145] },
      alternateRowStyles: { fillColor: [245, 248, 252] },
    });

    doc.addPage();
    doc.setFont("NotoSans", "bold");
    doc.setFontSize(16);
    doc.setTextColor(20);
    doc.text(lang === "UA" ? "Структура витрат і методологія" : lang === "DE" ? "Kostenstruktur und Methodik" : "Cost structure and methodology", 14, 18);
    doc.setFont("NotoSans", "normal");
    const expenseRows = Object.entries(expensesBySource).map(([source, amount]) => [source, `$${Number(amount).toLocaleString()}`]);
    autoTable(doc, {
      startY: 26,
      head: [[lang === "UA" ? "Джерело" : "Source", lang === "UA" ? "Витрати" : "Spend"]],
      body: expenseRows.length ? expenseRows : [[lang === "UA" ? "Немає даних про витрати" : "No expense data", "-"]],
      styles: { font: "NotoSans", fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: [18, 66, 145] },
    });
    const methodology = lang === "UA"
      ? "Звіт побудовано на синхронізованих даних RIVANT за вказаний період. Виручка, витрати, маржа та кількість замовлень розраховані з щоденних записів. AI формує текстове пояснення лише на основі цих значень; він не додає припущень або вигаданих причин."
      : lang === "DE"
      ? "Dieser Bericht basiert auf den synchronisierten RIVANT-Daten des angegebenen Zeitraums. Umsatz, Kosten, Marge und Bestellungen werden aus Tageswerten berechnet. Die KI erläutert nur diese Werte und fügt keine Annahmen hinzu."
      : "This report is based on synchronized RIVANT data for the stated period. Revenue, costs, margin, and orders are calculated from daily records. AI explains only these values and does not add assumptions or invented causes.";
    doc.setFontSize(10);
    doc.setTextColor(60);
    const methodY = (doc.lastAutoTable?.finalY || 40) + 14;
    doc.text(doc.splitTextToSize(methodology, 180), 14, methodY);
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont("NotoSans", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`RIVANT | ${page}/${pages}`, 196, 290, { align: "right" });
  }

  const arrayBuffer = doc.output("arraybuffer");
  const safeName = (businessName || "RIVANT").trim().replace(/[<>:"/\\|?*]+/g, "-") || "RIVANT";
  const safeTitle = title.replace(/[<>:"/\\|?*]+/g, "-");
  const filename = `${safeName} - ${safeTitle} - ${new Date().toISOString().slice(0, 10)}.pdf`;

  return { buffer: Buffer.from(arrayBuffer), filename };
}
