import { useState, useEffect } from 'react';

export const useDashboardData = () => {
  const [data, setData] = useState({
    metrics: {
      profitMargin: 23.4,
      cac: 47,
      forecast: 284000,
      revenue: 127450,
      profit: 34280
    },
    history: Array.from({ length: 30 }, (_, i) => ({
      day: i + 1,
      revenue: 10000 + Math.random() * 5000,
      expenses: 8000 + Math.random() * 3000,
    }))
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setData(prev => {
        const newMargin = Math.max(0, parseFloat(prev.metrics.profitMargin) + (Math.random() - 0.5));
        const newCac = Math.max(20, parseFloat(prev.metrics.cac) + (Math.random() * 4 - 2));
        
        const lastRevenue = prev.history[prev.history.length - 1].revenue;
        const newHistory = [...prev.history.slice(1), {
          day: prev.history[prev.history.length - 1].day + 1,
          revenue: Math.max(5000, lastRevenue + (Math.random() * 1000 - 500)),
          expenses: Math.max(3000, 7000 + Math.random() * 2000)
        }];

        return {
          metrics: { 
            profitMargin: Number(newMargin.toFixed(1)),
            cac: Number(newCac.toFixed(0)),
            forecast: prev.metrics.forecast,
            revenue: prev.metrics.revenue,
            profit: prev.metrics.profit
          },
          history: newHistory
        };
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return data;
};