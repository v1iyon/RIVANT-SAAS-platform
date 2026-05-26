"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
  LogOut,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Activity,
  ChevronDown,
  Menu,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

type ViewType = "overview" | "risks" | "forecast" | "integrations" | "settings";

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
  { icon: Settings, label: "Settings", view: "settings" as ViewType },
];

const alerts = [
  { 
    id: 1,
    severity: "high", 
    title: "Meta Ads ROAS dropped below 2.0",
    description: "Campaign 'Summer Sale' performing 34% below target",
    action: "View Campaign",
    actionLink: "#",
    time: "2 min ago",
  },
  { 
    id: 2,
    severity: "medium", 
    title: "Inventory turnover slowing",
    description: "SKU #4521 has 45 days of stock remaining",
    action: "Adjust Spend",
    actionLink: "#",
    time: "15 min ago",
  },
  { 
    id: 3,
    severity: "low", 
    title: "Payment processor fees increased",
    description: "Stripe fees up 0.2% from last month",
    action: "Review Fees",
    actionLink: "#",
    time: "1 hour ago",
  },
];

const integrations = [
  { name: "Stripe", status: "connected", lastSync: "2 min ago" },
  { name: "Shopify", status: "connected", lastSync: "5 min ago" },
  { name: "Meta Ads", status: "connected", lastSync: "1 min ago" },
  { name: "Google Analytics", status: "pending", lastSync: "Setup required" },
  { name: "QuickBooks", status: "connected", lastSync: "15 min ago" },
];

