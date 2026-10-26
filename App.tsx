import React, { useState, useEffect } from 'react';
import { RtdbProvider, useRtdb } from './context/RtdbContext';
import { DemoBanner } from './components/common/DemoBanner';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { CeoCommandCenter } from './components/dashboard/CeoCommandCenter';
import { OrderDetailJourney } from './components/orders/OrderDetailJourney';
import { BlueprintView } from './components/blueprint/BlueprintView';
import { QuotationsView } from './components/modules/QuotationsView';
import { SalesOrdersView } from './components/modules/SalesOrdersView';
import { ProcurementView } from './components/modules/ProcurementView';
import { InventoryView } from './components/modules/InventoryView';
import { ProductionShopFloorView } from './components/modules/ProductionShopFloorView';
import { QualityView } from './components/modules/QualityView';
import { DispatchView } from './components/modules/DispatchView';
import { FinanceView } from './components/modules/FinanceView';
import { MasterDataView } from './components/modules/MasterDataView';
import { NotificationsView } from './components/modules/NotificationsView';
import { ReportsView } from './components/modules/ReportsView';
import { AdminView } from './components/modules/AdminView';
import { TaskAccountabilityView } from './components/modules/TaskAccountabilityView';
import { FirebaseAuthAndDiagnosticsModal } from './components/auth/FirebaseAuthAndDiagnosticsModal';
import { preloadMontexLogoForPdf } from './utils/pdfBrandingUtility';
import { canRoleAccessWorkspaceTab, WORKSPACE_TAB_TO_MODULE, WorkspaceTabId } from './types/roles';

