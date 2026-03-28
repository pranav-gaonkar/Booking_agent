import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Calendar, Clock, Users, AlertTriangle, CheckCircle2, ChevronDown, MapPin } from 'lucide-react';
import { BookingItem, getBookings } from '@/lib/agentApi';
import { ActivityFeed } from '@/components/ActivityFeed';

const statusConfig = {
  confirmed: { icon: CheckCircle2, label: 'Confirmed', className: 'text-primary' },
  pending: { icon: Clock, label: 'Pending', className: 'text-accent' },
  conflict: { icon: AlertTriangle, label: 'Conflict', className: 'text-destructive' },
};

const statusFilters = ['all', 'confirmed', 'pending', 'conflict'] as const;
type StatusFilter = typeof statusFilters[number];

const filterLabels: Record<StatusFilter, string> = {
  all: 'All',
  confirmed: 'Confirmed',
  pending: 'Pending',
  conflict: 'Conflicts',
};

export const BookingSidebar = () => {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  const filteredBookings = filter === 'all'
    ? bookings
    : bookings.filter(b => b.status === filter);

  return (
    <div className="flex flex-col h-full gap-5 p-4 overflow-y-auto pb-8">
      {/* Upcoming Bookings */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5" /> Upcoming Bookings
        </h3>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {statusFilters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`glass-button rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
                filter === f
                  ? 'ring-1 ring-primary/40 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {filterLabels[f]}
            </button>
          ))}
        </div>
        <div className="space-y-2.5">
          {filteredBookings.map((booking, i) => {
            const StatusIcon = statusConfig[booking.status].icon;
            const isExpanded = expandedId === booking.id;
            return (
              <motion.div
                key={booking.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className="glass-card p-3 rounded-xl cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : booking.id)}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <h4 className="text-sm font-medium text-foreground">{booking.title}</h4>
                  <div className="flex items-center gap-1 shrink-0">
                    <StatusIcon className={`h-4 w-4 ${statusConfig[booking.status].className}`} />
                    <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{booking.time}</span>
                  <span>{booking.duration}</span>
                </div>
                <motion.div
                  initial={false}
                  animate={{ height: isExpanded ? 'auto' : 0, opacity: isExpanded ? 1 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 pt-2 border-t border-border/20 space-y-1.5">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3 shrink-0" />
                      <span>{booking.participants.join(', ')}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3 shrink-0" />
                      <span>{booking.date}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span>Virtual · Google Meet</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] mt-1">
                      <span className={`glass-button rounded-full px-2 py-0.5 ${statusConfig[booking.status].className}`}>
                        {statusConfig[booking.status].label}
                      </span>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            );
          })}
          {filteredBookings.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No bookings match this filter.</p>
          )}
        </div>
      </div>

      {/* Activity Feed */}
      <ActivityFeed />
    </div>
  );
};
