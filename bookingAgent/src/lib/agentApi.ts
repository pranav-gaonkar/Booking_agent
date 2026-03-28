export interface AgentChatRequest {
  message: string;
  threadId?: string;
}

export type BookingStatus = 'confirmed' | 'pending' | 'conflict';

export interface BookingItem {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  participants: string[];
  status: BookingStatus;
}

export interface StatsResponse {
  total_bookings: number;
  confirmed: number;
  pending: number;
  conflicts: number;
}

export interface SummaryResponse {
  stats: StatsResponse;
  bookings: BookingItem[];
}

export interface NotificationItem {
  id: string;
  type: 'success' | 'warning' | 'info';
  title: string;
  message: string;
  time: string;
  read: boolean;
}

export interface NotificationListResponse {
  notifications: NotificationItem[];
  unread_count: number;
}

export interface ImportCsvResponse {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface AgentChatResponse {
  reply: string;
  thread_id: string;
  booking_status: string;
  conflict_suggestions: string[];
  state: {
    current_intent?: Record<string, unknown>;
  };
}

const API_BASE_URL = import.meta.env.VITE_AGENT_API_URL ?? 'http://127.0.0.1:8000';

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Agent API error ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function sendAgentMessage(
  payload: AgentChatRequest,
): Promise<AgentChatResponse> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: payload.message,
      thread_id: payload.threadId,
    }),
  });

  return parseResponse<AgentChatResponse>(response);
}

export async function getBookings(): Promise<BookingItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/bookings`);
  return parseResponse<BookingItem[]>(response);
}

export async function getStats(): Promise<StatsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/stats`);
  return parseResponse<StatsResponse>(response);
}

export async function getSummary(): Promise<SummaryResponse> {
  const response = await fetch(`${API_BASE_URL}/api/summary`);
  return parseResponse<SummaryResponse>(response);
}

export async function getNotifications(): Promise<NotificationListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/notifications`);
  return parseResponse<NotificationListResponse>(response);
}

export async function markAllNotificationsRead(): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/api/notifications/mark-all-read`, {
    method: 'POST',
  });
  const data = await parseResponse<{ unread_count: number }>(response);
  return data.unread_count;
}

export async function dismissNotification(notificationId: string): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/api/notifications/${notificationId}`, {
    method: 'DELETE',
  });
  const data = await parseResponse<{ unread_count: number }>(response);
  return data.unread_count;
}

export async function importBookingsCsv(csvContent: string): Promise<ImportCsvResponse> {
  const response = await fetch(`${API_BASE_URL}/api/bookings/import-csv`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ csv_content: csvContent }),
  });

  return parseResponse<ImportCsvResponse>(response);
}
