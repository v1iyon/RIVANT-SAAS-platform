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
    <div className="min-h-screen bg-background flex flex-col lg:flex-row pb-20 lg:pb-0">
      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Desktop Sidebar */}
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
              className="lg:hidden text-sidebar-foreground/60 hover:text-sidebar-foreground p-2 bg-sidebar-accent rounded-lg"
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
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                  activeView === item.view
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </button>
            ))}
          </nav>

          {/* User Menu */}
          <div className="border-t border-sidebar-border pt-4 mt-4">
            <DropdownMenu>
              <DropdownMenuTrigger className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 transition-colors">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <span className="text-xs font-medium text-primary">JD</span>
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium text-sidebar-foreground">John Doe</div>
                  <div className="text-xs text-sidebar-foreground/60">Growth Plan</div>
                </div>
                <ChevronDown className="w-4 h-4 text-sidebar-foreground/40" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 bg-popover border-border">
                <DropdownMenuItem className="focus:bg-primary/10 cursor-pointer py-3">
                  <Settings className="w-4 h-4 mr-2" />
                  Account Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem className="focus:bg-primary/10 cursor-pointer text-red-400 py-3">
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
        <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-xl border-b border-border px-4 lg:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setIsMobileSidebarOpen(true)}
                className="lg:hidden text-foreground p-2 bg-secondary rounded-lg hover:bg-secondary/80"
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
              <div className="hidden sm:flex items-center gap-2 bg-secondary px-3 py-1.5 rounded-full">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm text-foreground font-medium">Live</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" className="relative bg-secondary hover:bg-secondary/80">
                    <Bell className="w-5 h-5" />
                    <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-yellow-500 text-[10px] font-bold flex items-center justify-center text-white">
                      3
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-80 bg-popover border-border p-0" align="end">
                  <div className="p-3 border-b border-border">
                    <h3 className="font-medium text-foreground">Notifications</h3>
                  </div>
                  <div className="max-h-80 overflow-auto">
                    {alerts.slice(0, 3).map((alert) => (
                      <div key={alert.id} className="p-3 hover:bg-secondary/50 border-b border-border/30 last:border-0">
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
                  <div className="p-2 border-t border-border">
                    <Button variant="ghost" size="sm" className="w-full text-primary hover:bg-primary/10">
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
            <div className="space-y-4 sm:space-y-6">
              {/* KPI Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-card rounded-xl p-4 sm:p-5 border border-border">
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                    </div>
                    <span className="text-[10px] sm:text-xs text-green-500 bg-green-500/10 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full flex items-center gap-0.5">
                      <ArrowUpRight className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      +12%
                    </span>
                  </div>
                  <div className="text-lg sm:text-2xl font-bold text-foreground tabular-nums">
                    ${Math.round(revenue).toLocaleString()}
                  </div>
                  <div className="text-xs sm:text-sm text-muted-foreground">Revenue (30d)</div>
                </div>

                <div className="bg-card rounded-xl p-4 sm:p-5 border border-border">
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
                    </div>
                    <span className="text-[10px] sm:text-xs text-green-500 bg-green-500/10 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full flex items-center gap-0.5">
                      <ArrowUpRight className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      +8%
                    </span>
                  </div>
                  <div className="text-lg sm:text-2xl font-bold text-foreground tabular-nums">
                    ${Math.round(profit).toLocaleString()}
                  </div>
                  <div className="text-xs sm:text-sm text-muted-foreground">Profit (30d)</div>
                </div>

                <div className="bg-card rounded-xl p-4 sm:p-5 border border-border">
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                      <LineChart className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-500" />
                    </div>
                    <span className="text-[10px] sm:text-xs text-green-500 bg-green-500/10 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full flex items-center gap-0.5">
                      <ArrowUpRight className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      +2.3%
                    </span>
                  </div>
                  <div className="text-lg sm:text-2xl font-bold text-foreground tabular-nums">
                    {profitMargin.toFixed(1)}%
                  </div>
                  <div className="text-xs sm:text-sm text-muted-foreground">Margin</div>
                </div>

                <div className="bg-card rounded-xl p-4 sm:p-5 border border-border">
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Users className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                    </div>
                    <span className="text-[10px] sm:text-xs text-green-500 bg-green-500/10 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full flex items-center gap-0.5">
                      <ArrowDownRight className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      -12%
                    </span>
                  </div>
                  <div className="text-lg sm:text-2xl font-bold text-foreground tabular-nums">
                    ${Math.round(cac)}
                  </div>
                  <div className="text-xs sm:text-sm text-muted-foreground">CAC</div>
                </div>
              </div>

              {/* Alert Feed */}
              <div className="bg-card rounded-xl p-4 sm:p-5 border border-border">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-foreground">Active Alerts</h3>
                  <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/10">
                    View all
                  </Button>
                </div>
                <div className="space-y-3">
                  {alerts.map((alert) => (
                    <div key={alert.id} className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
                      <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        alert.severity === "high" 
                          ? "bg-red-500/10" 
                          : alert.severity === "medium"
                          ? "bg-yellow-500/10"
                          : "bg-blue-500/10"
                      }`}>
                        <AlertCircle className={`w-4 h-4 sm:w-5 sm:h-5 ${
                          alert.severity === "high" 
                            ? "text-red-500" 
                            : alert.severity === "medium"
                            ? "text-yellow-500"
                            : "text-blue-500"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                          <div>
                            <h4 className="font-medium text-foreground text-sm">{alert.title}</h4>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{alert.description}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground hidden sm:inline">{alert.time}</span>
                            <Button size="sm" variant="secondary" className="h-8 text-xs bg-secondary hover:bg-secondary/80">
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
              <div className="bg-card rounded-xl p-4 sm:p-5 border border-border">
                <h3 className="font-semibold text-foreground mb-4">Revenue vs Expenses (30 Days)</h3>
                <div className="h-40 sm:h-48 flex items-end justify-between gap-0.5 sm:gap-1 px-2">
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
            <div className="space-y-4 sm:space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-xs text-yellow-500 bg-yellow-500/10 px-3 py-1.5 rounded-full font-medium">
                  3 Active Risks
                </span>
                <Button variant="secondary" size="sm" className="bg-secondary hover:bg-secondary/80">Export Report</Button>
              </div>

              <div className="space-y-3 sm:space-y-4">
                {alerts.map((risk) => (
                  <div key={risk.id} className="bg-card rounded-xl p-4 sm:p-5 border border-border hover:bg-card/80 transition-colors">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center shrink-0 ${
                        risk.severity === "high" 
                          ? "bg-red-500/10" 
                          : risk.severity === "medium"
                          ? "bg-yellow-500/10"
                          : "bg-blue-500/10"
                      }`}>
                        <AlertCircle className={`w-5 h-5 sm:w-6 sm:h-6 ${
                          risk.severity === "high" 
                            ? "text-red-500" 
                            : risk.severity === "medium"
                            ? "text-yellow-500"
                            : "text-blue-500"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-medium uppercase px-2 py-0.5 rounded ${
                                risk.severity === "high" 
                                  ? "bg-red-500/10 text-red-500" 
                                  : risk.severity === "medium"
                                  ? "bg-yellow-500/10 text-yellow-500"
                                  : "bg-blue-500/10 text-blue-500"
                              }`}>
                                {risk.severity}
                              </span>
                              <span className="text-xs text-muted-foreground">{risk.time}</span>
                            </div>
                            <h4 className="font-medium text-foreground">{risk.title}</h4>
                            <p className="text-sm text-muted-foreground mt-1">{risk.description}</p>
                          </div>
                          <Button size="sm" variant="secondary" className="shrink-0 bg-secondary hover:bg-secondary/80">
                            {risk.action}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Forecast View */}
          {activeView === "forecast" && (
            <div className="space-y-4 sm:space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-card rounded-xl p-4 sm:p-5 border border-border">
                  <div className="text-sm text-muted-foreground mb-1">Projected Revenue (90d)</div>
                  <div className="text-2xl sm:text-3xl font-bold text-foreground">$892,400</div>
                  <div className="text-sm text-green-500 mt-1">+18% vs last quarter</div>
                </div>
                <div className="bg-card rounded-xl p-4 sm:p-5 border border-border">
                  <div className="text-sm text-muted-foreground mb-1">Projected Expenses (90d)</div>
                  <div className="text-2xl sm:text-3xl font-bold text-foreground">$654,200</div>
                  <div className="text-sm text-yellow-500 mt-1">+8% vs last quarter</div>
                </div>
              </div>

              <div className="bg-card rounded-xl p-4 sm:p-5 border border-border">
                <h3 className="font-semibold text-foreground mb-4">Monthly Forecast</h3>
                <div className="h-48 flex items-end justify-around gap-4 px-4">
                  {[
                    { month: "Jul", revenue: 280, expense: 210 },
                    { month: "Aug", revenue: 305, expense: 220 },
                    { month: "Sep", revenue: 307, expense: 224 },
                  ].map((data, i) => (
                    <div key={i} className="flex flex-col items-center gap-2 flex-1">
                      <div className="w-full flex gap-2 justify-center h-36">
                        <div 
                          className="w-8 sm:w-12 bg-primary/40 rounded-t-lg transition-all hover:bg-primary/60"
                          style={{ height: `${(data.revenue / 350) * 100}%` }}
                        />
                        <div 
                          className="w-8 sm:w-12 bg-muted rounded-t-lg"
                          style={{ height: `${(data.expense / 350) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm text-muted-foreground">{data.month}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Integrations View */}
          {activeView === "integrations" && (
            <div className="space-y-4">
              {integrations.map((integration, i) => (
                <div key={i} className="bg-card rounded-xl p-4 sm:p-5 border border-border flex items-center justify-between">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-secondary flex items-center justify-center">
                      <Link2 className="w-5 h-5 sm:w-6 sm:h-6 text-foreground" />
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground">{integration.name}</h4>
                      <p className="text-xs sm:text-sm text-muted-foreground">{integration.lastSync}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2 sm:px-3 py-1 rounded-full ${
                    integration.status === "connected" 
                      ? "bg-green-500/10 text-green-500"
                      : "bg-yellow-500/10 text-yellow-500"
                  }`}>
                    {integration.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Settings View */}
          {activeView === "settings" && (
            <div className="max-w-2xl space-y-6">
              <div className="bg-card rounded-xl p-4 sm:p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4">Account Settings</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-muted-foreground">Email</label>
                    <p className="text-foreground font-medium">john@company.com</p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">Plan</label>
                    <p className="text-foreground font-medium">Growth Plan</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-background/95 backdrop-blur-xl border-t border-border px-2 py-2 safe-area-inset-bottom">
        <div className="flex items-center justify-around">
          {sidebarItems.slice(0, 4).map((item) => (
            <button
              key={item.label}
              onClick={() => setActiveView(item.view)}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors min-w-[64px] ${
                activeView === item.view
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          ))}
          <button
            onClick={() => setActiveView("settings")}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors min-w-[64px] ${
              activeView === "settings"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Settings className="w-5 h-5" />
            <span className="text-[10px] font-medium">Settings</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
