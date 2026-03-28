import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, AlertTriangle, Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { getStats } from '@/lib/agentApi';

type TrendType = 'up' | 'down' | 'flat';

const trendConfig = {
  up: { icon: TrendingUp, className: 'text-primary' },
  down: { icon: TrendingDown, className: 'text-destructive' },
  flat: { icon: Minus, className: 'text-muted-foreground' },
};

const ProgressRing = ({ progress, color }: { progress: number; color: string }) => {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  const strokeColor = color.includes('primary') ? 'hsl(var(--primary))' : color.includes('accent') ? 'hsl(var(--accent))' : 'hsl(var(--destructive))';

  return (
    <svg width="44" height="44" className="shrink-0 -rotate-90">
      <circle cx="22" cy="22" r={radius} fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
      <motion.circle
        cx="22" cy="22" r={radius} fill="none"
        stroke={strokeColor} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.2, delay: 0.3, ease: 'easeOut' }}
      />
    </svg>
  );
};

export const StatsBar = () => {
  const [counts, setCounts] = useState({ total: 0, confirmed: 0, pending: 0, conflicts: 0 });

  useEffect(() => {
    const loadStats = async () => {
      try {
        const data = await getStats();
        setCounts({
          total: data.total_bookings,
          confirmed: data.confirmed,
          pending: data.pending,
          conflicts: data.conflicts,
        });
      } catch {
        setCounts({ total: 0, confirmed: 0, pending: 0, conflicts: 0 });
      }
    };

    void loadStats();
    const handler = () => {
      void loadStats();
    };
    window.addEventListener('booking-data-updated', handler);
    return () => window.removeEventListener('booking-data-updated', handler);
  }, []);

  const denominator = Math.max(1, counts.total);
  const stats = useMemo(
    () => [
      {
        icon: Calendar,
        label: 'Total Bookings',
        value: String(counts.total),
        color: 'text-primary',
        progress: counts.total > 0 ? 100 : 0,
        trend: 'up' as TrendType,
        change: counts.total > 0 ? 'live' : '0',
      },
      {
        icon: CheckCircle2,
        label: 'Confirmed',
        value: String(counts.confirmed),
        color: 'text-primary',
        progress: Math.round((counts.confirmed / denominator) * 100),
        trend: 'up' as TrendType,
        change: `${Math.round((counts.confirmed / denominator) * 100)}%`,
      },
      {
        icon: Clock,
        label: 'Pending',
        value: String(counts.pending),
        color: 'text-accent',
        progress: Math.round((counts.pending / denominator) * 100),
        trend: 'flat' as TrendType,
        change: `${Math.round((counts.pending / denominator) * 100)}%`,
      },
      {
        icon: AlertTriangle,
        label: 'Conflicts',
        value: String(counts.conflicts),
        color: 'text-destructive',
        progress: Math.round((counts.conflicts / denominator) * 100),
        trend: counts.conflicts > 0 ? ('up' as TrendType) : ('down' as TrendType),
        change: `${Math.round((counts.conflicts / denominator) * 100)}%`,
      },
    ],
    [counts, denominator],
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          className="glass-card rounded-xl p-3 flex items-center gap-3 group cursor-default"
        >
          <div className="relative">
            <ProgressRing progress={stat.progress} color={stat.color} />
            <div className="absolute inset-0 flex items-center justify-center">
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
          </div>
          <div>
            <p className="text-lg font-bold text-foreground leading-none">{stat.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{stat.label}</p>
            <div className="flex items-center gap-1 mt-1">
              {(() => {
                const TrendIcon = trendConfig[stat.trend].icon;
                return <TrendIcon className={`h-3 w-3 ${trendConfig[stat.trend].className}`} />;
              })()}
              <span className={`text-[10px] font-medium ${trendConfig[stat.trend].className}`}>{stat.change}</span>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
};
