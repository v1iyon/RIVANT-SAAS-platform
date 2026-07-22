// app/page.tsx - полностью переработанный лендинг
"use client";

import { useState, useRef, useCallback, useEffect, type ComponentType } from "react";
import { Navbar } from "@/components/navbar";
import { HeroSection } from "@/components/hero-section";
import { LossCalculator } from "@/components/loss-calculator";
import { ProblemSolutionGrid } from "@/components/problem-solution-grid";
import { Testimonials } from "@/components/testimonials";
import { PricingSection } from "@/components/pricing-section";
import { ContactForm } from "@/components/contact-form";
import { Footer } from "@/components/footer";
import { LiveDemoModal } from "@/components/live-demo-modal";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/translations";
import { 
  LayoutDashboard, 
  AlertTriangle, 
  TrendingUp, 
  Link2, 
  Settings, 
  DollarSign, 
  Users, 
  LineChart, 
  Bell, 
  ArrowUpRight, 
  ArrowDownRight,
  BarChart3,
  Calendar,
  TrendingDown,
  Zap,
  Package,
  CreditCard,
  Truck,
  Activity,
  X,
  Play,
  Calculator,
  Star,
  Quote,
  Send,
  CheckCircle,
  Globe
} from "lucide-react";

// ========== КОМПОНЕНТ ГРАФИКА (как в демо) ==========
const generateChartData = () => {
  const data = [];
  let revenue = 82300;
  let expenses = 61500;
  let volatilityPhase = 0;
  
  for (let i = 0; i < 30; i++) {
    if (i % (7 + Math.floor(Math.random() * 5)) === 0) {
      volatilityPhase = Math.random();
    }
    
    let revenueAmp, expenseAmp;
    if (volatilityPhase < 0.3) {
      revenueAmp = 600;
      expenseAmp = 450;
    } else if (volatilityPhase < 0.7) {
      revenueAmp = 1800;
      expenseAmp = 1200;
    } else {
      revenueAmp = 4000;
      expenseAmp = 2800;
    }
    
    const revenueDir = Math.random() > 0.48 ? 1 : -1;
    const expenseDir = Math.random() > 0.52 ? 1 : -1;
    
    let revenueDelta = revenueDir * Math.random() * revenueAmp;
    let expenseDelta = expenseDir * Math.random() * expenseAmp;
    
    if (Math.random() > 0.88) {
      const spikeDir = Math.random() > 0.6 ? 1 : -1;
      const spikeSize = 5000 + Math.random() * 12000;
      revenueDelta += spikeDir * spikeSize;
      if (Math.random() > 0.4) {
        expenseDelta += spikeDir * spikeSize * (0.3 + Math.random() * 0.4);
      }
    }
    
    const isWeekend = (i % 7 === 5 || i % 7 === 6);
    if (isWeekend) {
      revenueDelta += -1200 + (Math.random() - 0.5) * 1000;
      expenseDelta += -800 + (Math.random() - 0.5) * 700;
    }
    
    const isMonday = (i % 7 === 0);
    if (isMonday && i > 0) {
      revenueDelta += 1500 + Math.random() * 1500;
      expenseDelta += 700 + Math.random() * 1000;
    }
    
    revenue = Math.max(58000, Math.min(172000, revenue + revenueDelta));
    expenses = Math.max(44000, Math.min(132000, expenses + expenseDelta));
    
    const expenseRatio = expenses / revenue;
    if (expenseRatio > 0.92) {
      expenses = revenue * (0.88 + Math.random() * 0.03);
    }
    if (expenseRatio < 0.62) {
      expenses = revenue * (0.65 + Math.random() * 0.05);
    }
    
    const profit = revenue - expenses;
    const margin = (profit / revenue) * 100;
    
    data.push({
      day: i + 1,
      revenue: Math.round(revenue),
      expenses: Math.round(expenses),
      profit: Math.round(profit),
      margin: Number(margin.toFixed(1))
    });
  }
  return data;
};

const CHART_DATA = generateChartData();

