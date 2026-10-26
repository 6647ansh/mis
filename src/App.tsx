import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { RtdbProvider, useRtdb } from './context/RtdbContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { SignInPage } from './components/auth/SignInPage';
import { AccountStatusGate } from './components/auth/AccountStatusGate';
import { canRoleAccessWorkspaceTab, WORKSPACE_TAB_TO_MODULE, WorkspaceTabId } from './types/roles';

// Each module is fetched only when first opened, so sign-in and the shell stay light.
const lazyNamed = <K extends string>(
  loader: () => Promise<Record<K, React.ComponentType<any>>>,
  name: K
) => lazy(() => loader().then((m) => ({ default: m[name] })));

const CeoCommandCenter = lazyNamed(() => import('./components/dashboard/CeoCommandCenter'), 'CeoCommandCenter');
const OrderDetailJourney = lazyNamed(() => import('./components/orders/OrderDetailJourney'), 'OrderDetailJourney');
const BlueprintView = lazyNamed(() => import('./components/blueprint/BlueprintView'), 'BlueprintView');
const QuotationsView = lazyNamed(() => import('./components/modules/QuotationsView'), 'QuotationsView');
const SalesOrdersView = lazyNamed(() => import('./components/modules/SalesOrdersView'), 'SalesOrdersView');
const ProcurementView = lazyNamed(() => import('./components/modules/ProcurementView'), 'ProcurementView');
const InventoryView = lazyNamed(() => import('./components/modules/InventoryView'), 'InventoryView');
const ProductionShopFloorView = lazyNamed(() => import('./components/modules/ProductionShopFloorView'), 'ProductionShopFloorView');
const QualityView = lazyNamed(() => import('./components/modules/QualityView'), 'QualityView');
const DispatchView = lazyNamed(() => import('./components/modules/DispatchView'), 'DispatchView');
const FinanceView = lazyNamed(() => import('./components/modules/FinanceView'), 'FinanceView');
const MasterDataView = lazyNamed(() => import('./components/modules/MasterDataView'), 'MasterDataView');
const NotificationsView = lazyNamed(() => import('./components/modules/NotificationsView'), 'NotificationsView');
const ReportsView = lazyNamed(() => import('./components/modules/ReportsView'), 'ReportsView');
const AdminView = lazyNamed(() => import('./components/modules/AdminView'), 'AdminView');
const TaskAccountabilityView = lazyNamed(() => import('./components/modules/TaskAccountabilityView'), 'TaskAccountabilityView');

function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

function ModuleFallback() {
  return (
    <div className="flex h-64 items-center justify-center" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
      <span className="sr-only">Loading module</span>
    </div>
  );
}

function MontexWorkspace() {
  const { currentUser } = useRtdb();
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get('tab');
    const initialOrder = params.get('orderId');
    if (initialTab) setCurrentTab(initialTab);
    if (initialOrder) setSelectedOrderId(initialOrder);

    const handlePopState = (event: PopStateEvent) => {
      if (event.state?.tabId) {
        setCurrentTab(event.state.tabId);
        if (event.state.orderId) setSelectedOrderId(event.state.orderId);
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
    if (orderId) setSelectedOrderId(orderId);
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

  const openOrder = (orderId: string) => handleNavigate('order_journey', orderId);

  const isTabAuthorizedForRole = canRoleAccessWorkspaceTab(
    currentUser.role,
    currentTab,
    currentUser.accountStatus
  );
  const moduleName = WORKSPACE_TAB_TO_MODULE[currentTab as WorkspaceTabId] || 'this module';

  return (
    <div className="min-h-screen bg-[#F4F6F9] flex flex-col font-sans text-[#1C2736]">
      <Header
        currentTab={currentTab}
        onNavigate={handleNavigate}
        currentUser={currentUser}
        onSelectUserRole={() => {}}
        onOpenMobileMenu={() => setMobileMenuOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          currentTab={currentTab}
          onNavigate={handleNavigate}
          currentUser={currentUser}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        />

        <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="max-w-7xl mx-auto">
            {!isTabAuthorizedForRole ? (
              <div className="mx-auto my-12 max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-bronze-200 bg-bronze-50 text-bronze-600">
                  <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 className="mt-5 text-xl font-bold tracking-tight text-slate-900">
                  {moduleName} is not part of your role
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Your account can't open {moduleName}. If you need it for your work, ask the
                  system administrator to review your role.
                </p>
                <button
                  type="button"
                  onClick={() => handleNavigate('dashboard')}
                  className="mt-6 inline-flex h-11 cursor-pointer items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze-500 focus-visible:ring-offset-2"
                >
                  Go to dashboard
                </button>
              </div>
            ) : (
              <Suspense fallback={<ModuleFallback />}>
                {currentTab === 'dashboard' && <CeoCommandCenter onNavigate={handleNavigate} />}

                {currentTab === 'order_journey' && (
                  <OrderDetailJourney
                    initialOrderId={selectedOrderId}
                    onNavigateToModule={handleNavigate}
                  />
                )}

                {currentTab === 'tasks_accountability' && (
                  <TaskAccountabilityView onSelectOrder={openOrder} />
                )}

                {currentTab === 'blueprint' && <BlueprintView />}

                {currentTab === 'quotations' && <QuotationsView onSelectOrder={openOrder} />}

                {currentTab === 'sales_orders' && <SalesOrdersView onSelectOrder={openOrder} />}

                {currentTab === 'purchase' && <ProcurementView />}

                {currentTab === 'inventory' && <InventoryView />}

                {currentTab === 'production' && <ProductionShopFloorView />}

                {currentTab === 'quality' && <QualityView />}

                {currentTab === 'dispatch' && <DispatchView />}

                {currentTab === 'finance' && <FinanceView />}

                {currentTab === 'customers' && <MasterDataView initialType="customers" />}

                {currentTab === 'products' && <MasterDataView initialType="products" />}

                {currentTab === 'reports' && <ReportsView />}

                {currentTab === 'notifications' && <NotificationsView onNavigate={handleNavigate} />}

                {currentTab === 'admin' && (
                  <AdminView currentUser={currentUser} onSelectUserRole={() => {}} />
                )}
              </Suspense>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Entry gate. Nothing protected renders until Firebase has resolved the session:
 * signed out → sign-in page; signed in but not approved → status page; active → workspace.
 */
function AppGate() {
  const { authLoading, firebaseUser, currentUser } = useRtdb();

  if (authLoading) return <FullPageSpinner label="Checking your session" />;
  if (!firebaseUser) return <SignInPage />;
  if (currentUser.accountStatus !== 'active') return <AccountStatusGate />;
  return <MontexWorkspace />;
}

export default function App() {
  return (
    <RtdbProvider>
      <AppGate />
    </RtdbProvider>
  );
}
