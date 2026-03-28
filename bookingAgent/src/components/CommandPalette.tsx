import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Calendar, MessageSquare, Clock, AlertTriangle, Sparkles, Command, ArrowRight } from 'lucide-react';
import { BookingItem, getBookings } from '@/lib/agentApi';

interface CommandItem {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  category: 'action' | 'booking' | 'navigation';
  shortcut?: string;
}

const baseCommands: CommandItem[] = [
  { id: 'new-booking', icon: Calendar, label: 'New Booking', description: 'Schedule a new meeting', category: 'action', shortcut: 'N' },
  { id: 'check-conflicts', icon: AlertTriangle, label: 'Check Conflicts', description: 'Scan for scheduling overlaps', category: 'action', shortcut: 'C' },
  { id: 'ai-suggest', icon: Sparkles, label: 'AI Suggestions', description: 'Get smart scheduling recommendations', category: 'action' },
  { id: 'open-chat', icon: MessageSquare, label: 'Open Chat', description: 'Talk to your booking agent', category: 'navigation' },
];

export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [bookings, setBookings] = useState<BookingItem[]>([]);

  useEffect(() => {
    const loadBookings = async () => {
      try {
        const data = await getBookings();
        setBookings(data);
      } catch {
        setBookings([]);
      }
    };

    void loadBookings();
    const handler = () => {
      void loadBookings();
    };
    window.addEventListener('booking-data-updated', handler);
    return () => window.removeEventListener('booking-data-updated', handler);
  }, []);

  const commands: CommandItem[] = [
    ...baseCommands,
    ...bookings.map(b => ({
      id: `booking-${b.id}`,
      icon: Clock,
      label: b.title,
      description: `${b.date} at ${b.time} · ${b.duration}`,
      category: 'booking' as const,
    })),
  ];

  const toggle = useCallback(() => {
    setOpen(prev => !prev);
    setQuery('');
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle]);

  const filtered = commands.filter(c =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    c.description.toLowerCase().includes(query.toLowerCase())
  );

  const grouped = {
    action: filtered.filter(c => c.category === 'action'),
    booking: filtered.filter(c => c.category === 'booking'),
    navigation: filtered.filter(c => c.category === 'navigation'),
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-background/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 400 }}
            className="fixed top-[15%] left-1/2 -translate-x-1/2 z-[210] w-[90vw] max-w-lg glass-card rounded-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search commands, bookings..."
                className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
              />
              <kbd className="glass-button rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">ESC</kbd>
            </div>
            <div className="max-h-72 overflow-y-auto p-2 space-y-3">
              {Object.entries(grouped).map(([cat, items]) => items.length > 0 && (
                <div key={cat}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 mb-1.5">
                    {cat === 'action' ? 'Actions' : cat === 'booking' ? 'Bookings' : 'Navigation'}
                  </p>
                  {items.map((item, i) => (
                    <motion.button
                      key={item.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      onClick={() => setOpen(false)}
                      className="w-full glass-button rounded-xl px-3 py-2.5 flex items-center gap-3 text-left group mb-1"
                    >
                      <div className="glass-button rounded-lg p-1.5 shrink-0">
                        <item.icon className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{item.label}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{item.description}</p>
                      </div>
                      {item.shortcut && (
                        <kbd className="glass-button rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono shrink-0">
                          {item.shortcut}
                        </kbd>
                      )}
                      <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </motion.button>
                  ))}
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No results found
                </div>
              )}
            </div>
            <div className="px-4 py-2 border-t border-border/30 flex items-center gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><Command className="h-3 w-3" />+K to toggle</span>
              <span>↑↓ navigate</span>
              <span>↵ select</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};