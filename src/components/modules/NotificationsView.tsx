import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Check,
  Bell,
  ArrowRight,
  CheckCircle2,
  Filter,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import { PageHeader } from '../common/PageHeader';
import { AlertBanner } from '../common/AlertBanner';
import { StatusBadge } from '../common/StatusBadge';
import { ActionQueueItem } from '../../types/mis';
import { validateSalesOrderQuantities } from '../../services/misDataValidator';

interface NotificationsViewProps {
  onNavigate?: (tabId: string, orderId?: string) => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  onNavigate,
}) => {
  const {
    alertThresholds,
    actionQueue,
    salesOrders,
    activeRbacGroup,
    currentUser,
    saveAlertThresholdsRecord,
    acknowledgeAlertRecord,
  } = useRtdb();

  const [activeTab, setActiveTab] = useState<'alerts' | 'thresholds'>('alerts');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'high' | 'medium' | 'acknowledged'>('all');
  const [thresholds, setThresholds] = useState(alertThresholds);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    title: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    setThresholds(alertThresholds);
  }, [alertThresholds]);

  const canWriteAlerts =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo'].includes(currentUser.role);

  const orderQuantityAdvisories = salesOrders
    .map((o) => validateSalesOrderQuantities(o))
    .filter((v) => !v.valid);

  const handleAcknowledgeAlert = async (item: ActionQueueItem) => {
    if (currentUser.accountStatus !== 'active') {
      setFeedback({
        type: 'error',
        title: 'Account Restricted',
        message: `Your account (${currentUser.email}) is currently ${currentUser.accountStatus}. Only active accounts can acknowledge operational alerts.`,
      });
      return;
    }

    const res = await acknowledgeAlertRecord(item);
    if (!res.success) {
      setFeedback({
        type: 'error',
        title: 'Could Not Acknowledge Alert',
        message: res.error || 'Unable to update alert status in the database.',
      });
      return;
    }

    setFeedback({
      type: res.persistedToFirestore ? 'success' : 'info',
      title: 'Alert Acknowledged',
      message: res.persistedToFirestore
        ? `"${item.title}" (${item.associatedRef}) has been marked as acknowledged in Cloud Firestore (/actionQueue/${item.id}).`
        : `"${item.title}" (${item.associatedRef}) has been marked as acknowledged for this preview session.`,
    });
  };

  const handleDrillDown = (action: ActionQueueItem) => {
    if (!onNavigate) return;
    const matchedOrder = salesOrders.find(
      (o) =>
        action.associatedRef.includes(o.jobNumber) ||
        action.associatedRef.includes(o.poNumber) ||
        action.description.includes(o.jobNumber)
    );
    if (matchedOrder) {
      onNavigate('order_journey', matchedOrder.id);
      return;
    }
    if (action.type === 'payment_ageing') {
      onNavigate('finance');
    } else if (action.type === 'material_shortage') {
      onNavigate('inventory');
    } else if (action.type === 'qc_rejection' || action.type === 'clearance_pending') {
      onNavigate('quality');
    } else {
      onNavigate('sales_orders');
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (!canWriteAlerts) {
      setFeedback({
        type: 'error',
        title: 'Permission Required',
        message:
          currentUser.accountStatus !== 'active'
            ? `Your account (${currentUser.email}) is ${currentUser.accountStatus}. Only active Super Admin accounts can modify alert thresholds.`
            : `Your current role (${currentUser.role} / ${activeRbacGroup}) has read-only access to company alert rules. Switch to Super Admin to save changes.`,
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    const res = await saveAlertThresholdsRecord(thresholds);
    if (res.success) {
      setFeedback({
        type: 'success',
        title: 'Alert Thresholds Updated',
        message: res.persistedToFirestore
          ? 'Company-wide alert rules and notification thresholds have been saved to Cloud Firestore (/systemConfig/alertThresholds).'
          : 'Alert rules and notification thresholds have been updated for this preview session.',
      });
    } else {
      setFeedback({
        type: 'error',
        title: 'Failed to Save Thresholds',
        message: res.error || 'Could not update alert thresholds.',
      });
    }
    setSaving(false);
  };

  const pendingAlertsCount = actionQueue.filter((a) => !a.acknowledged).length;

  const filteredQueue = actionQueue.filter((item) => {
    if (severityFilter === 'acknowledged') return Boolean(item.acknowledged);
    if (item.acknowledged) return false;
    if (severityFilter === 'high') return item.severity === 'high';
    if (severityFilter === 'medium') return item.severity === 'medium' || item.severity === 'low';
    return true;
  });

  return (
    <div className="space-y-5 text-xs">
      <PageHeader
        category="Administration & Governance"
        title="Operational Alerts & Threshold Settings"
        description="Review active plant bottlenecks, quality advisories, and configure company-wide notification rules."
        primaryAction={
          activeTab === 'thresholds' ? (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-[#14283F] text-white rounded-lg font-semibold hover:bg-[#234765] transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Sliders className="w-3.5 h-3.5 text-[#F28C28]" />
              )}
              <span>{saving ? 'Saving Thresholds...' : 'Save Alert Thresholds'}</span>
            </button>
          ) : undefined
        }
      />

      {feedback && (
        <AlertBanner
          severity={feedback.type}
          title={feedback.title}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Clear Section Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('alerts')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'alerts'
                ? 'border-[#14283F] text-[#14283F]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Active Alerts & Action Queue</span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-rose-100 text-rose-800">
              {pendingAlertsCount} Pending
            </span>
          </button>

          <button
            onClick={() => setActiveTab('thresholds')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'thresholds'
                ? 'border-[#14283F] text-[#14283F]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Alert Rules & Threshold Configuration</span>
          </button>
        </div>
      </div>

      {/* TAB 1: ACTIVE ALERTS & ACTION QUEUE */}
      {activeTab === 'alerts' && (
        <div className="space-y-5">
          {/* Filter Bar */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-slate-600 font-medium">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Filter Operational Alerts:</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'all', label: `All Active (${pendingAlertsCount})` },
                {
                  id: 'high',
                  label: `Critical Priority (${actionQueue.filter((a) => !a.acknowledged && a.severity === 'high').length})`,
                },
                {
                  id: 'medium',
                  label: `Warnings & Advisories (${actionQueue.filter((a) => !a.acknowledged && a.severity !== 'high').length})`,
                },
                {
                  id: 'acknowledged',
                  label: `Acknowledged (${actionQueue.filter((a) => a.acknowledged).length})`,
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSeverityFilter(tab.id as typeof severityFilter)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    severityFilter === tab.id
                      ? 'bg-[#14283F] text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Structured Operational Alerts List */}
          <div className="space-y-3">
            {filteredQueue.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-2">
                <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
                <div className="text-sm font-bold text-slate-800">
                  No alerts in this category
                </div>
                <p className="text-xs text-slate-500">
                  All operational alerts matching your current filter have been addressed.
                </p>
              </div>
            ) : (
              filteredQueue.map((item) => (
                <AlertBanner
                  key={item.id}
                  severity={
                    item.acknowledged
                      ? 'success'
                      : item.severity === 'high'
                      ? 'critical'
                      : 'warning'
                  }
                  title={item.title}
                  message={item.description}
                  reference={`${item.associatedRef} · ${item.customerOrSupplier} · Assigned: ${item.assignedToDepartment} (${item.daysPending}d pending)`}
                  actionText={item.suggestedAction}
                  actions={
                    <div className="flex items-center gap-2">
                      {!item.acknowledged && (
                        <button
                          onClick={() => handleAcknowledgeAlert(item)}
                          className="px-3 py-1.5 text-xs font-semibold bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        >
                          Acknowledge
                        </button>
                      )}
                      {onNavigate && (
                        <button
                          onClick={() => handleDrillDown(item)}
                          className="px-3 py-1.5 text-xs font-semibold bg-[#14283F] text-white hover:bg-[#234765] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <span>Open Record</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  }
                />
              ))
            )}
          </div>

          {/* Quality & Order Quantity Advisories */}
          {orderQuantityAdvisories.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-sm font-bold text-[#14283F]">
                    Order & Inspection Quantity Advisories
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Automated verification checks comparing forged, inspected, passed, and dispatched quantities across active jobs.
                  </p>
                </div>
                <StatusBadge status="warning" label={`${orderQuantityAdvisories.length} Review Note(s)`} />
              </div>

              <div className="space-y-3">
                {orderQuantityAdvisories.map((adv) => (
                  <AlertBanner
                    key={adv.orderId}
                    severity="warning"
                    title="Inspection Quantity Exceeds Forged Count"
                    message={adv.errors.join(' ')}
                    reference={`PO: ${adv.poNumber} · Job No: ${adv.jobNumber}`}
                    actionText="Verify the passed and rejected piece counts with Quality Control in the Order Lifecycle or Quality Inspection module."
                    actions={
                      onNavigate ? (
                        <button
                          onClick={() => onNavigate('order_journey', adv.orderId)}
                          className="px-3 py-1.5 text-xs font-semibold bg-[#14283F] text-white hover:bg-[#234765] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <span>Inspect Job</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ALERT THRESHOLDS */}
      {activeTab === 'thresholds' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-[#14283F]">
                Operational & Shop-Floor Alert Triggers
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure when the system generates warnings for quality rejections, overdue invoices, delivery risk, low stock, and equipment limits.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 border border-slate-200 rounded-xl space-y-2 bg-slate-50/50">
              <label className="font-bold text-slate-800 block">
                Quality Rejection Alert Limit (%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={thresholds.rejectionPercent}
                  onChange={(e) =>
                    setThresholds({
                      ...thresholds,
                      rejectionPercent: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-24 p-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white"
                />
                <span className="text-slate-600">% of inspected lot</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Flags an inspection batch to Quality Assurance when rejected pieces exceed this percentage.
              </p>
            </div>

            <div className="p-4 border border-slate-200 rounded-xl space-y-2 bg-slate-50/50">
              <label className="font-bold text-slate-800 block">
                Overdue Payment Alert (Days)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={thresholds.criticalAgeingDays}
                  onChange={(e) =>
                    setThresholds({
                      ...thresholds,
                      criticalAgeingDays: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-24 p-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white"
                />
                <span className="text-slate-600">Days past invoice date</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Highlights overdue customer invoices in the CEO Command Center and Finance modules.
              </p>
            </div>

            <div className="p-4 border border-slate-200 rounded-xl space-y-2 bg-slate-50/50">
              <label className="font-bold text-slate-800 block">
                Delivery Schedule Warning Buffer (Days)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={thresholds.deliveryDelayDays}
                  onChange={(e) =>
                    setThresholds({
                      ...thresholds,
                      deliveryDelayDays: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-24 p-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white"
                />
                <span className="text-slate-600">Days before PO due date</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Alerts Sales and Production when an order approaches its contractual delivery date.
              </p>
            </div>

            <div className="p-4 border border-slate-200 rounded-xl space-y-2 bg-slate-50/50">
              <label className="font-bold text-slate-800 block">
                Raw Material Safety Buffer (Days)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={thresholds.lowStockDays}
                  onChange={(e) =>
                    setThresholds({
                      ...thresholds,
                      lowStockDays: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-24 p-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white"
                />
                <span className="text-slate-600">Days of stock remaining</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Triggers a purchase requisition warning when raw steel inventory drops below this buffer.
              </p>
            </div>

            <div className="p-4 border border-slate-200 rounded-xl space-y-2 bg-slate-50/50">
              <label className="font-bold text-slate-800 block">
                Furnace Maximum Temperature (°C)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={thresholds.furnaceTemp ?? 1230}
                  onChange={(e) =>
                    setThresholds({
                      ...thresholds,
                      furnaceTemp: parseInt(e.target.value) || 1230,
                    })
                  }
                  className="w-24 p-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white"
                />
                <span className="text-slate-600">°C soaking ceiling</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Flags furnace heat logs if soaking temperature exceeds the metallurgical limit.
              </p>
            </div>

            <div className="p-4 border border-slate-200 rounded-xl space-y-2 bg-slate-50/50">
              <label className="font-bold text-slate-800 block">
                Machine Downtime Escalation (Minutes)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={thresholds.machineDowntimeMinutes ?? 45}
                  onChange={(e) =>
                    setThresholds({
                      ...thresholds,
                      machineDowntimeMinutes: parseInt(e.target.value) || 45,
                    })
                  }
                  className="w-24 p-2 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 bg-white"
                />
                <span className="text-slate-600">Minutes continuous stop</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Escalates hammer or press stoppages to the Works Manager after this duration.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
