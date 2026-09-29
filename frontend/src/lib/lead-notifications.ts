export interface LeadNotification {
  id: string;
  leadId: string;
  title: string;
  customerName: string;
  phone: string | null;
  destination: string | null;
  createdAt: string;
  read: boolean;
}

const STORAGE_KEY = 'errance-lead-notifications';
export const LEAD_NOTIFICATIONS_CHANGED = 'errance:lead-notifications-changed';

export function readLeadNotifications(): LeadNotification[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function writeLeadNotifications(items: LeadNotification[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 100)));
  window.dispatchEvent(new CustomEvent(LEAD_NOTIFICATIONS_CHANGED));
}

export function addLeadNotification(item: LeadNotification) {
  const current = readLeadNotifications().filter((existing) => existing.id !== item.id);
  writeLeadNotifications([item, ...current]);
}

