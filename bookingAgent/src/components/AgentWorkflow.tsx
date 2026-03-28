import { motion } from 'framer-motion';
import { Bot, Sparkles, MessageSquare, GitBranch, Wrench, ChevronRight } from 'lucide-react';

const nodes = [
  { icon: MessageSquare, label: 'NLU', desc: 'Intent & Entity Extraction', color: 'text-accent' },
  { icon: GitBranch, label: 'LangGraph', desc: 'State Graph Controller', color: 'text-primary' },
  { icon: Wrench, label: 'Tools', desc: 'Calendar & Booking APIs', color: 'text-primary' },
  { icon: Sparkles, label: 'Resolve', desc: 'Conflict Resolution', color: 'text-destructive' },
];

export const AgentWorkflow = () => {
  return (
    <div className="glass-card p-5 rounded-2xl">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
        <Bot className="h-3.5 w-3.5" /> Agent Workflow Pipeline
      </h3>
      <div className="flex items-center justify-between gap-0">
        {nodes.map((node, i) => (
          <div key={node.label} className="flex items-center gap-0 flex-1">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.12 }}
              className="glass-button rounded-xl p-3 flex flex-col items-center text-center flex-1 min-w-0"
            >
              <node.icon className={`h-5 w-5 mb-1.5 ${node.color}`} />
              <span className="text-xs font-semibold text-foreground">{node.label}</span>
              <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">{node.desc}</span>
            </motion.div>
            {i < nodes.length - 1 && (
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.12 + 0.1 }}
                className="shrink-0 flex items-center mx-1"
              >
                <div className="w-6 h-0.5 bg-primary/60 rounded-full" />
                <ChevronRight className="h-4 w-4 -ml-1 text-primary/80" />
              </motion.div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
