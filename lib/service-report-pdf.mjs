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

function drawTrendChart(doc, metrics, language, startY = 38) {
  const chart = { x: 14, y: startY, width: 182, height: 52 };
  const values = metrics.map((row) => Number(row.revenue || 0));
  const margins = metrics.map((row) => Number(row.margin_pct || 0));
  const max = Math.max(...values, 1);
  doc.setDrawColor(220, 226, 236);
  doc.setFillColor(248, 250, 253);
  doc.rect(chart.x, chart.y, chart.width, chart.height, "FD");
  doc.setDrawColor(210, 218, 230);
  for (let i = 1; i < 4; i++) doc.line(chart.x, chart.y + (chart.height / 4) * i, chart.x + chart.width, chart.y + (chart.height / 4) * i);

  const step = values.length > 1 ? chart.width / (values.length - 1) : chart.width;

  // Виручка — синя лінія по лівій шкалі ($).
  doc.setDrawColor(26, 86, 190);
  doc.setLineWidth(0.8);
  values.forEach((value, index) => {
    if (!index) return;
    const previous = values[index - 1];
    const x1 = chart.x + step * (index - 1);
    const y1 = chart.y + chart.height - (previous / max) * (chart.height - 4) - 2;
    const x2 = chart.x + step * index;
    const y2 = chart.y + chart.height - (value / max) * (chart.height - 4) - 2;
    doc.line(x1, y1, x2, y2);
  });

  // Маржа — зелена пунктирна лінія по правій шкалі (0–100%), другий шар
  // поверх того самого графіка — робить його "міні-дашбордом", а не одним
  // показником, як просили.
  doc.setDrawColor(22, 163, 74);
  doc.setLineWidth(0.6);
  doc.setLineDashPattern([1.2, 1], 0);
  margins.forEach((value, index) => {
    if (!index) return;
    const previous = Math.max(0, Math.min(100, margins[index - 1]));
    const current = Math.max(0, Math.min(100, value));
    const x1 = chart.x + step * (index - 1);
    const y1 = chart.y + chart.height - (previous / 100) * (chart.height - 4) - 2;
    const x2 = chart.x + step * index;
    const y2 = chart.y + chart.height - (current / 100) * (chart.height - 4) - 2;
    doc.line(x1, y1, x2, y2);
  });
  doc.setLineDashPattern([], 0);

  doc.setFontSize(8);
  doc.setTextColor(80);
  doc.text(language === "UA" ? "Виручка за днями" : language === "DE" ? "Tagesumsatz" : "Daily revenue", chart.x + 4, chart.y + 7);
  doc.setTextColor(120);
  doc.text(`$${max.toLocaleString()}`, chart.x + chart.width - 4, chart.y + 7, { align: "right" });

  // Легенда під графіком — дві лінії, дві шкали, один рядок пояснення.
  const legendY = chart.y + chart.height + 6;
  doc.setDrawColor(26, 86, 190);
  doc.setLineWidth(0.8);
  doc.line(chart.x, legendY, chart.x + 6, legendY);
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(language === "UA" ? "Виручка ($)" : language === "DE" ? "Umsatz ($)" : "Revenue ($)", chart.x + 9, legendY + 1);
  doc.setDrawColor(22, 163, 74);
  doc.setLineDashPattern([1.2, 1], 0);
  doc.line(chart.x + 55, legendY, chart.x + 61, legendY);
  doc.setLineDashPattern([], 0);
  doc.text(language === "UA" ? "Маржа (%)" : language === "DE" ? "Marge (%)" : "Margin (%)", chart.x + 64, legendY + 1);

  // Повертаємо Y одразу під легендою — раніше наступний блок (Аналітика)
  // мав власну захардкожену координату, яка майже збігалась із легендою і
  // "наїжджала" на неї. Тепер немає розсинхрону: викликач завжди має
  // актуальну нижню межу графіка.
  return legendY + 8;
}

