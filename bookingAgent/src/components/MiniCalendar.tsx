import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getBookings, type BookingItem } from '@/lib/agentApi';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const MiniCalendar = () => {
  const [currentDate, setCurrentDate] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
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

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const now = new Date();

  const dayMarkers = useMemo(() => {
    const markedBooked = new Set<number>();
    const markedConflict = new Set<number>();

    for (const booking of bookings) {
      const parsed = new Date(`${booking.date}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) {
        continue;
      }
      if (parsed.getFullYear() !== year || parsed.getMonth() !== month) {
        continue;
      }

      const day = parsed.getDate();
      markedBooked.add(day);
      if (booking.status === 'conflict') {
        markedConflict.add(day);
      }
    }

    return {
      booked: markedBooked,
      conflict: markedConflict,
    };
  }, [bookings, month, year]);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-foreground">
          {MONTHS[month]} {year}
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
            className="glass-button rounded-lg p-1"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-3 w-3 text-muted-foreground" />
          </button>
          <button
            onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
            className="glass-button rounded-lg p-1"
            aria-label="Next month"
          >
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {DAYS.map(d => (
          <div key={d} className="text-[10px] text-muted-foreground text-center py-1 font-medium">{d}</div>
        ))}
        {cells.map((day, i) => {
          const isToday = Boolean(
            day
              && day === now.getDate()
              && month === now.getMonth()
              && year === now.getFullYear(),
          );
          const hasBooking = Boolean(day && dayMarkers.booked.has(day));
          const hasConflict = Boolean(day && dayMarkers.conflict.has(day));

          return (
            <motion.button
              key={i}
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.9 }}
              className={`relative text-[11px] rounded-lg py-1.5 transition-colors
                ${!day ? 'invisible' : 'hover:bg-primary/10 cursor-pointer'}
                ${isToday ? 'bg-primary text-primary-foreground font-bold' : 'text-foreground'}
              `}
            >
              {day}
              {hasBooking && !isToday && (
                <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${hasConflict ? 'bg-destructive' : 'bg-primary'}`} />
              )}
            </motion.button>
          );
        })}
      </div>

      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-border/30">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span className="text-[10px] text-muted-foreground">Booked</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-destructive" />
          <span className="text-[10px] text-muted-foreground">Conflict</span>
        </div>
      </div>
    </div>
  );
};