function MontexWorkspace() {
  const {
    firebaseUser,
    currentUser,
    setPreviewUserRole,
    logoutUser,
    refreshOwnUserProfile,
  } = useRtdb();
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('ORD-2026-001');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [authModalState, setAuthModalState] = useState<{
    open: boolean;
    tab: 'auth' | 'diagnostics' | 'rules';
  }>({ open: false, tab: 'auth' });
  const [refreshingGateStatus, setRefreshingGateStatus] = useState(false);
  const [gateFeedback, setGateFeedback] = useState<string | null>(null);

  useEffect(() => {
    preloadMontexLogoForPdf();
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get('tab');
    const initialOrder = params.get('orderId');
    if (initialTab) {
      setCurrentTab(initialTab);
    }
    if (initialOrder) {
      setSelectedOrderId(initialOrder);
    }

    const handlePopState = (event: PopStateEvent) => {
      if (event.state?.tabId) {
        setCurrentTab(event.state.tabId);
        if (event.state.orderId) {
          setSelectedOrderId(event.state.orderId);
        }
      } else {
        const searchParams = new URLSearchParams(window.location.search);
        setCurrentTab(searchParams.get('tab') || 'dashboard');
        const ord = searchParams.get('orderId');
        if (ord) setSelectedOrderId(ord);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleNavigate = (tabId: string, orderId?: string) => {
    setCurrentTab(tabId);
    const nextOrderId = orderId || selectedOrderId;
    if (orderId) {
      setSelectedOrderId(orderId);
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tabId);
      if (orderId) {
        url.searchParams.set('orderId', orderId);
      } else {
        url.searchParams.delete('orderId');
      }
      window.history.pushState({ tabId, orderId: nextOrderId }, '', url.toString());
    } catch {
      // Ignore history pushState restrictions in sandboxed environments
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Phase 3 Enforcement: Authenticated Firebase users with non-active accountStatus cannot use protected modules
  const isAuthenticatedAccountRestricted =
    Boolean(firebaseUser) && currentUser.accountStatus !== 'active';

  const isTabAuthorizedForRole = canRoleAccessWorkspaceTab(
    currentUser.role,
    currentTab,
    currentUser.accountStatus
  );

  const handleRefreshGateStatus = async () => {
    setRefreshingGateStatus(true);
    setGateFeedback(null);
    const res = await refreshOwnUserProfile();
    if (res.success && res.profile) {
      if (res.profile.accountStatus !== 'active') {
        setGateFeedback(
          `Synced from database at ${new Date().toLocaleTimeString()}: status is "${res.profile.accountStatus.toUpperCase()}".`
        );
      }
    } else {
      setGateFeedback(res.error || 'Could not refresh status from database.');
    }
    setRefreshingGateStatus(false);
  };

  return (
    <div className="min-h-screen bg-[#F4F6F9] flex flex-col font-sans text-[#1C2736]">
      {/* Clean Client-Ready Plant Status & Session Bar */}
      <DemoBanner
        onOpenBlueprint={() => setCurrentTab('admin')}
        onOpenFirebaseConsole={(tab: 'auth' | 'diagnostics' | 'rules') =>
          setAuthModalState({ open: true, tab })
        }
        onNavigate={handleNavigate}
      />

      {/* Top Bar Contract Compliant Header */}
      <Header
        currentTab={currentTab}
        onNavigate={handleNavigate}
        currentUser={currentUser}
        onSelectUserRole={(u) => setPreviewUserRole(u)}
        onOpenMobileMenu={() => setMobileMenuOpen(true)}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Persistent Desktop Sidebar & Mobile Drawer */}
        <Sidebar
          currentTab={currentTab}
          onNavigate={handleNavigate}
          currentUser={currentUser}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        />

        {/* Content Viewport */}
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="max-w-7xl mx-auto">
            {isAuthenticatedAccountRestricted ? (
              <div className="bg-white rounded-lg border-2 border-rose-200 shadow-sm p-6 md:p-8 max-w-2xl mx-auto my-8 space-y-4 text-xs">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-rose-700 font-bold">
                      Zero-Trust Access Gate · Account Status Restricted
                    </span>
                    <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                      {currentUser.accountStatus === 'rejected'
                        ? 'Employee Access Request Rejected — Protected Modules Locked'
                        : currentUser.accountStatus === 'deactivated'
                        ? 'Employee Account Deactivated — Protected Modules Locked'
                        : 'Account Pending Administrator Approval — Protected Modules Locked'}
                    </h2>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-rose-100 text-rose-800 font-mono font-bold uppercase text-[11px]">
                    {currentUser.accountStatus}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded bg-slate-50 border border-slate-200 font-mono text-[11px]">
                  <div>
                    <span className="text-slate-500 block">Authenticated Email:</span>
                    <strong className="text-slate-900">
                      {firebaseUser?.email || currentUser.email}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Canonical Firebase UID:</span>
                    <strong className="text-slate-900">
                      {firebaseUser?.uid || currentUser.id}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Active Authorization Role:</span>
                    <strong className="text-rose-700">
                      NONE (Zero Business Data Permissions)
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Requested Role &amp; Department:</span>
                    <strong className="text-amber-800">
                      {(currentUser.requestedRole || currentUser.role || 'sales').toUpperCase()} ·{' '}
                      {currentUser.requestedDepartment || currentUser.department || 'Sales'}
                    </strong>
                  </div>
                </div>

                {currentUser.accountStatus === 'rejected' && (
                  <div className="p-3.5 rounded bg-rose-50 border border-rose-200 text-rose-900 space-y-1">
                    <div className="font-bold">
                      Rejection Reason: {currentUser.rejectionReason || 'Not specified'}
                    </div>
                    <div className="text-[11px] font-mono text-rose-700">
                      Reviewed by: {currentUser.rejectedByEmail || currentUser.rejectedByName || 'Administrator'}{' '}
                      {currentUser.rejectedAt ? `at ${currentUser.rejectedAt}` : ''}
                    </div>
                  </div>
                )}

                <p className="text-slate-600 leading-relaxed">
                  Your employee profile in <code>/users/&#123;uid&#125;</code> currently has status{' '}
                  <code className="font-mono font-bold text-rose-700">
                    {currentUser.accountStatus}
                  </code>
                  . Pending and rejected accounts cannot read or write protected Montex Forge MIS
                  business data. An authorized <strong>Super Admin</strong> (or{' '}
                  <strong>CEO</strong>) can review and approve your request in{' '}
                  <strong>Admin → Employee Approval Queue</strong>.
                </p>

                {gateFeedback && (
                  <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-900 font-medium">
                    {gateFeedback}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    onClick={() => setAuthModalState({ open: true, tab: 'auth' })}
                    className="px-4 py-2 bg-[#14283F] text-white rounded font-semibold hover:bg-slate-800 cursor-pointer"
                  >
                    {currentUser.accountStatus === 'rejected'
                      ? 'Update & Resubmit Access Request'
                      : 'Edit Access Request / Open Auth Console'}
                  </button>
                  <button
                    onClick={handleRefreshGateStatus}
                    disabled={refreshingGateStatus}
                    className="px-4 py-2 bg-white border border-slate-300 text-slate-800 rounded font-semibold hover:bg-slate-100 cursor-pointer"
                  >
                    {refreshingGateStatus ? 'Checking Database...' : 'Refresh Approval Status'}
                  </button>
                  <button
                    onClick={() => logoutUser()}
                    className="px-4 py-2 bg-rose-600 text-white rounded font-semibold hover:bg-rose-700 cursor-pointer"
                  >
                    Sign Out of Restricted Account
                  </button>
                </div>
              </div>
            ) : !isTabAuthorizedForRole ? (
              <div className="bg-white rounded-lg border-2 border-amber-300 shadow-sm p-6 md:p-8 max-w-2xl mx-auto my-8 space-y-4 text-xs">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-amber-800 font-bold">
                      RBAC Department Boundary · Unauthorized Module Route
                    </span>
                    <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                      Module Access Restricted for Role &ldquo;{currentUser.role}&rdquo;
                    </h2>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-amber-100 text-amber-900 font-mono font-bold uppercase text-[11px]">
                    {WORKSPACE_TAB_TO_MODULE[currentTab as WorkspaceTabId] || currentTab}
                  </span>
                </div>

                <p className="text-slate-600 leading-relaxed">
                  Active profile <strong className="text-slate-900">{currentUser.name}</strong> (
                  <code className="font-mono font-semibold">{currentUser.role}</code> ·{' '}
                  {currentUser.department}) does not have view authorization for the{' '}
                  <strong className="text-slate-900">
                    {WORKSPACE_TAB_TO_MODULE[currentTab as WorkspaceTabId] || currentTab}
                  </strong>{' '}
                  module under the Montex Forge Industries RBAC permission matrix.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    onClick={() => handleNavigate('dashboard')}
                    className="px-4 py-2 bg-[#14283F] text-white rounded font-semibold hover:bg-slate-800 cursor-pointer"
                  >
                    Return to Command Center Dashboard
                  </button>
                  <button
                    onClick={() => handleNavigate('tasks_accountability')}
                    className="px-4 py-2 bg-slate-100 text-slate-800 border border-slate-300 rounded font-semibold hover:bg-slate-200 cursor-pointer"
                  >
                    Open Tasks, Handovers &amp; SOP Hub
                  </button>
                </div>
              </div>
            ) : (
              <>
                {currentTab === 'dashboard' && (
                  <CeoCommandCenter onNavigate={handleNavigate} />
                )}


                {currentTab === 'order_journey' && (
                  <OrderDetailJourney
                    initialOrderId={selectedOrderId}
                    onNavigateToModule={handleNavigate}
                  />
                )}

                {currentTab === 'tasks_accountability' && (
                  <TaskAccountabilityView
                    onSelectOrder={(orderId) => {
                      setSelectedOrderId(orderId);
                      setCurrentTab('order_journey');
                    }}
                  />
                )}

                {currentTab === 'blueprint' && <BlueprintView />}

                {currentTab === 'quotations' && (
                  <QuotationsView
                    onSelectOrder={(orderId) => {
                      setSelectedOrderId(orderId);
                      setCurrentTab('order_journey');
                    }}
                  />
                )}

                {currentTab === 'sales_orders' && (
                  <SalesOrdersView
                    onSelectOrder={(id) => {
                      setSelectedOrderId(id);
                      setCurrentTab('order_journey');
                    }}
                  />
                )}

                {currentTab === 'purchase' && <ProcurementView />}

                {currentTab === 'inventory' && <InventoryView />}

                {currentTab === 'production' && <ProductionShopFloorView />}

                {currentTab === 'quality' && <QualityView />}

                {currentTab === 'dispatch' && <DispatchView />}

                {currentTab === 'finance' && <FinanceView />}

                {currentTab === 'customers' && (
                  <MasterDataView initialType="customers" />
                )}

                {currentTab === 'products' && (
                  <MasterDataView initialType="products" />
                )}

                {currentTab === 'reports' && <ReportsView />}

                {currentTab === 'notifications' && (
                  <NotificationsView onNavigate={handleNavigate} />
                )}

                {currentTab === 'admin' && (
                  <AdminView
                    currentUser={currentUser}
                    onSelectUserRole={(u) => setPreviewUserRole(u)}
                    onOpenFirebaseConsole={(tab) =>
                      setAuthModalState({ open: true, tab })
                    }
                  />
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* Firebase Authentication, Seeding, Security Rules & Diagnostic Suite Modal */}
      <FirebaseAuthAndDiagnosticsModal
        isOpen={authModalState.open}
        initialTab={authModalState.tab}
        onClose={() => setAuthModalState((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}

export default function App() {
  return (
    <RtdbProvider>
      <MontexWorkspace />
    </RtdbProvider>
  );
}
