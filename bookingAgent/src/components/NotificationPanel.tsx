import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCircle2, AlertTriangle, Clock, X, Calendar } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  NotificationItem,
  dismissNotification,
  getNotifications,
  markAllNotificationsRead,
} from '@/lib/agentApi';

const typeConfig = {
  success: { icon: CheckCircle2, className: 'text-primary' },
  warning: { icon: AlertTriangle, className: 'text-destructive' },
  info: { icon: Clock, className: 'text-accent' },
};

export const NotificationPanel = ({
  open,
  onClose,
  onUnreadCountChange,
}: {
  open: boolean;
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
}) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const data = await getNotifications();
        setNotifications(data.notifications);
        onUnreadCountChange(data.unread_count);
      } catch {
        setNotifications([]);
        onUnreadCountChange(0);
      }
    };

    void loadNotifications();
    const handler = () => {
      void loadNotifications();
    };
    window.addEventListener('booking-data-updated', handler);
    return () => window.removeEventListener('booking-data-updated', handler);
  }, [onUnreadCountChange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const refreshOnOpen = async () => {
      try {
        const data = await getNotifications();
        setNotifications(data.notifications);
        onUnreadCountChange(data.unread_count);
      } catch {
        // Keep previous state on refresh failures.
      }
    };

    void refreshOnOpen();
  }, [open, onUnreadCountChange]);

  const markAllRead = async () => {
    const unread = await markAllNotificationsRead();
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    onUnreadCountChange(unread);
  };

  const dismiss = async (id: string) => {
    const unread = await dismissNotification(id);
    setNotifications(prev => prev.filter(n => n.id !== id));
    onUnreadCountChange(unread);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90]"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
          />
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onPointerDown={(e) => e.stopPropagation()}
            className="fixed right-2 sm:right-4 top-[72px] w-[calc(100vw-1rem)] sm:w-96 max-w-96 glass-card rounded-2xl z-[100] overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                Notifications
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={markAllRead} className="text-[10px] text-primary hover:underline">
                  Mark all read
                </button>
                <button onClick={onClose} className="glass-button rounded-lg p-1">
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto p-2 space-y-1.5">
              {notifications.map((n, i) => {
                const Icon = typeConfig[n.type].icon;
                return (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`glass-button rounded-xl p-3 flex gap-3 group cursor-pointer ${!n.read ? 'ring-1 ring-primary/20' : 'opacity-70'}`}
                  >
                    <div className="shrink-0 mt-0.5">
                      <Icon className={`h-4 w-4 ${typeConfig[n.type].className}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-foreground truncate">{n.title}</p>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1">{n.time}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </motion.div>
                );
              })}
              {notifications.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  <Calendar className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No notifications
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
