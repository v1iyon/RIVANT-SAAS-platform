// app/dashboard/page.tsx
"use client";

import { StripeConnectCard } from "@/components/dashboard/stripe-connect-card";
import { IntegrationConnectCard } from "@/components/dashboard/integration-connect-card";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLanguage, Language } from "@/lib/translations";
import { TrialPromptModal } from "@/components/dashboard/trial-prompt-modal";
import {
  LayoutDashboard,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Link2,
  Settings,
  DollarSign,
  Users,
  LineChart,
  Bell,
  LogOut,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  Trash2,
  Globe,
  BarChart3,
  Calendar,
  Package,
  CreditCard,
  Activity,
  Wifi,
  WifiOff,
  CheckCircle,
  Shield,
  User,
  Building,
  BellRing,
  Zap,
  Truck,
  Download,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase-browser";

type ViewType = "overview" | "risks" | "forecast" | "integrations" | "settings";

// Реальні назви місяців, що йдуть від поточної дати (не хардкод) — використовується
// у вкладці "Прогноз" для тарифу Scale/Trial (90 днів = 3 місяці наперед). Якщо зараз
// серпень — покаже "Сер, Вер, Жов"; наступного місяця саме собою стане "Вер, Жов, Лис".
const MONTH_NAMES_BY_LANG: Record<string, string[]> = {
  EN: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  UA: ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"],
  DE: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
};

function getUpcomingMonthLabels(count: number, language: string): string[] {
  const names = MONTH_NAMES_BY_LANG[language] || MONTH_NAMES_BY_LANG.EN;
  const now = new Date();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    labels.push(names[d.getMonth()]);
  }
  return labels;
}

interface Risk {
  id: string | number;
  title: string;
  description: string;
  time: string;
  severity: "critical" | "high" | "medium" | "low";
  action: string;
  category: "ads" | "inventory" | "finance" | "shipping" | "conversion" | "cac" | "margin" | "integration";
  alertType?: string;
  integrationId?: string;
}

// alerts_log.type -> UI category. Раніше рахував тільки "revenue_drop" (Stripe) —
// тепер sync-скрипти Shopify/Meta Ads/Google Ads теж шлють алерти (sync-failure,
// сплеск/падіння рекламних витрат, CAC, собівартість/доставка).
function alertTypeToCategory(type: string): Risk["category"] {
  if (type === "revenue_drop") return "finance";
  if (type === "cac_spike") return "cac";
  if (type === "cogs_spike_shopify") return "margin";
  if (type === "shipping_spike_shopify") return "shipping";
  if (type.startsWith("ad_spend_")) return "ads";
  if (type.startsWith("sync_failure_")) return "integration";
  return "integration";
}

function formatAlertTime(sentAt: string): string {
  try {
    return new Date(sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return sentAt;
  }
}

// Реальная строка метрик из /api/metrics (metrics_computed в Supabase).
// Раньше здесь были BASE_REVENUE/BASE_PROFIT/BASE_MARGIN/BASE_CAC —
// захардкоженные demo-числа. Теперь всё считается из реальных данных,
// а до первого синка показываем честный empty-state вместо фейковых цифр.
interface MetricsRow {
  date: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin_pct: number;
  orders: number;
  cac: number | null;
  cacMeta: number | null;
  cacGoogle: number | null;
}


// Преобразует реальные строки metrics_computed (пришедшие из /api/metrics)
// в форму {day, revenue, expenses, profit, margin}, которую ожидает
// RevenueExpensesChart. day — порядковый номер в выборке (не календарный день),
// нужен только для подписи в hover-тултипе.
const toChartHistory = (rows: MetricsRow[]) =>
  rows.map((r, i) => ({
    day: i + 1,
    date: r.date,
    revenue: r.revenue,
    expenses: r.expenses,
    profit: r.profit,
    margin: r.margin_pct,
  }));

// Берёт значения last/prev metric для карточек сверху и спарклайн
// из хвоста реальной истории (без выдуманных случайных чисел).
const buildSparkline = (rows: MetricsRow[], pick: (r: MetricsRow) => number) => {
  const tail = rows.slice(-14);
  return tail.map(pick);
};

// Полный список часовых поясов IANA — то же самое, что использует ОС.
// Fallback на случай очень старых браузеров без поддержки Intl.supportedValuesOf.
const FALLBACK_TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Europe/Kyiv", "Europe/Moscow",
  "Africa/Cairo", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo",
  "Asia/Shanghai", "Australia/Sydney", "Pacific/Auckland",
];

function getAllTimezones(): string[] {
  try {
    // @ts-ignore
    if (typeof Intl.supportedValuesOf === "function") {
      // @ts-ignore
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {}
  return FALLBACK_TIMEZONES;
}

function getTimezoneOffset(tz: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
    const parts = formatter.formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || "";
  } catch {
    return "";
  }
}

function formatTimezoneLabel(tz: string): string {
  const offset = getTimezoneOffset(tz);
  const cityName = tz.split("/").pop()?.replace(/_/g, " ") || tz;
  return offset ? `${cityName} (${offset})` : tz;
}

// Группируем по континенту (часть до первого "/" в IANA-имени),
// чтобы <optgroup> в select показывал понятные разделы вместо
// одного длинного списка на 400+ строк.
function groupTimezonesByRegion(zones: string[]): Record<string, string[]> {
  const regionNames: Record<string, string> = {
    Africa: "Africa",
    America: "America",
    Antarctica: "Antarctica",
    Asia: "Asia",
    Atlantic: "Atlantic",
    Australia: "Australia",
    Europe: "Europe",
    Indian: "Indian Ocean",
    Pacific: "Pacific",
    UTC: "UTC",
  };
  const groups: Record<string, string[]> = {};
  for (const tz of zones) {
    const region = tz.split("/")[0];
    const label = regionNames[region] || "Other";
    if (!groups[label]) groups[label] = [];
    groups[label].push(tz);
  }
  // сортируем регионы в логичном порядке, остальное — по алфавиту
  const order = ["UTC", "Europe", "Asia", "Africa", "America", "Australia", "Pacific", "Atlantic", "Indian Ocean", "Antarctica", "Other"];
  const sorted: Record<string, string[]> = {};
  for (const key of order) {
    if (groups[key]) sorted[key] = groups[key].sort();
  }
  return sorted;
}

const sidebarItems = [
  { icon: LayoutDashboard, label: "overview", view: "overview" as ViewType, translationKey: "overview" },
  { icon: AlertTriangle, label: "risks", view: "risks" as ViewType, translationKey: "risks" },
  { icon: TrendingUp, label: "forecast", view: "forecast" as ViewType, translationKey: "forecast" },
  { icon: Link2, label: "integrations", view: "integrations" as ViewType, translationKey: "integrations" },
  { icon: Settings, label: "settings", view: "settings" as ViewType, translationKey: "settings" },
];

// ========== КОМПОНЕНТ АНИМИРОВАННОГО ЧИСЛА ==========
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
      <div className="text-2xl font-bold text-white">{prefix}{Math.round(displayValue).toLocaleString()}{suffix}</div>
      <div className={`text-xs flex items-center gap-0.5 mt-1 ${isPositive ? "text-green-400" : "text-red-400"}`}>
        {changePercent > 0 ? "+" : ""}{changePercent}%
        {changePercent > 0 ? <ArrowUpRight className="w-3 h-3" /> : changePercent < 0 ? <ArrowDownRight className="w-3 h-3" /> : null}
      </div>
    </div>
  );
}

