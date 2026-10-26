import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { GroupDto, PersonDto, SessionDto } from '@budget/shared';
import { readStoredPerson, storePerson } from './api';
import { useCatalog } from './queries';

interface AppState {
  session: SessionDto;
  people: PersonDto[];
  /** The person using the app, from the HA user or the local "Qui es-tu ?" choice. */
  me: PersonDto | null;
  setMe: (id: string) => void;
  personName: (id: string | null | undefined) => string;
  catalog: GroupDto[];
  categoryName: (id: string, subId?: string | null) => string;
  categoryLabel: (id: string, subId?: string | null) => string;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ session, children }: { session: SessionDto; children: ReactNode }): JSX.Element {
  const [storedMe, setStoredMe] = useState<string | null>(readStoredPerson());
  const catalogQuery = useCatalog();
  const catalog = catalogQuery.data ?? [];

  const value = useMemo<AppState>(() => {
    const people = session.people;
    const meId = session.me ?? (storedMe && people.some((p) => p.id === storedMe) ? storedMe : null);
    const categories = new Map(catalog.flatMap((g) => g.categories.map((c) => [c.id, c] as const)));
    const groups = new Map(catalog.map((g) => [g.id, g] as const));
    const categoryName = (id: string, subId?: string | null): string => {
      const cat = categories.get(id);
      if (!cat) return 'Catégorie inconnue';
      const sub = subId ? cat.subcategories.find((s) => s.id === subId) : undefined;
      return sub ? `${cat.name} · ${sub.name}` : cat.name;
    };
    return {
      session,
      people,
      me: people.find((p) => p.id === meId) ?? null,
      setMe: (id: string) => {
        storePerson(id);
        setStoredMe(id);
      },
      personName: (id) => people.find((p) => p.id === id)?.name ?? '—',
      catalog,
      categoryName,
      categoryLabel: (id, subId) => {
        const cat = categories.get(id);
        const group = cat ? groups.get(cat.groupId) : undefined;
        return `${group ? `${group.name} › ` : ''}${categoryName(id, subId)}`;
      },
    };
  }, [session, storedMe, catalog]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
