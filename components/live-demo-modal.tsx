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
} from "lucide-react";

interface LiveDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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
  { icon: LayoutDashboard, label: "Overview", active: true },
  { icon: AlertTriangle, label: "Risks", active: false },
  { icon: TrendingUp, label: "Forecast", active: false },
  { icon: Link2, label: "Integrations", active: false },
];

export function LiveDemoModal({ isOpen, onClose }: LiveDemoModalProps) {
  const [showAlert, setShowAlert] = useState(false);
  
  const profitMargin = useAnimatedValue(isOpen ? 23.4 : 0);
  const cac = useAnimatedValue(isOpen ? 47 : 0);
  const cashflow = useAnimatedValue(isOpen ? 284000 : 0);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setShowAlert(true), 2000);
      return () => clearTimeout(timer);
    } else {
      setShowAlert(false);
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="max-w-5xl w-[95vw] h-[80vh] p-0 glass-strong border-border/50 overflow-hidden"
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
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    item.active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6 overflow-auto relative">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Dashboard Overview</h2>
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
              <div className="glass rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-green-500" />
                  </div>
                  <span className="text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full">
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
              <div className="glass rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded-full">
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
              <div className="glass rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-purple-500" />
                  </div>
                  <span className="text-xs text-purple-500 bg-purple-500/10 px-2 py-1 rounded-full">
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
                      className="flex-1 bg-purple-500/30 rounded-sm transition-all hover:bg-purple-500/50"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Activity Chart Placeholder */}
            <div className="glass rounded-xl p-5">
              <h3 className="font-medium text-foreground mb-4">Revenue vs Expenses (30 Days)</h3>
              <div className="h-48 flex items-end justify-between gap-2 px-4">
                {Array.from({ length: 30 }, (_, i) => {
                  const revenueHeight = 40 + Math.random() * 50;
                  const expenseHeight = 20 + Math.random() * 30;
                  return (
                    <div key={i} className="flex-1 flex flex-col gap-1">
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

            {/* Telegram Alert Overlay */}
            {showAlert && (
              <div className="absolute bottom-6 right-6 w-80 glass-strong rounded-xl p-4 animate-in slide-in-from-right-4 fade-in duration-500 shadow-2xl">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
                    <Bell className="w-5 h-5 text-yellow-500" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-foreground">Telegram Alert</span>
                      <span className="text-xs text-muted-foreground">Just now</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      ⚠️ <span className="text-yellow-500">Profit margin dropped 6%</span> - Check Meta Ads campaign spending.
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-md hover:bg-primary/20 transition-colors">
                        View Details
                      </button>
                      <button className="text-xs text-muted-foreground px-3 py-1.5 hover:text-foreground transition-colors">
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
