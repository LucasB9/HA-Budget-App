import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconBudget = (): JSX.Element => (
  <Svg>
    <path d="M12 3a9 9 0 1 0 9 9h-9V3Z" />
    <path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z" />
  </Svg>
);

export const IconList = (): JSX.Element => (
  <Svg>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="1" />
    <circle cx="4" cy="12" r="1" />
    <circle cx="4" cy="18" r="1" />
  </Svg>
);

export const IconBalance = (): JSX.Element => (
  <Svg>
    <path d="M12 4v16M5 8h14" />
    <path d="M5 8l-3 7a3.5 3.5 0 0 0 6 0L5 8ZM19 8l-3 7a3.5 3.5 0 0 0 6 0l-3-7Z" />
  </Svg>
);

export const IconMore = (): JSX.Element => (
  <Svg>
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
  </Svg>
);
