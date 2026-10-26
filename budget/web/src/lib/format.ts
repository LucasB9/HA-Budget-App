import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isMonthKey } from '@budget/shared';
import { useApp } from './app-context';

const dayFormatter = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function toUtcNoon(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

export function formatDayFr(iso: string, today: string): string {
  if (iso === today) return "Aujourd'hui";
  const diffDays = Math.round((toUtcNoon(today).getTime() - toUtcNoon(iso).getTime()) / 86_400_000);
  if (diffDays === 1) return 'Hier';
  return dayFormatter.format(toUtcNoon(iso));
}

export function formatDateTimeFr(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
}

/** Month shown by a screen, kept in the `?m=YYYY-MM` query so it survives reloads and links. */
export function useMonthParam(): [string, (month: string) => void] {
  const { session } = useApp();
  const [params, setParams] = useSearchParams();
  const raw = params.get('m');
  const month = raw && isMonthKey(raw) ? raw : session.currentMonth;
  const setMonth = useCallback(
    (next: string) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('m', next);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [month, setMonth];
}

const RECENT_KEY = 'budget.recentCategories';

export interface RecentCategory {
  categoryId: string;
  subcategoryId: string | null;
}

export function readRecentCategories(): RecentCategory[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as RecentCategory[]).slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function rememberCategory(entry: RecentCategory): void {
  try {
    const rest = readRecentCategories().filter(
      (r) => !(r.categoryId === entry.categoryId && r.subcategoryId === entry.subcategoryId),
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify([entry, ...rest].slice(0, 6)));
  } catch {
    // recents are a convenience only
  }
}