// ========== КОМПОНЕНТ ТИКЕР-СПАРКЛАЙНА ==========
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
              className={`flex-1 rounded-sm transition-all duration-200 min-w-[4px] ${
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

// ========== КОМПОНЕНТ ГЛАВНОГО ГРАФИКА ==========
function RevenueExpensesChart({ history }: {
  history: { day: number; date: string; revenue: number; expenses: number; profit: number; margin: number }[];
}) {
  const { t, language } = useLanguage();
  const T = t as any;
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<"revenue" | "expenses" | "profit">("revenue");

  const isEmpty = !history || history.length === 0;
  // Пока нет реальных данных — рисуем тот же скелет графика с нулями,
  // а не блокирующее текстовое сообщение (было "No revenue history yet").
  const chartData = isEmpty
    ? Array.from({ length: 30 }, (_, i) => ({ day: i + 1, date: "", revenue: 0, expenses: 0, profit: 0, margin: 0 }))
    : history;
  const maxRevenue = Math.max(...chartData.map(d => d.revenue));
  const maxExpenses = Math.max(...chartData.map(d => d.expenses));
  const maxProfit = Math.max(...chartData.map(d => d.profit));
  const minProfit = Math.min(...chartData.map(d => d.profit));
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

  const totalRevenue = chartData.reduce((sum, d) => sum + d.revenue, 0);
  const totalExpenses = chartData.reduce((sum, d) => sum + d.expenses, 0);
  const totalProfit = totalRevenue - totalExpenses;
  const avgMargin = chartData.reduce((sum, d) => sum + d.margin, 0) / chartData.length;
  const expenseEfficiency = totalRevenue > 0 ? (totalExpenses / totalRevenue * 100).toFixed(1) : "0.0";
  const bestDay = chartData.reduce((best, d, i) => d.margin > chartData[best].margin ? i : best, 0);
  const worstDay = chartData.reduce((worst, d, i) => d.margin < chartData[worst].margin ? i : worst, 0);

  return (
    <div className="bg-gradient-to-br from-gray-900/80 to-black rounded-2xl p-4 sm:p-5 border border-gray-800">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-bold text-white">{T.revenueVsExpenses || "Revenue vs Expenses (30 days)"}</h3>
        </div>
        <div className="flex gap-2 bg-gray-800/50 rounded-lg p-1">
          <button onClick={() => setSelectedMetric("revenue")} className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${selectedMetric === "revenue" ? "bg-blue-500/30 text-blue-400" : "text-gray-500 hover:text-gray-300"}`}>{T.revenue || "Revenue"}</button>
          <button onClick={() => setSelectedMetric("expenses")} className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${selectedMetric === "expenses" ? "bg-rose-500/30 text-rose-400" : "text-gray-500 hover:text-gray-300"}`}>{T.expenses || "Expenses"}</button>
          <button onClick={() => setSelectedMetric("profit")} className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${selectedMetric === "profit" ? "bg-green-500/30 text-green-400" : "text-gray-500 hover:text-gray-300"}`}>{T.profit || "Profit"}</button>
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

        <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between text-[10px] font-mono">
          {ySteps.slice().reverse().map((step, idx) => (
            <div key={idx} className="text-gray-500 -translate-y-1/2">
              {selectedMetric === "profit" ? (step >= 0 ? "+" : "") : "$"}{(step / 1000).toFixed(0)}k
            </div>
          ))}
        </div>

        <div className="ml-12 h-48 sm:h-64 flex gap-0.5 sm:gap-1 overflow-x-auto pb-2">
          {chartData.map((item, idx) => {
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
                className="flex-1 h-full flex flex-col justify-end items-center gap-0.5 group cursor-pointer min-w-[20px] sm:min-w-[24px]"
                onMouseEnter={() => setHoveredBar(idx)}
                onMouseLeave={() => setHoveredBar(null)}
                onClick={() => setHoveredBar((prev) => (prev === idx ? null : idx))}
              >
                <div className="relative w-full mt-auto">
                  <div className={`w-full ${getBarColor()} rounded-t-sm transition-all duration-150`} style={{ height: `${Math.max(percent, 3)}px`, minHeight: '3px' }} />
                  {hoveredBar === idx && (
                    <div className="absolute -top-28 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 z-20 shadow-xl whitespace-nowrap">
                      <div className="text-xs font-bold text-white">{T.day || "Day"} {item.day}</div>
                      <div className={`text-sm font-bold mt-1 ${getMetricValue(item) >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {selectedMetric === "revenue" && "$"}{value.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1">{T.revenue || "Revenue"}: ${item.revenue.toLocaleString()}</div>
                      <div className="text-[10px] text-gray-400">{T.expenses || "Expenses"}: ${item.expenses.toLocaleString()}</div>
                      <div className="text-[10px] text-gray-500 mt-1">{T.margin || "Margin"}: {item.margin}%</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-5 pt-4 border-t border-gray-800">
        <div className="bg-blue-500/5 rounded-xl p-2 sm:p-3 border border-blue-500/15">
          <div className="flex items-center gap-1 mb-1">
            <DollarSign className="w-3 h-3 text-blue-400" />
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider">{T.totalRevenue || "Total Revenue"}</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-white">${(totalRevenue / 1000).toFixed(0)}k</div>
          <div className="text-[10px] text-gray-500 mt-1">↑ {chartData[0].revenue > 0 ? Math.abs(((chartData[chartData.length-1].revenue - chartData[0].revenue) / chartData[0].revenue * 100)).toFixed(0) : "0"}% {T.demoVsStart || "vs start"}</div>
        </div>
        <div className="bg-rose-500/5 rounded-xl p-2 sm:p-3 border border-rose-500/15">
          <div className="flex items-center gap-1 mb-1">
            <TrendingDown className="w-3 h-3 text-rose-400" />
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider">{T.totalExpenses || "Total Expenses"}</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-white">${(totalExpenses / 1000).toFixed(0)}k</div>
          <div className="text-[10px] text-gray-500 mt-1">{((totalExpenses / totalRevenue) * 100).toFixed(0)}% {T.demoOfRevenue || "of revenue"}</div>
        </div>
        <div className="bg-green-500/10 rounded-xl p-2 sm:p-3 border border-green-500/20">
          <div className="flex items-center gap-1 mb-1">
            <TrendingUp className="w-3 h-3 text-green-400" />
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider">{T.netProfit || "Net Profit"}</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-green-400">+${(totalProfit / 1000).toFixed(0)}k</div>
          <div className="text-[10px] text-gray-500 mt-1">{avgMargin.toFixed(1)}% {T.demoAvgMargin || "avg margin"}</div>
        </div>
      </div>

      <div className="flex justify-between items-center mt-3 pt-2 text-[10px] text-gray-600 border-t border-gray-800/50">
        <span>{T.demoExpenseRatio || "Expense ratio"}: {expenseEfficiency}%</span>
        <span>{T.demoPeakMargin || "Peak margin"}: {chartData[bestDay].margin}%</span>
        <span>{T.demoLowMargin || "Low margin"}: {chartData[worstDay].margin}%</span>
      </div>
    </div>
  );
}

// ========== КОМПОНЕНТ КАРТОЧКИ МЕТРИКИ (стиль как в LiveDemo) ==========
// Полные literal-классы Tailwind для каждой темы карточки. Раньше цвет строился
// динамически через color.replace("bg-", "text-") — Tailwind не видит такую строку
// на этапе сборки и не генерирует CSS для неё, если она не встречается где-то ещё
// буквально в коде. text-blue-500/text-green-500 случайно были в других файлах
// (поэтому Дохід/Прибуток красились), а text-purple-500/text-orange-500 — нет,
// поэтому Маржа и CAC оставались белыми.
const METRIC_CARD_THEMES: Record<string, { from: string; border: string; text: string; ticker: string }> = {
  "bg-blue-500": { from: "from-blue-500/10", border: "border-blue-500/20", text: "text-blue-500", ticker: "bg-blue-500/60" },
  "bg-green-500": { from: "from-green-500/10", border: "border-green-500/20", text: "text-green-500", ticker: "bg-green-500/60" },
  "bg-purple-500": { from: "from-purple-500/10", border: "border-purple-500/20", text: "text-purple-500", ticker: "bg-purple-500/60" },
  "bg-orange-500": { from: "from-orange-500/10", border: "border-orange-500/20", text: "text-orange-500", ticker: "bg-orange-500/60" },
};

function MetricCard({ title, value, change, color, prefix = "$", suffix = "", sparklineData, prevValue }: {
  title: string; value: number; change: number; color: string; prefix?: string; suffix?: string;
  sparklineData: number[]; prevValue: number;
}) {
  const theme = METRIC_CARD_THEMES[color] || METRIC_CARD_THEMES["bg-blue-500"];
  return (
  <div className={`bg-gradient-to-br ${theme.from} to-transparent rounded-xl p-4 pb-5 border ${theme.border}`}>
      <div className={`text-xs font-semibold mb-1 uppercase ${theme.text}`}>{title}</div>
      <AnimatedNumber value={value} prefix={prefix} suffix={suffix} changePercent={change} />
      <TickerSparkline
        history={sparklineData}
        color={theme.ticker}
        currentValue={value}
        previousValue={prevValue}
      />
    </div>
  );
}

// ========== СВАЙП-КАРТОЧКА CAC (Meta Ads / Загальне / Google Ads) ==========
// Порядок навмисно: індекс 0 = Meta Ads (свайп вправо від центру = вліво по
// екрану), 1 = Загальне (стартова позиція), 2 = Google Ads (свайп вліво від
// центру = вправо по екрану) — як просили: "справа Google Ads, зліва Meta Ads,
// по центру — загальні дані по обох джерелах".
interface CacPanelData {
  label: string;
  value: number | null;
  change: number;
  prev: number | null;
  sparklineData: number[];
}

function SwipeableCacCard({ panels, language }: { panels: CacPanelData[]; language: string }) {
  const [index, setIndex] = useState(1);
  const touchStartX = useRef<number | null>(null);
  const theme = METRIC_CARD_THEMES["bg-orange-500"];

  const goTo = (i: number) => setIndex(Math.max(0, Math.min(panels.length - 1, i)));

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) > 40) {
      if (delta < 0) goTo(index + 1);
      else goTo(index - 1);
    }
    touchStartX.current = null;
  };

  const panel = panels[index];
  const hasValue = panel.value != null;
  const title = index === 1 ? "CAC" : panel.label;

  return (
  <div
  className={`bg-gradient-to-br ${theme.from} to-transparent rounded-xl p-4 pb-2.5 sm:pb-2 border ${theme.border} select-none flex flex-col`}
    onTouchStart={handleTouchStart}
    onTouchEnd={handleTouchEnd}
  >
    <div className="flex items-center justify-between gap-1">
      <div className={`text-xs font-semibold uppercase ${theme.text} truncate`}>
        {title}
      </div>
      <div className="hidden sm:flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          className="text-gray-500 hover:text-gray-300 disabled:opacity-20 disabled:cursor-not-allowed p-0.5"
          aria-label="previous"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => goTo(index + 1)}
          disabled={index === panels.length - 1}
          className="text-gray-500 hover:text-gray-300 disabled:opacity-20 disabled:cursor-not-allowed p-0.5"
          aria-label="next"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <div className="mb-1 min-h-[52px]">
      {hasValue ? (
        <AnimatedNumber value={panel.value as number} prefix="$" changePercent={panel.change} />
      ) : (
        <p className="text-xs text-gray-500 mt-2">
          {language === "UA" ? "Немає даних для цього джерела" : language === "DE" ? "Keine Daten für diese Quelle" : "No data for this source yet"}
        </p>
      )}
    </div>
    <div className="-mt-1">
      {hasValue ? (
        <TickerSparkline
          history={panel.sparklineData}
          color={theme.ticker}
          currentValue={panel.value as number}
          previousValue={panel.prev ?? (panel.value as number)}
        />
      ) : (
        <div className="h-8 mt-2" aria-hidden="true" />
      )}
    </div>

   <div className="flex items-center justify-center gap-1.5 pt-2">
      {panels.map((_, i) => (
        <button
          key={i}
          onClick={() => goTo(i)}
          className={`w-1.5 h-1.5 rounded-full transition-colors ${i === index ? "bg-orange-400" : "bg-gray-700"}`}
          aria-label={`panel ${i + 1}`}
        />
      ))}
    </div>
  </div>
);
}

function getStatusBadge(status: string, t: any) {
  switch(status) {
    case "connected":
      return <span className="text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-400 flex items-center gap-1"><Wifi className="w-3 h-3" /> {t.demoConnected || "Connected"}</span>;
    case "error":
      return <span className="text-xs px-2 py-1 rounded-full font-semibold bg-red-500/20 text-red-400 flex items-center gap-1"><WifiOff className="w-3 h-3" /> {t.demoConnectionError || "Error"}</span>;
    case "pending":
      return <span className="text-xs px-2 py-1 rounded-full font-semibold bg-yellow-500/20 text-yellow-400">{t.demoSetupRequired || "Setup Required"}</span>;
    default:
      return <span className="text-xs px-2 py-1 rounded-full font-semibold bg-gray-500/20 text-gray-400">{status}</span>;
  }
}

function getCategoryIcon(category: string) {
  switch(category) {
    case "ads": return <Zap className="w-4 h-4" />;
    case "inventory": return <Package className="w-4 h-4" />;
    case "finance": return <CreditCard className="w-4 h-4" />;
    case "shipping": return <Truck className="w-4 h-4" />;
    case "cac": return <Users className="w-4 h-4" />;
    case "margin": return <TrendingUp className="w-4 h-4" />;
    default: return <AlertCircle className="w-4 h-4" />;
  }
}



export default function DashboardPage() {
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeView, setActiveView] = useState<ViewType>("overview");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const [metricsRows, setMetricsRows] = useState<MetricsRow[]>([]);
  const [metricsLoaded, setMetricsLoaded] = useState(false);

const [forecastData, setForecastData] = useState<any>(null);
const [forecastLoaded, setForecastLoaded] = useState(false);

  const lastRow = metricsRows[metricsRows.length - 1];
  const prevRow = metricsRows[metricsRows.length - 2];

  const currentRevenue = lastRow?.revenue ?? 0;
  const currentProfit = lastRow?.profit ?? 0;
  const currentMargin = lastRow?.margin_pct ?? 0;
  const currentCac = lastRow?.cac ?? null;
  const currentCacMeta = lastRow?.cacMeta ?? null;
  const currentCacGoogle = lastRow?.cacGoogle ?? null;
  const prevRevenue = prevRow?.revenue ?? currentRevenue;
  const prevProfit = prevRow?.profit ?? currentProfit;
  const prevMargin = prevRow?.margin_pct ?? currentMargin;
  const prevCac = prevRow?.cac ?? currentCac;
  const prevCacMeta = prevRow?.cacMeta ?? currentCacMeta;
  const prevCacGoogle = prevRow?.cacGoogle ?? currentCacGoogle;

  const revenueQueue = buildSparkline(metricsRows, (r) => r.revenue);
  const profitQueue = buildSparkline(metricsRows, (r) => r.profit);
  const marginQueue = buildSparkline(metricsRows, (r) => r.margin_pct);
  // CAC-спарклайни для свайп-картки — null (нема даних за день) замінюємо
  // на 0, інакше TickerSparkline ламається на Math.max/min з null.
  const cacQueue = buildSparkline(metricsRows, (r) => r.cac ?? 0);
  const cacMetaQueue = buildSparkline(metricsRows, (r) => r.cacMeta ?? 0);
  const cacGoogleQueue = buildSparkline(metricsRows, (r) => r.cacGoogle ?? 0);
  const chartHistory = toChartHistory(metricsRows);

  const [risks, setRisks] = useState<Risk[]>([]);
  const [alertCount, setAlertCount] = useState(0);
  const [alertsLoaded, setAlertsLoaded] = useState(false);

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(30);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [show2FAModal, setShow2FAModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
const [deleteConfirmText, setDeleteConfirmText] = useState("");
const [deleting, setDeleting] = useState(false);
const [deleteError, setDeleteError] = useState("");
  const [mfaFactorId, setMfaFactorId] = useState("");
  const [mfaQrCode, setMfaQrCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMsg, setMfaMsg] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [feedbackType, setFeedbackType] = useState<"bug" | "feature">("bug");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [reviewMsg, setReviewMsg] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileInitials, setProfileInitials] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null);
  const [phoneDirty, setPhoneDirty] = useState(false);
const [phoneSaved, setPhoneSaved] = useState(false);
const [companyDirty, setCompanyDirty] = useState(false);
const [companySaved, setCompanySaved] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const addToQueue = <T,>(queue: T[], newValue: T): T[] => [...queue.slice(1), newValue];
  const supabase = createClient();
  const [subInfo, setSubInfo] = useState<{ plan: string | null; access_status: string; is_blocked?: boolean } | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [timezone, setTimezoneState] = useState("America/New_York");
  const [allTimezones] = useState<string[]>(() => getAllTimezones().sort());
  const groupedTimezones = groupTimezonesByRegion(allTimezones);
  const [businessId, setBusinessId] = useState("");
  const [broadcastNotif, setBroadcastNotif] = useState<{ id: string; message: string } | null>(null);

  const [showExpiredNotice, setShowExpiredNotice] = useState(false);

  useEffect(() => {
  const refreshTelegramStatus = async () => {
    if (document.visibilityState === "visible" && profileEmail) {
      try {
        const res = await fetch(
          `/api/business-status?email=${encodeURIComponent(profileEmail)}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        setTelegramConnected(!!data.telegram_connected);
      } catch (e) {
        console.error("Failed to refresh telegram status", e);
      }
    }
  };

  document.addEventListener("visibilitychange", refreshTelegramStatus);
  window.addEventListener("focus", refreshTelegramStatus);
  return () => {
    document.removeEventListener("visibilitychange", refreshTelegramStatus);
    window.removeEventListener("focus", refreshTelegramStatus);
  };
}, [profileEmail]);

useEffect(() => {
  if (!profileEmail) return;
  setForecastLoaded(false);
  fetch(`/api/forecast?email=${encodeURIComponent(profileEmail)}&language=${language}`, { cache: "no-store" })
    .then((res) => res.json())
    .then((data) => setForecastData(data))
    .catch((e) => {
      console.error("Failed to load forecast", e);
      setForecastData({ sufficient: false, days: 0 });
    })
    .finally(() => setForecastLoaded(true));
}, [profileEmail, language]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }: any) => {
      if (!data.session) {
        router.push("/");
        return;
      }
      const email = data.session.user.email || "";
      const prefsRes = await fetch(`/api/notification-prefs?email=${encodeURIComponent(email)}`);
      const prefs = await prefsRes.json();
      setNotificationsEnabled(prefs.push_enabled);
      setEmailAlerts(prefs.email_enabled);
      setProfileEmail(email);
      setEditEmail(email);
      setIsAuthenticated(true);
     const bizRes = await fetch(`/api/business-profile?email=${encodeURIComponent(email)}`);
const bizData = await bizRes.json();
if (bizData.business) {
  setBusinessName(bizData.business.name || "");
  setBusinessId(bizData.business.id?.slice(0, 8).toUpperCase() || "");

  if (bizData.business.timezone) {
    setTimezoneState(bizData.business.timezone);
  } else {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setTimezoneState(detected);
    saveBusinessProfileWithTimezone(detected);
  }
}

      const bizStatusRes = await fetch(`/api/business-status?email=${encodeURIComponent(email)}`);
      const bizStatus = await bizStatusRes.json();
      setTelegramConnected(!!bizStatus.telegram_connected);

      const res = await fetch(`/api/subscription-status?email=${encodeURIComponent(email)}`, { cache: "no-store" });
      const sub = await res.json();
      setSubInfo(sub);

      try {
        const selRes = await fetch(`/api/integrations-select?email=${encodeURIComponent(email)}`, { cache: "no-store" });
        const selData = await selRes.json();
        setSelectedProviders(selData.selected || []);
      } catch (e) {
        console.error("Failed to load integrations selection", e);
        setSelectedProviders([]);
      }

      try {
        const metricsRes = await fetch(`/api/metrics?email=${encodeURIComponent(email)}`, { cache: "no-store" });
        const metricsData = await metricsRes.json();
        setMetricsRows(metricsData.hasData ? metricsData.rows : []);
      } catch (e) {
        console.error("Failed to load metrics", e);
        setMetricsRows([]);
      } finally {
        setMetricsLoaded(true);
      }

      try {
        const alertsRes = await fetch(`/api/alerts?email=${encodeURIComponent(email)}`, { cache: "no-store" });
        const alertsData = await alertsRes.json();
        const mapped: Risk[] = (alertsData.alerts || []).map((a: any) => ({
          id: a.id,
          title: a.message,
          description: a.ai_explanation || "",
          time: formatAlertTime(a.sent_at),
          severity: a.severity,
          action: language === "UA" ? "Переглянути огляд" : language === "DE" ? "Übersicht ansehen" : "View overview",
          category: alertTypeToCategory(a.type),
          alertType: a.type,
        }));
        setRisks(mapped);
        setAlertCount(mapped.length);
      } catch (e) {
        console.error("Failed to load alerts", e);
        setRisks([]);
        setAlertCount(0);
      } finally {
        setAlertsLoaded(true);
      }

      const notifRes = await fetch(`/api/notifications/latest?email=${encodeURIComponent(email)}`, { cache: "no-store" });
      const notifData = await notifRes.json();
      if (notifData.notification) setBroadcastNotif(notifData.notification);

      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const verifiedFactor = factorsData?.totp?.find((f: any) => f.status === "verified");
      setTwoFactorEnabled(!!verifiedFactor);
      if (verifiedFactor) setMfaFactorId(verifiedFactor.id);
      const profileRes = await fetch(`/api/profile?email=${encodeURIComponent(email)}`, { cache: "no-store" });
      const profile = await profileRes.json();
      const displayName = profile.full_name || email.split("@")[0] || "";
      if (displayName) {
        setProfileName(displayName);
        setEditName(displayName);
        const initials = displayName.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);
        setProfileInitials(initials);
      }
      if (profile.phone) {
        setProfilePhone(profile.phone);
        setEditPhone(profile.phone);
      }
      if (profile.avatar_url) {
        setProfilePhotoUrl(profile.avatar_url);
        setEditPhotoUrl(profile.avatar_url);
      }
    });
  }, [router]);

 const isExpiredTrial = subInfo?.access_status === "expired";
