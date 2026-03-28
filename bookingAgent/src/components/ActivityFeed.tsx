import { motion } from 'framer-motion';
import { CheckCircle2, Plus, RefreshCw, AlertTriangle, Clock } from 'lucide-react';

const activities = [
  { icon: Plus, label: 'New booking created', detail: 'Team Standup - Mar 24', time: '2 min ago', color: 'text-primary' },
  { icon: CheckCircle2, label: 'Meeting confirmed', detail: 'Design Review with Diana', time: '15 min ago', color: 'text-primary' },
  { icon: AlertTriangle, label: 'Conflict detected', detail: 'Sprint Planning overlap', time: '30 min ago', color: 'text-destructive' },
  { icon: RefreshCw, label: 'Rescheduled', detail: 'Client Call moved to Thu', time: '1 hr ago', color: 'text-accent' },
  { icon: Clock, label: 'Reminder sent', detail: 'Sprint Planning tomorrow', time: '2 hrs ago', color: 'text-muted-foreground' },
];

export const ActivityFeed = () => {
  return (
    <div className="space-y-2 pb-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
        <Clock className="h-3.5 w-3.5" /> Recent Activity
      </h3>
      {activities.map((a, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.06 }}
          className="glass-button rounded-xl p-2.5 flex items-center gap-3"
        >
          <div className={`shrink-0 ${a.color}`}>
            <a.icon className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-foreground truncate">{a.label}</p>
            <p className="text-[10px] text-muted-foreground truncate">{a.detail}</p>
          </div>
          <span className="text-[9px] text-muted-foreground/60 shrink-0">{a.time}</span>
        </motion.div>
      ))}
    </div>
  );
};
