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
export async function renderServiceReportPdf({ businessName, serviceType, facts, narrative, language }) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const lang = LABELS[language] ? language : "EN";
  const L = LABELS[lang];
  const title = TITLES[serviceType]?.[lang] || TITLES[serviceType]?.EN || "RIVANT Report";

  const doc = new jsPDF();
  const logoDataUrl = loadLogoDataUrl();

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

  doc.setFontSize(17);
  doc.setTextColor(20);
  doc.text(title, 14, titleY);
  doc.setFontSize(11);
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
    styles: { fontSize: 11, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: "bold", textColor: [80, 80, 80] }, 1: { textColor: [20, 20, 20] } },
  });

  const afterTableY = doc.lastAutoTable.finalY + 12;
  doc.setFontSize(11);
  doc.setTextColor(30);
  const narrativeLines = doc.splitTextToSize(narrative || "", 180);
  doc.text(narrativeLines, 14, afterTableY);

  const disclaimerY = afterTableY + narrativeLines.length * 5.5 + 10;
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(doc.splitTextToSize(L.disclaimer, 180), 14, disclaimerY);

  const arrayBuffer = doc.output("arraybuffer");
  const safeName = (businessName || "rivant").trim().replace(/[^a-zA-Z0-9\-_]+/g, "-").toLowerCase() || "rivant";
  const filename = `${safeName}-${serviceType}-${new Date().toISOString().slice(0, 10)}.pdf`;

  return { buffer: Buffer.from(arrayBuffer), filename };
}
