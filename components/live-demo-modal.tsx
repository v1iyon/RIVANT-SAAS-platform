"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/translations";
import { useCurrency, formatLocaleCurrency, type Currency } from "@/lib/currency";
import { getSeverityLabel, getSeverityColorClasses } from "@/lib/severity";
import { 
  LayoutDashboard, AlertTriangle, TrendingUp, Link2, 
  Bell, X, AlertCircle, ArrowUpRight, ArrowDownRight, Trash2,
  TrendingDown, DollarSign, BarChart3, Zap, Package, CreditCard, Truck, Users, Activity,
  CheckCircle, Wifi, WifiOff, Settings, Link, ChevronLeft, ChevronRight, Filter, Receipt, Sparkles
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
  { id: "klaviyo", name: "Klaviyo", icon: "✉️", status: "setup_required", lastSync: "Not connected", lastSyncTime: new Date(0) },
];

// Категорії для фільтра-воронки на вкладці "Ризики" — той самий принцип, що
// й у реальному кабінеті (RISK_CATEGORIES в app/dashboard/page.tsx), тільки
// без localStorage: демо-фільтр скидається при закритті модалки.
const RISK_CATEGORIES: { id: Risk["category"]; label: Record<string, string> }[] = [
  { id: "finance", label: { UA: "Виручка", EN: "Revenue", DE: "Umsatz" } },
  { id: "margin", label: { UA: "Маржа", EN: "Margin", DE: "Marge" } },
  { id: "ads", label: { UA: "Реклама", EN: "Ads", DE: "Werbung" } },
  { id: "cac", label: { UA: "CAC", EN: "CAC", DE: "CAC" } },
  { id: "conversion", label: { UA: "Конверсія", EN: "Conversion", DE: "Konversion" } },
  { id: "inventory", label: { UA: "Товар", EN: "Product", DE: "Produkt" } },
  { id: "shipping", label: { UA: "Доставка", EN: "Shipping", DE: "Versand" } },
  { id: "integration", label: { UA: "Синхронізація", EN: "Sync", DE: "Sync" } },
];

// Каталог карток дашборда — той самий принцип, що й WIDGET_CATALOG_IDS у
// реальному кабінеті (app/dashboard/page.tsx): 7 доступних метрик, з яких
// одночасно активні максимум 4, вибір робиться через "шестерню" над картками.
const WIDGET_CATALOG_IDS = ["revenue", "profit", "margin", "cac", "orders", "aov", "expenses"] as const;
type WidgetId = (typeof WIDGET_CATALOG_IDS)[number];
const DEFAULT_WIDGET_IDS: WidgetId[] = ["revenue", "profit", "margin", "cac"];

const WIDGET_ICONS: Record<WidgetId, React.ComponentType<{ className?: string }>> = {
  revenue: DollarSign,
  profit: TrendingUp,
  margin: Activity,
  cac: Users,
  orders: Package,
  aov: CreditCard,
  expenses: Receipt,
};

const METRIC_CARD_THEMES: Record<string, { from: string; border: string; text: string; ticker: string }> = {
  "bg-blue-500": { from: "from-blue-500/10", border: "border-blue-500/20", text: "text-blue-400", ticker: "bg-blue-500/60" },
  "bg-green-500": { from: "from-green-500/10", border: "border-green-500/20", text: "text-green-400", ticker: "bg-green-500/60" },
  "bg-purple-500": { from: "from-purple-500/10", border: "border-purple-500/20", text: "text-purple-400", ticker: "bg-purple-500/60" },
  "bg-cyan-500": { from: "from-cyan-500/10", border: "border-cyan-500/20", text: "text-cyan-400", ticker: "bg-cyan-500/60" },
  "bg-pink-500": { from: "from-pink-500/10", border: "border-pink-500/20", text: "text-pink-400", ticker: "bg-pink-500/60" },
  "bg-red-500": { from: "from-red-500/10", border: "border-red-500/20", text: "text-red-400", ticker: "bg-red-500/60" },
};

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
  currentCacMeta: number; prevCacMeta: number;
  currentCacGoogle: number; prevCacGoogle: number;
  revenueQueue: number[]; profitQueue: number[]; marginQueue: number[]; cacQueue: number[];
  cacMetaQueue: number[]; cacGoogleQueue: number[];
}

// Гарантирует, что последние два значения в очереди графика совпадают
// с currentValue/prevValue — иначе столбик может визуально "расти",
// а процент рядом при этом показывать минус (и наоборот).
function seedQueue(current: number, prev: number, volatility: number, trend: number): number[] {
  const q = generateTickerData(current, volatility, trend);
  q[q.length - 2] = prev;
  q[q.length - 1] = current;
  return q;
}

const SEED_PREV_REVENUE = BASE_REVENUE * 0.997;
const SEED_PREV_PROFIT = BASE_PROFIT * 1.004;
const SEED_PREV_MARGIN = BASE_MARGIN * 1.006;
const SEED_PREV_CAC = BASE_CAC * 0.992;
// Meta/Google CAC — отдельные демо-серии вокруг общего CAC (Meta обычно
// немного дешевле привлечения, Google — немного дороже), нужны только для
// свайп-карточки CAC в живом демо, как в реальном личном кабинете.
const BASE_CAC_META = BASE_CAC * 0.87;
const BASE_CAC_GOOGLE = BASE_CAC * 1.18;
const SEED_PREV_CAC_META = BASE_CAC_META * 0.99;
const SEED_PREV_CAC_GOOGLE = BASE_CAC_GOOGLE * 1.01;

let metricsState: MetricsState = {
  currentRevenue: BASE_REVENUE, prevRevenue: SEED_PREV_REVENUE,
  currentProfit: BASE_PROFIT, prevProfit: SEED_PREV_PROFIT,
  currentMargin: BASE_MARGIN, prevMargin: SEED_PREV_MARGIN,
  currentCac: BASE_CAC, prevCac: SEED_PREV_CAC,
  currentCacMeta: BASE_CAC_META, prevCacMeta: SEED_PREV_CAC_META,
  currentCacGoogle: BASE_CAC_GOOGLE, prevCacGoogle: SEED_PREV_CAC_GOOGLE,
  revenueQueue: seedQueue(BASE_REVENUE, SEED_PREV_REVENUE, 400, 0.0003),
  profitQueue: seedQueue(BASE_PROFIT, SEED_PREV_PROFIT, 300, 0.0002),
  marginQueue: seedQueue(BASE_MARGIN, SEED_PREV_MARGIN, 0.4, 0.0001),
  cacQueue: seedQueue(BASE_CAC, SEED_PREV_CAC, 1.2, -0.0001),
  cacMetaQueue: seedQueue(BASE_CAC_META, SEED_PREV_CAC_META, 1.1, -0.0001),
  cacGoogleQueue: seedQueue(BASE_CAC_GOOGLE, SEED_PREV_CAC_GOOGLE, 1.4, 0.0001),
};

const metricsListeners = new Set<() => void>();
const METRICS_TICK_MS = 45000; // в реальности данные обновляются раз в час — в демо держим
// заметно более редкий тик (45с), чтобы не создавать иллюзию обновления "каждую секунду",
// но метрики всё ещё ощущались живыми внутри короткой демо-сессии

