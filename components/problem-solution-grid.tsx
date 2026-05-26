"use client";

import { FileSpreadsheet, Database, Brain, TrendingUp } from "lucide-react";

const problems = [
  {
    icon: FileSpreadsheet,
    title: "Manual Reporting",
    description:
      "Hours wasted on spreadsheets, manual data entry, and report generation. Time that could be spent growing your business.",
    stat: "12+ hrs/week",
    statLabel: "Lost to manual work",
  },
  {
    icon: Database,
    title: "Data Fragmentation",
    description:
      "Critical business data scattered across 10+ tools. No single source of truth means delayed decisions and missed opportunities.",
    stat: "40%",
    statLabel: "Data visibility gap",
  },
  {
    icon: Brain,
    title: "Intuitive Risk",
    description:
      "Relying on gut feelings instead of data-driven insights. Problems are discovered too late when they're already expensive.",
    stat: "3x",
    statLabel: "Higher error rate",
  },
  {
    icon: TrendingUp,
    title: "Hidden Margin Leaks",
    description:
      "Small inefficiencies that compound over time. Ad spend waste, pricing errors, and operational costs that silently drain profits.",
    stat: "8-15%",
    statLabel: "Revenue leakage",
  },
];

export function ProblemSolutionGrid() {
  return (
    <section id="features" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            The Problems We <span className="text-primary">Solve</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Most businesses don&apos;t realize how much they&apos;re losing until it&apos;s too late.
            PulseOps identifies these issues before they become critical.
          </p>
        </div>

        {/* Problem Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {problems.map((problem, index) => (
            <div
              key={problem.title}
              className="glass rounded-2xl p-8 group hover:bg-white/[0.08] transition-all duration-300"
              style={{
                animationDelay: `${index * 100}ms`,
              }}
            >
              <div className="flex items-start gap-6">
                <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <problem.icon className="w-7 h-7 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-foreground mb-2">
                    {problem.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed mb-4">
                    {problem.description}
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-primary">
                      {problem.stat}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {problem.statLabel}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Solution Banner */}
        <div className="mt-16 glass-strong rounded-2xl p-8 sm:p-12 text-center">
          <h3 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">
            PulseOps turns chaos into clarity
          </h3>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-8">
            One dashboard. Real-time insights. Automated alerts. Stop reacting to problems
            and start preventing them.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">-73%</div>
              <div className="text-sm text-muted-foreground">Report Time</div>
            </div>
            <div className="w-px h-12 bg-border hidden sm:block" />
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">+28%</div>
              <div className="text-sm text-muted-foreground">Profit Margin</div>
            </div>
            <div className="w-px h-12 bg-border hidden sm:block" />
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">2.5hrs</div>
              <div className="text-sm text-muted-foreground">Saved Daily</div>
            </div>
            <div className="w-px h-12 bg-border hidden sm:block" />
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">24/7</div>
              <div className="text-sm text-muted-foreground">Monitoring</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
