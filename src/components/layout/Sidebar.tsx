import React from 'react';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { UserProfile } from '../../types/mis';
import { canRoleAccessWorkspaceTab } from '../../types/roles';
import { useRtdb } from '../../context/RtdbContext';
import { MONTEX_OFFICIAL_LOGO_PATH } from '../common/MontexLogo';
import { NAV_GROUPS } from './nav';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/overlays';

interface SidebarProps {
  currentTab: string;
  onNavigate: (tabId: string) => void;
  currentUser: UserProfile;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Counts that need someone's attention (not register totals). */
function useAttentionCounts(): Record<string, number> {
  const { rawMaterials, qualityInspections, actionQueue, tasks, salesOrders } = useRtdb();
  return {
    inventory: rawMaterials.filter((m) => m.status === 'critical').length,
    quality: qualityInspections.filter((q) => q.status !== 'cleared').length,
    notifications: actionQueue.filter((a) => !a.acknowledged).length,
    tasks_accountability: tasks.filter((t) => t.status === 'submitted_for_verification' || t.status === 'blocked').length,
    dispatch: salesOrders.filter((o) => o.qualityClearedBy && o.financeClearedBy && o.status !== 'completed').length,
  };
}

// Credit for the people who built the system.
const credit = (
  <p className="px-3 pb-3 pt-1 text-[11px] leading-snug text-slate-500">
    Built by <span className="font-medium text-slate-300">Ansh Yadav</span>
    <br />
    <span className="font-semibold tracking-wide text-bronze-400">BLOOM COSMOS</span>
  </p>
);

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onNavigate,
  currentUser,
  mobileOpen,
  onCloseMobile,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const counts = useAttentionCounts();
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => canRoleAccessWorkspaceTab(currentUser.role, i.id, currentUser.accountStatus)),
  })).filter((g) => g.items.length > 0);

  const renderNav = (collapsed: boolean) => (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.title} className="mb-5 last:mb-0">
          {!collapsed && (
            <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {group.title}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = currentTab === item.id;
              const count = counts[item.id] || 0;
              const Icon = item.icon;
              const link = (
                <button
                  type="button"
                  onClick={() => {
                    onNavigate(item.id);
                    onCloseMobile();
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze-400',
                    collapsed && 'justify-center px-0',
                    active ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  )}
                >
                  {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-bronze-400" aria-hidden="true" />}
                  <Icon className={cn('size-[18px] shrink-0', active ? 'text-bronze-300' : 'text-slate-400 group-hover:text-slate-200')} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {count > 0 &&
                    (collapsed ? (
                      <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-bronze-400" aria-label={`${count} need attention`} />
                    ) : (
                      <span className="ml-auto rounded-full bg-bronze-500/20 px-1.5 text-[11px] font-semibold tabular-nums text-bronze-200">
                        {count}
                      </span>
                    ))}
                </button>
              );
              return (
                <li key={item.id}>
                  {collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (collapsed: boolean) => (
    <div className={cn('flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-4', collapsed && 'justify-center px-0')}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white p-1">
        <img src={MONTEX_OFFICIAL_LOGO_PATH} alt="Montex" className="h-full w-full object-contain" />
      </span>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold text-white">Montex MIS</p>
          <p className="truncate text-[11px] text-slate-400">Montex Forge Industries</p>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col bg-slate-950 transition-[width] duration-200 lg:flex',
          isCollapsed ? 'w-[68px]' : 'w-[248px]'
        )}
      >
        {brand(isCollapsed)}
        {renderNav(isCollapsed)}
        {onToggleCollapse && (
          <div className="border-t border-white/10 p-3">
            <button
              type="button"
              onClick={onToggleCollapse}
              className={cn(
                'flex h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 text-[13px] text-slate-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze-400',
                isCollapsed && 'justify-center px-0'
              )}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
              {!isCollapsed && 'Collapse'}
            </button>
          </div>
        )}
        {!isCollapsed && credit}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-950/60 animate-fade-in" onClick={onCloseMobile} />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-slate-950 shadow-raised animate-slide-up">
            {brand(false)}
            <button
              type="button"
              onClick={onCloseMobile}
              className="absolute right-3 top-4 flex size-8 cursor-pointer items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
            {renderNav(false)}
            {credit}
          </aside>
        </div>
      )}
    </>
  );
};