const hasGrowthAccess = subInfo ? ["trial", "growth", "scale"].includes(subInfo.plan || "") : false;
const isBlocked =
  !subInfo ||
  (!subInfo.plan && !isExpiredTrial) ||
  subInfo.access_status === "blocked" ||
  subInfo.access_status === "none";

useEffect(() => {
  if (isExpiredTrial) setShowExpiredNotice(true);
}, [isExpiredTrial]);


  const pctChange = (curr: number, prev: number) => (prev ? ((curr - prev) / prev * 100).toFixed(1) : "0.0");
  const revenueChange = pctChange(currentRevenue, prevRevenue);
  const profitChange = pctChange(currentProfit, prevProfit);
  const marginChange = (currentMargin - prevMargin).toFixed(1);
  const cacChange = currentCac != null && prevCac ? pctChange(currentCac, prevCac) : "0.0";
  const cacMetaChange = currentCacMeta != null && prevCacMeta ? pctChange(currentCacMeta, prevCacMeta) : "0.0";
  const cacGoogleChange = currentCacGoogle != null && prevCacGoogle ? pctChange(currentCacGoogle, prevCacGoogle) : "0.0";

 const handleConnectTelegram = async () => {
  const res = await fetch("/api/telegram-connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: profileEmail, language }),
  });
  const data = await res.json();
  if (data.url) {
    window.open(data.url, "_blank");
  } else {
    alert("Error: " + (data.error || "could not get link"));
  }
};

const handleDisconnectTelegram = async () => {
    await fetch("/api/telegram-disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: profileEmail }),
    });
    setTelegramConnected(false);
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const confirmDeleteAccount = async () => {
  setDeleting(true);
  setDeleteError("");
  try {
    const res = await fetch("/api/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: profileEmail }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error || "Something went wrong");
      setDeleting(false);
      return;
    }
    await supabase.auth.signOut();
    router.push("/");
  } catch {
    setDeleteError("Network error");
    setDeleting(false);
  }
};

  const openEditProfile = () => {
    setEditName(profileName);
    setEditEmail(profileEmail);
    setEditPhone(profilePhone);
    setEditPhotoUrl(profilePhotoUrl);
    setShowEditProfileModal(true);
  };

  const saveBusinessProfile = async () => {
    await fetch("/api/business-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: profileEmail, name: businessName, timezone }),
    });
    setCompanyDirty(false);
    setCompanySaved(true);
    setTimeout(() => setCompanySaved(false), 2000);
  };

  const saveBusinessProfileWithTimezone = async (tz: string) => {
  await fetch("/api/business-profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: profileEmail, name: businessName, timezone: tz }),
  });
};

const savePhone = async () => {
  try {
    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: profileEmail,
        full_name: profileName,
        phone: profilePhone,
        avatar_url: profilePhotoUrl,
      }),
    });
    setPhoneDirty(false);
    setPhoneSaved(true);
    setTimeout(() => setPhoneSaved(false), 2000);
  } catch (e) {
    console.error("Failed to save phone", e);
  }
};
  
  const handleExportData = () => {
    window.open(`/api/export-data?email=${encodeURIComponent(profileEmail)}`, "_blank");
  };
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [exportingFormat, setExportingFormat] = useState(false);
  const handleExportFormat = async (format: "json" | "xlsx" | "pdf") => {
    setExportMenuOpen(false);
    if (format === "json") {
      handleExportData();
      return;
    }
    setExportingFormat(true);
    try {
      if (format === "xlsx") {
        const { exportMetricsToExcel } = await import("@/lib/export-metrics");
        await exportMetricsToExcel(metricsRows, businessName);
      } else {
        const { exportMetricsToPdf } = await import("@/lib/export-metrics");
        await exportMetricsToPdf(metricsRows, businessName);
      }
    } catch (e) {
      console.error("Export failed", e);
    } finally {
      setExportingFormat(false);
    }
  };

  // Закрываем меню экспорта при клике вне него или при скролле —
  // раньше закрывалось только повторным кликом на "Export"/пункт меню.
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const handleScroll = () => setExportMenuOpen(false);
    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [exportMenuOpen]);

  const submitReview = async () => {
    setReviewMsg("");
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: profileEmail,
        author_name: profileName,
        business_name: businessName,
        rating: reviewRating,
        comment: reviewComment,
      }),
    });
    if (res.ok) {
      setReviewMsg("success");
      setReviewComment("");
    } else {
      setReviewMsg("error");
    }
  };

  const submitFeedback = async () => {
  setFeedbackMsg("");
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: profileEmail, type: feedbackType, message: feedbackMessage }),
  });
  if (res.ok) {
    setFeedbackMsg("success");
    setFeedbackMessage("");
  } else {
    setFeedbackMsg("error");
  }
};

  const dismissBroadcast = async () => {
  setBroadcastNotif(null);
  await fetch("/api/notifications/latest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: profileEmail }),
  });
};

 const handleChangePassword = async () => {
  if (newPassword.length < 6) {
    setPasswordMsg(
      language === "UA" ? "Пароль має містити щонайменше 6 символів" : language === "DE" ? "Das Passwort muss mindestens 6 Zeichen lang sein" : "Password must be at least 6 characters"
    );
    return;
  }
  setPasswordLoading(true);
  setPasswordMsg("");
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  setPasswordLoading(false);
  if (error) {
    setPasswordMsg(error.message);
    return;
  }
  setPasswordMsg(
    language === "UA" ? "Пароль успішно оновлено" : language === "DE" ? "Passwort erfolgreich aktualisiert" : "Password updated successfully"
  );
  setNewPassword("");
  setTimeout(() => setShowPasswordModal(false), 1500);
};

