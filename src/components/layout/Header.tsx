import React, { useState } from 'react';
import { UserProfile, RbacRoleGroup } from '../../types/mis';
import {
  ShieldCheck,
  Bell,
  ChevronRight,
  BarChart3,
  FileDown,
  CheckCircle2,
  Loader2,
  LogOut,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import { MontexLogo } from '../common/MontexLogo';
import {
  SHOWCASE_PDF_FILENAME,
  downloadShowcaseRoadmapPdf,
  getShowcasePdfPublicUrl,
} from '../../utils/pdfBrandingUtility';

interface HeaderProps {
  currentTab: string;
  onNavigate: (tabId: string) => void;
  currentUser: UserProfile;
  onSelectUserRole: (user: UserProfile) => void;
  onOpenMobileMenu: () => void;
}

const MODULE_BREADCRUMBS: Record<
  string,
  { category: string; categoryTab: string; title: string }
> = {
  dashboard: { category: 'Overview', categoryTab: 'dashboard', title: 'CEO Command Center' },
  order_journey: {
    category: 'Overview',
    categoryTab: 'sales_orders',
    title: 'Order Lifecycle Tracker',
  },
  sales_orders: {
    category: 'Sales & Orders',
    categoryTab: 'sales_orders',
    title: 'Sales Orders & Job Numbers',
  },
  quotations: {
    category: 'Sales & Orders',
    categoryTab: 'sales_orders',
    title: 'Quotations & Tenders',
  },
  customers: {
    category: 'Sales & Orders',
    categoryTab: 'sales_orders',
    title: 'Customers Master',
  },
  products: {
    category: 'Sales & Orders',
    categoryTab: 'sales_orders',
    title: 'Products & Specifications',
  },
  production: {
    category: 'Operations',
    categoryTab: 'production',
    title: 'Production & Shop Floor',
  },
  inventory: {
    category: 'Operations',
    categoryTab: 'production',
    title: 'Inventory & Stores',
  },
  purchase: {
    category: 'Operations',
    categoryTab: 'production',
    title: 'Purchase & Steel Mills',
  },
  quality: {
    category: 'Operations',
    categoryTab: 'production',
    title: 'Quality & MTC',
  },
  dispatch: {
    category: 'Dispatch',
    categoryTab: 'dispatch',
    title: 'Dispatch & Logistics',
  },
  finance: {
    category: 'Finance & Reports',
    categoryTab: 'finance',
    title: 'Invoices, Costing & Receivables',
  },
  reports: {
    category: 'Finance & Reports',
    categoryTab: 'finance',
    title: 'Reports & Exports',
  },
  notifications: {
    category: 'Administration',
    categoryTab: 'admin',
    title: 'Alerts & Threshold Settings',
  },
  admin: {
    category: 'Administration',
    categoryTab: 'admin',
    title: 'Users, Roles & Settings',
  },
  blueprint: {
    category: 'Administration',
    categoryTab: 'admin',
    title: 'System Architecture Blueprint',
  },
};

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onNavigate,
  currentUser,
  onOpenMobileMenu,
}) => {
  const { activeRbacGroup, actionQueue, logoutUser } = useRtdb();
  const [pdfDownloadState, setPdfDownloadState] = useState<
    'idle' | 'downloading' | 'success' | 'error'
  >('idle');

  const showcasePdfUrl = getShowcasePdfPublicUrl();

  const handleDownloadShowcasePdf = async (
    e: React.MouseEvent<HTMLAnchorElement>
  ) => {
    e.preventDefault();
    if (pdfDownloadState === 'downloading') return;
    setPdfDownloadState('downloading');
    const result = await downloadShowcaseRoadmapPdf();
    if (result.success) {
      setPdfDownloadState('success');
      setTimeout(() => setPdfDownloadState('idle'), 3500);
    } else {
      setPdfDownloadState('error');
      setTimeout(() => setPdfDownloadState('idle'), 4000);
    }
  };

  const openAlertsCount = actionQueue.filter((a) => !a.acknowledged).length;
  const activeMeta = MODULE_BREADCRUMBS[currentTab] || {
    category: 'Montex Forge MIS',
    categoryTab: 'dashboard',
    title: 'Operations Console',
  };

  const rbacGroups: { group: RbacRoleGroup; label: string }[] = [
    { group: 'Admin', label: 'Super Admin (System Authority)' },
    { group: 'Management', label: 'Higher Authority (CEO / MD)' },
    { group: 'Finance', label: 'Finance (Accounts & Costing)' },
    { group: 'Sales', label: 'Sales (Orders & Quotations)' },
    { group: 'Production', label: 'Production (Shop, QC & Stores)' },
  ];

  return (
    <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 bg-white border-b border-slate-200 shadow-2xs sticky top-0 z-30">
      {/* Left: Mobile Menu Trigger + Current Page Breadcrumb & Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onOpenMobileMenu}
          className="md:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 focus-visible:outline-none cursor-pointer"
          aria-label="Open navigation menu"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Mobile compact logo */}
        <div className="md:hidden shrink-0">
          <MontexLogo variant="compact" size="sm" surface="light" />
        </div>

        {/* Active Module Breadcrumb (All segments clickable) */}
        <nav aria-label="Breadcrumb" className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="hover:text-[#14283F] hover:underline font-medium transition-colors cursor-pointer hidden sm:inline"
            >
              Montex Forge MIS
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 hidden sm:inline shrink-0" />
            <button
              type="button"
              onClick={() => onNavigate(activeMeta.categoryTab)}
              className="hover:text-[#14283F] hover:underline font-medium text-slate-600 transition-colors cursor-pointer"
            >
              {activeMeta.category}
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="font-bold text-[#14283F] truncate" aria-current="page">
              {activeMeta.title}
            </span>
          </div>
        </nav>
      </div>

      {/* Right: Global Actions, Notifications, Role Switcher & User Profile */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Global Shortcut: Download Product Showcase & Roadmap PDF */}
        <a
          href={showcasePdfUrl}
          download={SHOWCASE_PDF_FILENAME}
          onClick={handleDownloadShowcasePdf}
          data-testid="download-showcase-pdf-btn"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white rounded-md border transition-colors cursor-pointer shadow-2xs ${
            pdfDownloadState === 'success'
              ? 'bg-emerald-700 hover:bg-emerald-800 border-emerald-700'
              : pdfDownloadState === 'error'
              ? 'bg-rose-700 hover:bg-rose-800 border-rose-700'
              : 'bg-[#14283F] hover:bg-[#234765] border-[#14283F]'
          }`}
          title="Download 22-Page Montex Forge MIS Product Showcase & Digital Transformation Roadmap PDF"
        >
          {pdfDownloadState === 'downloading' ? (
            <Loader2 className="w-3.5 h-3.5 text-[#F28C28] animate-spin" />
          ) : pdfDownloadState === 'success' ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
          ) : (
            <FileDown className="w-3.5 h-3.5 text-[#F28C28]" />
          )}
          <span className="hidden md:inline">
            {pdfDownloadState === 'downloading'
              ? 'Downloading PDF...'
              : pdfDownloadState === 'success'
              ? 'PDF Downloaded'
              : pdfDownloadState === 'error'
              ? 'Retry PDF Download'
              : 'Showcase & Roadmap PDF'}
          </span>
          <span className="md:hidden">
            {pdfDownloadState === 'downloading' ? '...' : 'PDF'}
          </span>
        </a>

        {/* Global Shortcut: Reports & Exports */}
        {currentTab !== 'reports' && (
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-[#14283F] bg-[#F4F6F9] hover:bg-slate-200/70 rounded-md border border-slate-200 transition-colors cursor-pointer"
            title="Open Central Reports & Exports Center"
          >
            <BarChart3 className="w-3.5 h-3.5 text-[#234765]" />
            <span>Reports</span>
          </button>
        )}

        {/* Global Notifications Button */}
        <button
          type="button"
          onClick={() => onNavigate('notifications')}
          className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
            currentTab === 'notifications'
              ? 'bg-[#14283F] text-white border-[#14283F]'
              : openAlertsCount > 0
              ? 'bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100'
              : 'bg-[#F4F6F9] text-slate-700 border-slate-200 hover:bg-slate-200/70'
          }`}
          title="View Operational Alerts & Notification Thresholds"
        >
          <Bell
            className={`w-3.5 h-3.5 ${
              currentTab === 'notifications'
                ? 'text-[#F28C28]'
                : openAlertsCount > 0
                ? 'text-rose-600'
                : 'text-slate-500'
            }`}
          />
          <span className="hidden sm:inline">Alerts</span>
          {openAlertsCount > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold tabular-nums ${
                currentTab === 'notifications'
                  ? 'bg-[#F28C28] text-[#14283F]'
                  : 'bg-rose-600 text-white'
              }`}
            >
              {openAlertsCount}
            </span>
          )}
        </button>

        {/* User Profile */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
          <div
            className="w-8 h-8 rounded-md bg-[#14283F] border border-[#234765] text-white flex items-center justify-center text-xs font-bold font-mono tracking-wider shadow-2xs shrink-0"
            title={
              currentUser.accountStatus === 'active'
                ? `${currentUser.name} — ${activeRbacGroup} (${currentUser.department})`
                : `${currentUser.name} — Status: ${currentUser.accountStatus.toUpperCase()} (No Active Authorization Role)`
            }
          >
            {currentUser.avatarInitials}
          </div>
          <div className="hidden xl:block text-left">
            <div className="text-xs font-semibold text-slate-900 leading-tight">
              {currentUser.name}
            </div>
            <div className="text-[11px] text-slate-500 leading-tight">
              {currentUser.accountStatus === 'active' ? (
                <>
                  {activeRbacGroup} · {currentUser.department}
                </>
              ) : (
                <span className="text-amber-700 font-semibold">
                  {currentUser.accountStatus === 'rejected'
                    ? 'Access Rejected (No Active Role)'
                    : currentUser.accountStatus === 'deactivated'
                    ? 'Account Deactivated'
                    : 'Pending Approval (No Active Role)'}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => logoutUser()}
            title="Sign out"
            aria-label="Sign out"
            className="ml-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze-500"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
};
