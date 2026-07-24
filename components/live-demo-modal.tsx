"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/translations";
import { 
  LayoutDashboard, AlertTriangle, TrendingUp, Link2, 
  Bell, X, AlertCircle, ArrowUpRight, ArrowDownRight, Trash2,
  TrendingDown, DollarSign, BarChart3, Zap, Package, CreditCard, Truck, Users, Activity,
  CheckCircle, Wifi, WifiOff, Settings, Link
} from "lucide-react";

interface LiveDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewType = "overview" | "risks" | "forecast" | "integrations";

interface Risk {
  id: number;
  title: string;
  description: string;
  time: string;
  severity: "high" | "medium" | "low";
  action: string;
  category: "ads" | "inventory" | "finance" | "shipping" | "conversion" | "cac" | "margin" | "integration";
  integrationId?: string;
  alertType?: "revenue_drop" | "revenue_rise" | "profit_drop" | "profit_rise" | "cac_increase" | "cac_decrease" | "low_stock" | "sync_error" | "shipping_delay" | "conversion_drop" | "ad_spend" | "integration_down";
}

interface Integration {
  id: string;
  name: string;
  icon: string;
  status: "connected" | "error" | "setup_required";
  lastSync: string;
  lastSyncTime: Date;
  errorMessage?: string;
}

const BASE_REVENUE = 125608;
const BASE_PROFIT = 34563;
const BASE_MARGIN = 27.5;
const BASE_CAC = 47;

// Интеграции (используются только для генерации демо-алертов "integration_down",
// сама вкладка Integrations теперь рендерится отдельно, см. ниже)
const INITIAL_INTEGRATIONS: Integration[] = [
  { id: "shopify", name: "Shopify", icon: "🛍️", status: "connected", lastSync: "2 min ago", lastSyncTime: new Date() },
  { id: "meta", name: "Meta Ads", icon: "📱", status: "connected", lastSync: "5 min ago", lastSyncTime: new Date() },
  { id: "google", name: "Google Ads", icon: "🔍", status: "connected", lastSync: "12 min ago", lastSyncTime: new Date() },
  { id: "quickbooks", name: "QuickBooks", icon: "📊", status: "connected", lastSync: "1 hour ago", lastSyncTime: new Date(Date.now() - 3600000) },
  { id: "klaviyo", name: "Klaviyo", icon: "✉️", status: "setup_required", lastSync: "Not connected", lastSyncTime: new Date(0) },
];

// Названия месяцев для перевода
const getMonthName = (month: string, t: any): string => {
  const months: Record<string, Record<string, string>> = {
    EN: { Jul: "Jul", Aug: "Aug", Sep: "Sep" },
    UA: { Jul: "Лип", Aug: "Сер", Sep: "Вер" },
    DE: { Jul: "Jul", Aug: "Aug", Sep: "Sep" }
  };
  const lang = t._lang || "EN";
  return months[lang]?.[month] || month;
};

// Генерация данных графиков
const generateRealisticChartData = () => {
  const data = [];
  let revenue = 78200;
  let expenses = 58700;
  
  for (let day = 1; day <= 30; day++) {
    const growthRate = 0.0035;
    let newRevenue = revenue * (1 + growthRate);
    let newExpenses = expenses * (1 + growthRate * 0.65);
    
    const revenueNoise = newRevenue * (Math.random() - 0.5) * 0.02;
    const expenseNoise = newExpenses * (Math.random() - 0.5) * 0.015;
    
    newRevenue += revenueNoise;
    newExpenses += expenseNoise;
    
    if (day % 7 === 0 || day % 7 === 6) {
      newRevenue = newRevenue * 0.92;
      newExpenses = newExpenses * 0.88;
    }
    
    if (day === 7 || day === 21) {
      newRevenue = newRevenue * 1.08;
      newExpenses = newExpenses * 1.03;
    }
    
    revenue = Math.round(newRevenue);
    expenses = Math.round(newExpenses);
    const profit = revenue - expenses;
    const margin = (profit / revenue) * 100;
    
    data.push({ day, revenue, expenses, profit, margin: Number(margin.toFixed(1)) });
  }
  return data;
};

const generateTickerData = (baseValue: number, volatility: number, trend: number = 0) => {
  const data = [];
  let value = baseValue;
  for (let i = 0; i < 12; i++) {
    const trendEffect = value * trend;
    const change = (Math.random() - 0.48) * volatility;
    value = value + trendEffect + change;
    value = Math.max(baseValue * 0.94, Math.min(baseValue * 1.06, value));
    data.push(Math.round(value * 100) / 100);
  }
  return data;
};

const CHART_DATA = generateRealisticChartData();

// ============================================================================
// ГЛОБАЛЬНОЕ (module-level) ХРАНИЛИЩЕ МЕТРИК
// ----------------------------------------------------------------------------
// Раньше метрики тикали только внутри useEffect, который был завязан на
// isOpen — то есть, пока демо закрыто, ничего не обновлялось, и при каждом
// повторном открытии (если родитель размонтирует компонент) цифры откатывались
// к базовым значениям. Теперь состояние живёт вне компонента и тикает раз в
// 10 секунд всегда, независимо от того, открыта модалка или нет — так демо
// при открытии сразу показывает "живые", а не нулевые/базовые цифры.
// ============================================================================
interface MetricsState {
  currentRevenue: number; prevRevenue: number;
  currentProfit: number; prevProfit: number;
  currentMargin: number; prevMargin: number;
  currentCac: number; prevCac: number;
  revenueQueue: number[]; profitQueue: number[]; marginQueue: number[]; cacQueue: number[];
}

let metricsState: MetricsState = {
  currentRevenue: BASE_REVENUE, prevRevenue: BASE_REVENUE,
  currentProfit: BASE_PROFIT, prevProfit: BASE_PROFIT,
  currentMargin: BASE_MARGIN, prevMargin: BASE_MARGIN,
  currentCac: BASE_CAC, prevCac: BASE_CAC,
  revenueQueue: generateTickerData(BASE_REVENUE, 400, 0.0003),
  profitQueue: generateTickerData(BASE_PROFIT, 300, 0.0002),
  marginQueue: generateTickerData(BASE_MARGIN, 0.4, 0.0001),
  cacQueue: generateTickerData(BASE_CAC, 1.2, -0.0001),
};

const metricsListeners = new Set<() => void>();
const METRICS_TICK_MS = 10000; // раз в 10 секунд, всегда, даже когда демо закрыто

function tickMetrics() {
  const revenueChange = 1 + (Math.random() - 0.48) * 0.006;
  const profitChange = 1 + (Math.random() - 0.45) * 0.008;
  const cacChange = 1 + (Math.random() - 0.52) * 0.007;

  const newRevenue = Math.max(115000, Math.min(145000, metricsState.currentRevenue * revenueChange));
  const newProfit = Math.max(31000, Math.min(42000, metricsState.currentProfit * profitChange));
  const newMargin = (newProfit / newRevenue) * 100;
  const newCac = Math.max(43, Math.min(52, metricsState.currentCac * cacChange));

  metricsState = {
    currentRevenue: newRevenue, prevRevenue: metricsState.currentRevenue,
    currentProfit: newProfit, prevProfit: metricsState.currentProfit,
    currentMargin: newMargin, prevMargin: metricsState.currentMargin,
    currentCac: newCac, prevCac: metricsState.currentCac,
    revenueQueue: [...metricsState.revenueQueue.slice(1), newRevenue],
    profitQueue: [...metricsState.profitQueue.slice(1), newProfit],
    marginQueue: [...metricsState.marginQueue.slice(1), newMargin],
    cacQueue: [...metricsState.cacQueue.slice(1), newCac],
  };
  metricsListeners.forEach((fn) => fn());
}

