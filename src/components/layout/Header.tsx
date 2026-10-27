import React from 'react';
import { Bell, ChevronDown, ChevronRight, LogOut, Menu, Search } from 'lucide-react';
import { UserProfile } from '../../types/mis';
import { ROLE_DISPLAY_LABELS } from '../../types/roles';
import { useRtdb } from '../../context/RtdbContext';
import { findNav } from './nav';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/ui/overlays';

interface HeaderProps {
  currentTab: string;
  onNavigate: (tabId: string) => void;
  currentUser: UserProfile;
  onOpenMobileMenu: () => void;
  onOpenSearch: () => void;
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '•'
  );
}

export const Header: React.FC<HeaderProps> = ({ currentTab, onNavigate, currentUser, onOpenMobileMenu, onOpenSearch }) => {
  const { actionQueue, lastSyncedAt, rtdbError, logoutUser } = useRtdb();
  const openAlerts = actionQueue.filter((a) => !a.acknowledged).length;
  const { item, group } = findNav(currentTab);
  const name = currentUser.displayName || currentUser.name || currentUser.email;
  const roleLabel = (ROLE_DISPLAY_LABELS as Record<string, string>)[currentUser.role] || currentUser.role;
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMobileMenu} aria-label="Open navigation">
        <Menu />
      </Button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm sm:flex">
        {group && <span className="text-muted-foreground">{group.title}</span>}
        {group && <ChevronRight className="size-3.5 text-slate-400" aria-hidden="true" />}
        <span className="truncate font-semibold text-foreground">{item?.label || 'Montex MIS'}</span>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-slate-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
          aria-label="Search pages, orders and customers"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Search…</span>
          <kbd className="ml-auto hidden rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold sm:inline">
            {isMac ? '⌘' : 'Ctrl'} K
          </kbd>
        </button>

        <Tooltip content={rtdbError ? 'Some data could not load' : lastSyncedAt ? `Live · updated ${lastSyncedAt}` : 'Connecting…'}>
          <span className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground md:inline-flex">
            <span className={`size-2 rounded-full ${rtdbError ? 'bg-amber-500' : lastSyncedAt ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden="true">
              {!rtdbError && lastSyncedAt && <span className="block size-2 animate-ping rounded-full bg-emerald-400 opacity-60" />}
            </span>
            {rtdbError ? 'Partial' : 'Live'}
          </span>
        </Tooltip>

        <Tooltip content={openAlerts ? `${openAlerts} open alerts` : 'No open alerts'}>
          <Button variant="ghost" size="icon" className="relative" onClick={() => onNavigate('notifications')} aria-label={`Alerts, ${openAlerts} open`}>
            <Bell />
            {openAlerts > 0 && (
              <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white">
                {openAlerts > 9 ? '9+' : openAlerts}
              </span>
            )}
          </Button>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex cursor-pointer items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                {initials(name)}
              </span>
              <span className="hidden text-left leading-tight xl:block">
                <span className="block max-w-40 truncate text-sm font-semibold">{name}</span>
                <span className="block max-w-40 truncate text-xs text-muted-foreground">{roleLabel}</span>
              </span>
              <ChevronDown className="hidden size-4 text-muted-foreground xl:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <span className="block font-semibold text-foreground">{name}</span>
              <span className="block">{currentUser.email}</span>
              <span className="mt-1 block">
                {roleLabel} · {currentUser.department}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => logoutUser()}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
