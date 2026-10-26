import React from 'react';
import {
  LayoutDashboard,
  GitMerge,
  FileSpreadsheet,
  FileText,
  Users,
  Boxes,
  Layers,
  ShoppingCart,
  Factory,
  CheckCircle2,
  Truck,
  DollarSign,
  BarChart3,
  Bell,
  ShieldCheck,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { UserProfile } from '../../types/mis';
import { canRoleAccessWorkspaceTab } from '../../types/roles';
import { useRtdb } from '../../context/RtdbContext';
import { MontexLogo } from '../common/MontexLogo';

interface SidebarProps {
  currentTab: string;
  onNavigate: (tabId: string) => void;
  currentUser: UserProfile;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  alert?: boolean;
  tooltip?: string;
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onNavigate,
  currentUser,
  mobileOpen,
  onCloseMobile,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const {
    salesOrders,
    customers,
    products,
    rawMaterials,
    qualityInspections,
    actionQueue,
    quotations,
    purchaseOrders,
    tasks,
  } = useRtdb();

  const criticalShortages = rawMaterials.filter((m) => m.status === 'critical').length;
  const pendingQcCount = qualityInspections.filter((q) => q.status !== 'cleared').length;
  const openActionCount = actionQueue.filter((a) => !a.acknowledged).length;
  const pendingVerificationCount = tasks.filter(
    (t) => t.status === 'submitted_for_verification' || t.status === 'pending'
  ).length;

  const rawNavSections: NavSection[] = [
    {
      heading: 'Overview',
      items: [
        {
          id: 'dashboard',
          label: 'CEO Command Center',
          icon: LayoutDashboard,
          tooltip: 'Executive KPIs, bottlenecks & plant performance',
        },
        {
          id: 'order_journey',
          label: 'Order Lifecycle Tracker',
          icon: GitMerge,
          tooltip: '12-stage end-to-end order, FPR & H-1..H-5 handover progress',
        },
        {
          id: 'tasks_accountability',
          label: 'Tasks, Handovers & SOPs',
          icon: CheckCircle2,
          count: pendingVerificationCount,
          tooltip: 'Central Task Engine, Maker≠Checker Verification, H-1..H-5 Handovers & Duty SOPs',
        },
      ],
    },
    {
      heading: 'Sales & Orders',
      items: [
        {
          id: 'sales_orders',
          label: 'Sales Orders & Jobs',
          icon: FileSpreadsheet,
          count: salesOrders.length,
          tooltip: 'Customer purchase orders and internal job numbers',
        },
        {
          id: 'quotations',
          label: 'Quotations & Tenders',
          icon: FileText,
          count: quotations.length,
          tooltip: 'RFQs, repeat orders, follow-ups and PSU tenders',
        },
        {
          id: 'customers',
          label: 'Customers',
          icon: Users,
          count: customers.length,
          tooltip: 'Customer master directory and credit terms',
        },
        {
          id: 'products',
          label: 'Products & Specs',
          icon: Boxes,
          count: products.length,
          tooltip: 'Forged product catalog and standard weights',
        },
      ],
    },
    {
      heading: 'Operations',
      items: [
        {
          id: 'production',
          label: 'Production & Shop Floor',
          icon: Factory,
          tooltip: 'Shifts, hammers, furnaces, maintenance & power',
        },
        {
          id: 'inventory',
          label: 'Inventory & Stores',
          icon: Layers,
          alert: criticalShortages > 0,
          count: criticalShortages,
          tooltip: 'Raw material billet yard balances & stock movements',
        },
        {
          id: 'purchase',
          label: 'Purchase & Steel Mills',
          icon: ShoppingCart,
          count: purchaseOrders.length,
          tooltip: 'Steel mill purchase orders, indents & GRN receipts',
        },
        {
          id: 'quality',
          label: 'Quality & MTC',
          icon: CheckCircle2,
          count: pendingQcCount,
          tooltip: 'NDT inspections, dimensional reports & EN 10204 MTCs',
        },
      ],
    },
    {
      heading: 'Dispatch',
      items: [
        {
          id: 'dispatch',
          label: 'Dispatch & Logistics',
          icon: Truck,
          tooltip: 'Outward gate passes, vehicle LRs & delivery challans',
        },
      ],
    },
    {
      heading: 'Finance & Reports',
      items: [
        {
          id: 'finance',
          label: 'Invoices & Receivables',
          icon: DollarSign,
          tooltip: 'Receivables ageing, job costing, invoices & Tally sync',
        },
        {
          id: 'reports',
          label: 'Reports & Exports',
          icon: BarChart3,
          tooltip: 'Standard MIS reports, PDF packs & Excel workbooks',
        },
      ],
    },
    {
      heading: 'Administration',
      items: [
        {
          id: 'notifications',
          label: 'Alerts & Thresholds',
          icon: Bell,
          alert: openActionCount > 0,
          count: openActionCount,
          tooltip: 'Operational alert center and threshold rules',
        },
        {
          id: 'admin',
          label: 'Users, Roles & Settings',
          icon: ShieldCheck,
          tooltip: 'Employee accounts, RBAC permissions & diagnostics',
        },
      ],
    },
  ];

  const navSections: NavSection[] = rawNavSections
    .map((sec) => ({
      ...sec,
      items: sec.items.filter((item) =>
        canRoleAccessWorkspaceTab(currentUser.role, item.id, currentUser.accountStatus)
      ),
    }))
    .filter((sec) => sec.items.length > 0);


  const renderSidebarBody = (collapsedMode: boolean) => (
    <div
      className={`flex flex-col h-full bg-[#14283F] text-slate-100 border-r border-slate-800 select-none transition-all duration-200 ${
        collapsedMode ? 'w-20' : 'w-64'
      }`}
    >
      {/* Official Branded Sidebar Header */}
      <div className="p-3.5 border-b border-slate-800/90 bg-[#14283F] flex items-center justify-between gap-2">
        {collapsedMode ? (
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="mx-auto cursor-pointer focus-visible:outline-none"
            title="Montex Forge MIS — CEO Command Center"
          >
            <MontexLogo variant="compact" size="md" surface="dark" />
          </button>
        ) : (
          <div className="flex items-center justify-between w-full gap-2">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="text-left cursor-pointer focus-visible:outline-none"
            >
              <MontexLogo variant="full" size="md" surface="dark" showSubtitle />
            </button>

            {mobileOpen && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="p-1.5 text-slate-300 hover:text-white rounded-md cursor-pointer"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Primary Navigation Sections */}
      <nav
        aria-label="Primary Module Navigation"
        className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4"
      >
        {navSections.map((sec, idx) => (
          <div key={idx}>
            {!collapsedMode && (
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-1">
                {sec.heading}
              </div>
            )}
            <div className="space-y-0.5">
              {sec.items.map((item) => {
                const Icon = item.icon;
                const active = currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={
                      collapsedMode
                        ? `${item.label}${item.tooltip ? ` — ${item.tooltip}` : ''}`
                        : item.tooltip
                    }
                    onClick={() => {
                      onNavigate(item.id);
                      if (mobileOpen) onCloseMobile();
                    }}
                    className={`relative w-full flex items-center ${
                      collapsedMode ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2'
                    } text-xs font-medium rounded-md transition-all text-left cursor-pointer ${
                      active
                        ? 'bg-[#234765] text-white font-semibold shadow-xs'
                        : 'text-slate-300 hover:text-white hover:bg-[#234765]/55'
                    }`}
                  >
                    {active && (
                      <span
                        className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-[#F28C28]"
                        aria-hidden="true"
                      />
                    )}
                    <div
                      className={`flex items-center ${
                        collapsedMode ? 'justify-center' : 'gap-2.5 truncate'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          active ? 'text-[#F28C28]' : 'text-slate-400'
                        }`}
                      />
                      {!collapsedMode && <span className="truncate">{item.label}</span>}
                    </div>

                    {!collapsedMode && item.count !== undefined && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono tabular-nums shrink-0 ml-2 ${
                          item.alert
                            ? 'bg-rose-500/20 text-rose-200 border border-rose-400/40 font-bold'
                            : active
                            ? 'bg-[#14283F] text-[#F28C28] font-bold'
                            : 'bg-slate-800/80 text-slate-300'
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Desktop Collapse Toggle & Active Employee Footer */}
      <div className="p-3 border-t border-slate-800 bg-[#0F1F32] text-xs space-y-2.5">
        {!collapsedMode ? (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Active Operator
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-semibold uppercase">
                {currentUser.accountStatus}
              </span>
            </div>
            <div className="font-semibold text-white truncate">{currentUser.name}</div>
            <div className="text-[11px] text-slate-400 truncate">
              {currentUser.roleTitle} · {currentUser.department}
            </div>
          </div>
        ) : (
          <div
            className="w-9 h-9 mx-auto rounded-md bg-[#234765] text-white flex items-center justify-center font-mono font-bold text-xs border border-slate-700"
            title={`${currentUser.name} (${currentUser.roleTitle})`}
          >
            {currentUser.avatarInitials}
          </div>
        )}

        {onToggleCollapse && !mobileOpen && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="w-full py-1.5 px-2.5 rounded bg-[#234765]/60 hover:bg-[#234765] text-slate-300 hover:text-white text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            title={collapsedMode ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
          >
            {collapsedMode ? (
              <PanelLeftOpen className="w-3.5 h-3.5 text-[#F28C28]" />
            ) : (
              <>
                <PanelLeftClose className="w-3.5 h-3.5 text-[#F28C28]" />
                <span>Compact Sidebar</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden md:block shrink-0">{renderSidebarBody(isCollapsed)}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs" onClick={onCloseMobile} />
          <div className="relative z-10">{renderSidebarBody(false)}</div>
        </div>
      )}
    </>
  );
};