// Запускаем тикер один раз при загрузке модуля — он живёт независимо от
// того, монтирован ли компонент модалки.
if (typeof window !== "undefined") {
  const w = window as any;
  if (!w.__rivantMetricsTickerStarted) {
    w.__rivantMetricsTickerStarted = true;
    setInterval(tickMetrics, METRICS_TICK_MS);
  }
}

function useMetricsStore(): MetricsState {
  const [, forceRender] = useState(0);
  useEffect(() => {
    const listener = () => forceRender((v) => v + 1);
    metricsListeners.add(listener);
    return () => { metricsListeners.delete(listener); };
  }, []);
  return metricsState;
}

function AnimatedNumber({ value, prefix = "", suffix = "", changePercent = 0 }: { value: number; prefix?: string; suffix?: string; changePercent?: number }) {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValueRef = useRef(value);

  useEffect(() => {
    const duration = 500;
    const startValue = prevValueRef.current;
    const endValue = value;
    const startTime = performance.now();
    
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (endValue - startValue) * easeOut;
      setDisplayValue(current);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    prevValueRef.current = value;
  }, [value]);

  const isPositive = changePercent >= 0;
  return (
    <div>
      <div className="text-xl font-bold text-white">{prefix}{Math.round(displayValue).toLocaleString()}{suffix}</div>
      <div className={`text-xs flex items-center gap-0.5 mt-1 ${isPositive ? "text-green-400" : "text-red-400"}`}>
        {changePercent > 0 ? "+" : ""}{changePercent}% 
        {changePercent > 0 ? <ArrowUpRight className="w-3 h-3" /> : changePercent < 0 ? <ArrowDownRight className="w-3 h-3" /> : null}
      </div>
    </div>
  );
}

