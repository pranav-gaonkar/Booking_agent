export interface Booking {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  participants: string[];
  status: 'confirmed' | 'pending' | 'conflict';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface TimeSlot {
  time: string;
  available: boolean;
}

export const dummyBookings: Booking[] = [
  { id: '1', title: 'Team Standup', date: '2026-03-24', time: '09:00 AM', duration: '30 min', participants: ['Alice', 'Bob', 'Charlie'], status: 'confirmed' },
  { id: '2', title: 'Design Review', date: '2026-03-24', time: '11:00 AM', duration: '1 hr', participants: ['Diana', 'Eve'], status: 'confirmed' },
  { id: '3', title: 'Client Call', date: '2026-03-25', time: '02:00 PM', duration: '45 min', participants: ['Frank', 'Grace'], status: 'pending' },
  { id: '4', title: 'Sprint Planning', date: '2026-03-26', time: '10:00 AM', duration: '2 hrs', participants: ['Alice', 'Bob', 'Diana', 'Eve'], status: 'confirmed' },
  { id: '5', title: 'Lunch with Mentor', date: '2026-03-26', time: '12:30 PM', duration: '1 hr', participants: ['Prof. Smith'], status: 'conflict' },
];

export const dummyTimeSlots: TimeSlot[] = [
  { time: '08:00 AM', available: true },
  { time: '09:00 AM', available: false },
  { time: '10:00 AM', available: true },
  { time: '11:00 AM', available: false },
  { time: '12:00 PM', available: true },
  { time: '01:00 PM', available: true },
  { time: '02:00 PM', available: false },
  { time: '03:00 PM', available: true },
  { time: '04:00 PM', available: true },
  { time: '05:00 PM', available: true },
];

export const initialMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'assistant',
    content: "Hello! I'm your AI Booking Agent powered by LangGraph. I can help you schedule meetings, resolve conflicts, and manage your calendar. Try saying:\n\n- *\"Book a meeting with Alice tomorrow at 3 PM\"*\n- *\"What's my schedule for this week?\"*\n- *\"Reschedule my client call to Thursday\"*\n\nHow can I help you today?",
    timestamp: new Date(),
  },
];

export const agentResponses: Record<string, string> = {
  book: "I've analyzed your calendar and found an available slot. Here's what I've prepared:\n\n**New Meeting Booked** \n📅 March 27, 2026 at 3:00 PM\n⏱️ Duration: 30 minutes\n👥 Participants: Added\n\n✅ No conflicts detected. The booking has been confirmed!",
  schedule: "Here's your upcoming schedule:\n\n| Date | Time | Meeting |\n|------|------|---------|\n| Mar 24 | 9:00 AM | Team Standup |\n| Mar 24 | 11:00 AM | Design Review |\n| Mar 25 | 2:00 PM | Client Call |\n| Mar 26 | 10:00 AM | Sprint Planning |\n\n⚠️ **Conflict detected**: \"Lunch with Mentor\" overlaps with Sprint Planning on Mar 26. Would you like me to suggest alternatives?",
  reschedule: "I found the **Client Call** on your calendar.\n\n🔄 **Rescheduling Options:**\n1. Thursday, Mar 27 at 2:00 PM ✅ Available\n2. Thursday, Mar 27 at 3:00 PM ✅ Available\n3. Friday, Mar 28 at 10:00 AM ✅ Available\n\nWhich slot works best for you?",
  conflict: "I've detected a scheduling conflict:\n\n⚠️ **Sprint Planning** (10:00 AM - 12:00 PM) overlaps with **Lunch with Mentor** (12:30 PM)\n\n**Suggested Resolutions:**\n1. Move Lunch with Mentor to 1:00 PM\n2. Shorten Sprint Planning to 1.5 hours\n3. Move Lunch to another day\n\nWhich approach would you prefer?",
  default: "I understand your request. Let me check your calendar and find the best options for you.\n\n🔍 Analyzing availability...\n📊 Checking for conflicts...\n\nBased on your current schedule, I'd recommend scheduling this for **March 27 at 3:00 PM**. This slot has no conflicts and aligns with your typical meeting preferences.\n\nWould you like me to proceed with the booking?",
};
