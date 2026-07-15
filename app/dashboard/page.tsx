// app/dashboard/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLanguage, Language } from "@/lib/translations";
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
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";

type ViewType = "overview" | "risks" | "forecast" | "integrations" | "settings";

interface Risk {
  id: number;
  title: string;
  description: string;
  time: string;
  severity: "high" | "medium" | "low";
  action: string;
  category: "ads" | "inventory" | "finance" | "shipping" | "conversion" | "cac" | "margin" | "integration";
  alertType?: string;
  integrationId?: string;
}

interface Integration {
  id: string;
  name: string;
  status: "connected" | "error" | "pending";
  lastSync: string;
  lastSyncTime?: Date;
  errorMessage?: string;
}

// Базовые значения
const BASE_REVENUE = 125608;
const BASE_PROFIT = 34563;
const BASE_MARGIN = 27.5;
const BASE_CAC = 47;

// Интеграции
const INITIAL_INTEGRATIONS: Integration[] = [
  { id: "stripe", name: "Stripe", status: "connected", lastSync: "2 min ago", lastSyncTime: new Date() },
  { id: "shopify", name: "Shopify", status: "connected", lastSync: "5 min ago", lastSyncTime: new Date() },
  { id: "meta", name: "Meta Ads", status: "connected", lastSync: "1 min ago", lastSyncTime: new Date() },
  { id: "google", name: "Google Analytics", status: "pending", lastSync: "Setup required", lastSyncTime: new Date(0) },
  { id: "quickbooks", name: "QuickBooks", status: "connected", lastSync: "15 min ago", lastSyncTime: new Date(Date.now() - 900000) },
];

// Генерация данных для графика (30 дней)
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

// Генерация данных для тикеров
const generateTickerData = (baseValue: number, volatility: number, trend: number = 0) => {
  const data = [];
  let value = baseValue;
  for (let i = 0; i < 24; i++) {
    const trendEffect = value * trend;
    const change = (Math.random() - 0.48) * volatility;
    value = value + trendEffect + change;
    value = Math.max(baseValue * 0.94, Math.min(baseValue * 1.06, value));
    data.push(Math.round(value * 100) / 100);
  }
  return data;
};

const CHART_DATA = generateRealisticChartData();

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
        
        <div className="ml-12 h-48 sm:h-64 flex items-end gap-0.5 sm:gap-1 overflow-x-auto pb-2">
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
              <div key={idx} className="flex-1 flex flex-col items-center gap-0.5 group cursor-pointer min-w-[20px] sm:min-w-[24px]" onMouseEnter={() => setHoveredBar(idx)} onMouseLeave={() => setHoveredBar(null)}>
                <div className="relative w-full">
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
          <div className="text-[10px] text-gray-500 mt-1">↑ {Math.abs(((history[history.length-1].revenue - history[0].revenue) / history[0].revenue * 100)).toFixed(0)}% {T.demoVsStart || "vs start"}</div>
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
        <span>{T.demoPeakMargin || "Peak margin"}: {history[bestDay].margin}%</span>
        <span>{T.demoLowMargin || "Low margin"}: {history[worstDay].margin}%</span>
      </div>
    </div>
  );
}