function TickerSparkline({ history, color, currentValue, previousValue }: { history: number[]; color: string; currentValue: number; previousValue: number }) {
  const [items, setItems] = useState(history);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevHistoryLengthRef = useRef(history.length);
  
  useEffect(() => {
    if (history.length !== prevHistoryLengthRef.current) {
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 300);
    }
    setItems(history);
    prevHistoryLengthRef.current = history.length;
  }, [history]);
  
  const maxValue = Math.max(...items);
  const minValue = Math.min(...items);
  const range = maxValue - minValue;
  const isPositive = currentValue >= previousValue;
  
  return (
    <div className="flex items-end gap-0.5 h-8 mt-2 w-full overflow-hidden">
      <div className={`flex items-end gap-0.5 w-full transition-transform duration-300 ease-out ${isAnimating ? '-translate-x-2' : 'translate-x-0'}`}>
        {items.map((value, i) => {
          let height = range === 0 ? 20 : ((value - minValue) / range) * 20 + 4;
          const isNew = i === items.length - 1;
          const isFirst = i === 0;
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-all duration-200 min-w-[6px] ${
                isNew ? (isPositive ? 'bg-green-500 shadow-lg shadow-green-500/30 scale-110' : 'bg-red-500 shadow-lg shadow-red-500/30 scale-110') : color
              } ${isFirst && isAnimating ? 'opacity-0' : 'opacity-100'}`}
              style={{ height: `${height}px`, transition: 'opacity 0.2s ease-out, height 0.3s ease-out' }}
            />
          );
        })}
      </div>
    </div>
  );
}

// Функция перевода риска
function translateRisk(risk: Risk, t: any): Risk {
  const lang = t._lang || "EN";
  const translatedRisk = { ...risk };
  switch (risk.alertType) {
    case "revenue_drop":
      translatedRisk.title = lang === "UA" ? "Падіння виручки" : lang === "DE" ? "Umsatzrückgang" : "Revenue dropping";
      translatedRisk.description = lang === "UA" ? "Виручка суттєво знизилася за останню годину" : lang === "DE" ? "Der Umsatz ist in der letzten Stunde deutlich gesunken" : "Revenue decreased significantly in the last hour";
      translatedRisk.action = lang === "UA" ? "Детальніше" : lang === "DE" ? "Details ansehen" : "View Details";
      break;
    case "revenue_rise":
      translatedRisk.title = lang === "UA" ? "Сплеск виручки" : lang === "DE" ? "Umsatzanstieg" : "Revenue spike";
      translatedRisk.description = lang === "UA" ? "Виявлено незвичне зростання виручки" : lang === "DE" ? "Ungewöhnlicher Umsatzanstieg festgestellt" : "Unusual revenue increase detected";
      translatedRisk.action = lang === "UA" ? "Детальніше" : lang === "DE" ? "Details ansehen" : "View Details";
      break;
    case "profit_drop":
      translatedRisk.title = lang === "UA" ? "Маржа прибутку падає" : lang === "DE" ? "Gewinnmarge sinkt" : "Profit margin shrinking";
      translatedRisk.description = lang === "UA" ? "Маржа прибутку опустилася нижче цільового рівня" : lang === "DE" ? "Die Gewinnmarge ist unter das Zielniveau gefallen" : "Profit margin dropped below target";
      translatedRisk.action = lang === "UA" ? "Аналізувати" : lang === "DE" ? "Analysieren" : "Analyze";
      break;
    case "profit_rise":
      translatedRisk.title = lang === "UA" ? "Стрибок прибутку" : lang === "DE" ? "Gewinnsprung" : "Profit surge";
      translatedRisk.description = lang === "UA" ? "Виявлено виняткову маржу прибутку" : lang === "DE" ? "Außergewöhnliche Gewinnmarge festgestellt" : "Exceptional profit margin detected";
      translatedRisk.action = lang === "UA" ? "Аналізувати" : lang === "DE" ? "Analysieren" : "Analyze";
      break;
    case "cac_increase":
      translatedRisk.title = lang === "UA" ? "Вартість залучення клієнта зростає" : lang === "DE" ? "Kundenakquisekosten steigen" : "Customer acquisition cost rising";
      translatedRisk.description = lang === "UA" ? "CAC зросла — перевірте ефективність реклами" : lang === "DE" ? "CAC gestiegen – Werbeleistung überprüfen" : "CAC increased - review ad performance";
      translatedRisk.action = lang === "UA" ? "Переглянути маркетинг" : lang === "DE" ? "Marketing überprüfen" : "Review Marketing";
      break;
    case "cac_decrease":
      translatedRisk.title = lang === "UA" ? "CAC знижується" : lang === "DE" ? "CAC sinkt" : "CAC decreasing";
      translatedRisk.description = lang === "UA" ? "Ефективність маркетингу покращується" : lang === "DE" ? "Die Marketingeffizienz verbessert sich" : "Marketing efficiency improving";
      translatedRisk.action = lang === "UA" ? "Переглянути маркетинг" : lang === "DE" ? "Marketing überprüfen" : "Review Marketing";
      break;
    case "integration_down":
      translatedRisk.title = lang === "UA" ? "Інтеграцію відключено" : lang === "DE" ? "Integration getrennt" : "Integration disconnected";
      translatedRisk.description = lang === "UA"
        ? `З'єднання з ${risk.integrationId || "інтеграцією"} втрачено`
        : lang === "DE"
        ? `Verbindung zu ${risk.integrationId || "Integration"} wurde unterbrochen`
        : `Connection to ${risk.integrationId || "integration"} has been lost`;
      translatedRisk.action = lang === "UA" ? "Перепідключити" : lang === "DE" ? "Erneut verbinden" : "Reconnect";
      break;
    case "low_stock":
      translatedRisk.title = lang === "UA" ? "Низький запас товару" : lang === "DE" ? "Niedriger Lagerbestand" : "Low stock alert";
      translatedRisk.description = lang === "UA" ? "У топового SKU #4521 залишилось лише 3 дні запасу" : lang === "DE" ? "Top-SKU #4521 hat nur noch 3 Tage Bestand" : "Top SKU #4521 has only 3 days of stock remaining";
      translatedRisk.action = lang === "UA" ? "Замовити зараз" : lang === "DE" ? "Jetzt nachbestellen" : "Reorder Now";
      break;
    case "shipping_delay":
      translatedRisk.title = lang === "UA" ? "Виявлено затримку доставки" : lang === "DE" ? "Lieferverzögerung festgestellt" : "Shipping delay detected";
      translatedRisk.description = lang === "UA" ? "Середній час доставки збільшився на 1.4 дні" : lang === "DE" ? "Die durchschnittliche Lieferzeit hat sich um 1,4 Tage erhöht" : "Average delivery time increased by 1.4 days";
      translatedRisk.action = lang === "UA" ? "Переглянути замовлення" : lang === "DE" ? "Bestellungen ansehen" : "View Orders";
      break;
    case "conversion_drop":
      translatedRisk.title = lang === "UA" ? "Падіння конверсії" : lang === "DE" ? "Conversion-Rückgang" : "Conversion rate dropping";
      translatedRisk.description = lang === "UA" ? "Завершення оформлення замовлення впало на 12% за останні 2 години" : lang === "DE" ? "Der Checkout-Abschluss ist in den letzten 2 Stunden um 12 % gesunken" : "Checkout completion dropped 12% in last 2 hours";
      translatedRisk.action = lang === "UA" ? "Перевірити воронку" : lang === "DE" ? "Funnel prüfen" : "Check Funnel";
      break;
    case "ad_spend":
      translatedRisk.title = lang === "UA" ? "Сплеск витрат на рекламу" : lang === "DE" ? "Anstieg der Werbeausgaben" : "Ad spend spike";
      translatedRisk.description = lang === "UA" ? "Витрати Meta Ads на 23% вищі за денний бюджет" : lang === "DE" ? "Meta-Ads-Ausgaben liegen 23 % über dem Tagesbudget" : "Meta Ads spending 23% above daily budget";
      translatedRisk.action = lang === "UA" ? "Перевірити кампанії" : lang === "DE" ? "Kampagnen prüfen" : "Check Campaigns";
      break;
  }
  return translatedRisk;
}

// ============================================================================
// РОТАЦИЯ УВЕДОМЛЕНИЙ БЕЗ ПОВТОРОВ
// ----------------------------------------------------------------------------
// 10 разных типов уведомлений (не считая integration_down, который триггерится
// отдельно реальным статусом интеграций). Вместо случайного выбора с шансом
// повтора — берём из перемешанной очереди: каждый тип гарантированно
// показывается один раз за полный цикл, прежде чем колода перемешивается
// заново (и следим, чтобы новый первый элемент не совпадал с последним
// показанным на стыке циклов).
// ============================================================================
type AlertTemplate = { alertType: NonNullable<Risk["alertType"]>; category: Risk["category"]; severity: Risk["severity"] };

const ALERT_TEMPLATES: AlertTemplate[] = [
  { alertType: "revenue_drop", category: "ads", severity: "high" },
  { alertType: "revenue_rise", category: "ads", severity: "low" },
  { alertType: "profit_drop", category: "margin", severity: "high" },
  { alertType: "profit_rise", category: "margin", severity: "low" },
  { alertType: "cac_increase", category: "cac", severity: "medium" },
  { alertType: "cac_decrease", category: "cac", severity: "low" },
  { alertType: "low_stock", category: "inventory", severity: "high" },
  { alertType: "shipping_delay", category: "shipping", severity: "medium" },
  { alertType: "conversion_drop", category: "conversion", severity: "high" },
  { alertType: "ad_spend", category: "ads", severity: "medium" },
];

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Интервал между уведомлениями — 15-20 секунд
const MIN_ALERT_INTERVAL = 15000;
const MAX_ALERT_INTERVAL = 20000;
// Сколько уведомление "висит" в виде тоста, прежде чем исчезнуть
const NOTIFICATION_VISIBLE_MS = 3000;
// Максимум уведомлений, которые храним во вкладке "Риски"
const MAX_RISKS_STORED = 10;

// ГЛАВНЫЙ ГРАФИК
function RevenueExpensesChart() {
  const { t } = useLanguage();
  const T = t as any;
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<"revenue" | "expenses" | "profit">("revenue");
  const history = CHART_DATA;
  
  const maxRevenue = Math.max(...history.map(d => d.revenue));
  const maxExpenses = Math.max(...history.map(d => d.expenses));
  const maxProfit = Math.max(...history.map(d => d.profit));
  const minProfit = Math.min(...history.map(d => d.profit));
  let maxValue = selectedMetric === "revenue" ? maxRevenue : selectedMetric === "expenses" ? maxExpenses : maxProfit;
  let minValue = selectedMetric === "profit" ? minProfit : 0;
  
  const getYSteps = () => {
    if (selectedMetric === "revenue") return [0, 50000, 100000, 150000];
    if (selectedMetric === "expenses") return [0, 40000, 80000, 120000];
    return [0, 20000, 40000, 60000];
  };
  const ySteps = getYSteps();
  const getBarColor = () => {
    if (selectedMetric === "revenue") return "bg-gradient-to-t from-blue-600 to-blue-400";
    if (selectedMetric === "expenses") return "bg-gradient-to-t from-rose-600 to-rose-400";
    return "bg-gradient-to-t from-green-600 to-emerald-400";
  };
  const getMetricValue = (item: any) => {
    if (selectedMetric === "revenue") return item.revenue;
    if (selectedMetric === "expenses") return item.expenses;
    return item.profit;
  };
  
  const totalRevenue = history.reduce((sum, d) => sum + d.revenue, 0);
  const totalExpenses = history.reduce((sum, d) => sum + d.expenses, 0);
  const totalProfit = totalRevenue - totalExpenses;
  const avgMargin = history.reduce((sum, d) => sum + d.margin, 0) / history.length;
  const expenseEfficiency = (totalExpenses / totalRevenue * 100).toFixed(1);
  const bestDay = history.reduce((best, d, i) => d.margin > history[best].margin ? i : best, 0);
  const worstDay = history.reduce((worst, d, i) => d.margin < history[worst].margin ? i : worst, 0);
  
  return (
    <div className="bg-gradient-to-br from-gray-900/80 to-black rounded-2xl p-3 sm:p-5 border border-gray-800 overflow-hidden">
      <div className="flex flex-wrap justify-between items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-400 flex-shrink-0" />
          <h3 className="text-base sm:text-lg font-bold text-white">{T.demoRevenueVsExpenses || "Revenue vs Expenses (30 days)"}</h3>
        </div>
        <div className="flex gap-1 sm:gap-2 bg-gray-800/50 rounded-lg p-1">
          <button onClick={() => setSelectedMetric("revenue")} className={`px-2.5 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${selectedMetric === "revenue" ? "bg-blue-500/30 text-blue-400" : "text-gray-500 hover:text-gray-300"}`}>{T.demoRevenue || "Revenue"}</button>
          <button onClick={() => setSelectedMetric("expenses")} className={`px-2.5 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${selectedMetric === "expenses" ? "bg-rose-500/30 text-rose-400" : "text-gray-500 hover:text-gray-300"}`}>{T.demoExpenses || "Expenses"}</button>
          <button onClick={() => setSelectedMetric("profit")} className={`px-2.5 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${selectedMetric === "profit" ? "bg-green-500/30 text-green-400" : "text-gray-500 hover:text-gray-300"}`}>{T.demoProfit || "Profit"}</button>
        </div>
      </div>
      
      <div className="relative mt-3">
        <div className="absolute left-12 right-0 top-0 bottom-0 pointer-events-none">
          {ySteps.map((step, idx) => {
            let yPercent;
            if (selectedMetric === "profit") {
              const range = maxValue - minValue;
              yPercent = range === 0 ? 50 : (1 - (step - minValue) / range) * 100;
            } else {
              yPercent = (1 - step / maxValue) * 100;
            }
            if (yPercent < 0 || yPercent > 100) return null;
            return <div key={idx} className="absolute w-full border-t border-gray-800/50" style={{ top: `${yPercent}%` }} />;
          })}
        </div>
        
        <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between text-xs font-mono">
          {ySteps.slice().reverse().map((step, idx) => (
            <div key={idx} className="text-gray-500 -translate-y-1/2">
              {selectedMetric === "profit" ? (step >= 0 ? "+" : "") : "$"}{(step / 1000).toFixed(0)}k
            </div>
          ))}
        </div>

        <div className="ml-12 h-64 flex gap-1">
          {history.map((item, idx) => {
            const value = getMetricValue(item);
            let percent;
            if (selectedMetric === "profit") {
              const range = maxValue - minValue;
              percent = range === 0 ? 50 : ((value - minValue) / range) * 100;
            } else {
              percent = (value / maxValue) * 100;
            }
            return (
              <div
                key={idx}
                className="flex-1 h-full flex flex-col justify-end items-center gap-0.5 group cursor-pointer"
                onMouseEnter={() => setHoveredBar(idx)}
                onMouseLeave={() => setHoveredBar(null)}
                onClick={() => setHoveredBar((prev) => (prev === idx ? null : idx))}
              >
                <div className="relative w-full mt-auto">
                  <div className={`w-full ${getBarColor()} rounded-t-sm transition-all duration-150`} style={{ height: `${Math.max(percent, 3)}px`, minHeight: '3px' }} />
                  {hoveredBar === idx && (
                    <div className="absolute -top-28 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 z-20 shadow-xl whitespace-nowrap">
                      <div className="text-xs font-bold text-white">{T.demoDay || "Day"} {item.day}</div>
                      <div className={`text-sm font-bold mt-1 ${getMetricValue(item) >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {selectedMetric === "revenue" && "$"}{value.toLocaleString()}
                        {selectedMetric === "profit" && (value >= 0 ? `+${value.toLocaleString()}` : value.toLocaleString())}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1">{T.demoRevenue || "Revenue"}: ${item.revenue.toLocaleString()}</div>
                      <div className="text-[10px] text-gray-400">{T.demoExpenses || "Expenses"}: ${item.expenses.toLocaleString()}</div>
                      <div className="text-[10px] text-gray-500 mt-1">{T.demoMargin || "Margin"}: {item.margin}% · {T.demoProfit || "Profit"}: ${item.profit.toLocaleString()}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-6 pt-4 border-t border-gray-800">
        <div className="bg-blue-500/5 rounded-xl p-2 sm:p-3 border border-blue-500/15 overflow-hidden">
          <div className="flex items-center gap-1 sm:gap-1.5 mb-1">
            <DollarSign className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-blue-400 flex-shrink-0" />
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider truncate">{T.demoRevenue || "Total Revenue"}</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-white truncate">${(totalRevenue / 1000).toFixed(0)}k</div>
          <div className="text-[9px] sm:text-[10px] text-gray-500 mt-1 truncate">↑ {Math.abs(((history[history.length-1].revenue - history[0].revenue) / history[0].revenue * 100)).toFixed(0)}% {T.demoVsStart || "vs start"}</div>
        </div>
        <div className="bg-rose-500/5 rounded-xl p-2 sm:p-3 border border-rose-500/15 overflow-hidden">
          <div className="flex items-center gap-1 sm:gap-1.5 mb-1">
            <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-rose-400 flex-shrink-0" />
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider truncate">{T.demoExpenses || "Total Expenses"}</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-white truncate">${(totalExpenses / 1000).toFixed(0)}k</div>
          <div className="text-[9px] sm:text-[10px] text-gray-500 mt-1 truncate">{((totalExpenses / totalRevenue) * 100).toFixed(0)}% {T.demoOfRevenue || "of revenue"}</div>
        </div>
        <div className="bg-green-500/10 rounded-xl p-2 sm:p-3 border border-green-500/20 overflow-hidden">
          <div className="flex items-center gap-1 sm:gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-400 flex-shrink-0" />
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider truncate">{T.demoProfit || "Net Profit"}</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-green-400 truncate">+${(totalProfit / 1000).toFixed(0)}k</div>
          <div className="text-[9px] sm:text-[10px] text-gray-500 mt-1 truncate">{avgMargin.toFixed(1)}% {T.demoAvgMargin || "avg margin"}</div>
        </div>
      </div>
      
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 mt-3 pt-2 text-[10px] text-gray-600 border-t border-gray-800/50">
        <span className="truncate">{T.demoExpenseRatio || "Expense ratio"}: {expenseEfficiency}%</span>
        <span className="truncate">{T.demoPeakMargin || "Peak margin"}: {history[bestDay].margin}% ({T.demoDay || "day"} {bestDay + 1})</span>
        <span className="truncate">{T.demoLowMargin || "Low margin"}: {history[worstDay].margin}% ({T.demoDay || "day"} {worstDay + 1})</span>
      </div>
    </div>
  );
}

export function LiveDemoModal({ isOpen, onClose }: LiveDemoModalProps) {
  const { t, language } = useLanguage();
  const T = t as any;
  // Добавляем язык в T для использования в переводах месяцев
  T._lang = language;
  
  const [activeView, setActiveView] = useState<ViewType>("overview");
  const [risks, setRisks] = useState<Risk[]>([]);
  const [alertCount, setAlertCount] = useState(0);
  const [showTelegramPopup, setShowTelegramPopup] = useState(false);
  const [lastNotification, setLastNotification] = useState<Risk | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const notificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Очередь уведомлений без повторов + защита от повтора на стыке циклов
  const alertQueueRef = useRef<AlertTemplate[]>([]);
  const lastTemplateTypeRef = useRef<Risk["alertType"] | null>(null);
  const lastAlertIntegrationRef = useRef<string | null>(null);
  const hasInitializedRisksRef = useRef(false);
  
  const [integrations, setIntegrations] = useState<Integration[]>(INITIAL_INTEGRATIONS);
  const integrationsRef = useRef(integrations);
  useEffect(() => { integrationsRef.current = integrations; }, [integrations]);

  // Состояние карточки подключения Stripe на вкладке "Інтеграції"
  const [stripeKeyInput, setStripeKeyInput] = useState("");
  const [stripeConnected, setStripeConnected] = useState(false);

  const handleConnectStripe = () => {
    if (!stripeKeyInput.trim()) return;
    setStripeConnected(true);
  };

  // Метрики теперь берутся из глобального (module-level) стора, который
  // тикает раз в 10 секунд всегда — не только пока демо открыто.
  const metrics = useMetricsStore();
  
  const translateAllRisks = useCallback(() => {
    setRisks(prevRisks => prevRisks.map(risk => translateRisk(risk, T)));
    if (lastNotification) setLastNotification(translateRisk(lastNotification, T));
  }, [T, lastNotification]);
  
  useEffect(() => {
    if (isOpen) translateAllRisks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, isOpen]);

  // Достаём следующий тип уведомления из перемешанной очереди, гарантируя,
  // что все 10 типов будут показаны прежде, чем какой-либо повторится.
  const drawNextTemplate = useCallback((): AlertTemplate => {
    if (alertQueueRef.current.length === 0) {
      let shuffled = shuffleArray(ALERT_TEMPLATES);
      if (
        lastTemplateTypeRef.current &&
        shuffled.length > 1 &&
        shuffled[0].alertType === lastTemplateTypeRef.current
      ) {
        [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
      }
      alertQueueRef.current = shuffled;
    }
    const next = alertQueueRef.current.shift()!;
    lastTemplateTypeRef.current = next.alertType;
    return next;
  }, []);

  const showAlert = useCallback((risk: Risk) => {
    const translated = translateRisk(risk, T);
    setRisks(prev => [translated, ...prev].slice(0, MAX_RISKS_STORED));
    setAlertCount(prev => prev + 1);
    setLastNotification(translated);
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);
    notificationTimeoutRef.current = setTimeout(() => setLastNotification(null), NOTIFICATION_VISIBLE_MS);
  }, [T]);

  // Генерирует и показывает одно новое уведомление: интеграционные сбои в
  // приоритете (это реальное состояние интеграций), иначе — следующий тип
  // из очереди без повторов.
  const generateAndShowAlert = useCallback(() => {
    const now = Date.now();
    const timeStr = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const downIntegration = integrationsRef.current.find(i => i.status === "error");
    let risk: Risk;

    if (downIntegration && lastAlertIntegrationRef.current !== downIntegration.id) {
      lastAlertIntegrationRef.current = downIntegration.id;
      risk = {
        id: now,
        title: "", description: "", time: timeStr,
        severity: "high", action: "", category: "integration",
        integrationId: downIntegration.name,
        alertType: "integration_down",
      };
    } else {
      const template = drawNextTemplate();
      risk = {
        id: now,
        title: "", description: "", time: timeStr,
        severity: template.severity, action: "", category: template.category,
        alertType: template.alertType,
      };
    }

    showAlert(risk);
  }, [drawNextTemplate, showAlert]);
  
  // При первом открытии демо — сразу кладём пару уведомлений во вкладку
      // "Риски" (не как всплывающий тост, а как будто они уже были получены ранее).
      useEffect(() => {
        if (isOpen && !hasInitializedRisksRef.current) {
          hasInitializedRisksRef.current = true;
          const now = Date.now();
          const rawPreloaded: Risk[] = [
            {
              id: now - 27 * 60000,
              title: "", description: "",
              time: new Date(now - 27 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              severity: "medium", action: "", category: "shipping", alertType: "shipping_delay",
            },
            {
              id: now - 52 * 60000,
              title: "", description: "",
              time: new Date(now - 52 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              severity: "high", action: "", category: "inventory", alertType: "low_stock",
            },
          ];
          const preloaded = rawPreloaded.map(r => translateRisk(r, T));
          setRisks(preloaded);
          setAlertCount(preloaded.length);
          lastTemplateTypeRef.current = "low_stock"; // чтобы эти же типы не выпали первыми в живой ротации
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [isOpen]);

  // Планировщик "живых" уведомлений — раз в случайные 15-20 секунд, пока
  // демо открыто.
  useEffect(() => {
    if (!isOpen) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleNext = () => {
      const delay = MIN_ALERT_INTERVAL + Math.random() * (MAX_ALERT_INTERVAL - MIN_ALERT_INTERVAL);
      timeoutId = setTimeout(() => {
        generateAndShowAlert();
        scheduleNext();
      }, delay);
    };
    scheduleNext();
    return () => clearTimeout(timeoutId);
  }, [isOpen, generateAndShowAlert]);
  
  useEffect(() => {
    if (!isOpen) return;
    
    const integrationsInterval = setInterval(() => {
      setIntegrations(prev => {
        const newIntegrations = [...prev];
        const randomIndex = Math.floor(Math.random() * (newIntegrations.length - 1));
        
        if (newIntegrations[randomIndex].id !== "klaviyo") {
          if (Math.random() > 0.85) {
            if (newIntegrations[randomIndex].status === "connected") {
              newIntegrations[randomIndex].status = "error";
              newIntegrations[randomIndex].errorMessage = "Connection timeout";
              newIntegrations[randomIndex].lastSync = "Connection lost";
            } else if (newIntegrations[randomIndex].status === "error") {
              newIntegrations[randomIndex].status = "connected";
              newIntegrations[randomIndex].lastSync = "Just now";
              newIntegrations[randomIndex].lastSyncTime = new Date();
              newIntegrations[randomIndex].errorMessage = undefined;
            }
          }
        }
        return newIntegrations;
      });
    }, 45000);
    
    return () => {
      clearInterval(integrationsInterval);
    };
  }, [isOpen]);
  
  const removeRisk = (id: number) => {
    setRisks(prev => prev.filter(r => r.id !== id));
    setAlertCount(prev => prev - 1);
  };
  
  const clearAllRisks = () => {
    setRisks([]);
    setAlertCount(0);
  };
  
  const reconnectIntegration = (integrationId: string) => {
    setIntegrations(prev => prev.map(integ => 
      integ.id === integrationId 
        ? { ...integ, status: "connected", lastSync: "Just now", lastSyncTime: new Date(), errorMessage: undefined }
        : integ
    ));
    if (lastAlertIntegrationRef.current === integrationId) lastAlertIntegrationRef.current = null;
    setRisks(prev => prev.filter(r => r.integrationId !== integrationId));
  };
  
 useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose();
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);
  
  if (!isOpen) return null;
  
  const { currentRevenue, prevRevenue, currentProfit, prevProfit, currentMargin, prevMargin, currentCac, prevCac, revenueQueue, profitQueue, marginQueue, cacQueue } = metrics;
  const revenueChange = ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1);
  const profitChange = ((currentProfit - prevProfit) / prevProfit * 100).toFixed(1);
  const marginChange = (currentMargin - prevMargin).toFixed(1);
  const cacChange = ((currentCac - prevCac) / prevCac * 100).toFixed(1);
  
  const sidebarItems = [
    { icon: LayoutDashboard, label: T.demoOverview || "Dashboard Overview", shortLabel: T.overview || "Overview", view: "overview" as ViewType },
    { icon: AlertTriangle, label: T.demoRiskDetection || "Risk Detection", shortLabel: T.risks || "Risks", view: "risks" as ViewType },
    { icon: TrendingUp, label: T.demoCashflowForecast || "Cashflow Forecast", shortLabel: T.forecast || "Forecast", view: "forecast" as ViewType },
    { icon: Link2, label: T.demoIntegrations || "Integrations", shortLabel: T.integrations || "Integrations", view: "integrations" as ViewType },
  ];
  
  const getCategoryIcon = (category: string) => {
    switch(category) {
      case "ads": return <Zap className="w-4 h-4" />;
      case "inventory": return <Package className="w-4 h-4" />;
      case "finance": return <CreditCard className="w-4 h-4" />;
      case "shipping": return <Truck className="w-4 h-4" />;
      case "conversion": return <Users className="w-4 h-4" />;
      case "cac": return <Activity className="w-4 h-4" />;
      case "margin": return <TrendingUp className="w-4 h-4" />;
      case "integration": return <WifiOff className="w-4 h-4" />;
      default: return <AlertCircle className="w-4 h-4" />;
    }
  };
  
  const getStatusBadge = (status: Integration["status"]) => {
    switch(status) {
      case "connected": return <span className="text-sm px-3 py-1.5 rounded-full font-semibold bg-green-500/20 text-green-400 flex items-center gap-1"><Wifi className="w-3 h-3" /> {T.demoConnected || "Connected"}</span>;
      case "error": return <span className="text-sm px-3 py-1.5 rounded-full font-semibold bg-red-500/20 text-red-400 flex items-center gap-1"><WifiOff className="w-3 h-3" /> {T.demoConnectionError || "Connection Error"}</span>;
      case "setup_required": return <span className="text-sm px-3 py-1.5 rounded-full font-semibold bg-yellow-500/20 text-yellow-400">{T.demoSetupRequired || "Setup Required"}</span>;
    }
  };
  
  // Названия месяцев на текущем языке
  const monthNames: Record<string, string[]> = {
    EN: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    UA: ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"],
    DE: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]
  };
  const months = monthNames[language as keyof typeof monthNames] || monthNames.EN;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" style={{ backgroundColor: "rgba(0,0,0,0.95)", backdropFilter: "blur(8px)" }}>
      <div ref={modalRef} className="relative w-full max-w-[95vw] sm:max-w-[90vw] h-[95vh] bg-gradient-to-br from-gray-950 to-black border border-gray-800 rounded-2xl overflow-hidden flex flex-col shadow-2xl">
        {/* FIX: w-8 h-8 -> w-10 h-10, это главный крестик закрытия демо */}
        <button onClick={onClose} className="absolute top-3 right-3 z-50 w-10 h-10 rounded-lg bg-gray-800/50 flex items-center justify-center text-gray-400 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
        
        <div className="flex h-full overflow-hidden flex-col md:flex-row">
          
          {/* Sidebar */}
          <div className="hidden md:flex md:w-64 bg-black/60 border-r border-gray-800 p-4 flex-col">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <img src="/icon3.jpg" alt="RIVANT" className="w-8 h-8 object-contain" />
                <span className="font-semibold text-white text-lg">RIVANT</span>
              </div>
             
            </div>
            <nav className="space-y-1 flex-1">
              {sidebarItems.map((item) => (
                <button key={item.label} onClick={() => setActiveView(item.view)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${activeView === item.view ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "text-gray-500 hover:bg-gray-800/50 hover:text-gray-300"}`}>
                  <item.icon className="w-4 h-4 shrink-0" /> 
                  <span className="flex-1 text-left font-medium">{item.label}</span>
                </button>
              ))}
            </nav>
            <button onClick={() => setShowTelegramPopup(true)} className="mt-8 pt-4 border-t border-gray-800 w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-800/50 text-left">
              <Bell className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-left font-medium">{T.demoTelegramAlerts || "Telegram Alerts"}</span>
              <span className="ml-auto w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-xs flex items-center justify-center shrink-0 font-bold">{alertCount}</span>
            </button>
          </div>
          
          {/* Main Content */}
          <div className="flex-1 p-4 sm:p-6 pb-24 md:pb-6 overflow-auto">
            
            {/* Mobile navigation */}
            <div className="flex md:hidden items-center justify-between mb-5 pr-11">
              <h2 className="text-lg font-bold text-white truncate">
                {sidebarItems.find(i => i.view === activeView)?.shortLabel}
              </h2>
              <button onClick={() => setShowTelegramPopup(true)} className="ml-2 p-2 bg-gray-800/30 rounded-lg relative flex-shrink-0">
                <Bell className="w-5 h-5 text-gray-500" />
                {alertCount > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-500 text-xs flex items-center justify-center text-white font-bold">{alertCount}</span>}
              </button>
            </div>
            
            {/* Overview View */}
            {activeView === "overview" && (
              <div className="space-y-5">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-bold text-white">{T.demoOverview || "Dashboard Overview"}</h2>
                    <p className="text-sm text-gray-500 mt-1">{T.demoRealTimeMetrics || "Real-time business metrics"}</p>
                  </div>
                  <div className="flex items-center gap-2 bg-green-500/10 px-3 py-1.5 rounded-full">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm text-green-400 font-medium">{T.demoLive || "LIVE"}</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-gradient-to-br from-blue-500/10 to-transparent rounded-xl p-4 border border-blue-500/20">
                    <div className="text-xs text-blue-400 font-semibold mb-1 uppercase">{T.demoRevenue || "Revenue"}</div>
                    <AnimatedNumber value={currentRevenue} prefix="$" changePercent={parseFloat(revenueChange)} />
                    <TickerSparkline history={revenueQueue} color="bg-blue-500/60" currentValue={currentRevenue} previousValue={prevRevenue} />
                  </div>
                  <div className="bg-gradient-to-br from-green-500/10 to-transparent rounded-xl p-4 border border-green-500/20">
                    <div className="text-xs text-green-400 font-semibold mb-1 uppercase">{T.demoProfit || "Profit"}</div>
                    <AnimatedNumber value={currentProfit} prefix="$" changePercent={parseFloat(profitChange)} />
                    <TickerSparkline history={profitQueue} color="bg-green-500/60" currentValue={currentProfit} previousValue={prevProfit} />
                  </div>
                  <div className="bg-gradient-to-br from-purple-500/10 to-transparent rounded-xl p-4 border border-purple-500/20">
                    <div className="text-xs text-purple-400 font-semibold mb-1 uppercase">{T.demoMargin || "Margin"}</div>
                    <AnimatedNumber value={currentMargin} suffix="%" changePercent={parseFloat(marginChange)} />
                    <TickerSparkline history={marginQueue} color="bg-purple-500/60" currentValue={currentMargin} previousValue={prevMargin} />
                  </div>
                  <div className="bg-gradient-to-br from-orange-500/10 to-transparent rounded-xl p-4 border border-orange-500/20">
                    <div className="text-xs text-orange-400 font-semibold mb-1 uppercase">{T.demoCac || "CAC"}</div>
                    <AnimatedNumber value={currentCac} prefix="$" changePercent={parseFloat(cacChange)} />
                    <TickerSparkline history={cacQueue} color="bg-orange-500/60" currentValue={currentCac} previousValue={prevCac} />
                  </div>
                </div>
                
                <RevenueExpensesChart />
              </div>
            )}
            
            {/* Risks View */}
            {activeView === "risks" && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-bold text-white">{T.demoRiskDetection || "Risk Detection"}</h2>
                    <p className="text-sm text-gray-500 mt-1">{T.demoAiRisks || "AI-identified operational risks"}</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-sm text-blue-400 bg-blue-500/20 px-4 py-1.5 rounded-full font-semibold">{risks.length} {T.demoActiveRisks || "Active Risks"}</span>
                    {risks.length > 0 && <button onClick={clearAllRisks} className="text-gray-500 hover:text-white/80 px-2"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </div>
                <div className="space-y-3">
                  {risks.map((risk) => (
                    <div key={risk.id} className={`bg-gray-900/50 rounded-xl p-4 border transition-all ${lastNotification?.id === risk.id ? "border-blue-500/50 bg-blue-500/10" : "border-gray-800"}`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${risk.severity === "high" ? "bg-red-500/20" : risk.severity === "medium" ? "bg-yellow-500/20" : "bg-blue-500/20"}`}>
                          {getCategoryIcon(risk.category)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${risk.severity === "high" ? "bg-red-500/20 text-red-400" : risk.severity === "medium" ? "bg-yellow-500/20 text-yellow-400" : "bg-blue-500/20 text-blue-400"}`}>{risk.severity.toUpperCase()}</span>
                              <span className="text-xs text-gray-500">{risk.time}</span>
                            </div>
                            {/* FIX: увеличенная тап-зона крестика удаления риска (p-2 -m-2) */}
                            <button onClick={() => removeRisk(risk.id)} className="text-gray-500 hover:text-white/60 p-2 -m-2"><X className="w-3.5 h-3.5" /></button>
                          </div>
                          <h4 className="font-semibold text-white text-base mt-1">{risk.title}</h4>
                          <p className="text-sm text-gray-400 mt-0.5">{risk.description}</p>
                          <Button size="sm" variant="outline" className="mt-3 h-8 text-sm border-gray-700 text-gray-400 hover:bg-gray-800">{risk.action}</Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {risks.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="text-base">{T.demoNoActiveRisks || "No active risks. All systems normal."}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Forecast View */}
            {activeView === "forecast" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-2xl font-bold text-white">{T.demoCashflowForecast || "Cashflow Forecast"}</h2>
                  <p className="text-sm text-gray-500 mt-1">{T.demoAiPredictions || "AI-powered 90-day predictions"}</p>
                </div>

                {/* 1. Метрики */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-blue-500/10 to-transparent rounded-xl p-5 border border-blue-500/20">
                    <div className="text-sm text-blue-400 font-semibold mb-1">{T.demoProjectedRevenue || "Projected Revenue"}</div>
                    <div className="text-3xl font-bold text-white">$892,400</div>
                    <div className="text-sm text-green-400 mt-2">+18% {T.demoVsLastQuarter || "vs last quarter"}</div>
                    <div className="text-xs text-gray-500 mt-3">{T.demoConfidence || "Confidence"}: 94%</div>
                  </div>
                  <div className="bg-gradient-to-br from-orange-500/10 to-transparent rounded-xl p-5 border border-orange-500/20">
                    <div className="text-sm text-orange-400 font-semibold mb-1">{T.demoProjectedExpenses || "Projected Expenses"}</div>
                    <div className="text-3xl font-bold text-white">$654,200</div>
                    <div className="text-sm text-yellow-400 mt-2">+8% {T.demoVsLastQuarter || "vs last quarter"}</div>
                    <div className="text-xs text-gray-500 mt-3">{T.demoConfidence || "Confidence"}: 91%</div>
                  </div>
                </div>

                {/* 2. График */}
                <div className="bg-gray-900/30 rounded-xl p-3 sm:p-5 border border-gray-800 overflow-hidden">
                  <h3 className="font-semibold text-white text-base mb-4">{T.demoMonthlyForecast || "Monthly Forecast"}</h3>
                  <div className="flex justify-around items-end h-40 gap-1 sm:gap-4">
                    {[
                      { monthIdx: 6, revenue: 280, expenses: 210, revenueActual: 268 },
                      { monthIdx: 7, revenue: 298, expenses: 215, revenueActual: 291 },
                      { monthIdx: 8, revenue: 312, expenses: 222, revenueActual: null }
                    ].map((m, i) => (
                      <div key={i} className="flex flex-col items-center gap-2 flex-1 min-w-0">
                        <div className="relative w-full flex justify-center gap-1 sm:gap-2 items-end">
                          {m.revenueActual && (
                            <div className="relative group">
                              <div className="w-4 sm:w-8 bg-blue-500/30 rounded-t" style={{ height: `${m.revenueActual / 3.2}px` }} />
                              <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition bg-gray-800 text-white text-[10px] px-1 rounded whitespace-nowrap hidden sm:block">{T.demoActual || "Actual"}: ${m.revenueActual}k</div>
                            </div>
                          )}
                          <div className="relative group">
                            <div className="w-4 sm:w-8 bg-blue-500 rounded-t" style={{ height: `${m.revenue / 3.2}px` }} />
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition bg-gray-800 text-white text-[10px] px-1 rounded whitespace-nowrap hidden sm:block">{T.demoForecast || "Forecast"}: ${m.revenue}k</div>
                          </div>
                          <div className="relative group">
                            <div className="w-4 sm:w-8 bg-rose-500/60 rounded-t" style={{ height: `${m.expenses / 3.2}px` }} />
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition bg-gray-800 text-white text-[10px] px-1 rounded whitespace-nowrap hidden sm:block">{T.demoExpenses || "Expenses"}: ${m.expenses}k</div>
                          </div>
                        </div>
                        <span className="text-xs sm:text-sm text-gray-400 font-medium truncate max-w-full">{months[m.monthIdx]}</span>
                        <div className="flex gap-1.5 sm:gap-3 text-[9px] sm:text-[10px] text-gray-600">
                          <span className="text-blue-400">↑${m.revenue}k</span>
                          <span className="text-rose-400">↓${m.expenses}k</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-center gap-6 mt-4 pt-3 text-[10px] text-gray-600 border-t border-gray-800">
                    <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 rounded-sm" /><span>{T.demoRevenueForecast || "Revenue Forecast"}</span></div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500/30 rounded-sm" /><span>{T.demoActualRevenue || "Actual Revenue"}</span></div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 bg-rose-500/60 rounded-sm" /><span>{T.demoExpensesForecast || "Expenses Forecast"}</span></div>
                  </div>
                </div>

                {/* 3. AI текст */}
                <div className="bg-blue-500/5 rounded-xl p-4 border border-blue-500/20">
                  <p className="text-sm text-gray-400">{T.demoForecastBasedOn || "Based on historical data and market trends, our AI model predicts:"}</p>
                  <ul className="mt-2 space-y-1 text-sm text-gray-300">
                    <li>• {T.demoForecastRevenueGrowth || "18% revenue growth projected over next 90 days"}</li>
                    <li>• {T.demoForecastMarginImprovement || "Operating margin expected to improve by 2.3%"}</li>
                    <li>• {T.demoForecastSeasonalPeak || "Seasonal peak predicted in September (+12% vs August)"}</li>
                    <li>• {T.demoForecastAdSpend || "Recommended ad spend increase of 8% for Q3"}</li>
                  </ul>
                </div>
              </div>
            )}
            
            {/* Integrations View — приведено к виду реального ЛК (карточка Stripe + "coming soon") */}
            {activeView === "integrations" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-2xl font-bold text-white">{T.demoIntegrations || "Integrations"}</h2>
                  <p className="text-sm text-gray-500 mt-1">{T.demoConnectedSources || "Connected data sources"}</p>
                </div>

                <div className="space-y-4">
                  {/* Карточка подключения Stripe */}
                  <div className="bg-gray-900/40 rounded-xl p-5 border border-gray-800">
                    <h4 className="font-semibold text-white text-base">Stripe</h4>
                   <p className="text-sm text-gray-500 mt-1">
                      {language === "UA"
                        ? "Підключіть свій обліковий запис Stripe, щоб отримувати реальні дані про виручку"
                        : language === "DE"
                        ? "Verbinden Sie Ihr Stripe-Konto, um echte Umsatzdaten abzurufen"
                        : "Connect your Stripe account to pull real revenue data"}
                    </p>

                    <input
                      type="text"
                      value={stripeKeyInput}
                      onChange={(e) => setStripeKeyInput(e.target.value)}
                      placeholder="rk_live_... (restricted, read-only key)"
                      className="w-full mt-4 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-300 placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
                    />

                    <p className="text-xs text-gray-500 mt-2">
                      {language === "UA"
                        ? "Створіть обмежений ключ з доступом лише для читання в Stripe Dashboard → Developers → API keys → Create restricted key."
                        : language === "DE"
                        ? "Erstellen Sie einen eingeschränkten Schlüssel mit Lesezugriff in Stripe Dashboard → Developers → API keys → Create restricted key."
                        : "Create a restricted key with read-only access in Stripe Dashboard → Developers → API keys → Create restricted key."}
                    </p>

                    <Button
                      onClick={handleConnectStripe}
                      disabled={stripeConnected}
                      className={`mt-4 font-semibold px-5 ${stripeConnected ? "bg-green-500/20 text-green-400 hover:bg-green-500/20" : "bg-blue-500 hover:bg-blue-600 text-white"}`}
                    >
                      {stripeConnected ? (
                        <span className="flex items-center gap-1.5">
                          <Wifi className="w-4 h-4" />
                          {language === "UA" ? "Підключено" : language === "DE" ? "Verbunden" : "Connected"}
                        </span>
                      ) : (
                        `${language === "UA" ? "Підключити Stripe" : language === "DE" ? "Stripe verbinden" : "Connect Stripe"} →`
                      )}
                    </Button>
                  </div>

                  {/* Прочие интеграции — скоро */}
                  <div className="bg-gray-900/20 rounded-xl p-4 border border-gray-800 flex items-center gap-3 opacity-50">
                    <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
                      <Link className="w-5 h-5 text-gray-500" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-400 text-sm">Shopify, QuickBooks, Meta Ads</h4>
                      <p className="text-xs text-gray-600">
                        {language === "UA" ? "Скоро" : language === "DE" ? "Demnächst" : "Coming soon"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
          {/* Notification Toast */}
            {lastNotification && activeView !== "risks" && (
              <div
                key={lastNotification.id}
                className={`absolute bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:w-[380px] bg-gray-900/95 backdrop-blur-md rounded-2xl shadow-2xl border p-5 animate-in slide-in-from-bottom-3 fade-in duration-300 z-50 ${
                  lastNotification.severity === "high"
                    ? "border-red-500/30"
                    : lastNotification.severity === "medium"
                    ? "border-yellow-500/30"
                    : "border-blue-500/30"
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      lastNotification.severity === "high"
                        ? "bg-red-500/20 text-red-400"
                        : lastNotification.severity === "medium"
                        ? "bg-yellow-500/20 text-yellow-400"
                        : "bg-blue-500/20 text-blue-400"
                    }`}
                  >
                    {getCategoryIcon(lastNotification.category)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white leading-snug">
                      {lastNotification.title}
                    </p>
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                      {lastNotification.description}
                    </p>
                    <button
                      onClick={() => setActiveView("risks")}
                      className="mt-2.5 text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                    >
                      {T.demoViewInRisks || "View in Risks →"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {/* Telegram Popup */}
            {showTelegramPopup && (
              <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
                <div className="bg-gray-900 rounded-xl p-6 w-full max-w-md border border-gray-800">
                  <div className="flex justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">{T.demoTelegramAlerts || "Telegram Alerts"}</h3>
                    <button onClick={() => setShowTelegramPopup(false)} className="p-2 -m-2"><X className="w-5 h-5 text-gray-500" /></button>
                  </div>
                  <div className="bg-gray-800/50 rounded-xl p-4 mb-4">
                    <div className="flex items-center gap-3 mb-3">
                      <img src="/icon3.jpg" alt="RIVANT" className="w-10 h-10 object-contain" />
                      <div><div className="text-base font-semibold text-white">RIVANT Bot</div></div>
                    </div>
                    <div className="text-sm text-white space-y-1">
                      <p><span className="text-blue-400">{T.demoAlert || "Alert"}:</span> {risks[0]?.title || (T.demoNoActiveAlerts || "No active alerts")}</p>
                      <p className="text-xs text-gray-400">{risks[0]?.description || ""}</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">{T.demoConnectTelegram || "Get real-time alerts in Telegram when anomalies are detected."}</p>
                  <Button className="w-full bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 font-semibold py-2">{T.demoConnectTelegram || "Connect Telegram →"}</Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile bottom tab navigation */}
        <nav className="md:hidden absolute bottom-0 left-0 right-0 z-40 bg-gray-950/95 backdrop-blur-xl border-t border-gray-800 px-2 py-2">
          <div className="flex items-center justify-around">
            {sidebarItems.map((item) => (
              <button
                key={item.label}
                onClick={() => setActiveView(item.view)}
                className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-colors min-w-0 flex-1 ${
                  activeView === item.view ? "text-blue-400" : "text-gray-500"
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="truncate w-full text-center">{item.shortLabel}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}