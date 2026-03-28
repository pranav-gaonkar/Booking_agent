import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Days with bookings (dummy)
const bookedDays = [24, 25, 26, 27];
const conflictDays = [26];

export const MiniCalendar = () => {
  const [currentDate] = useState(new Date(2026, 2)); // March 2026
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = 23;

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
          <button className="glass-button rounded-lg p-1"><ChevronLeft className="h-3 w-3 text-muted-foreground" /></button>
          <button className="glass-button rounded-lg p-1"><ChevronRight className="h-3 w-3 text-muted-foreground" /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {DAYS.map(d => (
          <div key={d} className="text-[10px] text-muted-foreground text-center py-1 font-medium">{d}</div>
        ))}
        {cells.map((day, i) => {
          const isToday = day === today;
          const hasBooking = day && bookedDays.includes(day);
          const hasConflict = day && conflictDays.includes(day);

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
