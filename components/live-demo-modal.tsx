"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  LayoutDashboard,
  AlertTriangle,
  TrendingUp,
  Link2,
  DollarSign,
  Users,
  LineChart,
  Bell,
  X,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface LiveDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewType = "overview" | "risks" | "forecast" | "integrations";

// Animated counter hook
function useAnimatedValue(target: number, duration: number = 1500) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (target === 0) return;
    
    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      setValue(Math.round(target * easeOutQuart * 10) / 10);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [target, duration]);

  return value;
}

const sidebarItems = [
  { icon: LayoutDashboard, label: "Overview", view: "overview" as ViewType },
  { icon: AlertTriangle, label: "Risks", view: "risks" as ViewType },
  { icon: TrendingUp, label: "Forecast", view: "forecast" as ViewType },
  { icon: Link2, label: "Integrations", view: "integrations" as ViewType },
];

const risks = [
  { 
    severity: "high", 
    title: "Meta Ads ROAS dropped below 2.0",
    description: "Campaign 'Summer Sale' performing 34% below target",
    action: "View Campaign",
  },
  { 
    severity: "medium", 
    title: "Inventory turnover slowing",
    description: "SKU #4521 has 45 days of stock remaining",
    action: "Adjust Spend",
  },
  { 
    severity: "low", 
    title: "Payment processor fees increased",
    description: "Stripe fees up 0.2% from last month",
    action: "Review Fees",
  },
];

const integrations = [
  { name: "Stripe", status: "connected", lastSync: "2 min ago" },
  { name: "Shopify", status: "connected", lastSync: "5 min ago" },
  { name: "Meta Ads", status: "connected", lastSync: "1 min ago" },
  { name: "Google Analytics", status: "pending", lastSync: "Setup required" },
  { name: "QuickBooks", status: "connected", lastSync: "15 min ago" },
];

