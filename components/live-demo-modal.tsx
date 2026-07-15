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

const initialRisks: Risk[] = [];

const BASE_REVENUE = 125608;
const BASE_PROFIT = 34563;
const BASE_MARGIN = 27.5;
const BASE_CAC = 47;

// Интеграции
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
  const translatedRisk = { ...risk };
  switch (risk.alertType) {
    case "revenue_drop":
      translatedRisk.title = t.alertRevenueDropTitle || "Revenue dropping";
      translatedRisk.description = t.alertRevenueDropDesc || "Revenue decreased significantly in the last hour";
      translatedRisk.action = t.alertViewDetails || "View Details";
      break;
    case "revenue_rise":
      translatedRisk.title = t.alertRevenueRiseTitle || "Revenue spike";
      translatedRisk.description = t.alertRevenueRiseDesc || "Unusual revenue increase detected";
      translatedRisk.action = t.alertViewDetails || "View Details";
      break;
    case "profit_drop":
      translatedRisk.title = t.alertProfitDropTitle || "Profit margin shrinking";
      translatedRisk.description = t.alertProfitDropDesc || "Profit margin dropped below target";
      translatedRisk.action = t.alertAnalyze || "Analyze";
      break;
    case "profit_rise":
      translatedRisk.title = t.alertProfitRiseTitle || "Profit surge";
      translatedRisk.description = t.alertProfitRiseDesc || "Exceptional profit margin detected";
      translatedRisk.action = t.alertAnalyze || "Analyze";
      break;
    case "cac_increase":
      translatedRisk.title = t.alertCacIncreaseTitle || "Customer acquisition cost rising";
      translatedRisk.description = t.alertCacIncreaseDesc || "CAC increased - review ad performance";
      translatedRisk.action = t.alertReviewMarketing || "Review Marketing";
      break;
    case "cac_decrease":
      translatedRisk.title = t.alertCacDecreaseTitle || "CAC decreasing";
      translatedRisk.description = t.alertCacDecreaseDesc || "Marketing efficiency improving";
      translatedRisk.action = t.alertReviewMarketing || "Review Marketing";
      break;
    case "integration_down":
      translatedRisk.title = t.alertIntegrationDownTitle || "Integration disconnected";
      translatedRisk.description = (t.alertIntegrationDownDesc || "Connection to {name} has been lost").replace("{name}", risk.integrationId || "integration");
      translatedRisk.action = t.alertReconnect || "Reconnect";
      break;
    case "low_stock":
      translatedRisk.title = t.alertLowStockTitle || "Low stock alert";
      translatedRisk.description = t.alertLowStockDesc || "Top SKU #4521 has only 3 days of stock remaining";
      translatedRisk.action = t.alertReorder || "Reorder Now";
      break;
    case "shipping_delay":
      translatedRisk.title = t.alertShippingDelayTitle || "Shipping delay detected";
      translatedRisk.description = t.alertShippingDelayDesc || "Average delivery time increased by 1.4 days";
      translatedRisk.action = t.alertViewOrders || "View Orders";
      break;
    case "conversion_drop":
      translatedRisk.title = t.alertConversionDropTitle || "Conversion rate dropping";
      translatedRisk.description = t.alertConversionDropDesc || "Checkout completion dropped 12% in last 2 hours";
      translatedRisk.action = t.alertCheckFunnel || "Check Funnel";
      break;
    case "ad_spend":
      translatedRisk.title = t.alertAdSpendTitle || "Ad spend spike";
      translatedRisk.description = t.alertAdSpendDesc || "Meta Ads spending 23% above daily budget";
      translatedRisk.action = t.alertCheckCampaigns || "Check Campaigns";
      break;
  }
  return translatedRisk;
}

