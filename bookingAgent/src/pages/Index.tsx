import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ChatPanel } from '@/components/ChatPanel';
import { BookingSidebar } from '@/components/BookingSidebar';
import { StatsBar } from '@/components/StatsBar';
import { MobileSidebarDrawer } from '@/components/MobileSidebarDrawer';
import { NotificationPanel } from '@/components/NotificationPanel';
import { UserPreferences } from '@/components/UserPreferences';
import { BookingSummary } from '@/components/BookingSummary';
import { MiniCalendar } from '@/components/MiniCalendar';
import { Bot, Calendar, Bell, Command, Settings, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { CommandPalette } from '@/components/CommandPalette';

const Index = () => {
  const currentMonthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const [notifOpen, setNotifOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!calendarRef.current) {
        return;
      }
      if (!calendarRef.current.contains(event.target as Node)) {
        setCalendarOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <CommandPalette />

      {/* Vivid ambient background blobs for glass contrast */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-20 -left-20 w-[420px] h-[420px] rounded-full bg-primary/10 dark:bg-primary/5 blur-3xl animate-float" />
        <div className="absolute top-1/3 -right-32 w-[500px] h-[500px] rounded-full bg-accent/12 dark:bg-accent/5 blur-3xl animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute -bottom-20 left-1/4 w-[380px] h-[380px] rounded-full bg-primary/8 dark:bg-primary/3 blur-3xl animate-float" style={{ animationDelay: '4s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/6 dark:bg-accent/2 blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-30 border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3"
          >
            <div className="glass-button rounded-xl p-2 text-primary">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">BookFlow AI</h1>
              <p className="text-xs text-muted-foreground">Powered by LangGraph</p>
            </div>
          </motion.div>

          <div className="flex items-center gap-2">
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="hidden sm:flex relative"
            >
              <button
                onClick={() => setCalendarOpen(prev => !prev)}
                className="glass-button rounded-xl px-3 py-2 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                title="Open calendar"
              >
                <Calendar className="h-4 w-4" />
                <span>{currentMonthLabel}</span>
              </button>
              {calendarOpen && (
                <div
                  ref={calendarRef}
                  className="absolute right-0 top-12 z-[120] w-[300px]"
                >
                  <MiniCalendar />
                </div>
              )}
            </motion.div>

            <motion.button
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
              className="glass-button rounded-xl px-3 py-2 hidden sm:flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
              title="Command palette"
            >
              <Command className="h-3.5 w-3.5" />
              <kbd className="font-mono text-[10px]">⌘K</kbd>
            </motion.button>

            {/* Summary button */}
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => { e.stopPropagation(); setSummaryOpen(true); }}
              className="glass-button rounded-xl p-2 text-muted-foreground hover:text-foreground"
              title="Booking Summary"
            >
              <FileText className="h-4 w-4" />
            </motion.button>

            {/* Settings button */}
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => { e.stopPropagation(); setPrefsOpen(true); }}
              className="glass-button rounded-xl p-2 text-muted-foreground hover:text-foreground"
              title="User Preferences"
            >
              <Settings className="h-4 w-4" />
            </motion.button>

            {/* Notification bell */}
            <div className="relative z-40">
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => { e.stopPropagation(); setNotifOpen(prev => !prev); }}
                className="glass-button rounded-xl p-2 relative text-muted-foreground hover:text-foreground"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-destructive rounded-full border-2 border-background" />
                )}
              </motion.button>
              <NotificationPanel
                open={notifOpen}
                onClose={() => setNotifOpen(false)}
                onUnreadCountChange={setUnreadCount}
              />
            </div>

            <ThemeToggle />
            <MobileSidebarDrawer />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 py-4 h-[calc(100vh-65px)] flex flex-col gap-4">
        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <StatsBar />
        </motion.div>

        {/* Chat + Sidebar */}
        <div className="flex-1 flex gap-4 min-h-0">
          {/* Chat Area */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="glass-card flex-1 rounded-2xl flex flex-col min-h-0"
          >
            <div className="px-4 py-3 border-b border-border/30">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                Chat with your Booking Agent
              </h2>
            </div>
            <div className="flex-1 min-h-0">
              <ChatPanel />
            </div>
          </motion.div>

          {/* Sidebar — hidden on mobile, use drawer instead */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="glass-card w-80 rounded-2xl hidden lg:flex flex-col min-h-0 shrink-0"
          >
            <div className="px-4 py-3 border-b border-border/30">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                Bookings & Activity
              </h2>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <BookingSidebar />
            </div>
          </motion.div>
        </div>
      </main>
      {/* Modals */}
      <UserPreferences open={prefsOpen} onClose={() => setPrefsOpen(false)} />
      <BookingSummary open={summaryOpen} onClose={() => setSummaryOpen(false)} />
    </div>
  );
};

export default Index;
