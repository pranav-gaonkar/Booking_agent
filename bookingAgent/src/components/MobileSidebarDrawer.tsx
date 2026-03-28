import { Calendar, Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { BookingSidebar } from '@/components/BookingSidebar';

export const MobileSidebarDrawer = () => {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="glass-button rounded-xl p-2 lg:hidden">
          <Menu className="h-5 w-5 text-foreground" />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[320px] bg-background/80 backdrop-blur-2xl border-l border-border/50 p-0">
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border/30">
          <SheetTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Schedule Overview
          </SheetTitle>
        </SheetHeader>
        <BookingSidebar />
      </SheetContent>
    </Sheet>
  );
};
