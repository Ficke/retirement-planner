import { categorizeRisk } from '@/lib/risk-categories';

/**
 * Color legend showing risk category colors used in table rows
 */
export function RiskLegend() {
  const categories = [
    { name: 'Conservative', risk: 0.02 },
    { name: 'Moderate', risk: 0.07 },
    { name: 'Aggressive', risk: 0.15 },
    { name: 'High Risk', risk: 0.35 }
  ];

  return (
    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
      <span className="font-medium">Risk Categories:</span>
      {categories.map(({ name, risk }) => {
        const { bg, emoji } = categorizeRisk(risk);
        return (
          <div key={name} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded ${bg} border`} />
            <span className="text-xs">{emoji} {name}</span>
          </div>
        );
      })}
    </div>
  );
}