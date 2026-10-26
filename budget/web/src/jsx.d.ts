import type { JSX as ReactJSX } from 'react';

// React 19 no longer declares the global JSX namespace; keep `JSX.Element` usable in annotations.
declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
  }
}