const startEnroll2FA = async () => {
    setMfaMsg("");

    const { data: existing } = await supabase.auth.mfa.listFactors();
    const verified = existing?.totp?.find((f: any) => f.status === "verified");
    if (verified) {
      setTwoFactorEnabled(true);
      setMfaFactorId(verified.id);
      return;
    }

    const unverified = existing?.totp?.filter((f: any) => f.status !== "verified") || [];
    for (const f of unverified) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `rivant-${Date.now()}`,
    });
    if (error) {
      setMfaMsg(error.message);
      setShow2FAModal(true);
      return;
    }
    setMfaFactorId(data.id);
    setMfaQrCode(data.totp.qr_code);
    setShow2FAModal(true);
  };

  const confirmEnroll2FA = async () => {
    setMfaLoading(true);
    setMfaMsg("");
    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
    if (chErr) {
      setMfaLoading(false);
      setMfaMsg(chErr.message);
      return;
    }
    const { error: verErr } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: challenge.id,
      code: mfaCode,
    });
    setMfaLoading(false);
    if (verErr) {
      setMfaMsg(verErr.message);
      return;
    }
    setTwoFactorEnabled(true);
    setMfaMsg("2FA enabled!");
    setTimeout(() => { setShow2FAModal(false); setMfaCode(""); setMfaMsg(""); }, 1200);
  };

  const disable2FA = async () => {
    if (!mfaFactorId) return;
    await supabase.auth.mfa.unenroll({ factorId: mfaFactorId });
    setTwoFactorEnabled(false);
    setMfaFactorId("");
  };

  const saveProfile = async () => {
    const initials = editName.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    setProfileName(editName);
    setProfileEmail(editEmail);
    setProfilePhone(editPhone);
    setProfileInitials(initials);
    setProfilePhotoUrl(editPhotoUrl);
    setShowEditProfileModal(false);

    try {
      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: profileEmail,
          full_name: editName,
          phone: editPhone,
          avatar_url: editPhotoUrl,
        }),
      });
    } catch (e) {
      console.error("Failed to save profile", e);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setEditPhotoUrl(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const getTranslation = (key: string, fallback: string): string => {
    const translation = (t as any)[key];
    return translation !== undefined ? translation : fallback;
  };
const getPlanLabel = (plan: string | null | undefined): string => {
    switch (plan) {
      case "trial": return getTranslation("trialPlan", "Trial Plan");
      case "starter": return getTranslation("starterPlan", "Starter Plan");
      case "growth": return getTranslation("growthPlan", "Growth Plan");
      case "scale": return getTranslation("scalePlan", "Scale Plan");
      default: return getTranslation("noPlan", "No Plan");
    }
  };

  const changeLanguage = (lang: Language) => {
    setLanguage(lang);
  };

  const T = t as any;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">{getTranslation("loading", "Loading...")}</p>
        </div>
      </div>
    );
  }

