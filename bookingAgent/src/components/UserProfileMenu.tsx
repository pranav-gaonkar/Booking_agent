import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Settings, LogOut, HelpCircle, Shield } from 'lucide-react';

export const UserProfileMenu = () => {
  const [open, setOpen] = useState(false);

  const menuItems = [
    { icon: User, label: 'My Profile', action: () => {} },
    { icon: Settings, label: 'Settings', action: () => {} },
    { icon: Shield, label: 'Privacy', action: () => {} },
    { icon: HelpCircle, label: 'Help & Support', action: () => {} },
    { icon: LogOut, label: 'Sign Out', action: () => {}, destructive: true },
  ];

  return (
    <div className="relative">
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setOpen(!open)}
        className="glass-button rounded-full w-9 h-9 flex items-center justify-center overflow-hidden"
      >
        <div className="w-full h-full bg-gradient-to-br from-primary/60 to-accent/60 flex items-center justify-center">
          <span className="text-xs font-bold text-primary-foreground">JD</span>
        </div>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute right-0 top-full mt-2 w-56 glass-card rounded-2xl z-50 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-border/30">
                <p className="text-sm font-semibold text-foreground">John Doe</p>
                <p className="text-[11px] text-muted-foreground">john.doe@example.com</p>
              </div>
              <div className="p-1.5">
                {menuItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => { item.action(); setOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition-colors
                      ${item.destructive ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-primary/10'}
                    `}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
