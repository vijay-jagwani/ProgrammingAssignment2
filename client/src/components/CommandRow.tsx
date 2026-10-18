import type { ReactNode } from 'react';
import { GameMap } from './GameMap';

/** Top of every in-game screen: what to do next on the left, where the month stands on the right. */
export function CommandRow({ control }: { control: ReactNode }) {
  return (
    <div className="cmd-row">
      <div className="cmd-left">{control}</div>
      <div className="cmd-right">
        <GameMap compact />
      </div>
    </div>
  );
}