if (!subInfo) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">{getTranslation("loading", "Loading...")}</p>
        </div>
      </div>
    );
  }

  if (isBlocked) {
  const adminBlocked = subInfo?.is_blocked === true;
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">
          {adminBlocked
            ? (language === "UA" ? "Акаунт заблоковано" : language === "DE" ? "Konto gesperrt" : "Account suspended")
            : (language === "UA" ? "Підписка закінчилась" : language === "DE" ? "Abonnement abgelaufen" : "Subscription expired")}
        </h2>
        <p className="text-gray-400 text-sm mb-6">
          {adminBlocked
            ? (language === "UA"
                ? "Ваш акаунт заблоковано. Зверніться в підтримку, якщо вважаєте це помилкою."
                : language === "DE"
                ? "Ihr Konto wurde gesperrt. Kontaktieren Sie den Support, falls dies ein Fehler ist."
                : "Your account has been suspended. Contact support if you think this is a mistake.")
            : (language === "UA"
                ? "Ваш доступ призупинено, але дані в безпеці. Поновіть план, щоб продовжити."
                : language === "DE"
                ? "Ihr Zugang ist pausiert, Ihre Daten sind aber sicher. Erneuern Sie Ihren Plan, um fortzufahren."
                : "Your access is paused, but your data is safe. Renew your plan to continue.")}
        </p>
        {adminBlocked ? (
          <a
            href="https://t.me/official_rivant"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {language === "UA" ? "Написати в підтримку" : language === "DE" ? "Support kontaktieren" : "Contact support"}
          </a>
        ) : (
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => router.push("/#pricing")}>
            {language === "UA" ? "Переглянути тарифи" : language === "DE" ? "Pläne ansehen" : "View plans"}
          </Button>
        )}
        <button onClick={confirmLogout} className="block mx-auto mt-4 text-sm text-gray-500 hover:text-gray-300">
          {language === "UA" ? "Вийти" : language === "DE" ? "Abmelden" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

  return (
    <div className="h-screen bg-background flex flex-col lg:flex-row overflow-hidden pb-16 lg:pb-0">
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-64 bg-gray-950 lg:bg-black/60 border-r border-gray-800
        transform transition-transform duration-300 ease-in-out overflow-hidden
        ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full p-4 overflow-hidden">
          <div className="flex items-center justify-between gap-2 mb-8">
            <button onClick={handleLogout} className="focus:outline-none hover:opacity-80 transition-opacity">
              <img src="/icon8.png" alt="RIVANT" className="w-48 object-contain" />
            </button>
            <button
              onClick={() => setIsMobileSidebarOpen(false)}
              className="lg:hidden w-10 h-10 flex-shrink-0 rounded-lg bg-gray-800/70 flex items-center justify-center text-gray-300 hover:text-white transition-colors"
              aria-label={getTranslation("close", "Close")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="space-y-1 flex-1">
            {sidebarItems.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  setActiveView(item.view);
                  setIsMobileSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  activeView === item.view
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "text-gray-500 hover:bg-gray-800/50 hover:text-gray-300"
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left font-medium">{getTranslation(item.translationKey, item.label)}</span>
              </button>
            ))}
          </nav>

          <div className="border-t border-gray-800 pt-4 mt-4">
            <div className="px-3 py-2">
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                <Globe className="w-3 h-3" /> {getTranslation("language", "Language")}
              </p>
              <div className="flex gap-2">
                {(["EN", "UA", "DE"] as Language[]).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => changeLanguage(lang)}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                      language === lang
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-gray-800/30 text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-4 mt-2">
            <DropdownMenu>
              <DropdownMenuTrigger className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-400 hover:bg-gray-800/50 transition-colors">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center overflow-hidden">
                  {profilePhotoUrl ? (
                    <img src={profilePhotoUrl} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-medium text-blue-400">{profileInitials}</span>
                  )}
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium text-gray-200">{profileName}</div>
                  <div className="text-xs text-gray-500">{getPlanLabel(subInfo?.plan)}</div>
                </div>
                <ChevronDown className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 bg-gray-900 border-gray-800">
                <DropdownMenuItem className="focus:bg-blue-500/10 cursor-pointer py-3 text-gray-300" onClick={openEditProfile}>
                  <Settings className="w-4 h-4 mr-2" /> {getTranslation("accountSettings", "Account Settings")}
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-gray-800" />
                <DropdownMenuItem onClick={handleLogout} className="focus:bg-blue-500/10 cursor-pointer text-red-400 py-3">
                  <LogOut className="w-4 h-4 mr-2" /> {getTranslation("signOut", "Sign Out")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 mt-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left font-medium">{getTranslation("signOut", "Sign Out")}</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-xl border-b border-gray-800 px-4 lg:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => setIsMobileSidebarOpen(true)} className="lg:hidden text-foreground p-2 bg-secondary rounded-lg">
                <LayoutDashboard className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-lg font-semibold text-foreground capitalize">
                  {getTranslation(activeView, activeView)}
                </h1>
                <p className="text-sm text-muted-foreground hidden sm:block">
                  {activeView === "overview" && getTranslation("realtimeMetrics", "Real-time business metrics")}
                  {activeView === "risks" && getTranslation("aiRisks", "AI-identified operational risks")}
                  {activeView === "forecast" && getTranslation("aiPredictions", "AI-powered predictions")}
                  {activeView === "integrations" && getTranslation("dataSources", "Connected data sources")}
                  {activeView === "settings" && getTranslation("manageAccount", "Manage your account")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 bg-green-500/10 px-3 py-1.5 rounded-full">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm text-green-400 font-medium">{T.settingsLive || "Live"}</span>
              </div>
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" className="relative bg-gray-800/30 hover:bg-gray-800/50">
                    <Bell className="w-5 h-5 text-gray-400" />
                    {notificationsEnabled && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-yellow-500 text-[10px] font-bold flex items-center justify-center text-white">
                        {alertCount}
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-80 bg-gray-900 border-gray-800 p-0" align="end">
                  <div className="p-3 border-b border-gray-800">
                    <h3 className="font-medium text-foreground">{getTranslation("notifications", "Notifications")}</h3>
                  </div>
                  <div className="max-h-80 overflow-auto">
                    {risks.slice(0, 3).map((alert) => (
                      <div key={alert.id} className="p-3 hover:bg-gray-800/50 border-b border-gray-800/30 last:border-0">
                        <div className="flex items-start gap-3">
                          <div className={`w-2 h-2 rounded-full mt-1.5 ${
                            alert.severity === "high" || alert.severity === "critical" ? "bg-red-500" :
                            alert.severity === "medium" ? "bg-yellow-500" : "bg-blue-500"
                          }`} />
                          <div>
                            <p className="text-sm text-foreground">{alert.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{alert.time}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-2 border-t border-gray-800">
                    <Button variant="ghost" size="sm" className="w-full text-blue-400 hover:bg-blue-500/10" onClick={() => setActiveView("risks")}>
                      {getTranslation("viewAllAlerts", "View all alerts")}
                    </Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <TrialPromptModal email={profileEmail} language={language} />

        {showExpiredNotice && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
    <div className="bg-gray-900 border border-red-500/30 rounded-2xl p-6 w-full max-w-[380px] shadow-2xl text-center">
      <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
        <AlertCircle className="w-7 h-7 text-red-400" />
      </div>
      <h2 className="text-lg font-semibold text-white mb-2">
        {language === "UA" ? "Тариф не активний" : language === "DE" ? "Kein aktiver Tarif" : "No active plan"}
      </h2>
      <p className="text-sm text-gray-400 mb-6">
        {language === "UA"
          ? "Ваш тариф закінчився. Дані в безпеці — оформіть тариф, щоб продовжити."
          : language === "DE"
          ? "Ihr Tarif ist abgelaufen. Ihre Daten sind sicher — wählen Sie einen Tarif, um fortzufahren."
          : "Your plan has ended. Your data is safe — pick a plan to continue."}
      </p>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800" onClick={() => setShowExpiredNotice(false)}>
          {language === "UA" ? "Гаразд" : language === "DE" ? "OK" : "OK"}
        </Button>
        <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={() => router.push("/#pricing")}>
          {language === "UA" ? "Переглянути тарифи" : language === "DE" ? "Tarife ansehen" : "View plans"}
        </Button>
      </div>
    </div>
  </div>
)}

{broadcastNotif && (
  <div className="bg-blue-600/20 border-b border-blue-500/30 px-4 py-3 flex items-center justify-between gap-3">
    <p className="text-sm text-blue-300">{broadcastNotif.message}</p>
    <button onClick={dismissBroadcast} className="text-blue-300 hover:text-white shrink-0 p-1">
      <X className="w-4 h-4" />
    </button>
  </div>
)}

       <div className="flex-1 p-4 lg:p-6 overflow-auto">

          {activeView === "overview" && (
            <div className="space-y-5">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-start">
                    <MetricCard
                      title={T.revenue || "Revenue"}
                      value={currentRevenue}
                      change={parseFloat(revenueChange)}
                      color="bg-blue-500"
                      prefix="$"
                      sparklineData={revenueQueue}
                      prevValue={prevRevenue}
                    />
                    <MetricCard
                      title={T.profit || "Profit"}
                      value={currentProfit}
                      change={parseFloat(profitChange)}
                      color="bg-green-500"
                      prefix="$"
                      sparklineData={profitQueue}
                      prevValue={prevProfit}
                    />
                    <MetricCard
                      title={T.margin || "Margin"}
                      value={currentMargin}
                      change={parseFloat(marginChange)}
                      color="bg-purple-500"
                      suffix="%"
                      sparklineData={marginQueue}
                      prevValue={prevMargin}
                    />
                    <SwipeableCacCard
                      language={language}
                      panels={[
                        { label: "Meta Ads", value: currentCacMeta, change: parseFloat(cacMetaChange), prev: prevCacMeta, sparklineData: cacMetaQueue },
                        {
                          label: language === "UA" ? "Загальне" : language === "DE" ? "Gesamt" : "Combined",
                          value: currentCac,
                          change: parseFloat(cacChange),
                          prev: prevCac,
                          sparklineData: cacQueue,
                        },
                        { label: "Google Ads", value: currentCacGoogle, change: parseFloat(cacGoogleChange), prev: prevCacGoogle, sparklineData: cacGoogleQueue },
                      ]}
                    />
                  </div>

                  <RevenueExpensesChart history={chartHistory} />
            </div>
          )}

          {activeView === "risks" && (
            <div className="space-y-4">
             {isExpiredTrial ? (
  <div className="text-center py-16 bg-gray-900/30 rounded-xl border border-gray-800">
    <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-gray-600" />
    <h3 className="text-white font-semibold mb-1">
      {language === "UA" ? "Тариф не активний" : language === "DE" ? "Kein aktiver Tarif" : "No active plan"}
    </h3>
    <p className="text-gray-500 text-sm mb-4">
      {language === "UA" ? "Підключіть тариф, щоб бачити виявлені ризики." : language === "DE" ? "Verbinden Sie einen Tarif, um erkannte Risiken zu sehen." : "Connect a plan to see detected risks."}
    </p>
    <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => router.push("/#pricing")}>
      {language === "UA" ? "Переглянути тарифи" : language === "DE" ? "Tarife ansehen" : "View plans"}
    </Button>
  </div>
) : !hasGrowthAccess ? (
  <div className="text-center py-16 bg-gray-900/30 rounded-xl border border-gray-800">
    <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-gray-600" />
   <h3 className="text-white font-semibold mb-1">
{language === "UA" ? "Доступно на тарифі Growth" : language === "DE" ? "Verfügbar im Growth-Tarif" : "Available on Growth plan"}
</h3>
<p className="text-gray-500 text-sm mb-4">
{language === "UA" ? "Виявлення ризиків у реальному часі доступне на тарифі Growth." : language === "DE" ? "Echtzeit-Risikoerkennung ist Teil des Growth-Tarifs." : "Real-time risk detection is part of the Growth plan."}
</p>
<Button className="bg-blue-600 hover:bg-blue-700" onClick={() => router.push("/#pricing")}>
{language === "UA" ? "Оновити тариф" : language === "DE" ? "Upgraden" : "Upgrade"}
</Button>
  </div>
) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">{risks.length} {language === "UA" ? "сповіщень" : language === "DE" ? "Benachrichtigungen" : "notifications"}</span>
                    {risks.length > 0 && (
                      <button
                        onClick={async () => {
                          setRisks([]);
                          setAlertCount(0);
                          try {
                            await fetch("/api/alerts", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ email: profileEmail, resolveAll: true }),
                            });
                          } catch (e) {
                            console.error("Failed to resolve all alerts", e);
                          }
                        }}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {language === "UA" ? "Очистити всі" : language === "DE" ? "Alle löschen" : "Clear all"}
                      </button>
                    )}
                  </div>

                  <div className="space-y-3 pr-1 pb-6">
                    {risks.map((risk) => (
                      <div key={risk.id} className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            risk.severity === "high" || risk.severity === "critical" ? "bg-red-500/20" : risk.severity === "medium" ? "bg-yellow-500/20" : "bg-blue-500/20"
                          }`}>
                            {getCategoryIcon(risk.category)}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                                risk.severity === "high" || risk.severity === "critical" ? "bg-red-500/20 text-red-400" :
                                risk.severity === "medium" ? "bg-yellow-500/20 text-yellow-400" : "bg-blue-500/20 text-blue-400"
                              }`}>{risk.severity.toUpperCase()}</span>
                              <span className="text-xs text-gray-500">{risk.time}</span>
                            </div>
                            <h4 className="font-semibold text-white text-base">{risk.title}</h4>
                            <p className="text-sm text-gray-400 mt-0.5">{risk.description}</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-3 h-8 text-sm border-gray-700 text-gray-400 hover:bg-gray-800"
                              onClick={() => setActiveView("overview")}
                            >
                              {risk.action}
                            </Button>
                          </div>
                          <button
                            onClick={async () => {
                              setRisks(prev => prev.filter(r => r.id !== risk.id));
                              setAlertCount(prev => Math.max(0, prev - 1));
                              try {
                                await fetch("/api/alerts", {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ email: profileEmail, id: risk.id }),
                                });
                              } catch (e) {
                                console.error("Failed to resolve alert", e);
                              }
                            }}
                            className="text-gray-600 hover:text-gray-300 transition-colors p-2 -m-1 rounded-lg hover:bg-gray-800 self-start shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {alertsLoaded && risks.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p className="text-base">{T.demoNoActiveRisks || "No active risks. All systems normal."}</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}


              {activeView === "forecast" && (
  <div className="space-y-4">
    {isExpiredTrial ? (
      <div className="text-center py-16 bg-gray-900/30 rounded-xl border border-gray-800">
        <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-gray-600" />
        <h3 className="text-white font-semibold mb-1">
          {language === "UA" ? "Тариф не активний" : language === "DE" ? "Kein aktiver Tarif" : "No active plan"}
        </h3>
        <p className="text-gray-500 text-sm mb-4">
          {language === "UA" ? "Підключіть тариф, щоб бачити прогноз." : language === "DE" ? "Verbinden Sie einen Tarif, um die Prognose zu sehen." : "Connect a plan to see the forecast."}
        </p>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => router.push("/#pricing")}>
          {language === "UA" ? "Переглянути тарифи" : language === "DE" ? "Tarife ansehen" : "View plans"}
        </Button>
      </div>
    ) : !hasGrowthAccess ? (
      <div className="text-center py-16 bg-gray-900/30 rounded-xl border border-gray-800">
        <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-gray-600" />
       <h3 className="text-white font-semibold mb-1">
  {language === "UA" ? "Доступно на тарифі Growth" : language === "DE" ? "Verfügbar im Growth-Tarif" : "Available on Growth plan"}
</h3>
<p className="text-gray-500 text-sm mb-4">
  {language === "UA" ? "Виявлення ризиків у реальному часі доступне на тарифі Growth." : language === "DE" ? "Echtzeit-Risikoerkennung ist Teil des Growth-Tarifs." : "Real-time risk detection is part of the Growth plan."}
</p>
<Button className="bg-blue-600 hover:bg-blue-700" onClick={() => router.push("/#pricing")}>
  {language === "UA" ? "Оновити тариф" : language === "DE" ? "Upgraden" : "Upgrade"}
</Button>
      </div>
    ) : !forecastLoaded ? (
                <div className="text-center py-16 bg-gray-900/30 rounded-xl border border-gray-800">
                  <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">{getTranslation("loading", "Loading...")}</p>
                </div>
              ) : !forecastData?.sufficient ? (
                <div className="text-center py-16 bg-gray-900/30 rounded-xl border border-gray-800">
                  <TrendingUp className="w-10 h-10 mx-auto mb-3 text-gray-600" />
                  <h3 className="text-white font-semibold mb-1">
                    {language === "UA" ? "Недостатньо даних для прогнозу" : language === "DE" ? "Nicht genug Daten für eine Prognose" : "Not enough data for a forecast yet"}
                  </h3>
                  <p className="text-gray-500 text-sm max-w-md mx-auto">
                    {language === "UA"
                      ? `Є ${forecastData?.days ?? 0} дн. даних, потрібно мінімум 3. Прогноз з'явиться автоматично, коли назбирається історія.`
                      : language === "DE"
                      ? `${forecastData?.days ?? 0} Tage Daten vorhanden, mindestens 3 nötig. Die Prognose erscheint automatisch, sobald genug Historie da ist.`
                      : `${forecastData?.days ?? 0} day(s) of data so far, need at least 3. The forecast will appear automatically once there's enough history.`}
                  </p>
                </div>
              ) : (
                <>
                  {forecastData.tier === "low" && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-yellow-300">
                        {language === "UA"
                          ? `Попередній прогноз на основі лише ${forecastData.days} дн. даних — точність зросте, коли назбирається більше історії (рекомендовано від 14 днів).`
                          : language === "DE"
                          ? `Vorläufige Prognose auf Basis von nur ${forecastData.days} Tagen — die Genauigkeit steigt mit mehr Historie (empfohlen ab 14 Tagen).`
                          : `Preliminary forecast based on only ${forecastData.days} day(s) of data — accuracy improves as more history accumulates (14+ days recommended).`}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-gradient-to-br from-blue-500/10 to-transparent rounded-xl p-5 border border-blue-500/20">
                      <div className="text-sm text-blue-400 font-semibold mb-1">
                        {(T.projectedRevenue || "Projected Revenue")} ({forecastData.horizonDays}{T.forecastDaysUnit || "d"})
                      </div>
                      <div className="text-3xl font-bold text-white">${Math.round(forecastData.horizonDays === 30 ? forecastData.revenue30 : forecastData.revenue90).toLocaleString()}</div>
                      <div className={`text-sm mt-2 ${forecastData.dailyGrowthPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {forecastData.dailyGrowthPct >= 0 ? "+" : ""}{forecastData.dailyGrowthPct.toFixed(2)}%/{language === "UA" ? "день (тренд)" : language === "DE" ? "Tag (Trend)" : "day (trend)"}
                      </div>
                      <div className="text-xs text-gray-500 mt-3">
                        {T.demoConfidence || "Confidence"}: {forecastData.confidence}% · {language === "UA" ? `на основі ${forecastData.days} дн.` : language === "DE" ? `basierend auf ${forecastData.days} Tagen` : `based on ${forecastData.days} days`}
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-orange-500/10 to-transparent rounded-xl p-5 border border-orange-500/20">
                      <div className="text-sm text-orange-400 font-semibold mb-1">
                        {(T.projectedExpenses || "Projected Expenses")} ({forecastData.horizonDays}{T.forecastDaysUnit || "d"})
                      </div>
                      <div className="text-3xl font-bold text-white">${Math.round(forecastData.horizonDays === 30 ? forecastData.expenses30 : forecastData.expenses90).toLocaleString()}</div>
                      <div className="text-sm text-gray-500 mt-2">
                        {language === "UA" ? "лінійна екстраполяція витрат" : language === "DE" ? "lineare Extrapolation der Kosten" : "linear extrapolation of costs"}
                      </div>
                    </div>
                  </div>

                  <div className="bg-gray-900/30 rounded-xl p-3 sm:p-5 border border-gray-800 overflow-hidden">
                    <h3 className="font-semibold text-white text-base mb-4">
                      {forecastData.horizonDays === 30
                        ? (T.forecastWeeklyTitle || "Next 30 days")
                        : (T.forecastMonthlyTitle || "Next 3 months")}
                    </h3>
                    {(() => {
                      // Growth (30д) — тижнева розбивка накопичувального прогнозу
                      // в межах поточного місяця. Scale/Trial (90д) — розбивка по
                      // реальних календарних місяцях наперед від сьогодні (не
                      // хардкод: серпень зараз -> Сер/Вер/Жов, за місяць саме собою
                      // стане Вер/Жов/Лис).
                      // Реальний "фактичний дохід" для першого стовпця (як у демо-лайв,
                      // де Лип/Сер мали actual, а Вер — ще ні, бо в майбутньому). Рахуємо
                      // суму реальної виручки з metricsRows за поточний календарний
                      // місяць від 1 числа до сьогодні. Для 2-го і 3-го стовпця (майбутні
                      // місяці) фактичних даних ще не існує — там бар просто не рендериться.
                      const now = new Date();
                      const monthStartStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
                      const todayStr = now.toISOString().slice(0, 10);
                      const actualRevenueThisMonth = metricsRows
                        .filter((r) => r.date >= monthStartStr && r.date <= todayStr)
                        .reduce((sum, r) => sum + r.revenue, 0);

                      const bars =
                        forecastData.horizonDays === 30
                          ? [
                              { label: `${T.forecastWeekLabel || "Week"} 1`, revenue: forecastData.revenue7, expenses: forecastData.expenses7, revenueActual: null as number | null },
                              { label: `${T.forecastWeekLabel || "Week"} 2`, revenue: forecastData.revenue14, expenses: forecastData.expenses14, revenueActual: null as number | null },
                              { label: `${T.forecastWeekLabel || "Week"} 3`, revenue: forecastData.revenue21, expenses: forecastData.expenses21, revenueActual: null as number | null },
                              { label: `${T.forecastWeekLabel || "Week"} 4`, revenue: forecastData.revenue30, expenses: forecastData.expenses30, revenueActual: null as number | null },
                            ]
                          : getUpcomingMonthLabels(3, language).map((label, i) => ({
                              label,
                              revenue: [forecastData.revenue30, forecastData.revenue60, forecastData.revenue90][i],
                              expenses: [forecastData.expenses30, forecastData.expenses60, forecastData.expenses90][i],
                              revenueActual: i === 0 ? actualRevenueThisMonth : (null as number | null),
                            }));
                      const maxRevenue = Math.max(...bars.map((b) => b.revenue), ...bars.map((b) => b.revenueActual || 0), 1);
                      const maxExpenses = Math.max(...bars.map((b) => b.expenses), 1);
                      const scale = Math.max(maxRevenue, maxExpenses) / 100;
                      return (
                        <>
                          <div className="flex justify-around items-end h-28 gap-1 sm:gap-4">
                            {bars.map((m, i) => (
                              <div key={i} className="flex justify-center gap-1 sm:gap-2 items-end flex-1 min-w-0 h-full">
                                {m.revenueActual != null && (
                                  <div className="w-4 sm:w-8 bg-blue-500/30 rounded-t" style={{ height: `${Math.min(Math.max(m.revenueActual / scale, 2), 100)}px` }} />
                                )}
                                <div className="w-4 sm:w-8 bg-blue-500 rounded-t" style={{ height: `${Math.min(Math.max(m.revenue / scale, 2), 100)}px` }} />
                                <div className="w-4 sm:w-8 bg-rose-500/60 rounded-t" style={{ height: `${Math.min(Math.max(m.expenses / scale, 2), 100)}px` }} />
                              </div>
                            ))}
                          </div>
                          <div className="flex justify-around gap-1 sm:gap-4 mt-2">
                            {bars.map((m, i) => (
                              <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                                <span className="text-xs sm:text-sm text-gray-400 font-medium truncate max-w-full">{m.label}</span>
                                <div className="flex gap-1.5 sm:gap-2 text-[9px] sm:text-[10px]">
                                  <span className="text-blue-400">↑${Math.round(m.revenue / 1000)}k</span>
                                  <span className="text-rose-400">↓${Math.round(m.expenses / 1000)}k</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                    <div className="flex justify-center gap-6 mt-4 pt-3 text-[10px] text-gray-600 border-t border-gray-800">
                      <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 rounded-sm" /><span>{T.demoRevenueForecast || "Revenue Forecast"}</span></div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500/30 rounded-sm" /><span>{T.demoActualRevenue || "Actual Revenue"}</span></div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 bg-rose-500/60 rounded-sm" /><span>{T.demoExpensesForecast || "Expenses"}</span></div>
                    </div>
                  </div>

                  <div className="bg-blue-500/5 rounded-xl p-4 border border-blue-500/20">
                    {forecastData.explanation ? (
                      <p className="text-sm text-gray-300 whitespace-pre-line">{forecastData.explanation}</p>
                    ) : (
                      <ul className="space-y-1 text-sm text-gray-300">
                        <li>
                          • {language === "UA" ? "Тренд виручки" : language === "DE" ? "Umsatztrend" : "Revenue trend"}: {forecastData.dailyGrowthPct >= 0 ? "+" : ""}{forecastData.dailyGrowthPct.toFixed(2)}%/{language === "UA" ? "день" : language === "DE" ? "Tag" : "day"}
                        </li>
                        <li>
                          • {language === "UA" ? "Тренд маржі" : language === "DE" ? "Margentrend" : "Margin trend"}: {forecastData.marginSlope >= 0 ? "+" : ""}{forecastData.marginSlope.toFixed(2)} {language === "UA" ? "п.п./день" : "pp/day"}
                        </li>
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

         {activeView === "integrations" && (
            <div className="space-y-4">
              {subInfo?.plan === "growth" && (
                <div className="bg-blue-500/5 rounded-lg px-3 py-2 border border-blue-500/20 flex items-center gap-2">
                  <Link2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <p className="text-xs text-gray-400 leading-snug">
                    {selectedProviders.length > 0
                      ? (language === "UA"
                          ? <>На тарифі Growth можна підключити лише одну додаткову інтеграцію (крім Stripe) — ви обрали <span className="font-semibold text-gray-200">{selectedProviders[0]}</span>. Замінити на іншу можна тільки після продовження підписки або переходу на Scale.</>
                          : language === "DE"
                          ? <>Im Growth-Plan ist nur eine zusätzliche Integration (neben Stripe) möglich — Sie haben <span className="font-semibold text-gray-200">{selectedProviders[0]}</span> gewählt. Wechsel erst nach Verlängerung oder Upgrade auf Scale.</>
                          : <>The Growth plan allows only one additional integration (besides Stripe) — you've picked <span className="font-semibold text-gray-200">{selectedProviders[0]}</span>. Switching to another is only possible after renewal or upgrading to Scale.</>)
                      : (language === "UA"
                          ? "На тарифі Growth можна підключити одну додаткову інтеграцію (крім Stripe) — цей вибір буде зафіксовано до кінця поточного billing-періоду."
                          : language === "DE"
                          ? "Im Growth-Plan können Sie eine zusätzliche Integration (neben Stripe) wählen — diese Wahl gilt bis zum Ende des aktuellen Abrechnungszeitraums."
                          : "The Growth plan lets you connect one additional integration (besides Stripe) — your pick will be locked in until the end of this billing period.")}
                  </p>
                </div>
              )}

              <StripeConnectCard
  email={profileEmail}
  locked={isExpiredTrial}
  onLockedClick={() => router.push("/#pricing")}
/>

              <IntegrationConnectCard
                email={profileEmail}
                provider="shopify"
                displayName="Shopify"
                placeholder="shpat_..."
                isExpiredTrial={isExpiredTrial}
                planTier={subInfo?.plan ?? null}
                selectedProviders={selectedProviders}
                onSelected={(p) => setSelectedProviders([p])}
                onLockedClick={() => router.push("/#pricing")}
                extraField={{
                  key: "shop_domain",
                  label: language === "UA" ? "Домен магазину (yourshop.myshopify.com)" : language === "DE" ? "Shop-Domain (yourshop.myshopify.com)" : "Shop domain (yourshop.myshopify.com)",
                  placeholder: "yourshop.myshopify.com",
                }}
                hint={
                  language === "UA"
                    ? "Shopify Admin → Settings → Apps and sales channels → Develop apps → створіть Admin API access token."
                    : language === "DE"
                    ? "Shopify Admin → Settings → Apps and sales channels → Develop apps → Admin API access token erstellen."
                    : "Shopify Admin → Settings → Apps and sales channels → Develop apps → create an Admin API access token."
                }
              />
              <IntegrationConnectCard
                email={profileEmail}
                provider="meta_ads"
                displayName="Meta Ads"
                placeholder="EAAG..."
                isExpiredTrial={isExpiredTrial}
                planTier={subInfo?.plan ?? null}
                selectedProviders={selectedProviders}
                onSelected={(p) => setSelectedProviders([p])}
                onLockedClick={() => router.push("/#pricing")}
                extraField={{
                  key: "ad_account_id",
                  label: language === "UA" ? "Ad Account ID (без 'act_')" : language === "DE" ? "Ad Account ID (ohne 'act_')" : "Ad Account ID (without 'act_')",
                  placeholder: "123456789012345",
                }}
                hint={
                  language === "UA"
                    ? "Meta Business Suite → System Users → створіть токен з доступом ads_read."
                    : language === "DE"
                    ? "Meta Business Suite → System Users → Token mit ads_read-Zugriff erstellen."
                    : "Meta Business Suite → System Users → create a token with ads_read access."
                }
              />
              <IntegrationConnectCard
                email={profileEmail}
                provider="google_ads"
                displayName="Google Ads"
                placeholder="refresh token..."
                isExpiredTrial={isExpiredTrial}
                planTier={subInfo?.plan ?? null}
                selectedProviders={selectedProviders}
                onSelected={(p) => setSelectedProviders([p])}
                onLockedClick={() => router.push("/#pricing")}
                extraFields={[
                  {
                    key: "customer_id",
                    label: language === "UA" ? "Customer ID (без дефісів)" : language === "DE" ? "Customer ID (ohne Bindestriche)" : "Customer ID (without dashes)",
                    placeholder: "1234567890",
                  },
                  {
                    key: "client_id",
                    label: language === "UA" ? "OAuth Client ID (Google Cloud Console)" : language === "DE" ? "OAuth-Client-ID (Google Cloud Console)" : "OAuth Client ID (Google Cloud Console)",
                    placeholder: "xxxxxxxxxxxx.apps.googleusercontent.com",
                  },
                  {
                    key: "client_secret",
                    label: language === "UA" ? "OAuth Client Secret" : language === "DE" ? "OAuth Client Secret" : "OAuth Client Secret",
                    placeholder: "GOCSPX-...",
                  },
                  {
                    key: "developer_token",
                    label: language === "UA" ? "Developer Token (Google Ads API Center)" : language === "DE" ? "Developer Token (Google Ads API Center)" : "Developer Token (Google Ads API Center)",
                    placeholder: "ABcdeFGH93KL-NOPQ_STUv",
                  },
                ]}
                hint={
                  language === "UA"
                    ? "Google Ads → Tools → API Center: створіть Developer Token. Google Cloud Console → OAuth Client ID (тип Desktop). Google OAuth Playground → свій Client ID/Secret у Settings → авторизуйтесь зі scope 'https://www.googleapis.com/auth/adwords' → отримайте refresh token."
                    : language === "DE"
                    ? "Google Ads → Tools → API Center: Developer Token erstellen. Google Cloud Console → OAuth Client ID (Typ Desktop). Google OAuth Playground → eigene Client ID/Secret in Settings → mit Scope 'https://www.googleapis.com/auth/adwords' autorisieren → Refresh Token abrufen."
                    : "Google Ads → Tools → API Center: create a Developer Token. Google Cloud Console → create an OAuth Client ID (Desktop type). Google OAuth Playground → enter your own Client ID/Secret in Settings → authorize with scope 'https://www.googleapis.com/auth/adwords' → get the refresh token."
                }
              />

              <div className="bg-gray-900/20 rounded-xl p-4 border border-gray-800 opacity-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center">
                      <Link2 className="w-5 h-5 text-gray-400" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">Google Analytics, QuickBooks</h4>
                      <p className="text-xs text-gray-500">Coming soon</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeView === "settings" && (
            <div className="space-y-6">
             <div className="bg-card rounded-xl p-6 border border-border">
  <div className="flex flex-wrap items-center gap-4">
    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden shrink-0">
      {profilePhotoUrl ? (
        <img src={profilePhotoUrl} alt="avatar" className="w-full h-full object-cover" />
      ) : (
        <User className="w-8 h-8 text-primary" />
      )}
    </div>
    <div className="min-w-0">
      <h3 className="text-xl font-bold text-foreground truncate">{profileName}</h3>
      <p className="text-sm text-muted-foreground truncate">{profileEmail}</p>
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">{getPlanLabel(subInfo?.plan)}</span>
        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Active</span>
      </div>
    </div>
    <Button variant="outline" size="sm" className="w-full sm:w-auto sm:ml-auto" onClick={openEditProfile}>{T.editProfile || "Edit Profile"}</Button>
  </div>
</div>

              <div className="bg-card rounded-xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Building className="w-4 h-4 text-primary" /> {T.settingsAccountInfo || "Account Information"}
                </h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">{T.settingsCompanyName || "Company Name"}</label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        value={businessName}
                        onChange={(e) => { setBusinessName(e.target.value); setCompanyDirty(true); }}
                        onBlur={saveBusinessProfile}
                        className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      {companyDirty && (
                        <button
                          type="button"
                          onClick={saveBusinessProfile}
                          title={language === "UA" ? "Зберегти" : language === "DE" ? "Speichern" : "Save"}
                          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-primary/20 hover:bg-primary/30 text-primary transition-colors"
                        >
                          <CheckCircle className="w-5 h-5" />
                        </button>
                      )}
                      {companySaved && !companyDirty && (
                        <CheckCircle className="w-5 h-5 text-green-400 shrink-0 animate-pulse" />
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">{T.settingsBusinessId || "Business ID"}</label>
                    <p className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-foreground text-sm cursor-not-allowed">{businessId || "—"}</p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">{T.settingsPhone || "Phone"}</label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        value={profilePhone}
                        onChange={(e) => { setProfilePhone(e.target.value); setEditPhone(e.target.value); setPhoneDirty(true); }}
                        onBlur={savePhone}
                        className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      {phoneDirty && (
                        <button
                          type="button"
                          onClick={savePhone}
                          title={language === "UA" ? "Зберегти" : language === "DE" ? "Speichern" : "Save"}
                          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-primary/20 hover:bg-primary/30 text-primary transition-colors"
                        >
                          <CheckCircle className="w-5 h-5" />
                        </button>
                      )}
                      {phoneSaved && !phoneDirty && (
                        <CheckCircle className="w-5 h-5 text-green-400 shrink-0 animate-pulse" />
                      )}
                    </div>
                  </div>
                 <div>
  <label className="text-xs text-muted-foreground uppercase tracking-wider">{T.settingsTimezone || "Timezone"}</label>
  <select
    value={timezone}
    onChange={(e) => { setTimezoneState(e.target.value); saveBusinessProfileWithTimezone(e.target.value); }}
    className="mt-1 w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
  >
    {Object.entries(groupedTimezones).map(([region, zones]) => (
      <optgroup key={region} label={region}>
        {zones.map((tz) => (
          <option key={tz} value={tz}>
            {formatTimezoneLabel(tz)}
          </option>
        ))}
      </optgroup>
    ))}
  </select>
</div>
                </div>
              </div>

              <div className="bg-card rounded-xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <BellRing className="w-4 h-4 text-primary" /> {T.settingsNotifications || "Notification Preferences"}
                </h3>
                <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 py-2">
                    <div className="flex-1 min-w-0"><p className="font-medium text-foreground">{T.settingsPush || "Push Notifications"}</p><p className="text-xs text-muted-foreground">{T.settingsPushDesc || "Receive alerts in dashboard"}</p></div>
                    <div className="shrink-0 bg-secondary/40 rounded-full p-1">
                      <Switch checked={notificationsEnabled} onCheckedChange={(val) => {
                        setNotificationsEnabled(val);
                        fetch("/api/notification-prefs", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ email: profileEmail, push_enabled: val }),
                        });
                      }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <div className="flex-1 min-w-0"><p className="font-medium text-foreground">{T.settingsEmail || "Email Alerts"}</p><p className="text-xs text-muted-foreground">{T.settingsEmailDesc || "Receive alerts via email"}</p></div>
                    <div className="shrink-0 bg-secondary/40 rounded-full p-1">
                      <Switch checked={emailAlerts} onCheckedChange={(val) => {
                        setEmailAlerts(val);
                        fetch("/api/notification-prefs", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ email: profileEmail, email_enabled: val }),
                        });
                      }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <div className="flex-1 min-w-0"><p className="font-medium text-foreground">{T.settingsTelegram || "Telegram Notifications"}</p><p className="text-xs text-muted-foreground">{T.settingsTelegramDesc || "Connect Telegram for instant alerts"}</p></div>
                    {hasGrowthAccess ? (
  telegramConnected ? (
    <Button variant="outline" size="sm" className="shrink-0" onClick={handleDisconnectTelegram}>
      {language === "UA" ? "Відключити" : language === "DE" ? "Trennen" : "Disconnect"}
    </Button>
  ) : (
    <Button variant="outline" size="sm" className="shrink-0" onClick={handleConnectTelegram}>{T.settingsConnect || "Connect"}</Button>
  )
) : (

  <Button variant="outline" size="sm" className="shrink-0" onClick={() => router.push("/#pricing")}>
    {language === "UA" ? "Оновити" : language === "DE" ? "Upgrade" : "Upgrade"}
  </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-card rounded-xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" /> {T.settingsSecurity || "Security"}
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 py-2">
                    <div className="flex-1 min-w-0"><p className="font-medium text-foreground">{T.settings2FA || "Two-Factor Authentication"}</p><p className="text-xs text-muted-foreground">{T.settings2FADesc || "Add an extra layer of security"}</p></div>
                    <div className="shrink-0 bg-secondary/40 rounded-full p-1">
                      <Switch
                        checked={twoFactorEnabled}
                        onCheckedChange={(val) => { val ? startEnroll2FA() : disable2FA(); }}
                      />
                    </div>
                  </div>
                <div className="flex items-center justify-between gap-3 py-2">
                    <div className="flex-1 min-w-0"><p className="font-medium text-foreground">{T.settingsChangePassword || "Change Password"}</p><p className="text-xs text-muted-foreground">{T.settingsChangePasswordDesc || "Update your password"}</p></div>
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => setShowPasswordModal(true)}>{T.settingsUpdate || "Update"}</Button>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <div className="flex-1 min-w-0"><p className="font-medium text-foreground">{T.settingsApiKeys || "API Keys"}</p><p className="text-xs text-muted-foreground">{T.settingsApiKeysDesc || "Manage API access tokens"}</p></div>
                    <Button variant="outline" size="sm" className="shrink-0" disabled>
  {language === "UA" ? "Скоро" : language === "DE" ? "Bald" : "Coming soon"}
</Button>
                  </div>
                </div>
              </div>

              <div className="bg-card rounded-xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Settings className="w-4 h-4 text-primary" /> {T.settingsPreferences || "Preferences"}
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between py-2">
                    <div><p className="font-medium text-foreground">{T.language || "Language"}</p><p className="text-xs text-muted-foreground">{T.settingsSelectLanguage || "Select your preferred language"}</p></div>
                    <div className="flex gap-1">
                      {(["EN", "UA", "DE"] as Language[]).map((lang) => (
                        <button key={lang} onClick={() => changeLanguage(lang)} className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${language === lang ? "bg-primary text-white" : "bg-secondary text-foreground hover:bg-secondary/80"}`}>{lang}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

<div className="bg-card rounded-xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4">
                  {language === "UA" ? "Залишити відгук" : language === "DE" ? "Bewertung abgeben" : "Leave a Review"}
                </h3>
                <div className="flex gap-1 mb-3">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => setReviewRating(n)} className="text-2xl">
                      {n <= reviewRating ? "★" : "☆"}
                    </button>
                  ))}
                </div>
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder={
                    language === "UA"
                      ? "Поділіться своїм досвідом використання RIVANT..."
                      : language === "DE"
                      ? "Teilen Sie Ihre Erfahrung mit RIVANT..."
                      : "Share your experience with RIVANT..."
                  }
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm min-h-[80px]"
                />
                {reviewMsg && (
                  <p className="text-sm text-primary mt-2">
                    {reviewMsg === "success"
                      ? (language === "UA" ? "Дякуємо! Ваш відгук очікує на модерацію." : language === "DE" ? "Danke! Ihre Bewertung wird geprüft." : "Thanks! Your review is pending approval.")
                      : (language === "UA" ? "Щось пішло не так, спробуйте ще раз." : language === "DE" ? "Etwas ist schiefgelaufen, versuchen Sie es erneut." : "Something went wrong, try again.")}
                  </p>
                )}
                <Button className="mt-3" onClick={submitReview} disabled={!reviewComment.trim()}>
                  {language === "UA" ? "Надіслати відгук" : language === "DE" ? "Bewertung senden" : "Submit Review"}
                </Button>
              </div>

<div className="bg-card rounded-xl p-6 border border-border">
  <h3 className="font-semibold text-foreground mb-4">
    {language === "UA" ? "Повідомити про проблему" : language === "DE" ? "Problem melden" : "Report an issue"}
  </h3>
  <div className="flex gap-2 mb-3">
    <button
      onClick={() => setFeedbackType("bug")}
      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
        feedbackType === "bug" ? "bg-red-500/20 text-red-400" : "bg-secondary text-muted-foreground hover:bg-secondary/80"
      }`}
    >
      {language === "UA" ? "Проблема" : language === "DE" ? "Fehler" : "Bug"}
    </button>
    <button
      onClick={() => setFeedbackType("feature")}
      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
        feedbackType === "feature" ? "bg-blue-500/20 text-blue-400" : "bg-secondary text-muted-foreground hover:bg-secondary/80"
      }`}
    >
      {language === "UA" ? "Пропозиція функції" : language === "DE" ? "Funktionsvorschlag" : "Feature request"}
    </button>
  </div>
  <textarea
    value={feedbackMessage}
    onChange={(e) => setFeedbackMessage(e.target.value)}
    placeholder={
      language === "UA"
        ? "Опишіть проблему або ідею..."
        : language === "DE"
        ? "Beschreiben Sie das Problem oder die Idee..."
        : "Describe the issue or idea..."
    }
    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm min-h-[80px]"
  />
  {feedbackMsg && (
    <p className="text-sm text-primary mt-2">
      {feedbackMsg === "success"
        ? (language === "UA" ? "Дякуємо! Ми розглянемо це найближчим часом." : language === "DE" ? "Danke! Wir prüfen das zeitnah." : "Thanks! We'll look into it soon.")
        : (language === "UA" ? "Щось пішло не так, спробуйте ще раз." : language === "DE" ? "Etwas ist schiefgelaufen, versuchen Sie es erneut." : "Something went wrong, try again.")}
    </p>
  )}
  <Button className="mt-3" onClick={submitFeedback} disabled={!feedbackMessage.trim()}>
    {language === "UA" ? "Надіслати" : language === "DE" ? "Senden" : "Submit"}
  </Button>
</div>

              <div className="bg-card rounded-xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-primary" /> {T.settingsDangerZone || "Danger Zone"}
                </h3>
               <div className="space-y-3">
 <div className="flex items-center justify-between gap-3">
  <div className="min-w-0">
    <p className="font-medium text-foreground">
      {language === "UA" ? "Видалити акаунт" : language === "DE" ? "Konto löschen" : "Delete account"}
    </p>
    <p className="text-xs text-muted-foreground">{T.settingsDeleteAccountDesc || "Permanently delete your account and all data"}</p>
  </div>
  <Button variant="destructive" size="sm" className="shrink-0" onClick={() => setShowDeleteAccountModal(true)}>
    {language === "UA" ? "Видалити" : language === "DE" ? "Löschen" : "Delete"}
  </Button>
</div>
                  <div ref={exportMenuRef} className="flex items-center justify-between pt-2 border-t border-border relative">
                    <div><p className="font-medium text-foreground">{T.settingsExportData || "Export All Data"}</p><p className="text-xs text-muted-foreground">{T.settingsExportDataDesc || "Download all your business data"}</p></div>
                    <Button variant="outline" size="sm" onClick={() => setExportMenuOpen((v) => !v)} disabled={exportingFormat}>
                      {exportingFormat ? (language === "UA" ? "Експорт..." : language === "DE" ? "Exportiere..." : "Exporting...") : (T.settingsExport || "Export")}
                    </Button>
                    {exportMenuOpen && (
                      <div className="absolute right-0 bottom-full mb-1 z-10 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden min-w-[140px]">
                        <button onClick={() => handleExportFormat("json")} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors">JSON</button>
                        <button onClick={() => handleExportFormat("xlsx")} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors">Excel (.xlsx)</button>
                        <button onClick={() => handleExportFormat("pdf")} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors">PDF (.pdf)</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-background/95 backdrop-blur-xl border-t border-border px-2 py-2">
        <div className="flex items-center justify-around">
          {sidebarItems.map((item) => (
            <button key={item.label} onClick={() => setActiveView(item.view)} className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors min-w-[64px] ${activeView === item.view ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{getTranslation(item.translationKey, item.label)}</span>
            </button>
          ))}
        </div>
      </nav>

      <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />

      {showLogoutModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-[90vw] max-w-[320px] shadow-2xl">
            <h2 className="text-lg font-semibold text-white mb-2">
              {language === "UA" ? "Вийти з системи?" : language === "DE" ? "Abmelden?" : "Sign out?"}
            </h2>
            <p className="text-sm text-gray-400 mb-6">
              {language === "UA" ? "Ви впевнені, що хочете вийти?" : language === "DE" ? "Sind Sie sicher, dass Sie sich abmelden möchten?" : "Are you sure you want to sign out?"}
            </p>
            <div className="flex gap-3">
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={confirmLogout}>
                {language === "UA" ? "Так" : language === "DE" ? "Ja" : "Yes"}
              </Button>
              <Button variant="outline" className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800" onClick={() => setShowLogoutModal(false)}>
                {language === "UA" ? "Скасувати" : language === "DE" ? "Abbrechen" : "Cancel"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAccountModal && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
    <div className="bg-gray-900 border border-red-500/30 rounded-2xl p-6 w-full max-w-[400px] shadow-2xl">
      <h2 className="text-lg font-semibold text-white mb-2">
        {language === "UA" ? "Видалити акаунт?" : language === "DE" ? "Konto löschen?" : "Delete account?"}
      </h2>
      <p className="text-sm text-gray-400 mb-6">
        {language === "UA"
          ? "Ви впевнені, що хочете видалити акаунт? Усі ваші дані буде втрачено назавжди."
          : language === "DE"
          ? "Sind Sie sicher, dass Sie Ihr Konto löschen möchten? Alle Ihre Daten gehen dauerhaft verloren."
          : "Are you sure you want to delete your account? All your data will be lost permanently."}
      </p>
      {deleteError && <p className="text-sm text-red-400 mb-3">{deleteError}</p>}
      <div className="flex gap-3">
        <Button
          variant="destructive"
          className="flex-1"
          disabled={deleting}
          onClick={confirmDeleteAccount}
        >
          {deleting
            ? "..."
            : language === "UA" ? "Так, видалити" : language === "DE" ? "Ja, löschen" : "Yes, delete"}
        </Button>
        <Button
          variant="outline"
          className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800"
          onClick={() => { setShowDeleteAccountModal(false); setDeleteError(""); }}
        >
          {language === "UA" ? "Скасувати" : language === "DE" ? "Abbrechen" : "Cancel"}
        </Button>
      </div>
    </div>
  </div>
)}

      {showPasswordModal && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-[380px] shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">
          {language === "UA" ? "Змінити пароль" : language === "DE" ? "Passwort ändern" : "Change Password"}
        </h2>
        <button onClick={() => { setShowPasswordModal(false); setPasswordMsg(""); setNewPassword(""); }} className="text-gray-500 hover:text-gray-300 p-2 -m-2">
          <X className="w-5 h-5" />
        </button>
      </div>
      <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">
        {language === "UA" ? "Новий пароль" : language === "DE" ? "Neues Passwort" : "New password"}
      </label>
      <input
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        minLength={6}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
        placeholder="••••••••"
      />
      {passwordMsg && (
        <p className={`text-sm mt-2 ${passwordMsg.includes("success") || passwordMsg.includes("успіш") || passwordMsg.includes("erfolgreich") ? "text-green-400" : "text-red-400"}`}>
          {passwordMsg}
        </p>
      )}
      <Button
        className="w-full mt-4 bg-blue-600 hover:bg-blue-700"
        disabled={passwordLoading}
        onClick={handleChangePassword}
      >
        {passwordLoading ? "..." : (language === "UA" ? "Оновити пароль" : language === "DE" ? "Passwort aktualisieren" : "Update Password")}
      </Button>
    </div>
  </div>
)}

      {show2FAModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-[380px] shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                {language === "UA" ? "Увімкнути двофакторну автентифікацію" : language === "DE" ? "Zwei-Faktor-Authentifizierung aktivieren" : "Enable Two-Factor Auth"}
              </h2>
              <button onClick={() => { setShow2FAModal(false); setMfaCode(""); setMfaMsg(""); }} className="text-gray-500 hover:text-gray-300 p-2 -m-2">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-400 mb-3">
              {language === "UA"
                ? "Відскануйте цей QR-код у Google Authenticator або Authy:"
                : language === "DE"
                ? "Scannen Sie diesen QR-Code mit Google Authenticator oder Authy:"
                : "Scan this QR code with Google Authenticator or Authy:"}
            </p>
          {mfaQrCode && (
              <div className="bg-white rounded-lg p-3 mb-4 mx-auto w-[220px] h-[220px] flex items-center justify-center">
                <img src={mfaQrCode} alt="2FA QR code" className="w-full h-full" />
              </div>
            )}
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">
              {language === "UA" ? "Введіть 6-значний код" : language === "DE" ? "6-stelligen Code eingeben" : "Enter 6-digit code"}
            </label>
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              maxLength={6}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 tracking-widest text-center"
              placeholder="000000"
            />
            {mfaMsg && (
              <p className={`text-sm mt-2 ${mfaMsg.includes("enabled") ? "text-green-400" : "text-red-400"}`}>{mfaMsg}</p>
            )}
            <Button className="w-full mt-4 bg-blue-600 hover:bg-blue-700" disabled={mfaLoading} onClick={confirmEnroll2FA}>
              {mfaLoading ? "..." : language === "UA" ? "Підтвердити" : language === "DE" ? "Bestätigen" : "Confirm"}
            </Button>
          </div>
        </div>
      )}

      {showEditProfileModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-[400px] shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">
                {language === "UA" ? "Редагувати профіль" : language === "DE" ? "Profil bearbeiten" : "Edit Profile"}
              </h2>
              <button onClick={() => setShowEditProfileModal(false)} className="text-gray-500 hover:text-gray-300 transition-colors p-2 -m-2">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col items-center mb-5">
              <div
                className="w-20 h-20 rounded-full bg-blue-500/20 flex items-center justify-center overflow-hidden cursor-pointer ring-2 ring-transparent hover:ring-blue-500 transition-all"
                onClick={() => photoInputRef.current?.click()}
              >
                {editPhotoUrl ? (
                  <img src={editPhotoUrl} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-bold text-blue-400">{editName.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?"}</span>
                )}
              </div>
              <button
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-2"
                onClick={() => photoInputRef.current?.click()}
              >
                {language === "UA" ? "Змінити фото" : language === "DE" ? "Foto ändern" : "Change photo"}
              </button>
              {editPhotoUrl && (
                <button
                  className="text-xs text-gray-500 hover:text-red-400 transition-colors mt-1"
                  onClick={() => setEditPhotoUrl(null)}
                >
                  {language === "UA" ? "Видалити фото" : language === "DE" ? "Foto entfernen" : "Remove photo"}
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">
                  {language === "UA" ? "Ім'я" : language === "DE" ? "Name" : "Name"}
                </label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">
                  {language === "UA" ? "Електронна пошта" : language === "DE" ? "E-Mail" : "Email"}
                </label>
                <input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">
                  {language === "UA" ? "Телефон" : language === "DE" ? "Telefon" : "Phone"}
                </label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={saveProfile}>
                {language === "UA" ? "Зберегти" : language === "DE" ? "Speichern" : "Save"}
              </Button>
              <Button variant="outline" className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800" onClick={() => setShowEditProfileModal(false)}>
                {language === "UA" ? "Скасувати" : language === "DE" ? "Abbrechen" : "Cancel"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}