import type { ReactNode } from 'react';

/** Top of every in-game screen: the advance control, then the map, then the inputs. */
export function CommandRow({ control }: { control: ReactNode }) {
  return <div className="cmd-row">{control}</div>;
}
