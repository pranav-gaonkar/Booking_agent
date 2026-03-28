import { useState } from 'react';
import { Settings, Clock, Bell, Globe, Monitor } from 'lucide-react';
import { motion } from 'framer-motion';

interface Preferences {
  defaultDuration: string;
  timezone: string;
  notifications: boolean;
  autoResolve: boolean;
  workingHoursStart: string;
  workingHoursEnd: string;
}

const defaults: Preferences = {
  defaultDuration: '30 min',
  timezone: 'UTC-5 (EST)',
  notifications: true,
  autoResolve: false,
  workingHoursStart: '09:00 AM',
  workingHoursEnd: '05:00 PM',
};

export const UserPreferences = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [prefs, setPrefs] = useState<Preferences>(defaults);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[90]" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] w-[90vw] max-w-md glass-card rounded-2xl p-6 shadow-2xl"
      >
        <h2 className="text-base font-bold text-foreground flex items-center gap-2 mb-5">
          <Settings className="h-4 w-4 text-primary" /> User Preferences
        </h2>

        <div className="space-y-4">
          {/* Default Duration */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" /> Default Duration
            </label>
            <select
              value={prefs.defaultDuration}
              onChange={e => setPrefs(p => ({ ...p, defaultDuration: e.target.value }))}
              className="glass-button rounded-lg px-3 py-1.5 text-xs text-foreground bg-transparent outline-none"
            >
              <option value="15 min">15 min</option>
              <option value="30 min">30 min</option>
              <option value="45 min">45 min</option>
              <option value="1 hr">1 hr</option>
              <option value="2 hrs">2 hrs</option>
            </select>
          </div>

          {/* Timezone */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              <Globe className="h-3.5 w-3.5" /> Timezone
            </label>
            <select
              value={prefs.timezone}
              onChange={e => setPrefs(p => ({ ...p, timezone: e.target.value }))}
              className="glass-button rounded-lg px-3 py-1.5 text-xs text-foreground bg-transparent outline-none"
            >
              <option>UTC-8 (PST)</option>
              <option>UTC-5 (EST)</option>
              <option>UTC+0 (GMT)</option>
              <option>UTC+1 (CET)</option>
              <option>UTC+5:30 (IST)</option>
              <option>UTC+8 (CST)</option>
              <option>UTC+9 (JST)</option>
            </select>
          </div>

          {/* Working Hours */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              <Monitor className="h-3.5 w-3.5" /> Working Hours
            </label>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="glass-button rounded-lg px-2 py-1.5 text-foreground">{prefs.workingHoursStart}</span>
              <span className="text-muted-foreground">to</span>
              <span className="glass-button rounded-lg px-2 py-1.5 text-foreground">{prefs.workingHoursEnd}</span>
            </div>
          </div>

          {/* Notifications */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              <Bell className="h-3.5 w-3.5" /> Email Notifications
            </label>
            <button
              onClick={() => setPrefs(p => ({ ...p, notifications: !p.notifications }))}
              className={`w-10 h-5 rounded-full transition-all relative ${prefs.notifications ? 'bg-primary' : 'bg-muted'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${prefs.notifications ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>

          {/* Auto Resolve */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              <Settings className="h-3.5 w-3.5" /> Auto-resolve Conflicts
            </label>
            <button
              onClick={() => setPrefs(p => ({ ...p, autoResolve: !p.autoResolve }))}
              className={`w-10 h-5 rounded-full transition-all relative ${prefs.autoResolve ? 'bg-primary' : 'bg-muted'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${prefs.autoResolve ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="glass-button rounded-xl px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button onClick={onClose} className="glass-button rounded-xl px-4 py-2 text-xs text-primary font-semibold ring-1 ring-primary/30">
            Save Preferences
          </button>
        </div>
      </motion.div>
    </>
  );
};