// Раніше "Ключові висновки" виводились суцільним splitTextToSize-блоком —
// підзаголовки ("Підсумок", "Динаміка виручки...") зливались з буллетами під
// ними в одну стіну тексту. Тепер розпізнаємо рядок-заголовок (без "•") і
// даємо йому bold + відступ зверху; буллети йдуть щільніше під заголовком.
// Формат такий самий, що і в AI-промпті (lib/whatif-report.mjs) та у
// fallback-тексті — секції на окремих рядках, буллети починаються з "•".
function renderNarrative(doc, text, x, startY, maxWidth) {
  const rawLines = (text || "").split("\n").filter((line) => line.trim().length > 0);
  let y = startY;
  let first = true;

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    const isBullet = line.startsWith("•");

    if (!isBullet) {
      // Підзаголовок секції.
      if (!first) y += 3.5; // відступ ПЕРЕД новою секцією — це і прибирає ефект "суцільного тексту"
      doc.setFont("NotoSans", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(30);
      const lines = doc.splitTextToSize(line, maxWidth);
      doc.text(lines, x, y);
      y += lines.length * 5 + 1.5;
    } else {
      doc.setFont("NotoSans", "normal");
      doc.setFontSize(10);
      doc.setTextColor(70);
      const lines = doc.splitTextToSize(line, maxWidth - 3);
      doc.text(lines, x + 3, y);
      y += lines.length * 4.8;
    }
    first = false;
  }

  return y;
}