function tickMetrics() {
  const revenueChange = 1 + (Math.random() - 0.48) * 0.006;
  const profitChange = 1 + (Math.random() - 0.45) * 0.008;
  const cacChange = 1 + (Math.random() - 0.52) * 0.007;
  const cacMetaChange = 1 + (Math.random() - 0.5) * 0.008;
  const cacGoogleChange = 1 + (Math.random() - 0.5) * 0.009;

  const newRevenue = Math.max(115000, Math.min(145000, metricsState.currentRevenue * revenueChange));
  const newProfit = Math.max(31000, Math.min(42000, metricsState.currentProfit * profitChange));
  const newMargin = (newProfit / newRevenue) * 100;
  const newCac = Math.max(43, Math.min(52, metricsState.currentCac * cacChange));
  const newCacMeta = Math.max(35, Math.min(46, metricsState.currentCacMeta * cacMetaChange));
  const newCacGoogle = Math.max(50, Math.min(64, metricsState.currentCacGoogle * cacGoogleChange));

  metricsState = {
    currentRevenue: newRevenue, prevRevenue: metricsState.currentRevenue,
    currentProfit: newProfit, prevProfit: metricsState.currentProfit,
    currentMargin: newMargin, prevMargin: metricsState.currentMargin,
    currentCac: newCac, prevCac: metricsState.currentCac,
    currentCacMeta: newCacMeta, prevCacMeta: metricsState.currentCacMeta,
    currentCacGoogle: newCacGoogle, prevCacGoogle: metricsState.currentCacGoogle,
    revenueQueue: [...metricsState.revenueQueue.slice(1), newRevenue],
    profitQueue: [...metricsState.profitQueue.slice(1), newProfit],
    marginQueue: [...metricsState.marginQueue.slice(1), newMargin],
    cacQueue: [...metricsState.cacQueue.slice(1), newCac],
    cacMetaQueue: [...metricsState.cacMetaQueue.slice(1), newCacMeta],
    cacGoogleQueue: [...metricsState.cacGoogleQueue.slice(1), newCacGoogle],
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
              className={`flex-1 rounded-sm origin-bottom transition-all duration-200 min-w-[6px] ${
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

// ========== ЗАГАЛЬНА КАРТКА МЕТРИКИ (Revenue/Profit/Margin/Orders/AOV/Expenses) ==========
// Той самий принцип, що й MetricCard у app/dashboard/page.tsx: одна картка на
// колір/тему, використовується для будь-якої метрики з каталогу карток.
function DemoMetricCard({ title, value, change, color, prefix = "", suffix = "", sparklineData, prevValue }: {
  title: string; value: number; change: number; color: string; prefix?: string; suffix?: string;
  sparklineData: number[]; prevValue: number;
}) {
  const theme = METRIC_CARD_THEMES[color] || METRIC_CARD_THEMES["bg-blue-500"];
  return (
    <div className={`bg-gradient-to-br ${theme.from} to-transparent rounded-xl p-4 border ${theme.border}`}>
      <div className={`text-xs font-semibold mb-1 uppercase ${theme.text}`}>{title}</div>
      <AnimatedNumber value={value} prefix={prefix} suffix={suffix} changePercent={change} />
      <TickerSparkline history={sparklineData} color={theme.ticker} currentValue={value} previousValue={prevValue} />
    </div>
  );
}

// ========== ПАНЕЛЬ НАЛАШТУВАННЯ КАРТОК ("ШЕСТЕРНЯ") ==========
// Той самий функціонал, що й WidgetPrefsPanel у реальному кабінеті: обираєш
// рівно 4 картки з 7 доступних метрик, тиснеш "Готово" — Overview
// перемальовується з новим набором. У демо нічого нікуди не зберігається
// (немає бекенду), вибір живе лише в стейті модалки на час сесії.
function DemoWidgetPrefsPanel({
  open, onClose, activeIds, catalog, onApply, labels,
}: {
  open: boolean;
  onClose: () => void;
  activeIds: WidgetId[];
  catalog: { id: WidgetId; label: string; icon: React.ComponentType<{ className?: string }> }[];
  onApply: (ids: WidgetId[]) => void;
  labels: { title: string; active: string; available: string; done: string; cancel: string; needMore: (n: number) => string; maxReached: string };
}) {
  const [selected, setSelected] = useState<WidgetId[]>(activeIds);
  useEffect(() => { if (open) setSelected(activeIds); }, [open, activeIds]);
  if (!open) return null;

  const toggle = (id: WidgetId) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 rounded-xl p-6 w-full max-w-md border border-gray-800">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-white">{labels.title}</h3>
          <button onClick={onClose} className="p-2 -m-2 text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{labels.active}</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {catalog.filter((c) => selected.includes(c.id)).map((c) => (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-blue-500/20 text-blue-300 border border-blue-500/30"
            >
              <c.icon className="w-3.5 h-3.5" />
              {c.label}
              <X className="w-3 h-3 ml-1" />
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{labels.available}</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {catalog.filter((c) => !selected.includes(c.id)).map((c) => (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              disabled={selected.length >= 4}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-gray-800/60 text-gray-400 border border-gray-700 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <c.icon className="w-3.5 h-3.5" />
              {c.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-600 mb-4">
          {selected.length < 4 ? labels.needMore(4 - selected.length) : labels.maxReached}
        </p>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button
            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40"
            disabled={selected.length !== 4}
            onClick={() => onApply(selected)}
          >
            {labels.done}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ========== СВАЙП-КАРТОЧКА CAC (Meta Ads / Загальне / Google Ads) ==========
// Тот же компонент, что и в реальном личном кабинете: по центру — общий CAC,
// свайп/стрелки вправо/влево переключают на Google Ads / Meta Ads.
interface CacPanelData {
  label: string;
  value: number;
  change: number;
  prev: number;
  sparklineData: number[];
}

function SwipeableCacCard({ panels, T, language, symbol = "$" }: { panels: CacPanelData[]; T: any; language: string; symbol?: string }) {
  const [index, setIndex] = useState(1);
  const touchStartX = useRef<number | null>(null);

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
  const title = index === 1 ? (T.demoCac || "CAC") : panel.label;

  return (
    <div
      className="bg-gradient-to-br from-orange-500/10 to-transparent rounded-xl p-4 pb-2.5 sm:pb-2 border border-orange-500/20 select-none flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="text-xs text-orange-400 font-semibold uppercase truncate">{title}</div>
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
        <AnimatedNumber value={panel.value} prefix={symbol} changePercent={panel.change} />
      </div>
      <div className="-mt-1">
        <TickerSparkline history={panel.sparklineData} color="bg-orange-500/60" currentValue={panel.value} previousValue={panel.prev} />
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

// Функция перевода риска
function translateRisk(risk: Risk, t: any, currency: Currency = "USD"): Risk {
  const lang = t._lang || "EN";
  const translatedRisk = { ...risk };
  // Хелпер: конвертирует и форматирует сумму под текущую валюту и язык
  // (правильный разделитель разрядов и положение знака валюты).
  const m = (usd: number) => formatLocaleCurrency(usd, currency, lang);
  switch (risk.alertType) {
    // Описания ниже написаны в стиле реального ai_explanation из личного
    // кабинета (что изменилось, конкретные цифры, что проверить) — раньше
    // тут была одна короткая строка без анализа, теперь под уведомлением в
    // демо тоже есть небольшая "расшифровка", как будто её сгенерировал ИИ.
    case "revenue_drop":
      translatedRisk.title = lang === "UA" ? "Падіння виручки" : lang === "DE" ? "Umsatzrückgang" : "Revenue dropping";
      translatedRisk.description = lang === "UA"
        ? `Виручка "My Business" впала на 34% за останню годину (з ${m(3180)} до ${m(2099)}), маржа при цьому майже не змінилась. Перевірте: обсяг замовлень за сьогодні, роботу рекламних кампаній та наявність технічних збоїв на сайті.`
        : lang === "DE"
        ? `Der Umsatz von "My Business" ist in der letzten Stunde um 34 % gesunken (von ${m(3180)} auf ${m(2099)}), die Marge blieb dabei fast unverändert. Prüfen Sie: die Bestellungen von heute, die laufenden Werbekampagnen und mögliche technische Störungen auf der Website.`
        : `"My Business" revenue dropped 34% in the last hour (from ${m(3180)} to ${m(2099)}), while margin stayed roughly flat. Check: today's order volume, active ad campaigns, and any technical issues on the site.`;
      translatedRisk.action = lang === "UA" ? "Детальніше" : lang === "DE" ? "Details ansehen" : "View Details";
      break;
    case "revenue_rise":
      translatedRisk.title = lang === "UA" ? "Сплеск виручки" : lang === "DE" ? "Umsatzanstieg" : "Revenue spike";
      translatedRisk.description = lang === "UA"
        ? `Виручка "My Business" зросла на 28% за останню годину (з ${m(2610)} до ${m(3340)}) — це вище звичайного діапазону коливань. Перевірте: чи не пов'язано зі сплеском реклами або разовим великим замовленням, щоб зрозуміти, чи тренд стійкий.`
        : lang === "DE"
        ? `Der Umsatz von "My Business" stieg in der letzten Stunde um 28 % (von ${m(2610)} auf ${m(3340)}) — über der üblichen Schwankungsbreite. Prüfen Sie, ob dies mit einer Werbekampagne oder einer einzelnen Großbestellung zusammenhängt, um zu sehen, ob der Trend stabil ist.`
        : `"My Business" revenue rose 28% in the last hour (from ${m(2610)} to ${m(3340)}) — above the usual range of fluctuation. Check whether this ties to an ad push or a single large order, to see if the trend is likely to hold.`;
      translatedRisk.action = lang === "UA" ? "Детальніше" : lang === "DE" ? "Details ansehen" : "View Details";
      break;
    case "profit_drop":
      translatedRisk.title = lang === "UA" ? "Маржа прибутку падає" : lang === "DE" ? "Gewinnmarge sinkt" : "Profit margin shrinking";
      translatedRisk.description = lang === "UA"
        ? "Маржа прибутку \"My Business\" опустилася до 19.4%, що нижче цільового рівня ~27%. Виручка при цьому стабільна — падіння викликане ростом витрат. Перевірте: собівартість, витрати на доставку та рекламний бюджет за останню добу."
        : lang === "DE"
        ? "Die Gewinnmarge von \"My Business\" ist auf 19,4 % gefallen, unter dem Zielwert von ~27 %. Der Umsatz ist dabei stabil — der Rückgang liegt an gestiegenen Kosten. Prüfen Sie: Warenkosten, Versandkosten und Werbebudget der letzten 24 Stunden."
        : "\"My Business\" profit margin dropped to 19.4%, below the ~27% target. Revenue held steady — the drop comes from rising costs. Check: cost of goods, shipping costs, and ad spend over the last 24 hours.";
      translatedRisk.action = lang === "UA" ? "Аналізувати" : lang === "DE" ? "Analysieren" : "Analyze";
      break;
    case "profit_rise":
      translatedRisk.title = lang === "UA" ? "Стрибок прибутку" : lang === "DE" ? "Gewinnsprung" : "Profit surge";
      translatedRisk.description = lang === "UA"
        ? "Маржа прибутку \"My Business\" виросла до 35.2% — помітно вище звичайних ~27%. Найімовірніша причина: зниження рекламних витрат при стабільній виручці. Варто зафіксувати, що саме змінилося, щоб повторити результат."
        : lang === "DE"
        ? "Die Gewinnmarge von \"My Business\" stieg auf 35,2 % — deutlich über den üblichen ~27 %. Wahrscheinlichste Ursache: geringere Werbeausgaben bei stabilem Umsatz. Es lohnt sich festzuhalten, was sich geändert hat, um das Ergebnis zu wiederholen."
        : "\"My Business\" profit margin rose to 35.2% — notably above the usual ~27%. Most likely cause: lower ad spend with steady revenue. Worth noting exactly what changed so it can be repeated.";
      translatedRisk.action = lang === "UA" ? "Аналізувати" : lang === "DE" ? "Analysieren" : "Analyze";
      break;
    case "cac_increase":
      translatedRisk.title = lang === "UA" ? "Вартість залучення клієнта зростає" : lang === "DE" ? "Kundenakquisekosten steigen" : "Customer acquisition cost rising";
      translatedRisk.description = lang === "UA"
        ? `CAC зріс з ${m(47)} до ${m(58)} (+23%) за останню добу, головним чином за рахунок Google Ads. Кількість замовлень при цьому не зросла пропорційно. Перевірте: налаштування таргетингу та ставки в активних кампаніях.`
        : lang === "DE"
        ? `Die CAC ist in den letzten 24 Stunden von ${m(47)} auf ${m(58)} (+23 %) gestiegen, vor allem durch Google Ads. Die Bestellzahl ist dabei nicht proportional gewachsen. Prüfen Sie: Targeting-Einstellungen und Gebote in den aktiven Kampagnen.`
        : `CAC rose from ${m(47)} to ${m(58)} (+23%) over the last day, mostly driven by Google Ads. Order volume didn't grow proportionally. Check: targeting settings and bids in the active campaigns.`;
      translatedRisk.action = lang === "UA" ? "Переглянути маркетинг" : lang === "DE" ? "Marketing überprüfen" : "Review Marketing";
      break;
    case "cac_decrease":
      translatedRisk.title = lang === "UA" ? "CAC знижується" : lang === "DE" ? "CAC sinkt" : "CAC decreasing";
      translatedRisk.description = lang === "UA"
        ? `CAC знизився з ${m(52)} до ${m(41)} (-21%) за останню добу при стабільній кількості замовлень — ефективність реклами покращується. Варто перевірити, які кампанії дали цей ефект, щоб перерозподілити бюджет на їхню користь.`
        : lang === "DE"
        ? `Die CAC sank in den letzten 24 Stunden von ${m(52)} auf ${m(41)} (-21 %) bei stabiler Bestellzahl — die Werbeeffizienz verbessert sich. Prüfen Sie, welche Kampagnen dafür verantwortlich sind, um das Budget entsprechend umzuschichten.`
        : `CAC fell from ${m(52)} to ${m(41)} (-21%) over the last day with steady order volume — ad efficiency is improving. Worth checking which campaigns drove this, to shift budget toward them.`;
      translatedRisk.action = lang === "UA" ? "Переглянути маркетинг" : lang === "DE" ? "Marketing überprüfen" : "Review Marketing";
      break;
    case "integration_down":
      translatedRisk.title = lang === "UA" ? "Інтеграцію відключено" : lang === "DE" ? "Integration getrennt" : "Integration disconnected";
      translatedRisk.description = lang === "UA"
        ? `Синхронізацію з ${risk.integrationId || "інтеграцією"} зупинено — токен доступу, ймовірно, прострочився або втратив потрібний дозвіл. Перевірте: статус та термін дії токена, а за потреби переавторизуйте підключення.`
        : lang === "DE"
        ? `Die Synchronisierung mit ${risk.integrationId || "der Integration"} wurde gestoppt — der Zugriffstoken ist wahrscheinlich abgelaufen oder hat die nötige Berechtigung verloren. Prüfen Sie Status und Gültigkeit des Tokens und autorisieren Sie die Verbindung bei Bedarf erneut.`
        : `Sync with ${risk.integrationId || "the integration"} has stopped — the access token likely expired or lost the required permission. Check the token's status and expiry, and re-authorize the connection if needed.`;
      translatedRisk.action = lang === "UA" ? "Перепідключити" : lang === "DE" ? "Erneut verbinden" : "Reconnect";
      break;
    case "low_stock":
      translatedRisk.title = lang === "UA" ? "Низький запас товару" : lang === "DE" ? "Niedriger Lagerbestand" : "Low stock alert";
      translatedRisk.description = lang === "UA"
        ? "У топового SKU #4521 залишилось лише 3 дні запасу при поточному темпі продажів — це один із найбільш продаваних товарів за останні 30 днів. Перевірте: наявний залишок на складі та терміни поставки від постачальника."
        : lang === "DE"
        ? "Der Top-SKU #4521 hat beim aktuellen Verkaufstempo nur noch 3 Tage Bestand — eines der meistverkauften Produkte der letzten 30 Tage. Prüfen Sie: den aktuellen Lagerbestand und die Lieferzeiten des Lieferanten."
        : "Top SKU #4521 has only 3 days of stock left at the current sales pace — one of the best-selling items over the last 30 days. Check: current warehouse stock and supplier lead times.";
      translatedRisk.action = lang === "UA" ? "Замовити зараз" : lang === "DE" ? "Jetzt nachbestellen" : "Reorder Now";
      break;
    case "shipping_delay":
      translatedRisk.title = lang === "UA" ? "Виявлено затримку доставки" : lang === "DE" ? "Lieferverzögerung festgestellt" : "Shipping delay detected";
      translatedRisk.description = lang === "UA"
        ? "Середній час доставки збільшився на 1.4 дні за останній тиждень порівняно з попереднім. Це може вплинути на задоволеність клієнтів і кількість повторних замовлень. Перевірте: статуси активних відправлень і роботу служби доставки."
        : lang === "DE"
        ? "Die durchschnittliche Lieferzeit hat sich in der letzten Woche im Vergleich zur Vorwoche um 1,4 Tage erhöht. Das kann die Kundenzufriedenheit und Wiederholungskäufe beeinträchtigen. Prüfen Sie: Status der aktiven Sendungen und die Leistung des Versanddienstleisters."
        : "Average delivery time increased by 1.4 days over the past week compared to the week before. This can affect customer satisfaction and repeat orders. Check: status of active shipments and carrier performance.";
      translatedRisk.action = lang === "UA" ? "Переглянути замовлення" : lang === "DE" ? "Bestellungen ansehen" : "View Orders";
      break;
    case "conversion_drop":
      translatedRisk.title = lang === "UA" ? "Падіння конверсії" : lang === "DE" ? "Conversion-Rückgang" : "Conversion rate dropping";
      translatedRisk.description = lang === "UA"
        ? "Завершення оформлення замовлення впало на 12% за останні 2 години при стабільному трафіку на сайт. Це вказує на проблему саме у воронці оформлення, а не в притоці відвідувачів. Перевірте: роботу форми оплати та кроки checkout на мобільних пристроях."
        : lang === "DE"
        ? "Der Checkout-Abschluss ist in den letzten 2 Stunden um 12 % gesunken, bei stabilem Website-Traffic. Das deutet auf ein Problem im Checkout-Funnel hin, nicht auf weniger Besucher. Prüfen Sie: die Zahlungsform und den Checkout-Ablauf auf mobilen Geräten."
        : "Checkout completion dropped 12% in the last 2 hours while site traffic stayed steady — pointing to a problem in the checkout funnel itself, not in visitor volume. Check: the payment form and checkout steps on mobile devices.";
      translatedRisk.action = lang === "UA" ? "Перевірити воронку" : lang === "DE" ? "Funnel prüfen" : "Check Funnel";
      break;
    case "ad_spend":
      translatedRisk.title = lang === "UA" ? "Сплеск витрат на рекламу" : lang === "DE" ? "Anstieg der Werbeausgaben" : "Ad spend spike";
      translatedRisk.description = lang === "UA"
        ? "Витрати Meta Ads сьогодні на 23% вищі за денний бюджет, а кількість конверсій зросла непропорційно менше. Перевірте: активні кампанії на предмет дубльованих аудиторій або збоїв у ставках."
        : lang === "DE"
        ? "Die Meta-Ads-Ausgaben liegen heute 23 % über dem Tagesbudget, während die Conversions unverhältnismäßig langsamer gewachsen sind. Prüfen Sie: aktive Kampagnen auf doppelte Zielgruppen oder fehlerhafte Gebote."
        : "Meta Ads spend is 23% above today's daily budget, while conversions grew disproportionately less. Check: active campaigns for overlapping audiences or bidding issues.";
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

// Интервал между уведомлениями — 24-32 секунды (было 15-20: слишком часто
// сыпало риски одно за другим, не давая рассмотреть предыдущее).
const MIN_ALERT_INTERVAL = 24000;
const MAX_ALERT_INTERVAL = 32000;
// Сколько уведомление "висит" в виде тоста, прежде чем исчезнуть
const NOTIFICATION_VISIBLE_MS = 3000;
// Максимум уведомлений, которые храним во вкладке "Риски"
const MAX_RISKS_STORED = 10;

// ТУЛТИП ЧЕРЕЗ ПОРТАЛ (см. подробный комментарий в app/dashboard/page.tsx у
// ChartTooltipPortal — та же причина: overflow-x-auto на контейнере баров
// заставляет браузер обрезать overflow-y, даже если он выставлен в visible,
// поэтому тултип рендерим в document.body с position: fixed, вне контейнера.
function ChartTooltipPortal({ anchor, children }: { anchor: { left: number; top: number } | null; children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready || !anchor || typeof document === "undefined") return null;
  const halfWidth = 115;
  const padding = 8;
  const clampedLeft = Math.min(
    Math.max(anchor.left, halfWidth + padding),
    window.innerWidth - halfWidth - padding
  );
  const clampedTop = Math.max(anchor.top - 8, padding);
  return createPortal(
    <div
      style={{ position: "fixed", left: clampedLeft, top: clampedTop, transform: "translate(-50%, -100%)" }}
      className="z-[200] bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl whitespace-nowrap max-w-[220px] pointer-events-none"
    >
      {children}
    </div>,
    document.body
  );
}

// ГЛАВНЫЙ ГРАФИК
function RevenueExpensesChart() {
  const { t } = useLanguage();
  const { symbol, convert } = useCurrency();
  const T = t as any;
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<{ left: number; top: number } | null>(null);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<"revenue" | "expenses" | "profit">("revenue");
  const history = CHART_DATA;

  const showBarTooltip = (idx: number) => {
    setHoveredBar(idx);
    const el = barRefs.current[idx];
    if (el) {
      const rect = el.getBoundingClientRect();
      setTooltipAnchor({ left: rect.left + rect.width / 2, top: rect.top });
    }
  };
  const hideBarTooltip = () => {
    setHoveredBar(null);
    setTooltipAnchor(null);
  };
  const toggleBarTooltip = (idx: number) => {
    if (hoveredBar === idx) {
      hideBarTooltip();
    } else {
      showBarTooltip(idx);
    }
  };
  useEffect(() => {
    if (hoveredBar === null) return;
    const close = () => hideBarTooltip();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [hoveredBar]);
  
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
  const expenseEfficiency = totalRevenue > 0 ? (totalExpenses / totalRevenue * 100).toFixed(1) : "0.0";
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
              {selectedMetric === "profit" ? (step >= 0 ? "+" : "") : symbol}{(convert(step) / 1000).toFixed(0)}k
            </div>
          ))}
        </div>

        <div className="ml-12 h-64 flex gap-1 overflow-x-auto overflow-y-visible">
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
                className="relative flex-1 h-full flex flex-col justify-end items-center gap-0.5 group cursor-pointer"
                onMouseEnter={() => showBarTooltip(idx)}
                onMouseLeave={hideBarTooltip}
                onClick={() => toggleBarTooltip(idx)}
              >
                {hoveredBar === idx && (
                  <ChartTooltipPortal anchor={tooltipAnchor}>
                    <div className="text-xs font-bold text-white">{T.demoDay || "Day"} {item.day}</div>
                    <div className={`text-sm font-bold mt-1 ${getMetricValue(item) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {selectedMetric === "revenue" && symbol}{Math.round(convert(value)).toLocaleString()}
                      {selectedMetric === "profit" && (value >= 0 ? `+${Math.round(convert(value)).toLocaleString()}` : Math.round(convert(value)).toLocaleString())}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">{T.demoRevenue || "Revenue"}: {symbol}{Math.round(convert(item.revenue)).toLocaleString()}</div>
                    <div className="text-[10px] text-gray-400">{T.demoExpenses || "Expenses"}: {symbol}{Math.round(convert(item.expenses)).toLocaleString()}</div>
                    <div className="text-[10px] text-gray-500 mt-1">{T.demoMargin || "Margin"}: {item.margin}% · {T.demoProfit || "Profit"}: {symbol}{Math.round(convert(item.profit)).toLocaleString()}</div>
                  </ChartTooltipPortal>
                )}
                <div className="w-full mt-auto">
                  {/* Реф — на закрашенном столбике, не на всю h-64 колонку-обёртку.
                      См. подробный комментарий в app/dashboard/page.tsx. */}
                  <div
                    ref={(el) => { barRefs.current[idx] = el; }}
                    className={`w-full ${getBarColor()} rounded-t-sm transition-all duration-150`}
                    style={{ height: `${Math.max(percent, 3)}px`, minHeight: '3px' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-6 pt-4 border-t border-gray-800">
        <div className="bg-blue-500/5 rounded-xl p-2 sm:p-3 border border-blue-500/15 overflow-hidden flex flex-col items-center text-center">
          <div className="flex items-center justify-center gap-1 sm:gap-1.5 mb-1">
            <DollarSign className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-blue-400 flex-shrink-0" />
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider truncate">{T.demoRevenue || "Total Revenue"}</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-white truncate">{symbol}{(convert(totalRevenue) / 1000).toFixed(0)}k</div>
          <div className="text-[9px] sm:text-[10px] text-gray-500 mt-1 truncate">↑ {Math.abs(((history[history.length-1].revenue - history[0].revenue) / history[0].revenue * 100)).toFixed(0)}% {T.demoVsStart || "vs start"}</div>
        </div>
        <div className="bg-rose-500/5 rounded-xl p-2 sm:p-3 border border-rose-500/15 overflow-hidden flex flex-col items-center text-center">
          <div className="flex items-center justify-center gap-1 sm:gap-1.5 mb-1">
            <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-rose-400 flex-shrink-0" />
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider truncate">{T.demoExpenses || "Total Expenses"}</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-white truncate">{symbol}{(convert(totalExpenses) / 1000).toFixed(0)}k</div>
          <div className="text-[9px] sm:text-[10px] text-gray-500 mt-1 truncate">{expenseEfficiency}% {T.demoOfRevenue || "of revenue"}</div>
        </div>
        <div className="bg-green-500/10 rounded-xl p-2 sm:p-3 border border-green-500/20 overflow-hidden flex flex-col items-center text-center">
          <div className="flex items-center justify-center gap-1 sm:gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-400 flex-shrink-0" />
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider truncate">{T.demoProfit || "Net Profit"}</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-green-400 truncate">+{symbol}{(convert(totalProfit) / 1000).toFixed(0)}k</div>
          <div className="text-[9px] sm:text-[10px] text-gray-500 mt-1 truncate">{avgMargin.toFixed(1)}% {T.demoAvgMargin || "avg margin"}</div>
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-1 mt-3 pt-2 text-[10px] text-gray-600 border-t border-gray-800/50">
        <div className="flex flex-col items-center text-center">
          <span className="truncate w-full">{T.demoExpenseRatio || "Expense ratio"}</span>
          <span className="text-gray-400 font-medium">{expenseEfficiency}%</span>
        </div>
        <div className="flex flex-col items-center text-center">
          <span className="truncate w-full">{T.demoPeakMargin || "Peak margin"}</span>
          <span className="text-gray-400 font-medium">{history[bestDay].margin}%</span>
        </div>
        <div className="flex flex-col items-center text-center">
          <span className="truncate w-full">{T.demoLowMargin || "Low margin"}</span>
          <span className="text-gray-400 font-medium">{history[worstDay].margin}%</span>
        </div>
      </div>
    </div>
  );
}

function DemoIntegrationCard({
  name, placeholder, hint, keyInput, setKeyInput, connected, setConnected, keyPreview, setKeyPreview, language,
  extraFields, extraValues, setExtraValues,
}: {
  name: string; placeholder: string; hint: string;
  keyInput: string; setKeyInput: (v: string) => void;
  connected: boolean; setConnected: (v: boolean) => void;
  keyPreview: string; setKeyPreview: (v: string) => void;
  language: string;
  extraFields?: { key: string; label: string; placeholder: string } | { key: string; label: string; placeholder: string }[];
  extraValues?: Record<string, string>; setExtraValues?: (v: Record<string, string>) => void;
}) {
  const fields = Array.isArray(extraFields) ? extraFields : extraFields ? [extraFields] : [];
  const handleConnect = () => {
    if (!keyInput.trim()) return;
    for (const f of fields) {
      if (!extraValues?.[f.key]?.trim()) return;
    }
    const key = keyInput.trim();
    setKeyPreview(key.slice(0, 8) + "..." + key.slice(-4));
    setConnected(true);
    setKeyInput("");
  };
  const handleDisconnect = () => {
    setConnected(false);
    setKeyPreview("");
  };

  return (
    <div className="bg-gray-900/40 rounded-xl p-5 border border-gray-800">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-semibold text-white text-base">{name}</h4>
          <p className="text-sm text-gray-500 mt-1">
            {connected
              ? (language === "UA" ? "Підключено, очікуємо першу синхронізацію" : language === "DE" ? "Verbunden, wartet auf erste Synchronisierung" : "Connected, waiting for first sync")
              : (language === "UA" ? `Підключіть ${name}, щоб отримувати реальні дані` : language === "DE" ? `Verbinden Sie ${name}, um echte Daten abzurufen` : `Connect ${name} to pull real data`)}
          </p>
        </div>
        {connected && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-400 flex items-center gap-1 font-mono whitespace-nowrap">
              <Wifi className="w-3 h-3 shrink-0" />
              {language === "UA" ? "Підключено" : language === "DE" ? "Verbunden" : "Connected"} · {keyPreview}
            </span>
            <Button size="sm" variant="outline" className="text-red-400 border-red-400/30 hover:bg-red-500/10 shrink-0" onClick={handleDisconnect}>
              {language === "UA" ? "Відключити" : language === "DE" ? "Trennen" : "Disconnect"}
            </Button>
          </div>
        )}
      </div>

      {!connected && (
        <>
          {fields.map((f) => (
            <div key={f.key}>
              <input
                type="text"
                value={extraValues?.[f.key] || ""}
                onChange={(e) => setExtraValues?.({ ...(extraValues || {}), [f.key]: e.target.value })}
                placeholder={f.placeholder}
                autoComplete="off"
                className="w-full mt-2 first:mt-4 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-300 font-mono placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
              <p className="text-xs text-gray-500 mt-2">{f.label}</p>
            </div>
          ))}
          <input
            type="text"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            className={`w-full ${fields.length ? "mt-2" : "mt-4"} bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-300 font-mono placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors`}
          />
          <p className="text-xs text-gray-500 mt-2">{hint}</p>
          <Button onClick={handleConnect} className="mt-4 font-semibold px-5 bg-blue-500 hover:bg-blue-600 text-white">
            {language === "UA" ? `Підключити ${name}` : language === "DE" ? `${name} verbinden` : `Connect ${name}`} →
          </Button>
        </>
      )}
    </div>
  );
}

export function LiveDemoModal({ isOpen, onClose }: LiveDemoModalProps) {
  const { t, language } = useLanguage();
  const { currency, symbol, convert } = useCurrency();
  const T = t as any;
  // Добавляем язык в T для использования в переводах месяцев
  T._lang = language;
  
  const [activeView, setActiveView] = useState<ViewType>("overview");
  const [risks, setRisks] = useState<Risk[]>([]);
  // Історія вирішених ризиків — той самий принцип, що й resolvedRisks у
  // app/dashboard/page.tsx: закриття ризику (X) переносить його в "Історію"
  // замість того, щоб він просто зникав назавжди.
  const [resolvedRisks, setResolvedRisks] = useState<Risk[]>([]);
  const [risksView, setRisksView] = useState<"active" | "history">("active");
  const [alertCount, setAlertCount] = useState(0);
  const [showTelegramPopup, setShowTelegramPopup] = useState(false);
  const [lastNotification, setLastNotification] = useState<Risk | null>(null);
  // Попап "спробувати 14 днів безкоштовно" — з'являється один раз за сесію
  // демо: коли людина доходить до останньої вкладки (Integrations) АБО
  // через хвилину перебування в демо, залежно від того, що станеться раніше.
  const [showTrialPrompt, setShowTrialPrompt] = useState(false);
  const trialPromptShownRef = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const notificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Очередь уведомлений без повторов + защита от повтора на стыке циклов
  const alertQueueRef = useRef<AlertTemplate[]>([]);
  const lastTemplateTypeRef = useRef<Risk["alertType"] | null>(null);
  const lastAlertIntegrationRef = useRef<string | null>(null);
  const hasInitializedRisksRef = useRef(false);

  // Фільтр-воронка по категоріях, як у реальному кабінеті. На відміну від
  // dashboard/page.tsx — тут НЕ зберігаємо вибір у localStorage: це демо,
  // при повторному відкритті фільтр повинен скидатись.
  const [riskCategoryFilter, setRiskCategoryFilter] = useState<Risk["category"][]>([]);
  const [riskFilterOpen, setRiskFilterOpen] = useState(false);
  const riskFilterRef = useRef<HTMLDivElement | null>(null);
  const riskFilterTouchStartYRef = useRef<number | null>(null);

  // Картки на Огляді — стан для "шестерні" (DemoWidgetPrefsPanel), той самий
  // принцип, що й widgetIds/widgetPrefsOpen у реальному кабінеті.
  const [widgetIds, setWidgetIds] = useState<WidgetId[]>(DEFAULT_WIDGET_IDS);
  const [widgetPrefsOpen, setWidgetPrefsOpen] = useState(false);

  const toggleRiskCategory = (cat: Risk["category"]) => {
    setRiskCategoryFilter((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  };

  useEffect(() => {
    if (!riskFilterOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (riskFilterRef.current && !riskFilterRef.current.contains(e.target as Node)) {
        setRiskFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [riskFilterOpen]);

  // Скидаємо фільтр і вкладку "Активні/Історія" при закритті демо, щоб
  // наступне відкриття завжди починалось "з чистого аркуша".
  useEffect(() => {
    if (!isOpen) {
      setRiskCategoryFilter([]);
      setRiskFilterOpen(false);
      setRisksView("active");
    }
  }, [isOpen]);
  
  const [integrations, setIntegrations] = useState<Integration[]>(INITIAL_INTEGRATIONS);
  const integrationsRef = useRef(integrations);
  useEffect(() => { integrationsRef.current = integrations; }, [integrations]);

  // Состояние карточки подключения Stripe на вкладке "Інтеграції"
  const [stripeKeyInput, setStripeKeyInput] = useState("");
  const [stripeConnected, setStripeConnected] = useState(false);
  const [stripeKeyPreview, setStripeKeyPreview] = useState("");
  const [shopifyKeyInput, setShopifyKeyInput] = useState("");
const [shopifyConnected, setShopifyConnected] = useState(false);
const [shopifyKeyPreview, setShopifyKeyPreview] = useState("");

const [metaKeyInput, setMetaKeyInput] = useState("");
const [metaConnected, setMetaConnected] = useState(false);
const [metaKeyPreview, setMetaKeyPreview] = useState("");

const [googleAdsKeyInput, setGoogleAdsKeyInput] = useState("");
const [googleAdsConnected, setGoogleAdsConnected] = useState(false);
const [googleAdsKeyPreview, setGoogleAdsKeyPreview] = useState("");
const [googleAdsExtraValues, setGoogleAdsExtraValues] = useState<Record<string, string>>({});

  const handleConnectStripe = () => {
    if (!stripeKeyInput.trim()) return;
    const key = stripeKeyInput.trim();
    setStripeKeyPreview(key.slice(0, 12) + "..." + key.slice(-4));
    setStripeConnected(true);
    setStripeKeyInput("");
  };

  const handleDisconnectStripe = () => {
   setStripeConnected(false);
   setStripeKeyPreview("");
 };

  // Метрики теперь берутся из глобального (module-level) стора, который
  // тикает раз в 10 секунд всегда — не только пока демо открыто.
  const metrics = useMetricsStore();
  
  const translateAllRisks = useCallback(() => {
    setRisks(prevRisks => prevRisks.map(risk => translateRisk(risk, T, currency)));
    setResolvedRisks(prevRisks => prevRisks.map(risk => translateRisk(risk, T, currency)));
    if (lastNotification) setLastNotification(translateRisk(lastNotification, T, currency));
  }, [T, currency, lastNotification]);
  
  useEffect(() => {
    if (isOpen) translateAllRisks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, currency, isOpen]);

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
    const translated = translateRisk(risk, T, currency);
    setRisks(prev => [translated, ...prev].slice(0, MAX_RISKS_STORED));
    setAlertCount(prev => prev + 1);
    setLastNotification(translated);
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);
    notificationTimeoutRef.current = setTimeout(() => setLastNotification(null), NOTIFICATION_VISIBLE_MS);
  }, [T, currency]);

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
          const preloaded = rawPreloaded.map(r => translateRisk(r, T, currency));
          setRisks(preloaded);
          setAlertCount(preloaded.length);
          lastTemplateTypeRef.current = "low_stock"; // чтобы эти же типы не выпали первыми в живой ротации

          // Так же кладём немного "вирішених" сповіщень у вкладку "Історія" —
          // інакше відвідувач демо бачить порожню історію, поки сам щось не
          // закриє, і не розуміє, як реально виглядає цей екран у вже
          // працюючому кабінеті клієнта. Три різні категорії для наочності.
          const rawResolvedPreloaded: Risk[] = [
            {
              id: now - 2 * 24 * 3600 * 1000,
              title: "", description: "",
              time: new Date(now - 2 * 24 * 3600 * 1000).toLocaleDateString([], { month: "short", day: "numeric" }),
              severity: "high", action: "", category: "ads", alertType: "revenue_drop",
            },
            {
              id: now - 4 * 24 * 3600 * 1000,
              title: "", description: "",
              time: new Date(now - 4 * 24 * 3600 * 1000).toLocaleDateString([], { month: "short", day: "numeric" }),
              severity: "medium", action: "", category: "cac", alertType: "cac_increase",
            },
            {
              id: now - 6 * 24 * 3600 * 1000,
              title: "", description: "",
              time: new Date(now - 6 * 24 * 3600 * 1000).toLocaleDateString([], { month: "short", day: "numeric" }),
              severity: "high", action: "", category: "margin", alertType: "profit_drop",
            },
          ];
          setResolvedRisks(rawResolvedPreloaded.map(r => translateRisk(r, T, currency)));
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

  // Попап "14 днів безкоштовно": показуємо один раз за сесію демо — коли
  // людина доходить до останньої вкладки (Integrations, останній пункт
  // sidebarItems) АБО через 60 секунд перебування в демо, залежно від того,
  // що станеться раніше. Скидаємо прапорець при закритті демо, щоб він міг
  // з'явитись знову, якщо людина відкриє демо ще раз.
  useEffect(() => {
    if (!isOpen) {
      trialPromptShownRef.current = false;
      setShowTrialPrompt(false);
      return;
    }
    const timeoutId = setTimeout(() => {
      if (!trialPromptShownRef.current) {
        trialPromptShownRef.current = true;
        setShowTrialPrompt(true);
      }
    }, 60000);
    return () => clearTimeout(timeoutId);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeView !== "integrations" || trialPromptShownRef.current) return;
    trialPromptShownRef.current = true;
    setShowTrialPrompt(true);
  }, [isOpen, activeView]);

  const handleTrialTry = () => {
    setShowTrialPrompt(false);
    onClose();
    // Той самий підхід, що й кнопки тарифів у pricing-section.tsx —
    // відкриває модалку реєстрації, не піднімаючи її стейт на рівень
    // сторінки.
    window.dispatchEvent(new CustomEvent("rivant:open-signup"));
  };

  const handleTrialDismiss = () => setShowTrialPrompt(false);

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
  
  // Закриття ризику (X) тепер переносить його в "Історію" замість того, щоб
  // видаляти назавжди — той самий принцип, що й resolve-флоу в реальному
  // кабінеті (PATCH /api/alerts). "Очистити всі" на вкладці "Активні" робить
  // те саме масово; на вкладці "Історія" trash-кнопка справді видаляє.
  const removeRisk = (id: number) => {
    setRisks(prev => {
      const risk = prev.find(r => r.id === id);
      if (risk) {
        setResolvedRisks(rprev => [risk, ...rprev].slice(0, MAX_RISKS_STORED));
      }
      return prev.filter(r => r.id !== id);
    });
    setAlertCount(prev => Math.max(0, prev - 1));
  };
  
  const clearAllRisks = () => {
    if (risksView === "active") {
      setResolvedRisks(prev => [...risks, ...prev].slice(0, MAX_RISKS_STORED));
      setRisks([]);
      setAlertCount(0);
    } else {
      setResolvedRisks([]);
    }
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
  
  const {
    currentRevenue, prevRevenue, currentProfit, prevProfit, currentMargin, prevMargin,
    currentCac, prevCac, currentCacMeta, prevCacMeta, currentCacGoogle, prevCacGoogle,
    revenueQueue, profitQueue, marginQueue, cacQueue, cacMetaQueue, cacGoogleQueue,
  } = metrics;
  const revenueChange = ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1);
  const profitChange = ((currentProfit - prevProfit) / prevProfit * 100).toFixed(1);
  const marginChange = (currentMargin - prevMargin).toFixed(1);
  const cacChange = ((currentCac - prevCac) / prevCac * 100).toFixed(1);
  const cacMetaChange = ((currentCacMeta - prevCacMeta) / prevCacMeta * 100).toFixed(1);
  const cacGoogleChange = ((currentCacGoogle - prevCacGoogle) / prevCacGoogle * 100).toFixed(1);

  // Похідні метрики для карток "Замовлення" / "Середній чек" / "Витрати" —
  // рахуються з тих самих revenue/profit-серій (в демо немає окремого
  // джерела замовлень), щоб "шестерня" мала повний каталог із 7 карток, як
  // у реальному кабінеті.
  const AVG_ORDER_VALUE = 45;
  const ordersQueue = revenueQueue.map((v) => Math.max(1, Math.round(v / AVG_ORDER_VALUE)));
  const expensesQueue = revenueQueue.map((v, i) => Math.max(0, v - profitQueue[i]));
  const aovQueue = ordersQueue.map((o, i) => (o ? revenueQueue[i] / o : 0));
  const currentOrders = Math.max(1, Math.round(currentRevenue / AVG_ORDER_VALUE));
  const prevOrders = Math.max(1, Math.round(prevRevenue / AVG_ORDER_VALUE));
  const ordersChange = ((currentOrders - prevOrders) / prevOrders * 100).toFixed(1);
  const currentExpenses = Math.max(0, currentRevenue - currentProfit);
  const prevExpenses = Math.max(0, prevRevenue - prevProfit);
  const expensesChangeVal = prevExpenses ? ((currentExpenses - prevExpenses) / prevExpenses * 100).toFixed(1) : "0.0";
  const currentAov = currentRevenue / currentOrders;
  const prevAov = prevRevenue / prevOrders;
  const aovChange = ((currentAov - prevAov) / prevAov * 100).toFixed(1);

  const widgetLabel = (id: WidgetId): string => {
    switch (id) {
      case "revenue": return T.demoRevenue || "Revenue";
      case "profit": return T.demoProfit || "Profit";
      case "margin": return T.demoMargin || "Margin";
      case "cac": return "CAC";
      case "orders": return language === "UA" ? "Замовлення" : language === "DE" ? "Bestellungen" : "Orders";
      case "aov": return language === "UA" ? "Середній чек" : language === "DE" ? "Ø Bestellwert" : "Avg. order value";
      case "expenses": return T.demoExpenses || "Expenses";
      default: return id;
    }
  };

  const widgetCatalogForPanel = WIDGET_CATALOG_IDS.map((id) => ({
    id, label: widgetLabel(id), icon: WIDGET_ICONS[id],
  }));

  const renderOverviewWidget = (id: WidgetId) => {
    switch (id) {
      case "revenue":
        return <DemoMetricCard key={id} title={widgetLabel("revenue")} value={convert(currentRevenue)} change={parseFloat(revenueChange)} color="bg-blue-500" prefix={symbol} sparklineData={revenueQueue} prevValue={prevRevenue} />;
      case "profit":
        return <DemoMetricCard key={id} title={widgetLabel("profit")} value={convert(currentProfit)} change={parseFloat(profitChange)} color="bg-green-500" prefix={symbol} sparklineData={profitQueue} prevValue={prevProfit} />;
      case "margin":
        return <DemoMetricCard key={id} title={widgetLabel("margin")} value={currentMargin} change={parseFloat(marginChange)} color="bg-purple-500" suffix="%" sparklineData={marginQueue} prevValue={prevMargin} />;
      case "cac":
        return (
          <SwipeableCacCard
            key={id}
            T={T}
            language={language}
            symbol={symbol}
            panels={[
              { label: "Meta Ads", value: convert(currentCacMeta), change: parseFloat(cacMetaChange), prev: convert(prevCacMeta), sparklineData: cacMetaQueue },
              {
                label: language === "UA" ? "Загальне" : language === "DE" ? "Gesamt" : "Combined",
                value: convert(currentCac),
                change: parseFloat(cacChange),
                prev: convert(prevCac),
                sparklineData: cacQueue,
              },
              { label: "Google Ads", value: convert(currentCacGoogle), change: parseFloat(cacGoogleChange), prev: convert(prevCacGoogle), sparklineData: cacGoogleQueue },
            ]}
          />
        );
      case "orders":
        return <DemoMetricCard key={id} title={widgetLabel("orders")} value={currentOrders} change={parseFloat(ordersChange)} color="bg-cyan-500" sparklineData={ordersQueue} prevValue={prevOrders} />;
      case "aov":
        return <DemoMetricCard key={id} title={widgetLabel("aov")} value={convert(currentAov)} change={parseFloat(aovChange)} color="bg-pink-500" prefix={symbol} sparklineData={aovQueue} prevValue={prevAov} />;
      case "expenses":
        return <DemoMetricCard key={id} title={widgetLabel("expenses")} value={convert(currentExpenses)} change={parseFloat(expensesChangeVal)} color="bg-red-500" prefix={symbol} sparklineData={expensesQueue} prevValue={prevExpenses} />;
      default:
        return null;
    }
  };

  // Фільтруємо ризики за обраними категоріями — порожній масив = показуємо всі,
  // той самий принцип, що й у app/dashboard/page.tsx. Рахуємо окремо для
  // "Активні" та "Історія".
  const filteredRisks = risks.filter(
    (risk) => riskCategoryFilter.length === 0 || riskCategoryFilter.includes(risk.category)
  );
  const filteredResolvedRisks = resolvedRisks.filter(
    (risk) => riskCategoryFilter.length === 0 || riskCategoryFilter.includes(risk.category)
  );
  
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

  // Підзаголовок під заголовком вкладки — єдиний, використовується в
  // уніфікованій шапці нижче (одна на всі breakpoint-и).
  const viewSubtitle =
    activeView === "overview" ? (T.demoRealTimeMetrics || "Real-time business metrics") :
    activeView === "risks" ? (T.demoAiRisks || "AI-identified operational risks") :
    activeView === "forecast" ? (T.demoAiPredictions || "AI-powered 90-day predictions") :
    activeView === "integrations" ? (T.demoConnectedSources || "Connected data sources") : "";
  
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
          <div className="flex-1 p-4 sm:p-6 pb-24 md:pb-6 overflow-auto relative">
            
            {/* Єдина шапка вкладки — одна й та сама на мобільному й десктопі
                (раніше тут дублювалось: короткий мобільний заголовок ЗДЕСЬ +
                повний h2-заголовок ще раз всередині кожної вкладки нижче). */}
            <div className="flex items-center justify-between gap-3 mb-5 pr-11 md:pr-0">
              <div className="min-w-0">
                <h2 className="text-lg sm:text-2xl font-bold text-white truncate">
                  {sidebarItems.find(i => i.view === activeView)?.label}
                </h2>
                <p className="text-sm text-gray-500 mt-1 hidden sm:block truncate">{viewSubtitle}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {activeView === "overview" && (
                  <div className="hidden sm:flex items-center gap-2 bg-green-500/10 px-3 py-1.5 rounded-full">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm text-green-400 font-medium">{T.demoLive || "LIVE"}</span>
                  </div>
                )}
                <button onClick={() => setShowTelegramPopup(true)} className="md:hidden p-2 bg-gray-800/30 rounded-lg relative flex-shrink-0">
                  <Bell className="w-5 h-5 text-gray-500" />
                  {alertCount > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-500 text-xs flex items-center justify-center text-white font-bold">{alertCount}</span>}
                </button>
              </div>
            </div>
            
            {/* Overview View */}
            {activeView === "overview" && (
              <div className="space-y-5">
                <div className="relative">
                  <button
                    onClick={() => setWidgetPrefsOpen(true)}
                    className="absolute -top-2 -right-2 z-10 w-7 h-7 rounded-full bg-gray-800/90 border border-gray-700 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                    aria-label={language === "UA" ? "Налаштувати картки" : language === "DE" ? "Kacheln anpassen" : "Customize cards"}
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-start">
                    {widgetIds.map((id) => renderOverviewWidget(id))}
                  </div>
                </div>
                
                <RevenueExpensesChart />
              </div>
            )}

            <DemoWidgetPrefsPanel
              open={widgetPrefsOpen}
              onClose={() => setWidgetPrefsOpen(false)}
              activeIds={widgetIds}
              catalog={widgetCatalogForPanel}
              onApply={(ids) => { setWidgetIds(ids); setWidgetPrefsOpen(false); }}
              labels={{
                title: language === "UA" ? "Картки на дашборді" : language === "DE" ? "Dashboard-Kacheln" : "Dashboard cards",
                active: language === "UA" ? "Активні (максимум 4)" : language === "DE" ? "Aktiv (max. 4)" : "Active (max 4)",
                available: language === "UA" ? "Доступні" : language === "DE" ? "Verfügbar" : "Available",
                done: language === "UA" ? "Готово" : language === "DE" ? "Fertig" : "Done",
                cancel: language === "UA" ? "Скасувати" : language === "DE" ? "Abbrechen" : "Cancel",
                needMore: (n: number) =>
                  language === "UA" ? `Виберіть ще ${n}, щоб зберегти` : language === "DE" ? `Wählen Sie noch ${n} aus, um zu speichern` : `Pick ${n} more to save`,
                maxReached: language === "UA" ? "Уже вибрано 4 — заберіть щось, щоб додати інше" : language === "DE" ? "Bereits 4 ausgewählt — entfernen Sie eine, um eine andere hinzuzufügen" : "4 selected — remove one to add another",
              }}
            />
            
            {/* Risks View — структура ідентична app/dashboard/page.tsx:
                Активні/Історія зліва, Фільтр + кошик справа. */}
            {activeView === "risks" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setRisksView("active")}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        risksView === "active" ? "bg-blue-600 text-white" : "text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {language === "UA" ? "Активні" : language === "DE" ? "Aktiv" : "Active"}
                      {filteredRisks.length > 0 && <span className="ml-1.5 opacity-70">{filteredRisks.length}</span>}
                    </button>
                    <button
                      onClick={() => setRisksView("history")}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        risksView === "history" ? "bg-blue-600 text-white" : "text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {language === "UA" ? "Історія" : language === "DE" ? "Verlauf" : "History"}
                      {filteredResolvedRisks.length > 0 && <span className="ml-1.5 opacity-70">{filteredResolvedRisks.length}</span>}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative" ref={riskFilterRef}>
                      <button
                        onClick={() => setRiskFilterOpen((v) => !v)}
                        title={language === "UA" ? "Фільтр" : language === "DE" ? "Filter" : "Filter"}
                        className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                          riskCategoryFilter.length > 0
                            ? "border-blue-500/40 text-blue-300 bg-blue-500/10"
                            : "border-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-800"
                        }`}
                      >
                        <Filter className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{language === "UA" ? "Фільтр" : language === "DE" ? "Filter" : "Filter"}</span>
                        {riskCategoryFilter.length > 0 && (
                          <span className="ml-0.5 bg-blue-500/30 rounded-full px-1.5 text-[10px]">{riskCategoryFilter.length}</span>
                        )}
                      </button>

                      {riskFilterOpen && (
                        <div
                          className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-800 rounded-xl shadow-xl z-20 p-2 touch-pan-y"
                          onTouchStart={(e) => {
                            riskFilterTouchStartYRef.current = e.touches[0].clientY;
                          }}
                          onTouchEnd={(e) => {
                            const startY = riskFilterTouchStartYRef.current;
                            if (startY == null) return;
                            const deltaY = e.changedTouches[0].clientY - startY;
                            if (deltaY > 40) setRiskFilterOpen(false);
                            riskFilterTouchStartYRef.current = null;
                          }}
                        >
                          <div className="sm:hidden w-9 h-1 rounded-full bg-gray-700 mx-auto mb-2" />
                          <div className="flex items-center justify-between px-2 py-1 mb-1">
                            <span className="text-xs font-semibold text-gray-400">
                              {language === "UA" ? "Показувати сповіщення про" : language === "DE" ? "Benachrichtigungen anzeigen für" : "Show notifications for"}
                            </span>
                            {riskCategoryFilter.length > 0 && (
                              <button
                                onClick={() => setRiskCategoryFilter([])}
                                className="text-[11px] text-gray-500 hover:text-red-400"
                              >
                                {language === "UA" ? "Скинути" : language === "DE" ? "Zurücksetzen" : "Reset"}
                              </button>
                            )}
                          </div>
                          {RISK_CATEGORIES.map((cat) => {
                            const checked = riskCategoryFilter.includes(cat.id);
                            return (
                              <label
                                key={cat.id}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-800 cursor-pointer text-sm text-gray-300"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleRiskCategory(cat.id)}
                                  className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0 focus:ring-offset-0"
                                />
                                <span className="text-gray-500">{getCategoryIcon(cat.id)}</span>
                                {cat.label[language] || cat.label.EN}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {risksView === "active" && risks.length > 0 && (
                      <button
                        onClick={clearAllRisks}
                        title={language === "UA" ? "Очистити всі" : language === "DE" ? "Alle löschen" : "Clear all"}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{language === "UA" ? "Очистити всі" : language === "DE" ? "Alle löschen" : "Clear all"}</span>
                      </button>
                    )}
                    {risksView === "history" && resolvedRisks.length > 0 && (
                      <button
                        onClick={clearAllRisks}
                        title={language === "UA" ? "Очистити історію" : language === "DE" ? "Verlauf löschen" : "Clear history"}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{language === "UA" ? "Очистити історію" : language === "DE" ? "Verlauf löschen" : "Clear history"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {risksView === "active" && (
                  <div className="space-y-3">
                    {filteredRisks.map((risk) => (
                      <div key={risk.id} className={`bg-gray-900/50 rounded-xl p-4 border transition-all ${lastNotification?.id === risk.id ? "border-blue-500/50 bg-blue-500/10" : "border-gray-800"}`}>
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${getSeverityColorClasses(risk.severity).bg}`}>
                            {getCategoryIcon(risk.category)}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${getSeverityColorClasses(risk.severity).bg} ${getSeverityColorClasses(risk.severity).text}`}>{getSeverityLabel(risk.severity, language)}</span>
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
                    {risks.length > 0 && filteredRisks.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <Filter className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="text-base">
                          {language === "UA" ? "Немає ризиків за обраним фільтром." : language === "DE" ? "Keine Risiken für den gewählten Filter." : "No risks match the selected filter."}
                        </p>
                        <button onClick={() => setRiskCategoryFilter([])} className="text-sm text-blue-400 hover:text-blue-300 mt-2">
                          {language === "UA" ? "Скинути фільтр" : language === "DE" ? "Filter zurücksetzen" : "Reset filter"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {risksView === "history" && (
                  <div className="space-y-3">
                    {filteredResolvedRisks.map((risk) => (
                      <div key={risk.id} className="bg-gray-900/30 rounded-xl p-4 border border-gray-800 opacity-80">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-500/10">
                            <CheckCircle className="w-5 h-5 text-green-500/70" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-500/10 text-green-500/80">
                                {language === "UA" ? "Вирішено" : language === "DE" ? "Gelöst" : "Resolved"}
                              </span>
                              <span className="text-xs text-gray-500">{risk.time}</span>
                            </div>
                            <h4 className="font-semibold text-gray-300 text-base">{risk.title}</h4>
                            <p className="text-sm text-gray-500 mt-0.5">{risk.description}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {resolvedRisks.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p className="text-base">
                          {language === "UA" ? "Історія поки порожня." : language === "DE" ? "Der Verlauf ist noch leer." : "History is empty so far."}
                        </p>
                      </div>
                    )}
                    {resolvedRisks.length > 0 && filteredResolvedRisks.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <Filter className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="text-base">
                          {language === "UA" ? "Немає записів за обраним фільтром." : language === "DE" ? "Keine Einträge für den gewählten Filter." : "No entries match the selected filter."}
                        </p>
                        <button onClick={() => setRiskCategoryFilter([])} className="text-sm text-blue-400 hover:text-blue-300 mt-2">
                          {language === "UA" ? "Скинути фільтр" : language === "DE" ? "Filter zurücksetzen" : "Reset filter"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* Forecast View */}
            {activeView === "forecast" && (
              <div className="space-y-4">
                {/* 1. Метрики */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-blue-500/10 to-transparent rounded-xl p-5 border border-blue-500/20">
                    <div className="text-sm text-blue-400 font-semibold mb-1">{T.demoProjectedRevenue || "Projected Revenue"}</div>
                    <div className="text-3xl font-bold text-white">{symbol}{Math.round(convert(892400)).toLocaleString()}</div>
                    <div className="text-sm text-green-400 mt-2">+18% {T.demoVsLastQuarter || "vs last quarter"}</div>
                    <div className="text-xs text-gray-500 mt-3">{T.demoConfidence || "Confidence"}: 94%</div>
                  </div>
                  <div className="bg-gradient-to-br from-orange-500/10 to-transparent rounded-xl p-5 border border-orange-500/20">
                    <div className="text-sm text-orange-400 font-semibold mb-1">{T.demoProjectedExpenses || "Projected Expenses"}</div>
                    <div className="text-3xl font-bold text-white">{symbol}{Math.round(convert(654200)).toLocaleString()}</div>
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
                              <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition bg-gray-800 text-white text-[10px] px-1 rounded whitespace-nowrap hidden sm:block">{T.demoActual || "Actual"}: {symbol}{Math.round(convert(m.revenueActual))}k</div>
                            </div>
                          )}
                          <div className="relative group">
                            <div className="w-4 sm:w-8 bg-blue-500 rounded-t" style={{ height: `${m.revenue / 3.2}px` }} />
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition bg-gray-800 text-white text-[10px] px-1 rounded whitespace-nowrap hidden sm:block">{T.demoForecast || "Forecast"}: {symbol}{Math.round(convert(m.revenue))}k</div>
                          </div>
                          <div className="relative group">
                            <div className="w-4 sm:w-8 bg-rose-500/60 rounded-t" style={{ height: `${m.expenses / 3.2}px` }} />
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition bg-gray-800 text-white text-[10px] px-1 rounded whitespace-nowrap hidden sm:block">{T.demoExpenses || "Expenses"}: {symbol}{Math.round(convert(m.expenses))}k</div>
                          </div>
                        </div>
                        <span className="text-xs sm:text-sm text-gray-400 font-medium truncate max-w-full">{months[m.monthIdx]}</span>
                        <div className="flex gap-1.5 sm:gap-3 text-[9px] sm:text-[10px] text-gray-600">
                          <span className="text-blue-400">↑{symbol}{Math.round(convert(m.revenue))}k</span>
                          <span className="text-rose-400">↓{symbol}{Math.round(convert(m.expenses))}k</span>
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

                {/* 3. AI текст — короткий заголовок + розгорнутий абзац у тому ж
                    стилі, що й реальний AI-аналіз у кабінеті
                    (forecast-ai-analysis) і DEMO_FORECAST_EXPLANATION з
                    онбординг-туру: прогноз -> тренд виручки -> тренд маржі ->
                    порада -> джерело розрахунку. */}
                <div data-tour="forecast-ai-analysis" className="bg-blue-500/5 rounded-xl p-4 border border-blue-500/20">
                  <p className="text-sm text-gray-400 mb-2">{T.demoForecastBasedOn || "Based on historical data and market trends, our AI model predicts:"}</p>
                  <p className="text-sm text-gray-300 whitespace-pre-line">
                    {language === "UA"
                      ? `RIVANT прогнозує ${symbol}${Math.round(convert(892400)).toLocaleString()} виручки та ${symbol}${Math.round(convert(654200)).toLocaleString()} витрат за поточний квартал, якщо нинішні тенденції збережуться — це +18% і +8% порівняно з минулим кварталом, з упевненістю 94% та 91% відповідно. Зростання виручки випереджає зростання витрат, тому операційна маржа має покращитися приблизно на 2,3 відсоткового пункту, що рухає прибутковість у правильному напрямку. Очікуйте сезонний пік у вересні — приблизно на 12% вище серпня, ймовірно пов'язаний із вашою рекламною активністю у Q3. Варто збільшити рекламний бюджет приблизно на 8% напередодні цього піку, щоб покрити додатковий попит, не втративши в запасах чи логістиці. Як завжди, щотижня звіряйте фактичні результати з цим прогнозом і коригуйте бюджет, якщо витрати почнуть випереджати очікуваний темп росту. Розрахунки базуються на квартальному тренді за підключеними джерелами доходів і витрат.`
                      : language === "DE"
                      ? `RIVANT prognostiziert für das laufende Quartal einen Umsatz von ${symbol}${Math.round(convert(892400)).toLocaleString()} und Ausgaben von ${symbol}${Math.round(convert(654200)).toLocaleString()}, sofern sich die aktuellen Trends fortsetzen — das entspricht +18 % bzw. +8 % gegenüber dem letzten Quartal, mit einer Konfidenz von 94 % bzw. 91 %. Da das Umsatzwachstum das Kostenwachstum weiterhin übertrifft, dürfte sich die operative Marge um rund 2,3 Prozentpunkte verbessern — ein Schritt in die richtige Richtung. Rechnen Sie im September mit einem saisonalen Höhepunkt, etwa 12 % über August, vermutlich getrieben durch Ihre Q3-Kampagnen. Es lohnt sich, die Werbeausgaben vor diesem Höhepunkt um rund 8 % zu erhöhen, um die zusätzliche Nachfrage zu bedienen, ohne bei Lager oder Versand ins Hintertreffen zu geraten. Vergleichen Sie wie gewohnt wöchentlich die tatsächlichen Ergebnisse mit dieser Prognose und passen Sie das Budget an, falls die Ausgaben schneller wachsen als erwartet. Die Berechnung basiert auf dem quartalsweisen Trend über Ihre verbundenen Umsatz- und Kostenquellen.`
                      : `RIVANT projects ${symbol}${Math.round(convert(892400)).toLocaleString()} in revenue and ${symbol}${Math.round(convert(654200)).toLocaleString()} in expenses for the current quarter, assuming today's trends hold — that's +18% and +8% versus last quarter, with 94% and 91% confidence respectively. Revenue growth continues to outpace cost growth, so operating margin is expected to improve by roughly 2.3 percentage points, moving profitability in the right direction. Look for a seasonal peak in September, about 12% above August, likely tied to your Q3 campaign push. It's worth increasing ad spend by around 8% ahead of that peak to capture the extra demand without under-delivering on stock or fulfillment. As always, compare actual results against this forecast each week and adjust budget if expenses start outrunning the projected growth rate. Calculations are based on your trailing quarterly trend across connected revenue and expense sources.`}
                  </p>
                </div>
              </div>
            )}
            
            {/* Integrations View — приведено к виду реального ЛК (карточка Stripe + "coming soon") */}
            {activeView === "integrations" && (
              <div className="space-y-4">
                <div className="space-y-4">
                  {/* Карточка подключения Stripe */}
                  <div className="bg-gray-900/40 rounded-xl p-5 border border-gray-800">
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div className="min-w-0">
      <h4 className="font-semibold text-white text-base">Stripe</h4>
      <p className="text-sm text-gray-500 mt-1">
        {stripeConnected
          ? (language === "UA" ? "Підключено, очікуємо першу синхронізацію" : language === "DE" ? "Verbunden, wartet auf erste Synchronisierung" : "Connected, waiting for first sync")
          : (language === "UA" ? "Підключіть свій обліковий запис Stripe, щоб отримувати реальні дані про виручку" : language === "DE" ? "Verbinden Sie Ihr Stripe-Konto, um echte Umsatzdaten abzurufen" : "Connect your Stripe account to pull real revenue data")}
      </p>
    </div>
    {stripeConnected && (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-400 flex items-center gap-1 font-mono whitespace-nowrap">
          <Wifi className="w-3 h-3 shrink-0" />
          {language === "UA" ? "Підключено" : language === "DE" ? "Verbunden" : "Connected"} · {stripeKeyPreview}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="text-red-400 border-red-400/30 hover:bg-red-500/10 shrink-0"
          onClick={handleDisconnectStripe}
        >
          {language === "UA" ? "Відключити" : language === "DE" ? "Trennen" : "Disconnect"}
        </Button>
      </div>
    )}
  </div>

  {!stripeConnected && (
    <>
      <input
        type="text"
        value={stripeKeyInput}
        onChange={(e) => setStripeKeyInput(e.target.value)}
        placeholder="rk_live_..."
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-lpignore="true"
        data-1p-ignore="true"
        className="w-full mt-4 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-300 font-mono placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
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
        className="mt-4 font-semibold px-5 bg-blue-500 hover:bg-blue-600 text-white"
      >
        {`${language === "UA" ? "Підключити Stripe" : language === "DE" ? "Stripe verbinden" : "Connect Stripe"} →`}
      </Button>
    </>
  )}
</div>

{[
  {
    key: "shopify" as const,
    connected: shopifyConnected,
    node: (
      <DemoIntegrationCard
        name="Shopify"
        placeholder="Client Secret"
        hint={language === "UA" ? "Shopify Dev Dashboard → ваш застосунок → Settings → Client ID і Client Secret." : language === "DE" ? "Shopify Dev Dashboard → Ihre App → Settings → Client ID und Client Secret." : "Shopify Dev Dashboard → your app → Settings → Client ID and Client Secret."}
        keyInput={shopifyKeyInput} setKeyInput={setShopifyKeyInput}
        connected={shopifyConnected} setConnected={setShopifyConnected}
        keyPreview={shopifyKeyPreview} setKeyPreview={setShopifyKeyPreview}
        language={language}
      />
    ),
  },
  {
    key: "meta" as const,
    connected: metaConnected,
    node: (
      <DemoIntegrationCard
        name="Meta Ads"
        placeholder="EAAG..."
        hint={language === "UA" ? "Meta Business Suite → System Users → створіть токен з доступом ads_read." : language === "DE" ? "Meta Business Suite → System Users → Token mit ads_read-Zugriff erstellen." : "Meta Business Suite → System Users → create a token with ads_read access."}
        keyInput={metaKeyInput} setKeyInput={setMetaKeyInput}
        connected={metaConnected} setConnected={setMetaConnected}
        keyPreview={metaKeyPreview} setKeyPreview={setMetaKeyPreview}
        language={language}
      />
    ),
  },
  {
    key: "google" as const,
    connected: googleAdsConnected,
    // Google Ads в живому демо оформлено один в один як у особистому
    // кабінеті (кнопка "Підключити через Google" замість ручних полів) —
    // але кнопка нікуди не веде і нічого реально не підключає, а лише
    // імітує миттєве підключення локально, як і решта демо-карток.
    node: (
      <div className="bg-gray-900/40 rounded-xl p-5 border border-gray-800">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-semibold text-white text-base">Google Ads</h4>
            <p className="text-sm text-gray-500 mt-1">
              {googleAdsConnected
                ? (language === "UA" ? "Підключено, очікуємо першу синхронізацію" : language === "DE" ? "Verbunden, wartet auf erste Synchronisierung" : "Connected, waiting for first sync")
                : (language === "UA" ? "Підключіть Google Ads, щоб отримувати реальні дані" : language === "DE" ? "Verbinden Sie Google Ads, um echte Daten abzurufen" : "Connect Google Ads to pull real data")}
            </p>
          </div>
          {googleAdsConnected && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-400 flex items-center gap-1 font-mono whitespace-nowrap">
                <Wifi className="w-3 h-3 shrink-0" />
                {language === "UA" ? "Підключено" : language === "DE" ? "Verbunden" : "Connected"}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="text-red-400 border-red-400/30 hover:bg-red-500/10 shrink-0"
                onClick={() => setGoogleAdsConnected(false)}
              >
                {language === "UA" ? "Відключити" : language === "DE" ? "Trennen" : "Disconnect"}
              </Button>
            </div>
          )}
        </div>

        {!googleAdsConnected && (
          <>
            <p className="text-xs text-gray-500 mt-4">
              {language === "UA"
                ? "Ви перейдете на сторінку Google, підтвердите доступ до Google Ads і повернетесь сюди — без ручного вводу токенів."
                : language === "DE"
                ? "Sie werden zu Google weitergeleitet, bestätigen den Zugriff auf Google Ads und kehren hierher zurück — ganz ohne manuelle Token-Eingabe."
                : "You'll be redirected to Google, approve access to Google Ads, and land back here — no manual token entry."}
            </p>
            <Button
              onClick={() => setGoogleAdsConnected(true)}
              className="mt-4 font-semibold px-5 bg-blue-500 hover:bg-blue-600 text-white"
            >
              {language === "UA" ? "Підключити через Google" : language === "DE" ? "Über Google verbinden" : "Connect with Google"}
            </Button>
          </>
        )}
      </div>
    ),
  },
]
  // Підключені інтеграції спливають наверх списку — той самий принцип, що
  // й integrationsOrder у app/dashboard/page.tsx, тільки рахується на
  // кожному рендері з локального demo-стану, а не з /api/integrations-status.
  .sort((a, b) => Number(b.connected) - Number(a.connected))
  .map((item) => <div key={item.key}>{item.node}</div>)}

                  {/* Прочие интеграции — скоро */}
                  <div className="bg-gray-900/20 rounded-xl p-4 border border-gray-800 flex items-center gap-3 opacity-50">
                    <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
                      <Link className="w-5 h-5 text-gray-500" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-400 text-sm">Google Analytics, QuickBooks</h4>
                      <p className="text-xs text-gray-600">
                        {language === "UA" ? "Скоро" : language === "DE" ? "Demnächst" : "Coming soon"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
          {/* Notification Toast: намеренно не рендерим floating-уведомление в демо —
              в личном кабинете плавающие тосты не предусмотрены, поэтому в live-demo
              они тоже убраны. lastNotification по-прежнему используется только для
              подсветки соответствующей строки в списке рисков. */}

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
                  <p className="text-sm text-gray-400 mb-4">{T.demoConnectTelegramDesc || "Get real-time alerts in Telegram when anomalies are detected."}</p>
                  <Button className="w-full bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 font-semibold py-2">{T.demoConnectTelegram || "Connect Telegram →"}</Button>
                </div>
              </div>
            )}
          </div>
        </div>

      {/* "14 днів безкоштовно" — окремий шар над усією демо-модалкою (а не
          лише над Main Content, як Telegram-попап вище), щоб перекривати й
          сайдбар, і мобільний нижній таб-бар. */}
      {showTrialPrompt && (
        <div className="absolute inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={handleTrialDismiss}>
          <div
            className="bg-gray-900 rounded-2xl p-6 w-full max-w-sm border border-blue-500/30 shadow-2xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
              <Zap className="w-7 h-7 text-blue-400" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">
              {language === "UA" ? "Сподобалось те, що бачите?" : language === "DE" ? "Gefällt Ihnen, was Sie sehen?" : "Like what you see?"}
            </h3>
            <p className="text-sm text-gray-400 mb-6">
              {language === "UA"
                ? "Отримайте 14 днів безкоштовного доступу до RIVANT з вашими реальними даними — без картки, скасувати можна в будь-який момент."
                : language === "DE"
                ? "Erhalten Sie 14 Tage kostenlosen Zugang zu RIVANT mit Ihren echten Daten — keine Kreditkarte nötig, jederzeit kündbar."
                : "Get 14 days of free access to RIVANT with your own real data — no card required, cancel anytime."}
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={handleTrialTry} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5">
                {language === "UA" ? "Спробувати безкоштовно" : language === "DE" ? "Kostenlos testen" : "Try it free"}
              </Button>
              <button onClick={handleTrialDismiss} className="w-full text-sm text-gray-500 hover:text-gray-300 py-2">
                {language === "UA" ? "Ні, дякую" : language === "DE" ? "Nein, danke" : "No thanks"}
              </button>
            </div>
          </div>
        </div>
      )}

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