// Генерация уведомлений
function generateAlertFromState(
  integrations: Integration[],
  currentRevenue: number,
  prevRevenue: number,
  currentProfit: number,
  prevProfit: number,
  usedAlertIds: Set<string>
): Risk | null {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const downIntegrations = integrations.filter(i => i.status === "error");
  for (const integration of downIntegrations) {
    const alertId = `integration_${integration.id}_${Math.floor(now.getTime() / 60000)}`;
    if (!usedAlertIds.has(alertId)) {
      return {
        id: now.getTime(),
        title: "",
        description: "",
        time: timeStr,
        severity: "high",
        action: "",
        category: "integration",
        integrationId: integration.name,
        alertType: "integration_down"
      };
    }
  }
  
  const revenueChange = (currentRevenue - prevRevenue) / prevRevenue;
  if (Math.abs(revenueChange) > 0.02 && Math.random() > 0.7) {
    const isDrop = revenueChange < 0;
    const alertId = `revenue_${Math.floor(now.getTime() / 60000)}`;
    if (!usedAlertIds.has(alertId)) {
      return {
        id: now.getTime(),
        title: "",
        description: "",
        time: timeStr,
        severity: Math.abs(revenueChange) > 0.035 ? "high" : "medium",
        action: "",
        category: "ads",
        alertType: isDrop ? "revenue_drop" : "revenue_rise"
      };
    }
  }
  
  return null;
}

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
    <div className="bg-gradient-to-br from-gray-900/80 to-black rounded-2xl p-5 border border-gray-800">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-bold text-white">{T.demoRevenueVsExpenses || "Revenue vs Expenses (30 days)"}</h3>
        </div>
        <div className="flex gap-2 bg-gray-800/50 rounded-lg p-1">
          <button onClick={() => setSelectedMetric("revenue")} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${selectedMetric === "revenue" ? "bg-blue-500/30 text-blue-400" : "text-gray-500 hover:text-gray-300"}`}>{T.demoRevenue || "Revenue"}</button>
          <button onClick={() => setSelectedMetric("expenses")} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${selectedMetric === "expenses" ? "bg-rose-500/30 text-rose-400" : "text-gray-500 hover:text-gray-300"}`}>{T.demoExpenses || "Expenses"}</button>
          <button onClick={() => setSelectedMetric("profit")} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${selectedMetric === "profit" ? "bg-green-500/30 text-green-400" : "text-gray-500 hover:text-gray-300"}`}>{T.demoProfit || "Profit"}</button>
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
        
        <div className="ml-12 h-64 flex items-end gap-1">
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
              <div key={idx} className="flex-1 flex flex-col items-center gap-0.5 group cursor-pointer" onMouseEnter={() => setHoveredBar(idx)} onMouseLeave={() => setHoveredBar(null)}>
                <div className="relative w-full">
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
      
      <div className="grid grid-cols-3 gap-3 mt-6 pt-4 border-t border-gray-800">
        <div className="bg-blue-500/5 rounded-xl p-3 border border-blue-500/15">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3.5 h-3.5 text-blue-400" />
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">{T.demoRevenue || "Total Revenue"}</div>
          </div>
          <div className="text-xl font-bold text-white">${(totalRevenue / 1000).toFixed(0)}k</div>
          <div className="text-[10px] text-gray-500 mt-1">↑ {Math.abs(((history[history.length-1].revenue - history[0].revenue) / history[0].revenue * 100)).toFixed(0)}% {T.demoVsStart || "vs start"}</div>
        </div>
        <div className="bg-rose-500/5 rounded-xl p-3 border border-rose-500/15">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">{T.demoExpenses || "Total Expenses"}</div>
          </div>
          <div className="text-xl font-bold text-white">${(totalExpenses / 1000).toFixed(0)}k</div>
          <div className="text-[10px] text-gray-500 mt-1">{((totalExpenses / totalRevenue) * 100).toFixed(0)}% {T.demoOfRevenue || "of revenue"}</div>
        </div>
        <div className="bg-green-500/10 rounded-xl p-3 border border-green-500/20">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-green-400" />
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">{T.demoProfit || "Net Profit"}</div>
          </div>
          <div className="text-xl font-bold text-green-400">+${(totalProfit / 1000).toFixed(0)}k</div>
          <div className="text-[10px] text-gray-500 mt-1">{avgMargin.toFixed(1)}% {T.demoAvgMargin || "avg margin"}</div>
        </div>
      </div>
      
      <div className="flex justify-between items-center mt-3 pt-2 text-[10px] text-gray-600 border-t border-gray-800/50">
        <span>{T.demoExpenseRatio || "Expense ratio"}: {expenseEfficiency}%</span>
        <span>{T.demoPeakMargin || "Peak margin"}: {history[bestDay].margin}% ({T.demoDay || "day"} {bestDay + 1})</span>
        <span>{T.demoLowMargin || "Low margin"}: {history[worstDay].margin}% ({T.demoDay || "day"} {worstDay + 1})</span>
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
  const [risks, setRisks] = useState<Risk[]>(initialRisks);
  const [alertCount, setAlertCount] = useState(0);
  const [showTelegramPopup, setShowTelegramPopup] = useState(false);
  const [lastNotification, setLastNotification] = useState<Risk | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const usedAlertIdsRef = useRef<Set<string>>(new Set());
  const lastAlertTimeRef = useRef<number>(Date.now());
  
  const [integrations, setIntegrations] = useState<Integration[]>(INITIAL_INTEGRATIONS);
  
  const [currentRevenue, setCurrentRevenue] = useState(BASE_REVENUE);
  const [currentProfit, setCurrentProfit] = useState(BASE_PROFIT);
  const [currentMargin, setCurrentMargin] = useState(BASE_MARGIN);
  const [currentCac, setCurrentCac] = useState(BASE_CAC);
  const [prevRevenue, setPrevRevenue] = useState(BASE_REVENUE);
  const [prevProfit, setPrevProfit] = useState(BASE_PROFIT);
  const [prevMargin, setPrevMargin] = useState(BASE_MARGIN);
  const [prevCac, setPrevCac] = useState(BASE_CAC);
  
  const [revenueQueue, setRevenueQueue] = useState<number[]>(() => generateTickerData(BASE_REVENUE, 400, 0.0003));
  const [profitQueue, setProfitQueue] = useState<number[]>(() => generateTickerData(BASE_PROFIT, 300, 0.0002));
  const [marginQueue, setMarginQueue] = useState<number[]>(() => generateTickerData(BASE_MARGIN, 0.4, 0.0001));
  const [cacQueue, setCacQueue] = useState<number[]>(() => generateTickerData(BASE_CAC, 1.2, -0.0001));
  
  const addToQueue = <T,>(queue: T[], newValue: T): T[] => [...queue.slice(1), newValue];
  
  const translateAllRisks = useCallback(() => {
    setRisks(prevRisks => prevRisks.map(risk => translateRisk(risk, T)));
    if (lastNotification) setLastNotification(translateRisk(lastNotification, T));
  }, [T, lastNotification]);
  
  useEffect(() => {
    if (isOpen) translateAllRisks();
  }, [language, isOpen, translateAllRisks]);
  
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const oneHourAgo = Date.now() - 3600000;
      for (const id of usedAlertIdsRef.current) {
        const timestamp = parseInt(id.split('_')[1]);
        if (timestamp < oneHourAgo) usedAlertIdsRef.current.delete(id);
      }
    }, 60000);
    return () => clearInterval(cleanupInterval);
  }, []);
  
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
    
    const metricsInterval = setInterval(() => {
      const revenueChange = 1 + (Math.random() - 0.48) * 0.006;
      const profitChange = 1 + (Math.random() - 0.45) * 0.008;
      const cacChange = 1 + (Math.random() - 0.52) * 0.007;
      
      const newRevenue = Math.max(115000, Math.min(145000, currentRevenue * revenueChange));
      const newProfit = Math.max(31000, Math.min(42000, currentProfit * profitChange));
      const newMargin = (newProfit / newRevenue) * 100;
      const newCac = Math.max(43, Math.min(52, currentCac * cacChange));
      
      const now = Date.now();
      const timeSinceLastAlert = now - lastAlertTimeRef.current;
      
      if (timeSinceLastAlert > 25000 && risks.length < 8) {
        const alert = generateAlertFromState(
          integrations,
          newRevenue, currentRevenue,
          newProfit, currentProfit,
          usedAlertIdsRef.current
        );
        
        if (alert) {
          const alertIdKey = `${alert.alertType}_${Math.floor(now / 60000)}`;
          if (!usedAlertIdsRef.current.has(alertIdKey)) {
            usedAlertIdsRef.current.add(alertIdKey);
            const translatedAlert = translateRisk(alert, T);
            setRisks(prev => [translatedAlert, ...prev.slice(0, 7)]);
            setAlertCount(prev => prev + 1);
            setLastNotification(translatedAlert);
            lastAlertTimeRef.current = now;
            setTimeout(() => setLastNotification(null), 7000);
          }
        }
      }
      
      setPrevRevenue(currentRevenue);
      setPrevProfit(currentProfit);
      setPrevMargin(currentMargin);
      setPrevCac(currentCac);
      
      setCurrentRevenue(newRevenue);
      setCurrentProfit(newProfit);
      setCurrentMargin(newMargin);
      setCurrentCac(newCac);
      
      setRevenueQueue(prev => addToQueue(prev, newRevenue));
      setProfitQueue(prev => addToQueue(prev, newProfit));
      setMarginQueue(prev => addToQueue(prev, newMargin));
      setCacQueue(prev => addToQueue(prev, newCac));
    }, 4500);
    
    return () => {
      clearInterval(metricsInterval);
      clearInterval(integrationsInterval);
    };
  }, [isOpen, currentRevenue, currentProfit, currentMargin, currentCac, integrations, T, risks.length]);
  
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
  
  const revenueChange = ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1);
  const profitChange = ((currentProfit - prevProfit) / prevProfit * 100).toFixed(1);
  const marginChange = (currentMargin - prevMargin).toFixed(1);
  const cacChange = ((currentCac - prevCac) / prevCac * 100).toFixed(1);
  
  const sidebarItems = [
    { icon: LayoutDashboard, label: T.demoOverview || "Dashboard Overview", view: "overview" as ViewType },
    { icon: AlertTriangle, label: T.demoRiskDetection || "Risk Detection", view: "risks" as ViewType },
    { icon: TrendingUp, label: T.demoCashflowForecast || "Cashflow Forecast", view: "forecast" as ViewType },
    { icon: Link2, label: T.demoIntegrations || "Integrations", view: "integrations" as ViewType },
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
        <button onClick={onClose} className="absolute top-3 right-3 z-50 w-8 h-8 rounded-lg bg-gray-800/50 flex items-center justify-center text-gray-400 hover:text-white transition-colors">
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
          <div className="flex-1 p-4 sm:p-6 overflow-auto">
            
            {/* Mobile navigation */}
            <div className="flex md:hidden items-center justify-between mb-5">
              <div className="flex gap-2 overflow-x-auto pb-1 flex-1">
                {sidebarItems.map((item) => (
                  <button key={item.label} onClick={() => setActiveView(item.view)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${activeView === item.view ? "bg-blue-500/20 text-blue-400" : "text-gray-500 bg-gray-800/30"}`}>
                    <item.icon className="w-4 h-4" /> {item.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowTelegramPopup(true)} className="ml-2 p-2 bg-gray-800/30 rounded-lg relative">
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
                            <button onClick={() => removeRisk(risk.id)} className="text-gray-500 hover:text-white/60"><X className="w-3.5 h-3.5" /></button>
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
            
            {/* Integrations View */}
            {activeView === "integrations" && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-bold text-white">{T.demoIntegrations || "Integrations"}</h2>
                    <p className="text-sm text-gray-500 mt-1">{T.demoConnectedSources || "Connected data sources"}</p>
                  </div>
                  <Button size="default" className="bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 font-semibold">+ {T.demoAddIntegration || "Add"}</Button>
                </div>
                <div className="space-y-3">
                  {integrations.map((integration) => (
                    <div key={integration.id} className={`bg-gray-900/30 rounded-xl p-4 flex justify-between items-center border ${integration.status === "error" ? "border-red-500/30 bg-red-500/5" : "border-gray-800"}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center">
                          <Link className="w-5 h-5 text-gray-400" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-white">{integration.name}</h4>
                          <p className="text-xs text-gray-500">{integration.lastSync}</p>
                          {integration.errorMessage && <p className="text-xs text-red-400 mt-0.5">{integration.errorMessage}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {integration.status === "error" ? (
                          <Button onClick={() => reconnectIntegration(integration.id)} size="sm" variant="outline" className="border-red-500/50 text-red-400 hover:bg-red-500/20">
                            <Wifi className="w-3 h-3 mr-1" /> {T.alertReconnect || "Reconnect"}
                          </Button>
                        ) : (
                          getStatusBadge(integration.status)
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="bg-gray-900/20 rounded-xl p-4 border border-gray-800 mt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-green-400" />
                      <span className="text-sm text-gray-400">{T.demoDataSyncStatus || "Data Sync Status"}</span>
                    </div>
                    <span className="text-xs text-green-400">{T.demoAllSystemsOperational || "All systems operational"}</span>
                  </div>
                  <div className="mt-3 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${integrations.filter(i => i.status === "connected").length / integrations.length * 100}%` }}></div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">{integrations.filter(i => i.status === "connected").length}/{integrations.length} {T.demoIntegrationsActive || "integrations active"}</p>
                </div>
              </div>
            )}
            
            {/* Notification Toast */}
            {lastNotification && activeView !== "risks" && (
              <div className="fixed bottom-20 right-4 left-4 md:left-auto md:right-4 md:w-80 bg-gray-900/95 rounded-xl p-4 border-l-4 border-blue-500 shadow-xl animate-in slide-in-from-right-5 fade-in duration-300 backdrop-blur-md z-50">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`p-1 rounded ${lastNotification.severity === "high" ? "bg-red-500/20" : lastNotification.severity === "medium" ? "bg-yellow-500/20" : "bg-blue-500/20"}`}>
                        {getCategoryIcon(lastNotification.category)}
                      </div>
                      <p className="text-sm font-semibold text-white">{lastNotification.title}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{lastNotification.description}</p>
                  </div>
                  <button onClick={() => setLastNotification(null)} className="text-gray-500 hover:text-white/80"><X className="w-3 h-3" /></button>
                </div>
                <button onClick={() => setActiveView("risks")} className="mt-2 text-xs text-blue-400 hover:text-blue-300 font-medium">{T.demoViewInRisks || "View in Risks →"}</button>
              </div>
            )}
            
            {/* Telegram Popup */}
            {showTelegramPopup && (
              <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
                <div className="bg-gray-900 rounded-xl p-6 w-full max-w-md border border-gray-800">
                  <div className="flex justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">{T.demoTelegramAlerts || "Telegram Alerts"}</h3>
                    <button onClick={() => setShowTelegramPopup(false)}><X className="w-5 h-5 text-gray-500" /></button>
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
      </div>
    </div>
  );
}