// ========== КОМПОНЕНТ КАРТОЧКИ МЕТРИКИ С АНИМАЦИЕЙ ==========
function MetricCard({ title, value, change, icon: Icon, color, prefix = "$", suffix = "", sparklineData, prevValue }: { 
  title: string; value: number; change: number; icon: any; color: string; prefix?: string; suffix?: string; 
  sparklineData: number[]; prevValue: number;
}) {
  const isPositive = change >= 0;
  const displayValue = suffix === "%" ? value.toFixed(1) : value.toLocaleString();

  return (
    <div className={`bg-gradient-to-br ${color}/10 to-transparent rounded-xl p-3 sm:p-4 border ${color}/20 overflow-hidden`}>
      <div className="flex items-center justify-between mb-2 gap-1">
        <div className={`w-7 h-7 rounded-lg ${color}/20 flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-3.5 h-3.5 ${color.replace("bg-", "text-")}`} />
        </div>
        <div className={`flex items-center gap-0.5 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full flex-shrink-0 ${isPositive ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
          {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {isPositive ? "+" : ""}{Math.abs(change)}%
        </div>
      </div>
      <div className="flex items-end justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-base sm:text-xl font-bold text-white truncate">{prefix}{displayValue}{suffix}</div>
          <div className="text-[11px] sm:text-xs text-gray-400 mt-0.5 truncate">{title}</div>
        </div>
        <div className="flex-shrink-0 w-12 sm:w-24">
          <TickerSparkline history={sparklineData} color={color.replace("bg-", "bg-").replace("/10", "/40")} currentValue={value} previousValue={prevValue} />
        </div>
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
    default: return <AlertCircle className="w-4 h-4" />;
  }
}

// Статичные риски для демо
const INITIAL_RISKS: Risk[] = [
  {
    id: 1,
    title: "Low stock alert",
    description: "Top SKU #4521 has only 3 days of stock remaining",
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    severity: "high",
    action: "Reorder Now",
    category: "inventory",
  },
  {
    id: 2,
    title: "Conversion rate dropping",
    description: "Checkout completion dropped 12% in last 2 hours",
    time: new Date(Date.now() - 600000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    severity: "high",
    action: "Check Funnel",
    category: "conversion",
  },
  {
    id: 3,
    title: "Ad spend spike",
    description: "Meta Ads spending 23% above daily budget",
    time: new Date(Date.now() - 1200000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    severity: "medium",
    action: "Check Campaigns",
    category: "ads",
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeView, setActiveView] = useState<ViewType>("overview");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  // Состояния для живых метрик
  const [currentRevenue, setCurrentRevenue] = useState(BASE_REVENUE);
  const [currentProfit, setCurrentProfit] = useState(BASE_PROFIT);
  const [currentMargin, setCurrentMargin] = useState(BASE_MARGIN);
  const [currentCac, setCurrentCac] = useState(BASE_CAC);
  const [prevRevenue, setPrevRevenue] = useState(BASE_REVENUE);
  const [prevProfit, setPrevProfit] = useState(BASE_PROFIT);
  const [prevMargin, setPrevMargin] = useState(BASE_MARGIN);
  const [prevCac, setPrevCac] = useState(BASE_CAC);
  
  // Очереди для спарклайнов
  const [revenueQueue, setRevenueQueue] = useState<number[]>(() => generateTickerData(BASE_REVENUE, 400, 0.0003));
  const [profitQueue, setProfitQueue] = useState<number[]>(() => generateTickerData(BASE_PROFIT, 300, 0.0002));
  const [marginQueue, setMarginQueue] = useState<number[]>(() => generateTickerData(BASE_MARGIN, 0.4, 0.0001));
  const [cacQueue, setCacQueue] = useState<number[]>(() => generateTickerData(BASE_CAC, 1.2, -0.0001));
  
  const [risks, setRisks] = useState<Risk[]>(INITIAL_RISKS);
  const [alertCount, setAlertCount] = useState(INITIAL_RISKS.length);
  const [integrations, setIntegrations] = useState<Integration[]>(INITIAL_INTEGRATIONS);
  
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(30);
  const [timezone, setTimezone] = useState("America/New_York");
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [profileName, setProfileName] = useState("John Doe");
  const [profileEmail, setProfileEmail] = useState("john.doe@rivant.com");
  const [profilePhone, setProfilePhone] = useState("+1 (555) 123-4567");
  const [profileInitials, setProfileInitials] = useState("JD");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [editName, setEditName] = useState("John Doe");
  const [editEmail, setEditEmail] = useState("john.doe@rivant.com");
  const [editPhone, setEditPhone] = useState("+1 (555) 123-4567");
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  
  const addToQueue = <T,>(queue: T[], newValue: T): T[] => [...queue.slice(1), newValue];
  
  useEffect(() => {
    const isLoggedIn = localStorage.getItem("isLoggedIn");
    if (isLoggedIn !== "true") {
      router.push("/");
    } else {
      setIsAuthenticated(true);
    }
  }, [router]);
  
  
  const revenueChange = ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1);
  const profitChange = ((currentProfit - prevProfit) / prevProfit * 100).toFixed(1);
  const marginChange = (currentMargin - prevMargin).toFixed(1);
  const cacChange = ((currentCac - prevCac) / prevCac * 100).toFixed(1);
  
  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = () => {
    localStorage.removeItem("isLoggedIn");
    router.push("/");
  };

  const openEditProfile = () => {
    setEditName(profileName);
    setEditEmail(profileEmail);
    setEditPhone(profilePhone);
    setEditPhotoUrl(profilePhotoUrl);
    setShowEditProfileModal(true);
  };

  const saveProfile = () => {
    const initials = editName.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    setProfileName(editName);
    setProfileEmail(editEmail);
    setProfilePhone(editPhone);
    setProfileInitials(initials);
    setProfilePhotoUrl(editPhotoUrl);
    setShowEditProfileModal(false);
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
  
  return (
    <div className="h-screen bg-background flex flex-col lg:flex-row overflow-hidden pb-16 lg:pb-0">
      {/* Затемняющая подложка — тап мимо меню закрывает его */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar - как в демо */}
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
              className="lg:hidden w-9 h-9 flex-shrink-0 rounded-lg bg-gray-800/70 flex items-center justify-center text-gray-300 hover:text-white transition-colors"
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
                  <div className="text-xs text-gray-500">{getTranslation("growthPlan", "Growth Plan")}</div>
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
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
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
                    <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-yellow-500 text-[10px] font-bold flex items-center justify-center text-white">
                      {alertCount}
                    </span>
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
                            alert.severity === "high" ? "bg-red-500" : 
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
        
        {/* Content */}
       <div className="flex-1 p-4 lg:p-6 overflow-auto">
          
          {/* Overview View - как в демо лайв */}
          {activeView === "overview" && (
            <div className="space-y-5">
              
              
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard 
                  title={T.revenue || "Revenue"} 
                  value={currentRevenue} 
                  change={parseFloat(revenueChange)} 
                  icon={DollarSign} 
                  color="bg-blue-500"
                  prefix="$"
                  sparklineData={revenueQueue}
                  prevValue={prevRevenue}
                />
                <MetricCard 
                  title={T.profit || "Profit"} 
                  value={currentProfit} 
                  change={parseFloat(profitChange)} 
                  icon={TrendingUp} 
                  color="bg-green-500"
                  prefix="$"
                  sparklineData={profitQueue}
                  prevValue={prevProfit}
                />
                <MetricCard 
                  title={T.margin || "Margin"} 
                  value={currentMargin} 
                  change={parseFloat(marginChange)} 
                  icon={LineChart} 
                  color="bg-purple-500"
                  suffix="%"
                  sparklineData={marginQueue}
                  prevValue={prevMargin}
                />
                <MetricCard 
                  title={T.cac || "CAC"} 
                  value={currentCac} 
                  change={parseFloat(cacChange)} 
                  icon={Users} 
                  color="bg-orange-500"
                  prefix="$"
                  sparklineData={cacQueue}
                  prevValue={prevCac}
                />
              </div>
              
              <RevenueExpensesChart />
            </div>
          )}
          
          {/* Risks View */}
{activeView === "risks" && (
  <div className="space-y-4">
    
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500">{risks.length} {language === "UA" ? "сповіщень" : language === "DE" ? "Benachrichtigungen" : "notifications"}</span>
      {risks.length > 0 && (
        <button
          onClick={() => { setRisks([]); setAlertCount(0); }}
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
                        risk.severity === "high" ? "bg-red-500/20" : risk.severity === "medium" ? "bg-yellow-500/20" : "bg-blue-500/20"
                      }`}>
                        {getCategoryIcon(risk.category)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            risk.severity === "high" ? "bg-red-500/20 text-red-400" : 
                            risk.severity === "medium" ? "bg-yellow-500/20 text-yellow-400" : "bg-blue-500/20 text-blue-400"
                          }`}>{risk.severity.toUpperCase()}</span>
                          <span className="text-xs text-gray-500">{risk.time}</span>
                        </div>
                        <h4 className="font-semibold text-white text-base">{risk.title}</h4>
                        <p className="text-sm text-gray-400 mt-0.5">{risk.description}</p>
                        <Button size="sm" variant="outline" className="mt-3 h-8 text-sm border-gray-700 text-gray-400 hover:bg-gray-800">
          {risk.action}
        </Button>
      </div>
      <button
        onClick={() => { setRisks(prev => prev.filter(r => r.id !== risk.id)); setAlertCount(prev => Math.max(0, prev - 1)); }}
        className="text-gray-600 hover:text-gray-300 transition-colors p-1 rounded-lg hover:bg-gray-800 self-start shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
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

              {/* 1. Метрики */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-blue-500/10 to-transparent rounded-xl p-5 border border-blue-500/20">
                  <div className="text-sm text-blue-400 font-semibold mb-1">{T.projectedRevenue || "Projected Revenue (90d)"}</div>
                  <div className="text-3xl font-bold text-white">$892,400</div>
                  <div className="text-sm text-green-400 mt-2">+18% {T.demoVsLastQuarter || "vs last quarter"}</div>
                  <div className="text-xs text-gray-500 mt-3">{T.demoConfidence || "Confidence"}: 94%</div>
                </div>
                <div className="bg-gradient-to-br from-orange-500/10 to-transparent rounded-xl p-5 border border-orange-500/20">
                  <div className="text-sm text-orange-400 font-semibold mb-1">{T.projectedExpenses || "Projected Expenses (90d)"}</div>
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
                    { month: "Jul", revenue: 280, expenses: 210, revenueActual: 268 },
                    { month: "Aug", revenue: 298, expenses: 215, revenueActual: 291 },
                    { month: "Sep", revenue: 312, expenses: 222, revenueActual: null }
                  ].map((m, i) => (
                    <div key={i} className="flex flex-col items-center gap-2 flex-1 min-w-0">
                      <div className="relative w-full flex justify-center gap-1 sm:gap-2 items-end">
                        {m.revenueActual && (
                          <div className="w-4 sm:w-8 bg-blue-500/30 rounded-t" style={{ height: `${m.revenueActual / 3.2}px` }} />
                        )}
                        <div className="w-4 sm:w-8 bg-blue-500 rounded-t" style={{ height: `${m.revenue / 3.2}px` }} />
                        <div className="w-4 sm:w-8 bg-rose-500/60 rounded-t" style={{ height: `${m.expenses / 3.2}px` }} />
                      </div>
                      <span className="text-xs sm:text-sm text-gray-400 font-medium truncate max-w-full">{m.month}</span>
                      <div className="flex gap-1.5 sm:gap-2 text-[9px] sm:text-[10px]">
                        <span className="text-blue-400">↑${m.revenue}k</span>
                        <span className="text-rose-400">↓${m.expenses}k</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-center gap-6 mt-4 pt-3 text-[10px] text-gray-600 border-t border-gray-800">
                  <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 rounded-sm" /><span>{T.demoRevenueForecast || "Revenue Forecast"}</span></div>
                  <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500/30 rounded-sm" /><span>{T.demoActualRevenue || "Actual Revenue"}</span></div>
                  <div className="flex items-center gap-1"><div className="w-3 h-3 bg-rose-500/60 rounded-sm" /><span>{T.demoExpensesForecast || "Expenses"}</span></div>
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
              
              
              <div className="space-y-3">
                {integrations.map((integration) => (
                  <div key={integration.id} className="bg-gray-900/30 rounded-xl p-4 flex justify-between items-center border border-gray-800">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center">
                        <Link2 className="w-5 h-5 text-gray-400" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-white">{integration.name}</h4>
                        <p className="text-xs text-gray-500">{integration.lastSync}</p>
                      </div>
                    </div>
                    {getStatusBadge(integration.status, T)}
                  </div>
                ))}
              </div>
              
              <div className="bg-gray-900/20 rounded-xl p-4 border border-gray-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-green-400" />
                    <span className="text-sm text-gray-400">{T.demoDataSyncStatus || "Data Sync Status"}</span>
                  </div>
                  <span className="text-xs text-green-400">{T.demoAllSystemsOperational || "All systems operational"}</span>
                </div>
                <div className="mt-3 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${integrations.filter(i => i.status === "connected").length / integrations.length * 100}%` }} />
                </div>
                <p className="text-xs text-gray-500 mt-2">{integrations.filter(i => i.status === "connected").length}/{integrations.length} {T.demoIntegrationsActive || "integrations active"}</p>
              </div>
            </div>
          )}
          
          {/* Settings View - с переводами */}
          {activeView === "settings" && (
            <div className="space-y-6">
              <div className="bg-card rounded-xl p-6 border border-border">
                <div className="flex flex-wrap items-center gap-4 mb-6">
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
                      <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">{T.growthPlan || "Growth Plan"}</span>
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
                  <div><label className="text-xs text-muted-foreground uppercase tracking-wider">{T.settingsCompanyName || "Company Name"}</label><p className="text-foreground font-medium mt-1">RIVANT Inc.</p></div>
                  <div><label className="text-xs text-muted-foreground uppercase tracking-wider">{T.settingsBusinessId || "Business ID"}</label><p className="text-foreground font-medium mt-1">RIV-2024-001</p></div>
                  <div><label className="text-xs text-muted-foreground uppercase tracking-wider">{T.settingsPhone || "Phone"}</label><p className="text-foreground font-medium mt-1">{profilePhone}</p></div>
                  <div><label className="text-xs text-muted-foreground uppercase tracking-wider">{T.settingsTimezone || "Timezone"}</label>
                    <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="mt-1 w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm">
                      <option value="America/New_York">Eastern Time (ET)</option>
                      <option value="Europe/Kyiv">EET (Kyiv)</option>
                      <option value="Europe/Berlin">CET (Berlin)</option>
                    </select>
                  </div>
                </div>
              </div>
              
              <div className="bg-card rounded-xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <BellRing className="w-4 h-4 text-primary" /> {T.settingsNotifications || "Notification Preferences"}
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between py-2">
                    <div><p className="font-medium text-foreground">{T.settingsPush || "Push Notifications"}</p><p className="text-xs text-muted-foreground">{T.settingsPushDesc || "Receive alerts in dashboard"}</p></div>
                    <Switch checked={notificationsEnabled} onCheckedChange={setNotificationsEnabled} />
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div><p className="font-medium text-foreground">{T.settingsEmail || "Email Alerts"}</p><p className="text-xs text-muted-foreground">{T.settingsEmailDesc || "Receive alerts via email"}</p></div>
                    <Switch checked={emailAlerts} onCheckedChange={setEmailAlerts} />
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div><p className="font-medium text-foreground">{T.settingsTelegram || "Telegram Notifications"}</p><p className="text-xs text-muted-foreground">{T.settingsTelegramDesc || "Connect Telegram for instant alerts"}</p></div>
                    <Button variant="outline" size="sm">{T.settingsConnect || "Connect"}</Button>
                  </div>
                </div>
              </div>
              
              <div className="bg-card rounded-xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" /> {T.settingsSecurity || "Security"}
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between py-2">
                    <div><p className="font-medium text-foreground">{T.settings2FA || "Two-Factor Authentication"}</p><p className="text-xs text-muted-foreground">{T.settings2FADesc || "Add an extra layer of security"}</p></div>
                    <Switch checked={twoFactorEnabled} onCheckedChange={setTwoFactorEnabled} />
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div><p className="font-medium text-foreground">{T.settingsChangePassword || "Change Password"}</p><p className="text-xs text-muted-foreground">{T.settingsChangePasswordDesc || "Update your password"}</p></div>
                    <Button variant="outline" size="sm">{T.settingsUpdate || "Update"}</Button>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div><p className="font-medium text-foreground">{T.settingsApiKeys || "API Keys"}</p><p className="text-xs text-muted-foreground">{T.settingsApiKeysDesc || "Manage API access tokens"}</p></div>
                    <Button variant="outline" size="sm">{T.settingsManage || "Manage"}</Button>
                  </div>
                </div>
              </div>
              
              <div className="bg-card rounded-xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Settings className="w-4 h-4 text-primary" /> {T.settingsPreferences || "Preferences"}
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between py-2">
                    <div><p className="font-medium text-foreground">{T.settingsAutoRefresh || "Auto-refresh Interval"}</p><p className="text-xs text-muted-foreground">{T.settingsAutoRefreshDesc || "How often data updates"}</p></div>
                    <select value={autoRefresh} onChange={(e) => setAutoRefresh(Number(e.target.value))} className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-foreground text-sm">
                      <option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={300}>5 minutes</option>
                    </select>
                  </div>
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
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-primary" /> {T.settingsDangerZone || "Danger Zone"}
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div><p className="font-medium text-foreground">{T.settingsDeleteAccount || "Delete Account"}</p><p className="text-xs text-muted-foreground">{T.settingsDeleteAccountDesc || "Permanently delete your account and all data"}</p></div>
                    <Button variant="destructive" size="sm">{T.settingsDeleteAccount || "Delete Account"}</Button>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <div><p className="font-medium text-foreground">{T.settingsExportData || "Export All Data"}</p><p className="text-xs text-muted-foreground">{T.settingsExportDataDesc || "Download all your business data"}</p></div>
                    <Button variant="outline" size="sm">{T.settingsExport || "Export"}</Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
      
      {/* Mobile Bottom Navigation */}
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

      {/* Hidden photo input */}
      <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />

      {/* Logout Confirmation Modal */}
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

      {/* Edit Profile Modal */}
      {showEditProfileModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-[400px] shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">
                {language === "UA" ? "Редагувати профіль" : language === "DE" ? "Profil bearbeiten" : "Edit Profile"}
              </h2>
              <button onClick={() => setShowEditProfileModal(false)} className="text-gray-500 hover:text-gray-300 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Avatar */}
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