// Простий горизонтальний бар-чарт витрат по джерелах — другий графік на тій
// самій сторінці, поруч із таблицею, щоб сторінка виглядала як міні-дашборд,
// а не просто список цифр.
function drawExpenseBarChart(doc, expensesBySource, x, y, width, height, L) {
  const entries = Object.entries(expensesBySource || {}).filter(([, amount]) => Number(amount) > 0);
  if (!entries.length) return y;

  doc.setFont("NotoSans", "bold");
  doc.setFontSize(11);
  doc.setTextColor(30);
  doc.text(L.expensesChartTitle, x, y);

  const max = Math.max(...entries.map(([, amount]) => Number(amount)), 1);
  const barAreaX = x + 42;
  const barAreaWidth = width - 42 - 24;
  const rowHeight = Math.min(9, (height - 10) / entries.length);
  const colors = [[26, 86, 190], [22, 163, 74], [217, 119, 6], [124, 58, 237], [220, 38, 38]];

  entries.forEach(([source, amount], index) => {
    const rowY = y + 10 + index * rowHeight;
    const barWidth = (Number(amount) / max) * barAreaWidth;
    const [r, g, b] = colors[index % colors.length];

    doc.setFont("NotoSans", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(90);
    doc.text(source, x, rowY + rowHeight * 0.6, { maxWidth: 40 });

    doc.setFillColor(r, g, b);
    doc.roundedRect(barAreaX, rowY, Math.max(barWidth, 1), rowHeight * 0.6, 0.6, 0.6, "F");

    doc.setTextColor(60);
    doc.text(`$${Number(amount).toLocaleString()}`, barAreaX + barWidth + 3, rowY + rowHeight * 0.6 - 1);
  });

  return y + 10 + entries.length * rowHeight + 8;
}

// Факти-інсайти, а не текст від AI: рахуються прямо з metrics, тому завжди
// присутні (не залежать від доступності Anthropic) і не можуть містити
// вигаданих причин — тільки арифметика по вже синхронізованих даних.
function computeInsights(metrics, L) {
  if (!metrics?.length) return [];
  const bullets = [];

  let best = metrics[0];
  let worst = metrics[0];
  let zeroDays = 0;
  for (const m of metrics) {
    const rev = Number(m.revenue || 0);
    if (rev > Number(best.revenue || 0)) best = m;
    if (rev < Number(worst.revenue || 0)) worst = m;
    if (!m.orders) zeroDays++;
  }
  bullets.push(L.insightBestDay(best.date, Number(best.revenue || 0)));
  if (worst.date !== best.date) bullets.push(L.insightWorstDay(worst.date, Number(worst.revenue || 0)));

  const mid = Math.floor(metrics.length / 2);
  const firstHalf = metrics.slice(0, mid);
  const secondHalf = metrics.slice(mid);
  const avg = (arr, key) => (arr.length ? arr.reduce((sum, m) => sum + Number(m[key] || 0), 0) / arr.length : 0);

  const revFirst = avg(firstHalf, "revenue");
  const revSecond = avg(secondHalf, "revenue");
  if (revFirst > 0) {
    const pctChange = Math.round(((revSecond - revFirst) / revFirst) * 100);
    if (Math.abs(pctChange) < 3) bullets.push(L.insightRevenueTrendFlat);
    else if (pctChange > 0) bullets.push(L.insightRevenueTrendUp(pctChange));
    else bullets.push(L.insightRevenueTrendDown(Math.abs(pctChange)));
  }

  const marginFirst = avg(firstHalf, "margin_pct");
  const marginSecond = avg(secondHalf, "margin_pct");
  const ppChange = Math.round((marginSecond - marginFirst) * 10) / 10;
  if (Math.abs(ppChange) < 1) bullets.push(L.insightMarginFlat);
  else if (ppChange > 0) bullets.push(L.insightMarginUp(ppChange));
  else bullets.push(L.insightMarginDown(Math.abs(ppChange)));

  if (zeroDays > 0) bullets.push(L.insightZeroDays(zeroDays));

  return bullets;
}

// Маленький логотип у лівому куті — на 1-й сторінці вже є великий (частина
// шапки), тут та сама картинка, тільки менша, для сторінок 2 і 3, щоб бренд
// був на кожному аркуші звіту.
function drawPageLogo(doc, logoDataUrl) {
  if (!logoDataUrl) return;
  try {
    const width = 18;
    const height = 8.9; // та сама пропорція 711×351, що і на 1-й сторінці
    doc.addImage(logoDataUrl, "PNG", 14, 7, width, height);
  } catch (e) {
    console.error("service-report-pdf: failed to embed page logo:", e.message);
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
    noNarrative: "Текстове пояснення тимчасово недоступне — усі факти та графіки нижче побудовані з ваших синхронізованих даних.",
    insightsTitle: "Аналітика",
    insightBestDay: (date, value) => `Найкращий день за виручкою — ${date} ($${value.toLocaleString()}).`,
    insightWorstDay: (date, value) => `Найслабший день за виручкою — ${date} ($${value.toLocaleString()}).`,
    insightRevenueTrendUp: (pct) => `Виручка в другій половині періоду в середньому на ${pct}% вища, ніж у першій.`,
    insightRevenueTrendDown: (pct) => `Виручка в другій половині періоду в середньому на ${pct}% нижча, ніж у першій.`,
    insightRevenueTrendFlat: "Виручка за період без вираженого тренду — коливається навколо одного рівня.",
    insightMarginUp: (pp) => `Середня маржа в другій половині періоду на ${pp} п.п. вища, ніж у першій.`,
    insightMarginDown: (pp) => `Середня маржа в другій половині періоду на ${pp} п.п. нижча, ніж у першій.`,
    insightMarginFlat: "Маржа за період стабільна, без вираженої зміни.",
    insightZeroDays: (count) => `Днів без замовлень за період: ${count}.`,
    expensesChartTitle: "Витрати по джерелах",
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
    noNarrative: "The text explanation is temporarily unavailable — all facts and charts below are built from your synced data.",
    insightsTitle: "Insights",
    insightBestDay: (date, value) => `Best revenue day — ${date} ($${value.toLocaleString()}).`,
    insightWorstDay: (date, value) => `Weakest revenue day — ${date} ($${value.toLocaleString()}).`,
    insightRevenueTrendUp: (pct) => `Revenue in the second half of the period averaged ${pct}% higher than in the first half.`,
    insightRevenueTrendDown: (pct) => `Revenue in the second half of the period averaged ${pct}% lower than in the first half.`,
    insightRevenueTrendFlat: "Revenue shows no clear trend over the period — it fluctuates around the same level.",
    insightMarginUp: (pp) => `Average margin in the second half of the period is ${pp} pp higher than in the first half.`,
    insightMarginDown: (pp) => `Average margin in the second half of the period is ${pp} pp lower than in the first half.`,
    insightMarginFlat: "Margin is stable over the period, with no clear change.",
    insightZeroDays: (count) => `Days with zero orders in the period: ${count}.`,
    expensesChartTitle: "Spend by source",
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
    noNarrative: "Die Texterklärung ist vorübergehend nicht verfügbar — alle Fakten und Diagramme unten basieren auf Ihren synchronisierten Daten.",
    insightsTitle: "Analyse",
    insightBestDay: (date, value) => `Bester Umsatztag — ${date} ($${value.toLocaleString()}).`,
    insightWorstDay: (date, value) => `Schwächster Umsatztag — ${date} ($${value.toLocaleString()}).`,
    insightRevenueTrendUp: (pct) => `Der Umsatz in der zweiten Hälfte des Zeitraums war im Schnitt ${pct}% höher als in der ersten Hälfte.`,
    insightRevenueTrendDown: (pct) => `Der Umsatz in der zweiten Hälfte des Zeitraums war im Schnitt ${pct}% niedriger als in der ersten Hälfte.`,
    insightRevenueTrendFlat: "Der Umsatz zeigt im Zeitraum keinen klaren Trend — er schwankt um ein ähnliches Niveau.",
    insightMarginUp: (pp) => `Die Durchschnittsmarge in der zweiten Hälfte des Zeitraums ist ${pp} pp höher als in der ersten Hälfte.`,
    insightMarginDown: (pp) => `Die Durchschnittsmarge in der zweiten Hälfte des Zeitraums ist ${pp} pp niedriger als in der ersten Hälfte.`,
    insightMarginFlat: "Die Marge ist im Zeitraum stabil, ohne klare Veränderung.",
    insightZeroDays: (count) => `Tage ohne Bestellungen im Zeitraum: ${count}.`,
    expensesChartTitle: "Ausgaben nach Quelle",
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
    [lang === "UA" ? "Середній чек" : lang === "DE" ? "Durchschnittlicher Bestellwert" : "Average order value", `$${facts.avgOrderValue.toLocaleString()}`],
    [lang === "UA" ? "Витрати за період" : lang === "DE" ? "Kosten im Zeitraum" : "Costs for period", `$${facts.totalCost.toLocaleString()}`],
    [lang === "UA" ? "Результат після витрат" : lang === "DE" ? "Ergebnis nach Kosten" : "Result after costs", `$${facts.totalProfit.toLocaleString()}`],
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
  const narrativeText = (narrative && narrative.trim()) || L.noNarrative;
  const narrativeEndY = renderNarrative(doc, narrativeText, 14, afterTableY + 7, 180);

  const disclaimerY = narrativeEndY + 10;
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(doc.splitTextToSize(L.disclaimer, 180), 14, disclaimerY);

  if (serviceType === "whatif_analysis") {
    doc.addPage();
    drawPageLogo(doc, logoDataUrl);
    doc.setFont("NotoSans", "bold");
    doc.setFontSize(16);
    doc.setTextColor(20);
    doc.text(lang === "UA" ? "Динаміка показників" : lang === "DE" ? "Kennzahlenentwicklung" : "Performance trends", 14, 26);
    doc.setFont("NotoSans", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(lang === "UA" ? "Графік виручки та щоденні дані, використані для реконструкції" : lang === "DE" ? "Umsatzdiagramm und Tagesdaten der Rekonstruktion" : "Revenue chart and daily data used in the reconstruction", 14, 33);
    const chartBottomY = drawTrendChart(doc, metrics, lang, 42);

    // Блок фактичних інсайтів — прямо під графіком, окремо від AI-тексту на
    // 1-й сторінці. Це і є той "аналіз/висновки", яких не вистачало.
    // insightsY тепер завжди йде від фактичної нижньої межі графіка й
    // легенди (chartBottomY), а не від захардкодженого числа — тому більше
    // не наїжджає на підписи "Виручка ($) / Маржа (%)".
    const insights = computeInsights(metrics, L);
    let insightsBottomY = chartBottomY;
    if (insights.length) {
      const insightsY = chartBottomY;
      doc.setFont("NotoSans", "bold");
      doc.setFontSize(11);
      doc.setTextColor(30);
      doc.text(L.insightsTitle, 14, insightsY);
      doc.setFont("NotoSans", "normal");
      doc.setFontSize(9);
      doc.setTextColor(70);
      let bulletY = insightsY + 6;
      for (const bullet of insights) {
        const lines = doc.splitTextToSize(`•  ${bullet}`, 182);
        doc.text(lines, 14, bulletY);
        bulletY += lines.length * 4.6;
      }
      insightsBottomY = bulletY + 4;
    }

    const dailyRows = metrics.map((m) => [
      m.date,
      `$${Number(m.revenue || 0).toLocaleString()}`,
      `$${Number(m.cost || 0).toLocaleString()}`,
      `${Number(m.margin_pct || 0).toFixed(1)}%`,
      String(m.orders || 0),
    ]);
    autoTable(doc, {
      startY: insightsBottomY,
      head: [[lang === "UA" ? "Дата" : "Date", lang === "UA" ? "Виручка" : "Revenue", lang === "UA" ? "Витрати" : "Costs", lang === "UA" ? "Маржа" : "Margin", lang === "UA" ? "Замовлення" : "Orders"]],
      body: dailyRows,
      styles: { font: "NotoSans", fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [18, 66, 145] },
      alternateRowStyles: { fillColor: [245, 248, 252] },
    });

    doc.addPage();
    drawPageLogo(doc, logoDataUrl);
    doc.setFont("NotoSans", "bold");
    doc.setFontSize(16);
    doc.setTextColor(20);
    doc.text(lang === "UA" ? "Структура витрат і методологія" : lang === "DE" ? "Kostenstruktur und Methodik" : "Cost structure and methodology", 14, 26);
    doc.setFont("NotoSans", "normal");

    // Бар-чарт зверху — той самий "як міні-дашборд", таблиця з точними
    // цифрами під ним лишається для деталізації.
    const afterChartY = drawExpenseBarChart(doc, expensesBySource, 14, 38, 182, 46, L);

    const totalSpend = Object.values(expensesBySource || {}).reduce((sum, v) => sum + Number(v || 0), 0);
    // Раніше таблиця мала лише 2 колонки (джерело/сума) — додав частку від
    // сукупних витрат і частку від виручки: це реальні розрахункові
    // показники з тих самих даних (не вигадка і не "порівняння з нішами",
    // для якого в нас просто немає зовнішніх бенчмарків).
    const expenseRows = Object.entries(expensesBySource || {}).map(([source, amount]) => [
      source,
      `$${Number(amount).toLocaleString()}`,
      totalSpend > 0 ? `${((Number(amount) / totalSpend) * 100).toFixed(1)}%` : "-",
      facts.totalRevenue > 0 ? `${((Number(amount) / facts.totalRevenue) * 100).toFixed(1)}%` : "-",
    ]);
    autoTable(doc, {
      startY: Math.max(afterChartY, 38),
      head: [[
        lang === "UA" ? "Джерело" : "Source",
        lang === "UA" ? "Витрати" : "Spend",
        lang === "UA" ? "% від витрат" : "% of spend",
        lang === "UA" ? "% від виручки" : "% of revenue",
      ]],
      body: expenseRows.length ? expenseRows : [[lang === "UA" ? "Немає даних про витрати" : "No expense data", "-", "-", "-"]],
      styles: { font: "NotoSans", fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: [18, 66, 145] },
      foot: expenseRows.length
        ? [[
            lang === "UA" ? "Разом" : lang === "DE" ? "Gesamt" : "Total",
            `$${totalSpend.toLocaleString()}`,
            "100%",
            facts.totalRevenue > 0 ? `${((totalSpend / facts.totalRevenue) * 100).toFixed(1)}%` : "-",
          ]]
        : undefined,
      footStyles: { fillColor: [235, 240, 248], textColor: [30, 30, 30], fontStyle: "bold" },
    });

    // Ефективність — ще один розрахунковий блок з тих самих чисел: скільки
    // коштувало одне замовлення і яку частку виручки "з'їдають" усі витрати
    // разом. Реальні цифри клієнта, не бенчмарк по ринку.
    const effY = (doc.lastAutoTable?.finalY || 60) + 10;
    doc.setFont("NotoSans", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text(lang === "UA" ? "Ефективність" : lang === "DE" ? "Effizienz" : "Efficiency", 14, effY);
    doc.setFont("NotoSans", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(70);
    const costPerOrder = facts.totalOrders > 0 ? facts.totalCost / facts.totalOrders : 0;
    const spendShareOfRevenue = facts.totalRevenue > 0 ? (facts.totalCost / facts.totalRevenue) * 100 : 0;
    const effBullets = lang === "UA"
      ? [
          `Усі витрати за період становлять ${spendShareOfRevenue.toFixed(1)}% від виручки.`,
          `Середні витрати на одне замовлення: $${costPerOrder.toFixed(2)}.`,
          `Середній чек мінус середні витрати на замовлення: $${(facts.avgOrderValue - costPerOrder).toFixed(2)}.`,
        ]
      : lang === "DE"
      ? [
          `Alle Kosten im Zeitraum entsprechen ${spendShareOfRevenue.toFixed(1)}% des Umsatzes.`,
          `Durchschnittliche Kosten pro Bestellung: $${costPerOrder.toFixed(2)}.`,
          `Durchschnittlicher Bestellwert minus durchschnittliche Kosten pro Bestellung: $${(facts.avgOrderValue - costPerOrder).toFixed(2)}.`,
        ]
      : [
          `Total costs for the period equal ${spendShareOfRevenue.toFixed(1)}% of revenue.`,
          `Average cost per order: $${costPerOrder.toFixed(2)}.`,
          `Average order value minus average cost per order: $${(facts.avgOrderValue - costPerOrder).toFixed(2)}.`,
        ];
    let effBulletY = effY + 6;
    for (const bullet of effBullets) {
      const lines = doc.splitTextToSize(`•  ${bullet}`, 182);
      doc.text(lines, 14, effBulletY);
      effBulletY += lines.length * 4.6;
    }

    const methodology = lang === "UA"
      ? "Звіт побудовано на синхронізованих даних RIVANT за вказаний період. Виручка, витрати, маржа та кількість замовлень розраховані з щоденних записів. AI формує текстове пояснення лише на основі цих значень; він не додає припущень або вигаданих причин."
      : lang === "DE"
      ? "Dieser Bericht basiert auf den synchronisierten RIVANT-Daten des angegebenen Zeitraums. Umsatz, Kosten, Marge und Bestellungen werden aus Tageswerten berechnet. Die KI erläutert nur diese Werte und fügt keine Annahmen hinzu."
      : "This report is based on synchronized RIVANT data for the stated period. Revenue, costs, margin, and orders are calculated from daily records. AI explains only these values and does not add assumptions or invented causes.";
    doc.setFontSize(9);
    doc.setTextColor(140);
    doc.text(doc.splitTextToSize(methodology, 180), 14, effBulletY + 8);
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
