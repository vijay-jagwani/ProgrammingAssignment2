import type { ReactNode } from 'react';
import { Phase, Role } from '@scg/shared';

export type IconName = 'chart' | 'factory' | 'truck' | 'tag' | 'handshake' | 'cart' | 'bars' | 'robot';

const PATHS: Record<IconName, ReactNode> = {
  chart: <><path d="M3 20h18" /><path d="M5 16l4-5 3 3 6-7" /></>,
  factory: <><path d="M3 20V10l5 3V10l5 3V6h3v14" /><path d="M3 20h18" /></>,
  truck: <><path d="M2 6h12v10H2z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="6" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  tag: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.3" /></>,
  handshake: <><path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" /></>,
  cart: <><path d="M3 4h2l2.2 10.5h10.6L20 7H7" /><circle cx="9.5" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>,
  bars: <><path d="M5 20V12M10 20V6M15 20v-9M20 20V9" /></>,
  robot: <><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01" /></>,
};

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export const PHASE_ICON: Record<Phase, IconName> = {
  LOBBY: 'chart',
  FORECAST: 'chart',
  PRODUCTION: 'factory',
  TRANSPORT: 'truck',
  PRICING: 'tag',
  TRADING: 'handshake',
  ORDERS: 'cart',
  RESULTS: 'bars',
  GAME_OVER: 'bars',
};

export const ROLE_ICON: Record<Role, IconName> = {
  DEMAND_PLANNER: 'chart',
  PRODUCTION_PLANNER: 'factory',
  TRANSPORT_MANAGER: 'truck',
  CUSTOMER_OPS: 'tag',
  CEO: 'handshake',
};

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
