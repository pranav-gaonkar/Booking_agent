import { motion } from 'framer-motion';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { FileText, Download, CheckCircle2, Clock, AlertTriangle, Mail, Upload } from 'lucide-react';
import { BookingItem, getSummary, importBookingsCsv } from '@/lib/agentApi';

export const BookingSummary = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadSummary = async () => {
    try {
      const data = await getSummary();
      setBookings(data.bookings);
    } catch {
      setBookings([]);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadSummary();
  }, [open]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setImporting(true);
    setImportMessage(null);
    try {
      const csvContent = await file.text();
      const result = await importBookingsCsv(csvContent);
      setImportMessage(
        `Imported ${result.imported}, skipped ${result.skipped}${
          result.errors.length ? ` (${result.errors[0]})` : ''
        }`,
      );
      await loadSummary();
      window.dispatchEvent(new Event('booking-data-updated'));
    } catch (error) {
      const text = error instanceof Error ? error.message : 'CSV import failed.';
      setImportMessage(text);
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  };

  const handleExportCsv = () => {
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const header = ['title', 'date', 'time', 'duration', 'status'];
    const rows = bookings.map((b) => [
      b.title,
      `='${b.date}'`,
      `='${b.time}'`,
      b.duration,
      b.status,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => escapeCsv(String(cell))).join(','))
      .join('\r\n');

    // Include UTF-8 BOM so Excel opens text cleanly and preserves date/time text fields.
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'booking-summary.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  const confirmed = bookings.filter(b => b.status === 'confirmed').length;
  const pending = bookings.filter(b => b.status === 'pending').length;
  const conflicts = bookings.filter(b => b.status === 'conflict').length;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[90]" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        className="fixed top-[46%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] w-[90vw] max-w-lg max-h-[88vh] overflow-y-auto glass-card rounded-2xl p-6 shadow-2xl"
      >
        <h2 className="text-base font-bold text-foreground flex items-center gap-2 mb-5">
          <FileText className="h-4 w-4 text-primary" /> Booking Summary
        </h2>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFileSelected}
        />

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="glass-button rounded-xl p-3 text-center">
            <CheckCircle2 className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-lg font-bold text-foreground">{confirmed}</p>
            <p className="text-[10px] text-muted-foreground">Confirmed</p>
          </div>
          <div className="glass-button rounded-xl p-3 text-center">
            <Clock className="h-5 w-5 text-accent mx-auto mb-1" />
            <p className="text-lg font-bold text-foreground">{pending}</p>
            <p className="text-[10px] text-muted-foreground">Pending</p>
          </div>
          <div className="glass-button rounded-xl p-3 text-center">
            <AlertTriangle className="h-5 w-5 text-destructive mx-auto mb-1" />
            <p className="text-lg font-bold text-foreground">{conflicts}</p>
            <p className="text-[10px] text-muted-foreground">Conflicts</p>
          </div>
        </div>

        {/* Booking Table */}
        <div className="glass-button rounded-xl overflow-hidden mb-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Meeting</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Date</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Time</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Status</th>
              </tr>
            </thead>
          </table>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {bookings.map(b => {
                  const StatusIcon = b.status === 'confirmed' ? CheckCircle2 : b.status === 'pending' ? Clock : AlertTriangle;
                  const statusColor = b.status === 'confirmed' ? 'text-primary' : b.status === 'pending' ? 'text-accent' : 'text-destructive';
                  return (
                    <tr key={b.id} className="border-b border-border/10 last:border-0">
                      <td className="px-3 py-2 text-foreground font-medium">{b.title}</td>
                      <td className="px-3 py-2 text-muted-foreground">{b.date}</td>
                      <td className="px-3 py-2 text-muted-foreground">{b.time}</td>
                      <td className="px-3 py-2">
                        <StatusIcon className={`h-3.5 w-3.5 ${statusColor}`} />
                      </td>
                    </tr>
                  );
                })}
                {bookings.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-muted-foreground" colSpan={4}>No bookings yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {importMessage && (
          <p className="text-[11px] text-muted-foreground mb-3">{importMessage}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button className="glass-button rounded-xl px-4 py-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Email Report
          </button>
          <button
            onClick={handleExportCsv}
            className="glass-button rounded-xl px-4 py-2 text-xs text-primary font-semibold ring-1 ring-primary/30 flex items-center gap-1.5"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          <button
            onClick={handleImportClick}
            disabled={importing}
            className="glass-button rounded-xl px-4 py-2 text-xs text-primary font-semibold ring-1 ring-primary/30 flex items-center gap-1.5 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" /> {importing ? 'Importing...' : 'Import CSV'}
          </button>
          <button onClick={onClose} className="glass-button rounded-xl px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>
      </motion.div>
    </>
  );
};
