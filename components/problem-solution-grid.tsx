"use client";

import { FileSpreadsheet, Database, Brain, TrendingUp } from "lucide-react";
import { useLanguage } from "@/lib/translations";

export function ProblemSolutionGrid() {
  const { t } = useLanguage();

  const problems = [
    {
      icon: FileSpreadsheet,
      title: t.manualReporting,
      description: t.manualReportingDesc,
      stat: t.manualReportingStat,
      statLabel: t.manualReportingLabel,
    },
    {
      icon: Database,
      title: t.dataFragmentation,
      description: t.dataFragmentationDesc,
      stat: t.dataFragmentationStat,
      statLabel: t.dataFragmentationLabel,
    },
    {
      icon: Brain,
      title: t.intuitiveRisk,
      description: t.intuitiveRiskDesc,
      stat: t.intuitiveRiskStat,
      statLabel: t.intuitiveRiskLabel,
    },
    {
      icon: TrendingUp,
      title: t.hiddenMarginLeaks,
      description: t.hiddenMarginLeaksDesc,
      stat: t.hiddenMarginLeaksStat,
      statLabel: t.hiddenMarginLeaksLabel,
    },
  ];

  return (
    <section id="features" className="py-8 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            {t.problemsWeSolve.split(" ").slice(0, -1).join(" ")}{" "}
            <span className="text-primary">{t.problemsWeSolve.split(" ").pop()}</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            {t.problemsSubtitle}
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
            {t.solutionBannerTitle || "RIVANT turns chaos into clarity"}
          </h3>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-8">
            {t.solutionBannerDesc || "One dashboard. Real-time insights. Automated alerts. Stop reacting to problems and start preventing them."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">-73%</div>
              <div className="text-sm text-muted-foreground">{t.statReportTime || "Report Time"}</div>
            </div>
            <div className="w-px h-12 bg-border hidden sm:block" />
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">+28%</div>
              <div className="text-sm text-muted-foreground">{t.statProfitMargin || "Profit Margin"}</div>
            </div>
            <div className="w-px h-12 bg-border hidden sm:block" />
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">2.5hrs</div>
              <div className="text-sm text-muted-foreground">{t.statSavedDaily || "Saved Daily"}</div>
            </div>
            <div className="w-px h-12 bg-border hidden sm:block" />
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">24/7</div>
              <div className="text-sm text-muted-foreground">{t.statMonitoring || "Monitoring"}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}