function RevenueChart() {
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
    if (selectedMetric === "revenue") return [0, 50000, 100000, 150000, 200000];
    if (selectedMetric === "expenses") return [0, 40000, 80000, 120000, 160000];
    return [-20000, 0, 20000, 40000, 60000];
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
  
  return (
    <div className="bg-gradient-to-br from-gray-900/80 to-black rounded-2xl p-4 sm:p-5 border border-gray-800">
      {/* Логотип RIVANT в углу графика */}
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-primary/20 flex items-center justify-center">
            <span className="text-primary text-xs font-bold">R</span>
          </div>
          <h3 className="text-lg font-bold text-white">Revenue & Cost Analysis</h3>
        </div>
        <span className="text-xs text-gray-500">30 days · actuals</span>
      </div>
      
      <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
        <div className="flex gap-2 bg-gray-800/50 rounded-lg p-1">
          <button
            onClick={() => setSelectedMetric("revenue")}
            className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
              selectedMetric === "revenue" ? "bg-blue-500/30 text-blue-400" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Revenue
          </button>
          <button
            onClick={() => setSelectedMetric("expenses")}
            className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
              selectedMetric === "expenses" ? "bg-rose-500/30 text-rose-400" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Expenses
          </button>
          <button
            onClick={() => setSelectedMetric("profit")}
            className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
              selectedMetric === "profit" ? "bg-green-500/30 text-green-400" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Profit
          </button>
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
            return (
              <div 
                key={idx}
                className="absolute w-full border-t border-gray-800/50"
                style={{ top: `${yPercent}%` }}
              />
            );
          })}
        </div>
        
        <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between text-[10px] font-mono">
          {ySteps.slice().reverse().map((step, idx) => {
            if (selectedMetric === "profit") {
              return (
                <div key={idx} className="text-gray-500 -translate-y-1/2">
                  {step >= 0 ? "+" : ""}{(step / 1000).toFixed(0)}k
                </div>
              );
            }
            return (
              <div key={idx} className="text-gray-500 -translate-y-1/2">
                ${(step / 1000).toFixed(0)}k
              </div>
            );
          })}
        </div>
        
        <div className="ml-12 h-48 sm:h-64 flex items-end gap-0.5 sm:gap-1 overflow-x-auto pb-2 scrollbar-thin">
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
                className="flex-1 flex flex-col items-center gap-0.5 group cursor-pointer min-w-[20px] sm:min-w-[24px]"
                onMouseEnter={() => setHoveredBar(idx)}
                onMouseLeave={() => setHoveredBar(null)}
              >
                <div className="relative w-full">
                  <div 
                    className={`w-full ${getBarColor()} rounded-t-sm transition-all duration-150`}
                    style={{ height: `${Math.max(percent, 3)}px`, minHeight: '3px' }}
                  />
                  
                  {hoveredBar === idx && (
                    <div className="absolute -top-28 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 z-20 shadow-xl whitespace-nowrap">
                      <div className="text-xs font-bold text-white">Day {item.day}</div>
                      <div className={`text-sm font-bold mt-1 ${getMetricValue(item) >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {selectedMetric === "revenue" && "$"}{value.toLocaleString()}
                        {selectedMetric === "profit" && (value >= 0 ? `+${value.toLocaleString()}` : value.toLocaleString())}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-1">
                        Rev: ${item.revenue.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        Exp: ${item.expenses.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-gray-600 mt-1">
                        Margin: {item.margin}% · Profit: ${item.profit.toLocaleString()}
                      </div>
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
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider">Total Revenue</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-white">${(totalRevenue / 1000).toFixed(0)}k</div>
        </div>
        
        <div className="bg-rose-500/5 rounded-xl p-2 sm:p-3 border border-rose-500/15">
          <div className="flex items-center gap-1 mb-1">
            <TrendingDown className="w-3 h-3 text-rose-400" />
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider">Total Expenses</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-white">${(totalExpenses / 1000).toFixed(0)}k</div>
        </div>
        
        <div className="bg-green-500/10 rounded-xl p-2 sm:p-3 border border-green-500/20">
          <div className="flex items-center gap-1 mb-1">
            <TrendingUp className="w-3 h-3 text-green-400" />
            <div className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-wider">Net Profit</div>
          </div>
          <div className="text-base sm:text-xl font-bold text-green-400">+${(totalProfit / 1000).toFixed(0)}k</div>
          <div className="text-[9px] text-green-400/70 mt-0.5">{avgMargin.toFixed(1)}% avg margin</div>
        </div>
      </div>
      
      <div className="flex justify-between items-center mt-3 pt-2 text-[9px] sm:text-[10px] text-gray-600 border-t border-gray-800/50">
        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Last 30 days →</span>
        <span>Profit trend: +{((history[history.length-1].profit - history[0].profit) / Math.abs(history[0].profit) * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ========== СЕКЦИЯ "БОЛЬШИНСТВО БИЗНЕСОВ ТЕРЯЮТ ПРИБЫЛЬ" ==========
function HeroMainSection({ onOpenCalculator, onOpenDemo }: { onOpenCalculator: () => void; onOpenDemo: () => void }) {
  const { t } = useLanguage();
  const T = t as any;
  
  return (
    <section className="relative min-h-[90vh] flex items-center justify-center pt-20 px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-primary/5 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto text-center">
        {/* Маленький логотип RIVANT в углу секции */}
        <div className="absolute -top-8 -left-8 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-primary text-2xl font-bold">R</span>
        </div>
        
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-secondary/80 rounded-full mb-6">
          <Zap className="w-4 h-4 text-primary" />
          <span className="text-xs text-muted-foreground">{T.trustedBy || "Trusted by 500+ companies"}</span>
        </div>

        <h1 className="text-4xl sm:text-7xl font-bold tracking-tight mb-6">
          <span className="text-foreground">Більшість бізнесів</span>
          <br />
          <span className="text-primary">втрачають прибуток непомітно</span>
        </h1>

        <p className="text-base sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
          RIVANT виявляє приховані втрати до того, як вони стануть дорогими
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button
            size="lg"
            className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base font-medium glow-blue"
            onClick={onOpenCalculator}
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
</svg>
            {T.calculateLosses || "Перейти до аналізу"}
          </Button>

          <Button
            size="lg"
            variant="outline"
            className="w-full sm:w-auto border-primary/50 text-primary hover:bg-primary/10 px-8 py-6 text-base font-medium"
            onClick={onOpenDemo}
          >
            <Play className="w-5 h-5 mr-2" />
            {T.watchDemo || "Дивитись демо"}
          </Button>
        </div>
        
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>🔒 Нам довіряють 500+ компаній</span>
          <span className="w-1 h-1 rounded-full bg-muted-foreground" />
          <span>⭐ 4.9 / 5</span>
        </div>
      </div>
    </section>
  );
}

// ========== СЕКЦИЯ "RIVANT ПЕРЕТВОРЮЄ ХАОС НА ЯСНІСТЬ" ==========
function ClaritySection() {
  const { t } = useLanguage();
  const T = t as any;
  
  const stats = [
    { value: "-73%", label: T.statReportTime || "Час звітності", suffix: "" },
    { value: "+28%", label: T.statProfitMargin || "Маржа прибутку", suffix: "" },
    { value: "2.5", label: T.statSavedDaily || "Заощаджено щодня", suffix: "hrs" },
    { value: "24/7", label: T.statMonitoring || "Моніторинг", suffix: "" },
  ];
  
  return (
    <section className="py-16 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="relative">
            {/* Логотип в углу */}
            <div className="absolute -top-6 -left-6 w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <span className="text-primary text-xl font-bold">R</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              RIVANT перетворює<br />хаос на <span className="text-primary">ясність</span>
            </h2>
            <p className="text-muted-foreground text-lg mb-8">Одна панель. Інсайти в реальному часі</p>
            <div className="grid grid-cols-2 gap-4">
              {stats.map((stat, idx) => (
                <div key={idx} className="glass rounded-2xl p-6 text-center border border-white/10">
                  <div className="text-3xl sm:text-4xl font-bold text-primary">{stat.value}</div>
                  <div className="text-sm text-muted-foreground mt-1">{stat.label} {stat.suffix}</div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="glass-strong rounded-2xl p-8 text-center relative">
            <div className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-primary text-sm font-bold">R</span>
            </div>
            <h3 className="text-2xl font-bold text-foreground mb-2">Реальні результати</h3>
            <p className="text-muted-foreground mb-6">Приєднуйтесь до сотень компаній</p>
            <div className="flex flex-wrap justify-center gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">500+</div>
                <div className="text-xs text-muted-foreground">компаній</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">94%</div>
                <div className="text-xs text-muted-foreground">задоволених</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">3.2x</div>
                <div className="text-xs text-muted-foreground">ROI</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ========== СЕКЦИЯ С 3 ШАГАМИ + ФОРМА ==========
function StepsAndFormSection() {
  const { t } = useLanguage();
  const T = t as any;
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formData, setFormData] = useState({ telegram: "" });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
    setTimeout(() => {
      setIsSubmitted(false);
      setFormData({ telegram: "" });
    }, 3000);
  };
  
  const steps = [
    { num: "1", title: T.step1 || "Розкажіть про цілі бізнесу", desc: T.step1Desc || "Детальний аналіз вашої моделі" },
    { num: "2", title: T.step2 || "Отримайте аналіз", desc: T.step2Desc || "Ми вкажемо на зони втрат" },
    { num: "3", title: T.step3 || "Почніть заощаджувати", desc: T.step3Desc || "Впроваджуйте рішення" },
  ];
  
  return (
    <section className="py-16 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Steps */}
          <div className="relative">
            <div className="absolute -top-6 -left-6 w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <span className="text-primary text-xl font-bold">R</span>
            </div>
            <div className="space-y-8">
              {steps.map((step, idx) => (
                <div key={idx} className="flex gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-primary text-xl font-bold">{step.num}</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">{step.title}</h3>
                    <p className="text-muted-foreground">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Form */}
          <div className="glass rounded-2xl p-6 sm:p-8 relative">
            <div className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-primary text-sm font-bold">R</span>
            </div>
            {isSubmitted ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                  <CheckCircle className="w-8 h-8 text-green-500" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Дякуємо!</h3>
                <p className="text-muted-foreground">Ми зв'яжемося з вами протягом 24 годин.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Telegram Username <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.telegram}
                    onChange={(e) => setFormData({ telegram: e.target.value })}
                    placeholder="@username"
                    className="w-full px-4 py-3 bg-input border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
                  />
                </div>
                <Button type="submit" size="lg" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                  <Send className="w-4 h-4 mr-2" />
                  {T.requestDemoBtn || "Надіслати запит"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">Ми поважаємо ваші дані 🔒</p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ========== СЕКЦИЯ ДАШБОРДА (МЕТРИКИ + ГРАФИК + TELEGRAM) ==========
function LiveDashboardPreview() {
  const { t } = useLanguage();
  const T = t as any;
  
  // Анимированные метрики (простая имитация)
  const [metrics, setMetrics] = useState({
    revenue: 125327,
    profit: 34509,
    margin: 23.0,
    cac: 47
  });
  
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(prev => ({
        revenue: prev.revenue + (Math.random() - 0.5) * 200,
        profit: prev.profit + (Math.random() - 0.5) * 80,
        margin: Math.max(20, Math.min(28, prev.margin + (Math.random() - 0.5) * 0.3)),
        cac: Math.max(40, Math.min(55, prev.cac + (Math.random() - 0.5) * 1.2))
      }));
    }, 5000);
    return () => clearInterval(interval);
  }, []);
  
  const revenueChange = ((metrics.revenue - 125327) / 125327 * 100).toFixed(1);
  const profitChange = ((metrics.profit - 34509) / 34509 * 100).toFixed(1);
  const marginChange = (metrics.margin - 23.0).toFixed(1);
  const cacChange = ((metrics.cac - 47) / 47 * 100).toFixed(1);
  
  return (
    <section className="py-16 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-gray-950 to-black rounded-2xl border border-gray-800 p-4 sm:p-6 relative">
          {/* Логотипы RIVANT по углам дашборда */}
          <div className="absolute -top-4 -left-4 w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <span className="text-primary text-sm font-bold">R</span>
          </div>
          <div className="absolute -bottom-4 -right-4 w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <span className="text-primary text-sm font-bold">R</span>
          </div>
          
          <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
            <div>
              <h2 className="text-2xl font-bold text-white">Огляд панелі</h2>
              <p className="text-sm text-gray-500">Метрики в реальному часі</p>
            </div>
            <div className="flex items-center gap-2 bg-green-500/10 px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm text-green-400 font-medium">{T.demoLive || "LIVE"}</span>
            </div>
          </div>
          
          {/* Метрики */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-blue-500/10 rounded-xl p-4 border border-blue-500/20">
              <div className="text-xs text-blue-400 font-semibold mb-1">Revenue (live)</div>
              <div className="text-xl font-bold text-white">${Math.round(metrics.revenue).toLocaleString()}</div>
              <div className={`text-xs flex items-center gap-0.5 mt-1 ${parseFloat(revenueChange) >= 0 ? "text-green-400" : "text-red-400"}`}>
                {parseFloat(revenueChange) >= 0 ? "+" : ""}{revenueChange}% <ArrowUpRight className="w-3 h-3" />
              </div>
            </div>
            
            <div className="bg-green-500/10 rounded-xl p-4 border border-green-500/20">
              <div className="text-xs text-green-400 font-semibold mb-1">Profit (live)</div>
              <div className="text-xl font-bold text-white">${Math.round(metrics.profit).toLocaleString()}</div>
              <div className={`text-xs flex items-center gap-0.5 mt-1 ${parseFloat(profitChange) >= 0 ? "text-green-400" : "text-red-400"}`}>
                {parseFloat(profitChange) >= 0 ? "+" : ""}{profitChange}% <ArrowUpRight className="w-3 h-3" />
              </div>
            </div>
            
            <div className="bg-purple-500/10 rounded-xl p-4 border border-purple-500/20">
              <div className="text-xs text-purple-400 font-semibold mb-1">Margin (live)</div>
              <div className="text-xl font-bold text-white">{metrics.margin.toFixed(1)}%</div>
              <div className={`text-xs flex items-center gap-0.5 mt-1 ${parseFloat(marginChange) >= 0 ? "text-green-400" : "text-red-400"}`}>
                {parseFloat(marginChange) >= 0 ? "+" : ""}{marginChange}% <ArrowUpRight className="w-3 h-3" />
              </div>
            </div>
            
            <div className="bg-orange-500/10 rounded-xl p-4 border border-orange-500/20">
              <div className="text-xs text-orange-400 font-semibold mb-1">CAC (live)</div>
              <div className="text-xl font-bold text-white">${Math.round(metrics.cac)}</div>
              <div className={`text-xs flex items-center gap-0.5 mt-1 ${parseFloat(cacChange) >= 0 ? "text-green-400" : "text-red-400"}`}>
                {parseFloat(cacChange) >= 0 ? "+" : ""}{cacChange}% <ArrowDownRight className="w-3 h-3" />
              </div>
            </div>
          </div>
          
          {/* График */}
          <RevenueChart />
          
          {/* Telegram уведомления */}
          <div className="mt-6 flex items-center justify-between p-4 bg-gray-900/50 rounded-xl border border-gray-800">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Bell className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-white">Telegram сповіщення</div>
                <div className="text-xs text-gray-500">Отримуйте сповіщення про аномалії в реальному часі</div>
              </div>
            </div>
            <Button size="sm" variant="outline" className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10">
              Підключити
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ========== СЕКЦИЯ "ОРГАН, МЕТРИКИ, РИЗИКИ, ПРОГНОЗ" (НАВИГАЦИЯ) ==========
function OrgNavigationSection() {
  const { t } = useLanguage();
  const T = t as any;
  const [activeTab, setActiveTab] = useState("overview");
  
  const navItems = [
    { id: "overview", label: "Огляд", icon: LayoutDashboard },
    { id: "risks", label: "Ризики", icon: AlertTriangle },
    { id: "forecast", label: "Прогноз", icon: TrendingUp },
    { id: "integrations", label: "Інтеграції", icon: Link2 },
    { id: "settings", label: "Налаштування", icon: Settings },
  ];
  
  return (
    <section className="py-16 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-gray-900/50 to-black rounded-2xl border border-gray-800 p-4 sm:p-6 relative">
          {/* Логотип RIVANT в углу */}
          <div className="absolute -top-4 -left-4 w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <span className="text-primary text-sm font-bold">R</span>
          </div>
          
          <div className="flex flex-wrap gap-2 mb-6 border-b border-gray-800 pb-4">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === item.id 
                    ? "bg-primary/20 text-primary" 
                    : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
          </div>
          
          {/* Контент вкладок */}
          <div className="mt-4">
            {activeTab === "overview" && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-gray-800/30 rounded-xl p-4">
                  <div className="text-xs text-gray-500">Дохід (30 днів)</div>
                  <div className="text-xl font-bold text-white">$127 450</div>
                  <div className="text-xs text-green-400">+12%</div>
                </div>
                <div className="bg-gray-800/30 rounded-xl p-4">
                  <div className="text-xs text-gray-500">Прибуток (30 днів)</div>
                  <div className="text-xl font-bold text-white">$34 280</div>
                  <div className="text-xs text-green-400">+8%</div>
                </div>
                <div className="bg-gray-800/30 rounded-xl p-4">
                  <div className="text-xs text-gray-500">Маржа</div>
                  <div className="text-xl font-bold text-white">26.9%</div>
                  <div className="text-xs text-green-400">+2.3%</div>
                </div>
                <div className="bg-gray-800/30 rounded-xl p-4">
                  <div className="text-xs text-gray-500">CAC</div>
                  <div className="text-xl font-bold text-white">$47</div>
                  <div className="text-xs text-green-400">+12%</div>
                </div>
              </div>
            )}
            
            {activeTab === "risks" && (
              <div className="space-y-3">
                <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                    <div className="font-medium text-white">Meta Ads ROAS dropped below 2.0</div>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">Campaign 'Summer Sale' performing 34% below target</p>
                </div>
                <div className="bg-yellow-500/10 rounded-xl p-4 border border-yellow-500/20">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-400" />
                    <div className="font-medium text-white">Inventory turnover slowing</div>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">SKU #4521 has 45 days of stock remaining</p>
                </div>
              </div>
            )}
            
            {activeTab === "forecast" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-blue-500/10 rounded-xl p-4">
                  <div className="text-sm text-blue-400">Projected Revenue (90d)</div>
                  <div className="text-2xl font-bold text-white">$892,400</div>
                  <div className="text-sm text-green-400">+18% vs last quarter</div>
                </div>
                <div className="bg-orange-500/10 rounded-xl p-4">
                  <div className="text-sm text-orange-400">Projected Expenses (90d)</div>
                  <div className="text-2xl font-bold text-white">$654,200</div>
                  <div className="text-sm text-yellow-400">+8% vs last quarter</div>
                </div>
              </div>
            )}
            
            {activeTab === "integrations" && (
              <div className="space-y-3">
                {["Shopify", "Meta Ads", "Google Analytics", "QuickBooks"].map((name) => (
                  <div key={name} className="flex justify-between items-center p-3 bg-gray-800/30 rounded-xl">
                    <span className="text-white">{name}</span>
                    <span className="text-xs text-green-400">Connected</span>
                  </div>
                ))}
              </div>
            )}
            
            {activeTab === "settings" && (
              <div className="space-y-4">
                <div className="flex justify-between items-center p-3 bg-gray-800/30 rounded-xl">
                  <span className="text-white">Language</span>
                  <div className="flex gap-2">
                    <button className="px-3 py-1 text-sm bg-primary/20 text-primary rounded-lg">EN</button>
                    <button className="px-3 py-1 text-sm text-gray-400 hover:bg-gray-700 rounded-lg">UA</button>
                    <button className="px-3 py-1 text-sm text-gray-400 hover:bg-gray-700 rounded-lg">DE</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ========== ГОЛОВНАЯ СТРАНИЦА ==========
export default function Home() {
  const [isDemoOpen, setIsDemoOpen] = useState(false);
  const calculatorRef = useRef<HTMLDivElement>(null);

  const handleOpenCalculator = useCallback(() => {
    calculatorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleOpenDemo = useCallback(() => {
    setIsDemoOpen(true);
  }, []);

  const handleCloseDemo = useCallback(() => {
    setIsDemoOpen(false);
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <Navbar onOpenDemo={handleOpenDemo} />
      
      {/* Секция 1: Герой с главным сообщением */}
      <HeroMainSection onOpenCalculator={handleOpenCalculator} onOpenDemo={handleOpenDemo} />
      
      {/* Секция 2: RIVANT превращает хаос в ясность */}
      <ClaritySection />
      
      {/* Секция 3: Калькулятор потерь */}
      <div ref={calculatorRef}>
        <LossCalculator />
      </div>
      
      {/* Секция 4: Сетка проблем/решений (из существующего компонента) */}
      <ProblemSolutionGrid />
      
      {/* Секция 5: 3 шага + форма */}
      <StepsAndFormSection />
      
      {/* Секция 6: Живой дашборд с метриками и графиком */}
      <LiveDashboardPreview />
      
      {/* Секция 7: Навигация "Орган, метрики, риски, прогноз" */}
      <OrgNavigationSection />
      
      {/* Секция 8: Отзывы */}
      <Testimonials />
      
      {/* Секция 9: Цены */}
      <PricingSection />
      
      {/* Секция 10: Контактная форма */}
      <ContactForm />
      
      {/* Футер */}
      <Footer />

      {/* Модальное окно демо */}
      <LiveDemoModal isOpen={isDemoOpen} onClose={handleCloseDemo} />
    </main>
  );
}