export default function DashboardPage() {
  const [activeView, setActiveView] = useState<ViewType>("overview");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  const revenue = useAnimatedValue(127450);
  const profit = useAnimatedValue(34280);
  const profitMargin = useAnimatedValue(26.9);
  const cac = useAnimatedValue(47);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border 
        transform transition-transform duration-300 ease-in-out
        ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full p-4">
          {/* Logo */}
          <div className="flex items-center justify-between mb-8">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Activity className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-sidebar-foreground">PulseOps</span>
            </Link>
            <button 
              onClick={() => setIsMobileSidebarOpen(false)}
              className="lg:hidden text-sidebar-foreground/60 hover:text-sidebar-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="space-y-1 flex-1">
            {sidebarItems.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  setActiveView(item.view);
                  setIsMobileSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  activeView === item.view
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
          </nav>

          {/* User Menu */}
          <div className="border-t border-sidebar-border pt-4 mt-4">
            <DropdownMenu>
              <DropdownMenuTrigger className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 transition-colors">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <span className="text-xs font-medium text-primary">JD</span>
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium text-sidebar-foreground">John Doe</div>
                  <div className="text-xs text-sidebar-foreground/60">Growth Plan</div>
                </div>
                <ChevronDown className="w-4 h-4 text-sidebar-foreground/40" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 glass-strong border-border/50">
                <DropdownMenuItem className="focus:bg-primary/10 cursor-pointer">
                  <Settings className="w-4 h-4 mr-2" />
                  Account Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/50" />
                <DropdownMenuItem className="focus:bg-primary/10 cursor-pointer text-red-400">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen">
        {/* Top Header */}
        <header className="sticky top-0 z-30 glass border-b border-border/50 px-4 lg:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setIsMobileSidebarOpen(true)}
                className="lg:hidden text-foreground"
              >
                <Menu className="w-6 h-6" />
              </button>
              <div>
                <h1 className="text-lg font-semibold text-foreground capitalize">{activeView}</h1>
                <p className="text-sm text-muted-foreground hidden sm:block">
                  {activeView === "overview" && "Real-time business metrics"}
                  {activeView === "risks" && "AI-identified operational risks"}
                  {activeView === "forecast" && "AI-powered predictions"}
                  {activeView === "integrations" && "Connected data sources"}
                  {activeView === "settings" && "Manage your account"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm text-muted-foreground">Live</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative">
                    <Bell className="w-5 h-5" />
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-yellow-500 text-[10px] font-medium flex items-center justify-center text-white">
                      3
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-80 glass-strong border-border/50 p-0" align="end">
                  <div className="p-3 border-b border-border/50">
                    <h3 className="font-medium text-foreground">Notifications</h3>
                  </div>
                  <div className="max-h-80 overflow-auto">
                    {alerts.slice(0, 3).map((alert) => (
                      <div key={alert.id} className="p-3 hover:bg-white/5 border-b border-border/30 last:border-0">
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
                  <div className="p-2 border-t border-border/50">
                    <Button variant="ghost" size="sm" className="w-full text-primary">
                      View all alerts
                    </Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-4 lg:p-6 overflow-auto">
          {/* Overview View */}
          {activeView === "overview" && (
            <div className="space-y-6">
              {/* KPI Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-primary" />
                    </div>
                    <span className="text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3" />
                      +12%
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-foreground tabular-nums">
                    ${Math.round(revenue).toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">Revenue (30d)</div>
                </div>

                <div className="glass rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-green-500" />
                    </div>
                    <span className="text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3" />
                      +8%
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-foreground tabular-nums">
                    ${Math.round(profit).toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">Profit (30d)</div>
                </div>

                <div className="glass rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                      <LineChart className="w-5 h-5 text-cyan-500" />
                    </div>
                    <span className="text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3" />
                      +2.3%
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-foreground tabular-nums">
                    {profitMargin.toFixed(1)}%
                  </div>
                  <div className="text-sm text-muted-foreground">Margin</div>
                </div>

                <div className="glass rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Users className="w-5 h-5 text-primary" />
                    </div>
                    <span className="text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full flex items-center gap-1">
                      <ArrowDownRight className="w-3 h-3" />
                      -12%
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-foreground tabular-nums">
                    ${Math.round(cac)}
                  </div>
                  <div className="text-sm text-muted-foreground">CAC</div>
                </div>
              </div>

              {/* Alert Feed */}
              <div className="glass rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-foreground">Active Alerts</h3>
                  <Button variant="ghost" size="sm" className="text-primary">
                    View all
                  </Button>
                </div>
                <div className="space-y-3">
                  {alerts.map((alert) => (
                    <div key={alert.id} className="flex items-start gap-4 p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        alert.severity === "high" 
                          ? "bg-red-500/10" 
                          : alert.severity === "medium"
                          ? "bg-yellow-500/10"
                          : "bg-blue-500/10"
                      }`}>
                        <AlertCircle className={`w-5 h-5 ${
                          alert.severity === "high" 
                            ? "text-red-500" 
                            : alert.severity === "medium"
                            ? "text-yellow-500"
                            : "text-blue-500"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h4 className="font-medium text-foreground text-sm">{alert.title}</h4>
                            <p className="text-xs text-muted-foreground mt-0.5">{alert.description}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground hidden sm:inline">{alert.time}</span>
                            <Button size="sm" variant="outline" className="h-8 text-xs">
                              {alert.action}
                              <ExternalLink className="w-3 h-3 ml-1" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Chart */}
              <div className="glass rounded-xl p-5">
                <h3 className="font-semibold text-foreground mb-4">Revenue vs Expenses (30 Days)</h3>
                <div className="h-48 flex items-end justify-between gap-1 sm:gap-2 px-2">
                  {Array.from({ length: 30 }, (_, i) => {
                    const revenueHeight = 40 + Math.random() * 50;
                    const expenseHeight = 20 + Math.random() * 30;
                    return (
                      <div key={i} className="flex-1 flex flex-col gap-0.5">
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
            </div>
          )}

          {/* Risks View */}
          {activeView === "risks" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-xs text-yellow-500 bg-yellow-500/10 px-3 py-1.5 rounded-full">
                  3 Active Risks
                </span>
                <Button variant="outline" size="sm">Export Report</Button>
              </div>

              <div className="space-y-4">
                {alerts.map((risk) => (
                  <div key={risk.id} className="glass rounded-xl p-5 hover:bg-white/[0.08] transition-colors">
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${
                        risk.severity === "high" 
                          ? "bg-red-500/10" 
                          : risk.severity === "medium"
                          ? "bg-yellow-500/10"
                          : "bg-blue-500/10"
                      }`}>
                        <AlertCircle className={`w-6 h-6 ${
                          risk.severity === "high" 
                            ? "text-red-500" 
                            : risk.severity === "medium"
                            ? "text-yellow-500"
                            : "text-blue-500"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                risk.severity === "high" 
                                  ? "bg-red-500/10 text-red-500" 
                                  : risk.severity === "medium"
                                  ? "bg-yellow-500/10 text-yellow-500"
                                  : "bg-blue-500/10 text-blue-500"
                              }`}>
                                {risk.severity.toUpperCase()}
                              </span>
                              <span className="text-xs text-muted-foreground">{risk.time}</span>
                            </div>
                            <h4 className="font-medium text-foreground">{risk.title}</h4>
                            <p className="text-sm text-muted-foreground mt-1">{risk.description}</p>
                          </div>
                          <Button size="sm" className="shrink-0">
                            {risk.action}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Risk Score Chart */}
              <div className="glass rounded-xl p-5">
                <h3 className="font-semibold text-foreground mb-4">Risk Score Trend (90 Days)</h3>
                <div className="h-32 flex items-end justify-between gap-1 px-2">
                  {Array.from({ length: 45 }, (_, i) => {
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
            </div>
          )}

          {/* Forecast View */}
          {activeView === "forecast" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="glass rounded-xl p-5">
                  <div className="text-sm text-muted-foreground mb-1">Projected Revenue (90d)</div>
                  <div className="text-3xl font-bold text-foreground">$892,400</div>
                  <div className="text-sm text-green-500 mt-1 flex items-center gap-1">
                    <ArrowUpRight className="w-4 h-4" />
                    +18% vs last quarter
                  </div>
                </div>
                <div className="glass rounded-xl p-5">
                  <div className="text-sm text-muted-foreground mb-1">Projected Expenses (90d)</div>
                  <div className="text-3xl font-bold text-foreground">$654,200</div>
                  <div className="text-sm text-yellow-500 mt-1 flex items-center gap-1">
                    <ArrowUpRight className="w-4 h-4" />
                    +8% vs last quarter
                  </div>
                </div>
              </div>

              <div className="glass rounded-xl p-5">
                <h3 className="font-semibold text-foreground mb-4">Monthly Forecast</h3>
                <div className="h-64 flex items-end justify-around gap-8 px-4">
                  {[
                    { month: "Jul", revenue: 280, expense: 210 },
                    { month: "Aug", revenue: 305, expense: 220 },
                    { month: "Sep", revenue: 307, expense: 224 },
                  ].map((data, i) => (
                    <div key={i} className="flex flex-col items-center gap-2 flex-1 max-w-32">
                      <div className="w-full flex gap-3 justify-center h-48">
                        <div className="w-12 flex flex-col justify-end">
                          <div 
                            className="bg-primary/50 rounded-t transition-all hover:bg-primary/70"
                            style={{ height: `${(data.revenue / 320) * 100}%` }}
                          />
                        </div>
                        <div className="w-12 flex flex-col justify-end">
                          <div 
                            className="bg-muted rounded-t"
                            style={{ height: `${(data.expense / 320) * 100}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-sm text-muted-foreground font-medium">{data.month}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-center gap-6 mt-6">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm bg-primary/50" />
                    <span className="text-sm text-muted-foreground">Revenue</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm bg-muted" />
                    <span className="text-sm text-muted-foreground">Expenses</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Integrations View */}
          {activeView === "integrations" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {integrations.filter(i => i.status === "connected").length} of {integrations.length} connected
                </span>
                <Button>Add Integration</Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {integrations.map((integration, i) => (
                  <div key={i} className="glass rounded-xl p-5 flex items-center justify-between hover:bg-white/[0.08] transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center">
                        <Link2 className="w-6 h-6 text-foreground" />
                      </div>
                      <div>
                        <h4 className="font-medium text-foreground">{integration.name}</h4>
                        <p className="text-sm text-muted-foreground">{integration.lastSync}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`px-3 py-1 rounded-full text-xs ${
                        integration.status === "connected"
                          ? "bg-green-500/10 text-green-500"
                          : "bg-yellow-500/10 text-yellow-500"
                      }`}>
                        {integration.status === "connected" ? "Connected" : "Setup Required"}
                      </div>
                      <Button variant="ghost" size="sm">
                        <Settings className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Settings View */}
          {activeView === "settings" && (
            <div className="max-w-2xl space-y-6">
              <div className="glass rounded-xl p-6">
                <h3 className="font-semibold text-foreground mb-4">Account Settings</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-muted-foreground">Email</label>
                    <input 
                      type="email" 
                      value="john@example.com" 
                      readOnly
                      className="w-full mt-1 px-4 py-2.5 rounded-lg bg-white/5 border border-border/50 text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">Company</label>
                    <input 
                      type="text" 
                      value="Acme Inc." 
                      readOnly
                      className="w-full mt-1 px-4 py-2.5 rounded-lg bg-white/5 border border-border/50 text-foreground"
                    />
                  </div>
                </div>
              </div>

              <div className="glass rounded-xl p-6">
                <h3 className="font-semibold text-foreground mb-4">Notification Preferences</h3>
                <div className="space-y-3">
                  {["Email alerts", "Telegram alerts", "Weekly digest"].map((pref) => (
                    <div key={pref} className="flex items-center justify-between py-2">
                      <span className="text-sm text-foreground">{pref}</span>
                      <button className="w-12 h-6 rounded-full bg-primary p-1 transition-colors">
                        <div className="w-4 h-4 rounded-full bg-white translate-x-6 transition-transform" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass rounded-xl p-6">
                <h3 className="font-semibold text-foreground mb-2">Current Plan</h3>
                <p className="text-sm text-muted-foreground mb-4">You are on the Growth plan at $149/month.</p>
                <Button variant="outline">Manage Subscription</Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