export function LiveDemoModal({ isOpen, onClose }: LiveDemoModalProps) {
  const [activeView, setActiveView] = useState<ViewType>("overview");
  const [showAlert, setShowAlert] = useState(false);
  const [showTelegramPopup, setShowTelegramPopup] = useState(false);
  
  const profitMargin = useAnimatedValue(isOpen ? 23.4 : 0);
  const cac = useAnimatedValue(isOpen ? 47 : 0);
  const cashflow = useAnimatedValue(isOpen ? 284000 : 0);

  useEffect(() => {
    if (isOpen && activeView === "overview") {
      const timer = setTimeout(() => setShowAlert(true), 2000);
      return () => clearTimeout(timer);
    } else {
      setShowAlert(false);
    }
  }, [isOpen, activeView]);

  useEffect(() => {
    if (!isOpen) {
      setActiveView("overview");
      setShowTelegramPopup(false);
    }
  }, [isOpen]);

  const handleViewChange = (view: ViewType) => {
    setActiveView(view);
    setShowAlert(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="max-w-5xl w-[95vw] h-[85vh] sm:h-[80vh] p-0 glass-strong border-border/50 overflow-hidden"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>PulseOps Dashboard Preview</DialogTitle>
          <DialogDescription>
            Interactive preview of the PulseOps dashboard showing real-time analytics
          </DialogDescription>
        </DialogHeader>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-50 w-8 h-8 rounded-lg glass flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex h-full">
          {/* Sidebar */}
          <div className="w-56 bg-sidebar border-r border-sidebar-border p-4 hidden md:block">
            <div className="flex items-center gap-2 mb-8">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <LineChart className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-sidebar-foreground">PulseOps</span>
            </div>

            <nav className="space-y-1">
              {sidebarItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => handleViewChange(item.view)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    activeView === item.view
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              ))}
            </nav>

            {/* Alert Button */}
            <div className="mt-8 pt-4 border-t border-sidebar-border">
              <button
                onClick={() => setShowTelegramPopup(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent/50 transition-colors"
              >
                <Bell className="w-4 h-4" />
                Alerts
                <span className="ml-auto w-5 h-5 rounded-full bg-yellow-500/20 text-yellow-500 text-xs flex items-center justify-center">
                  3
                </span>
              </button>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 p-4 sm:p-6 overflow-auto relative">
            {/* Mobile Nav */}
            <div className="flex md:hidden gap-2 mb-4 overflow-x-auto pb-2">
              {sidebarItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => handleViewChange(item.view)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
                    activeView === item.view
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-white/5"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              ))}
              <button
                onClick={() => setShowTelegramPopup(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap text-muted-foreground hover:bg-white/5 transition-colors"
              >
                <Bell className="w-4 h-4" />
                Alerts
              </button>
            </div>

            {/* Overview View */}
            {activeView === "overview" && (
              <>
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg sm:text-xl font-semibold text-foreground">Dashboard Overview</h2>
                    <p className="text-sm text-muted-foreground">Real-time business metrics</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm text-muted-foreground">Live</span>
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  {/* Profit Margin Card */}
                  <div className="glass rounded-xl p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                        <DollarSign className="w-5 h-5 text-green-500" />
                      </div>
                      <span className="text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full flex items-center gap-1">
                        <ArrowUpRight className="w-3 h-3" />
                        +2.3%
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-foreground tabular-nums">
                      {profitMargin.toFixed(1)}%
                    </div>
                    <div className="text-sm text-muted-foreground">Profit Margin</div>
                    
                    {/* Mini Chart */}
                    <div className="mt-4 h-12 flex items-end gap-1">
                      {[40, 55, 45, 60, 50, 70, 65, 75, 80, 78, 85, 82].map((height, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-green-500/30 rounded-sm transition-all hover:bg-green-500/50"
                          style={{ height: `${height}%` }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* CAC Card */}
                  <div className="glass rounded-xl p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Users className="w-5 h-5 text-primary" />
                      </div>
                      <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded-full flex items-center gap-1">
                        <ArrowDownRight className="w-3 h-3" />
                        -12%
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-foreground tabular-nums">
                      ${Math.round(cac)}
                    </div>
                    <div className="text-sm text-muted-foreground">Customer Acquisition Cost</div>
                    
                    {/* Mini Chart */}
                    <div className="mt-4 h-12 flex items-end gap-1">
                      {[80, 75, 70, 68, 65, 60, 55, 52, 50, 48, 47, 47].map((height, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-primary/30 rounded-sm transition-all hover:bg-primary/50"
                          style={{ height: `${height}%` }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Cashflow Card */}
                  <div className="glass rounded-xl p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                        <TrendingUp className="w-5 h-5 text-cyan-500" />
                      </div>
                      <span className="text-xs text-cyan-500 bg-cyan-500/10 px-2 py-1 rounded-full">
                        Forecast
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-foreground tabular-nums">
                      ${Math.round(cashflow / 1000)}K
                    </div>
                    <div className="text-sm text-muted-foreground">30-Day Cashflow Prediction</div>
                    
                    {/* Mini Chart */}
                    <div className="mt-4 h-12 flex items-end gap-1">
                      {[30, 35, 40, 45, 50, 55, 58, 65, 70, 75, 80, 85].map((height, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-cyan-500/30 rounded-sm transition-all hover:bg-cyan-500/50"
                          style={{ height: `${height}%` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Activity Chart */}
                <div className="glass rounded-xl p-4 sm:p-5">
                  <h3 className="font-medium text-foreground mb-4">Revenue vs Expenses (30 Days)</h3>
                  <div className="h-36 sm:h-48 flex items-end justify-between gap-1 sm:gap-2 px-2 sm:px-4">
                    {Array.from({ length: 30 }, (_, i) => {
                      const revenueHeight = 40 + Math.random() * 50;
                      const expenseHeight = 20 + Math.random() * 30;
                      return (
                        <div key={i} className="flex-1 flex flex-col gap-0.5 sm:gap-1">
                          <div
                            className="bg-primary/40 rounded-t-sm transition-all hover:bg-primary/60"
                            style={{ height: `${revenueHeight}%` }}
                          />
                          <div
                            className="bg-muted rounded-b-sm"
                            style={{ height: `${expenseHeight}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-center gap-6 mt-4">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm bg-primary/40" />
                      <span className="text-xs text-muted-foreground">Revenue</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm bg-muted" />
                      <span className="text-xs text-muted-foreground">Expenses</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Risks View */}
            {activeView === "risks" && (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg sm:text-xl font-semibold text-foreground">Risk Detection</h2>
                    <p className="text-sm text-muted-foreground">AI-identified operational risks</p>
                  </div>
                  <span className="text-xs text-yellow-500 bg-yellow-500/10 px-3 py-1.5 rounded-full">
                    3 Active Risks
                  </span>
                </div>

                <div className="space-y-4">
                  {risks.map((risk, i) => (
                    <div key={i} className="glass rounded-xl p-4 sm:p-5 hover:bg-white/[0.08] transition-colors">
                      <div className="flex items-start gap-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          risk.severity === "high" 
                            ? "bg-red-500/10" 
                            : risk.severity === "medium"
                            ? "bg-yellow-500/10"
                            : "bg-blue-500/10"
                        }`}>
                          <AlertCircle className={`w-5 h-5 ${
                            risk.severity === "high" 
                              ? "text-red-500" 
                              : risk.severity === "medium"
                              ? "text-yellow-500"
                              : "text-blue-500"
                          }`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h4 className="font-medium text-foreground">{risk.title}</h4>
                              <p className="text-sm text-muted-foreground mt-1">{risk.description}</p>
                            </div>
                            <Button size="sm" variant="outline" className="shrink-0 hidden sm:inline-flex">
                              {risk.action}
                            </Button>
                          </div>
                          <Button size="sm" variant="outline" className="mt-3 sm:hidden">
                            {risk.action}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Risk Score Chart */}
                <div className="glass rounded-xl p-4 sm:p-5 mt-6">
                  <h3 className="font-medium text-foreground mb-4">Risk Score Trend (90 Days)</h3>
                  <div className="h-32 flex items-end justify-between gap-1 px-2">
                    {Array.from({ length: 30 }, (_, i) => {
                      const height = 30 + Math.sin(i * 0.3) * 20 + Math.random() * 15;
                      const isHigh = height > 55;
                      return (
                        <div
                          key={i}
                          className={`flex-1 rounded-t-sm transition-all ${
                            isHigh ? "bg-red-500/40 hover:bg-red-500/60" : "bg-green-500/40 hover:bg-green-500/60"
                          }`}
                          style={{ height: `${height}%` }}
                        />
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Forecast View */}
            {activeView === "forecast" && (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg sm:text-xl font-semibold text-foreground">Cashflow Forecast</h2>
                    <p className="text-sm text-muted-foreground">AI-powered 90-day predictions</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <div className="glass rounded-xl p-5">
                    <div className="text-sm text-muted-foreground mb-1">Projected Revenue (90d)</div>
                    <div className="text-3xl font-bold text-foreground">$892,400</div>
                    <div className="text-sm text-green-500 mt-1">+18% vs last quarter</div>
                  </div>
                  <div className="glass rounded-xl p-5">
                    <div className="text-sm text-muted-foreground mb-1">Projected Expenses (90d)</div>
                    <div className="text-3xl font-bold text-foreground">$654,200</div>
                    <div className="text-sm text-yellow-500 mt-1">+8% vs last quarter</div>
                  </div>
                </div>

                <div className="glass rounded-xl p-4 sm:p-5">
                  <h3 className="font-medium text-foreground mb-4">Monthly Forecast</h3>
                  <div className="h-48 flex items-end justify-around gap-4 px-4">
                    {[
                      { month: "Jul", revenue: 280, expense: 210 },
                      { month: "Aug", revenue: 305, expense: 220 },
                      { month: "Sep", revenue: 307, expense: 224 },
                    ].map((data, i) => (
                      <div key={i} className="flex flex-col items-center gap-2 flex-1">
                        <div className="w-full flex gap-2 justify-center h-36">
                          <div className="w-8 flex flex-col justify-end">
                            <div 
                              className="bg-primary/50 rounded-t-sm"
                              style={{ height: `${(data.revenue / 320) * 100}%` }}
                            />
                          </div>
                          <div className="w-8 flex flex-col justify-end">
                            <div 
                              className="bg-muted rounded-t-sm"
                              style={{ height: `${(data.expense / 320) * 100}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-sm text-muted-foreground">{data.month}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-center gap-6 mt-4">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm bg-primary/50" />
                      <span className="text-xs text-muted-foreground">Revenue</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm bg-muted" />
                      <span className="text-xs text-muted-foreground">Expenses</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Integrations View */}
            {activeView === "integrations" && (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg sm:text-xl font-semibold text-foreground">Integrations</h2>
                    <p className="text-sm text-muted-foreground">Connected data sources</p>
                  </div>
                  <Button size="sm">Add Integration</Button>
                </div>

                <div className="space-y-3">
                  {integrations.map((integration, i) => (
                    <div key={i} className="glass rounded-xl p-4 flex items-center justify-between hover:bg-white/[0.08] transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                          <Link2 className="w-5 h-5 text-foreground" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground">{integration.name}</h4>
                          <p className="text-sm text-muted-foreground">{integration.lastSync}</p>
                        </div>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-xs ${
                        integration.status === "connected"
                          ? "bg-green-500/10 text-green-500"
                          : "bg-yellow-500/10 text-yellow-500"
                      }`}>
                        {integration.status === "connected" ? "Connected" : "Setup Required"}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Telegram Alert Overlay - Auto appears on overview */}
            {showAlert && activeView === "overview" && (
              <div className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 w-[calc(100%-2rem)] sm:w-80 glass-strong rounded-xl p-4 animate-in slide-in-from-right-4 fade-in duration-500 shadow-2xl">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
                    <Bell className="w-5 h-5 text-yellow-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-foreground">Telegram Alert</span>
                      <span className="text-xs text-muted-foreground">Just now</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <span className="text-yellow-500">Profit margin dropped 6%</span> - Check Meta Ads campaign spending.
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button 
                        onClick={() => handleViewChange("risks")}
                        className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-md hover:bg-primary/20 transition-colors"
                      >
                        View Details
                      </button>
                      <button 
                        onClick={() => setShowAlert(false)}
                        className="text-xs text-muted-foreground px-3 py-1.5 hover:text-foreground transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Telegram Popup - Manual trigger */}
            {showTelegramPopup && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
                <div className="glass-strong rounded-xl p-6 w-full max-w-md animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-foreground">Sample Telegram Alert</h3>
                    <button 
                      onClick={() => setShowTelegramPopup(false)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="bg-[#1c2733] rounded-xl p-4 border border-white/10">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                        <LineChart className="w-4 h-4 text-primary-foreground" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">PulseOps Bot</div>
                        <div className="text-xs text-gray-400">bot</div>
                      </div>
                    </div>
                    <div className="text-sm text-white leading-relaxed">
                      <span className="text-yellow-400">Alert:</span> Profit margin dropped <span className="font-semibold">6%</span> in the last 24 hours.<br/><br/>
                      <span className="text-gray-400">Possible cause:</span> Meta Ads &quot;Summer Sale&quot; campaign overspending.<br/><br/>
                      <span className="text-primary">Tap to view in dashboard</span>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground mt-4">
                    Receive real-time alerts directly in Telegram when PulseOps detects anomalies in your business metrics.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
