import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  AlertTriangle,
  ArrowRightLeft,
  ShieldCheck,
  Clock,
  Plus,
  BookOpen,
  UserCheck,
  XCircle,
  Send,
  Zap,
  Filter,
  Lock,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import {
  HandoverRecord,
  HandoverStageCode,
  TaskPriority,
  TaskRecord,
  TaskVerificationStatus,
} from '../../types/mis';
import {
  canActorAcceptOrRejectHandover,
  canActorVerifyDepartmentTask,
} from '../../types/roles';

interface TaskAccountabilityViewProps {
  onSelectOrder?: (orderId: string) => void;
}

const HANDOVER_STAGE_META: Record<
  string,
  { label: string; fromDept: string; toDept: string; description: string }
> = {
  'H-1': {
    label: 'H-1: Commercial & Technical TDC Handover',
    fromDept: 'Sales',
    toDept: 'Stores',
    description: 'Customer PO, Approved Drawing, QAP & TDC handed over to PPC / Stores',
  },
  'H-2': {
    label: 'H-2: Heat-Tagged Cut Billet Handover',
    fromDept: 'Stores',
    toDept: 'Production',
    description: 'Spectro-verified, saw-cut billets issued with Heat Number tags to Forge Shop',
  },
  'H-3': {
    label: 'H-3: Forged & Heat-Treated Lot Handover',
    fromDept: 'Production',
    toDept: 'Quality',
    description: 'Forged & normalized/quenched batch offered to QA / NABL Lab for testing',
  },
  'H-4': {
    label: 'H-4: QC Cleared & MTC Certified Lot Handover',
    fromDept: 'Quality',
    toDept: 'Dispatch',
    description: 'EN 10204 3.1 MTC & TPI witness cleared lot released to Dispatch Yard',
  },
  'H-5': {
    label: 'H-5: Gate-Out LR & Dispatch Dossier Handover',
    fromDept: 'Dispatch',
    toDept: 'Finance',
    description: 'Outward Gate Pass, Transporter LR & Packing List handed over for GST Invoicing',
  },
};

export const TaskAccountabilityView: React.FC<TaskAccountabilityViewProps> = ({
  onSelectOrder,
}) => {
  const {
    currentUser,
    usersList,
    salesOrders,
    tasks,
    handovers,
    roleDutyManuals,
    upsertTaskRecord,
    submitTaskForVerificationRecord,
    verifyTaskRecord,
    initiateHandoverRecord,
    resolveHandoverRecord,
    runSlaAutomationScanRecord,
  } = useRtdb();

  const [activeSubTab, setActiveSubTab] = useState<
    'tasks' | 'handovers' | 'duty_manual'
  >('tasks');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedRoleManual, setSelectedRoleManual] = useState<string>(
    currentUser.role === 'super_admin' || currentUser.role === 'ceo'
      ? 'sales'
      : currentUser.role
  );
  const [checkedSopItems, setCheckedSopItems] = useState<Record<string, boolean>>({});
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Modals state
  const [showNewTaskModal, setShowNewTaskModal] = useState<boolean>(false);
  const [showNewHandoverModal, setShowNewHandoverModal] = useState<boolean>(false);
  const [verificationModalTask, setVerificationModalTask] =
    useState<TaskRecord | null>(null);
  const [submissionModalTask, setSubmissionModalTask] =
    useState<TaskRecord | null>(null);
  const [resolveModalHandover, setResolveModalHandover] =
    useState<HandoverRecord | null>(null);
  const [modalRemarks, setModalRemarks] = useState<string>('');

  // New Task Form
  const [newTaskForm, setNewTaskForm] = useState({
    title: '',
    description: '',
    department: 'Quality',
    assignedToUid: 'USR-004',
    assignedToName: 'Dr. Praveen Kale',
    linkedOrderId: salesOrders[0]?.id || 'ORD-2026-001',
    priority: 'high' as TaskPriority,
    dueDate: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
    slaHours: 24,
  });

  // New Handover Form
  const [newHandoverForm, setNewHandoverForm] = useState({
    handoverCode: 'H-1' as HandoverStageCode,
    orderId: salesOrders[0]?.id || 'ORD-2026-001',
    quantityPcs: 100,
    weightMt: 6.45,
    heatNumber: 'HEAT-JSW-8841-A',
    checklistSummary:
      'Verified PO quantities, ASME drawing tolerances, heat number traceability, and stage inspection sign-off.',
  });

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (deptFilter !== 'ALL' && t.department.toLowerCase() !== deptFilter.toLowerCase()) {
        return false;
      }
      if (statusFilter !== 'ALL' && t.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [tasks, deptFilter, statusFilter]);

  const kpiCounts = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return {
      totalTasks: tasks.length,
      awaitingVerification: tasks.filter(
        (t) => t.status === 'submitted_for_verification'
      ).length,
      verifiedApproved: tasks.filter((t) => t.status === 'verified_approved').length,
      overdueOrEscalated: tasks.filter(
        (t) =>
          t.status !== 'verified_approved' &&
          (t.dueDate < today || Number(t.escalationLevel) > 0)
      ).length,
      pendingHandovers: handovers.filter((h) => h.status === 'pending_acceptance')
        .length,
    };
  }, [tasks, handovers]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskForm.title.trim()) return;
    const selectedOrder = salesOrders.find((o) => o.id === newTaskForm.linkedOrderId);
    const nowIso = new Date().toISOString();
    const taskId = `TSK-2026-${String(tasks.length + 101).slice(-3)}`;
    const newTask: TaskRecord = {
      id: taskId,
      taskNumber: `TSK-MF-2026-${String(tasks.length + 101).slice(-3)}`,
      title: newTaskForm.title.trim(),
      description:
        newTaskForm.description.trim() ||
        'Execute standard operational checklist and submit for Department Head verification.',
      department: newTaskForm.department,
      assignedToUid: newTaskForm.assignedToUid,
      assignedToName: newTaskForm.assignedToName,
      assignedByUid: currentUser.id,
      assignedByName: currentUser.name,
      linkedOrderId: selectedOrder?.id,
      linkedJobNumber: selectedOrder?.jobNumber,
      priority: newTaskForm.priority,
      status: 'pending',
      dueDate: newTaskForm.dueDate,
      slaHours: Number(newTaskForm.slaHours) || 24,
      escalationLevel: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const res = await upsertTaskRecord(newTask, true);
    if (res.success) {
      setShowNewTaskModal(false);
      setNewTaskForm((prev) => ({ ...prev, title: '', description: '' }));
      setFeedbackBanner({
        type: 'success',
        message: `Task ${newTask.taskNumber} assigned to ${newTask.assignedToName} (${newTask.department}).`,
      });
    } else {
      setFeedbackBanner({
        type: 'error',
        message: res.error || 'Failed to assign task.',
      });
    }
  };

  const handleEmployeeSubmitForVerification = async () => {
    if (!submissionModalTask) return;
    const res = await submitTaskForVerificationRecord(
      submissionModalTask,
      modalRemarks
    );
    if (res.success) {
      setFeedbackBanner({
        type: 'success',
        message: `Task ${submissionModalTask.taskNumber} marked as "Submitted for Verification". Awaiting Supervisor / Department Head sign-off.`,
      });
      setSubmissionModalTask(null);
      setModalRemarks('');
    } else {
      setFeedbackBanner({
        type: 'error',
        message: res.error || 'Could not submit task for verification.',
      });
    }
  };

  const handleSupervisorVerify = async (approved: boolean) => {
    if (!verificationModalTask) return;
    const res = await verifyTaskRecord(
      verificationModalTask,
      approved,
      modalRemarks
    );
    if (res.success) {
      setFeedbackBanner({
        type: 'success',
        message: approved
          ? `Task ${verificationModalTask.taskNumber} Verified & Approved by ${currentUser.name} (Maker ≠ Checker enforced).`
          : `Task ${verificationModalTask.taskNumber} returned for rework by ${currentUser.name}.`,
      });
      setVerificationModalTask(null);
      setModalRemarks('');
    } else {
      setFeedbackBanner({
        type: 'error',
        message: res.error || 'Verification failed due to Separation of Duties policy.',
      });
    }
  };

  const handleInitiateHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    const meta = HANDOVER_STAGE_META[newHandoverForm.handoverCode];
    const order = salesOrders.find((o) => o.id === newHandoverForm.orderId);
    const id = `HND-2026-${String(handovers.length + 101).slice(-3)}`;
    const record: HandoverRecord = {
      id,
      handoverCode: newHandoverForm.handoverCode,
      stageLabel: meta.label,
      orderId: order?.id || newHandoverForm.orderId,
      jobNumber: order?.jobNumber || 'JOB-MF-2026-0412',
      fromDepartment: meta.fromDept,
      toDepartment: meta.toDept,
      initiatedByUid: currentUser.id,
      initiatedByName: currentUser.name,
      status: 'pending_acceptance',
      quantityPcs: Number(newHandoverForm.quantityPcs) || 1,
      weightMt: Number(newHandoverForm.weightMt) || 1.0,
      heatNumber: newHandoverForm.heatNumber.trim() || 'HEAT-PENDING',
      checklistSummary: newHandoverForm.checklistSummary.trim(),
      initiatedAt: new Date().toISOString(),
    };

    const res = await initiateHandoverRecord(record);
    if (res.success) {
      setShowNewHandoverModal(false);
      setFeedbackBanner({
        type: 'success',
        message: `Handover ${record.handoverCode} (${record.fromDepartment} → ${record.toDepartment}) initiated for Job ${record.jobNumber}.`,
      });
    } else {
      setFeedbackBanner({
        type: 'error',
        message: res.error || 'Failed to initiate handover.',
      });
    }
  };

  const handleResolveHandover = async (accepted: boolean) => {
    if (!resolveModalHandover) return;
    const res = await resolveHandoverRecord(
      resolveModalHandover,
      accepted,
      modalRemarks
    );
    if (res.success) {
      setFeedbackBanner({
        type: 'success',
        message: accepted
          ? `Dual-Custody Handover ${resolveModalHandover.handoverCode} accepted by ${currentUser.name} (${resolveModalHandover.toDepartment}).`
          : `Handover ${resolveModalHandover.handoverCode} rejected by ${currentUser.name} and returned to ${resolveModalHandover.fromDepartment}.`,
      });
      setResolveModalHandover(null);
      setModalRemarks('');
    } else {
      setFeedbackBanner({
        type: 'error',
        message: res.error || 'Dual-custody handover check failed.',
      });
    }
  };

  const handleRunSlaScan = async () => {
    const scanRes = await runSlaAutomationScanRecord();
    setFeedbackBanner({
      type: 'success',
      message: `SLA Automation Scan complete: ${scanRes.scannedCount} records evaluated, ${scanRes.escalatedTasksCount} overdue task(s) escalated, ${scanRes.newAlertsGenerated} new deduplicated alert(s) posted.`,
    });
  };

  const statusBadge = (status: TaskVerificationStatus | string) => {
    switch (status) {
      case 'verified_approved':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[11px]">
            <CheckCircle2 className="w-3 h-3" />
            Verified & Approved
          </span>
        );
      case 'submitted_for_verification':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 font-semibold text-[11px]">
            <Clock className="w-3 h-3" />
            Submitted (Awaiting Supervisor)
          </span>
        );
      case 'rejected_rework':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 font-semibold text-[11px]">
            <XCircle className="w-3 h-3" />
            Returned for Rework
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 font-semibold text-[11px]">
            In Progress
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-[11px]">
            Pending Execution
          </span>
        );
    }
  };

  const activeDutyManual =
    roleDutyManuals.find((m) => m.role === selectedRoleManual) ||
    roleDutyManuals[0];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5 shadow-xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-[#14283F] text-amber-300 font-mono text-[10px] font-bold uppercase tracking-wider">
              Accountability & SoD Engine
            </span>
            <span className="text-xs text-slate-500 font-mono">
              Maker ≠ Checker · Dual-Custody H-1..H-5 · Duty SOPs
            </span>
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 mt-1">
            Task Accountability, Supervisor Verification & Handover Hub
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            Enforces strict distinction between Employee Submission and Department Head / CEO Verification, plus H-1 to H-5 inter-department custody handovers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRunSlaScan}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 text-amber-600" />
            Run SLA & Escalation Scan
          </button>
          <button
            type="button"
            onClick={() => setShowNewHandoverModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold cursor-pointer"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Initiate H-1..H-5 Handover
          </button>
          <button
            type="button"
            onClick={() => setShowNewTaskModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-[#14283F] hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Assign Accountability Task
          </button>
        </div>
      </div>

      {feedbackBanner && (
        <div
          className={`rounded-lg border px-4 py-3 text-xs flex items-center justify-between ${
            feedbackBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {feedbackBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedbackBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-[11px] font-semibold underline ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Executive Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white rounded-lg border border-slate-200 p-3.5">
          <div className="text-[11px] text-slate-500 font-medium">
            Active Department Tasks
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {kpiCounts.totalTasks}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Linked to Job Numbers & SLAs
          </div>
        </div>

        <div className="bg-white rounded-lg border border-amber-200 p-3.5">
          <div className="text-[11px] text-amber-800 font-semibold">
            Submitted (Awaiting Verification)
          </div>
          <div className="text-xl font-bold font-mono text-amber-700 mt-1">
            {kpiCounts.awaitingVerification}
          </div>
          <div className="text-[10px] text-amber-700 mt-0.5">
            Requires Dept Head / CEO Sign-off
          </div>
        </div>

        <div className="bg-white rounded-lg border border-emerald-200 p-3.5">
          <div className="text-[11px] text-emerald-800 font-semibold">
            Verified & Approved
          </div>
          <div className="text-xl font-bold font-mono text-emerald-700 mt-1">
            {kpiCounts.verifiedApproved}
          </div>
          <div className="text-[10px] text-emerald-700 mt-0.5">
            Maker ≠ Checker Audited
          </div>
        </div>

        <div className="bg-white rounded-lg border border-rose-200 p-3.5">
          <div className="text-[11px] text-rose-800 font-semibold">
            SLA Overdue / Escalated
          </div>
          <div className="text-xl font-bold font-mono text-rose-700 mt-1">
            {kpiCounts.overdueOrEscalated}
          </div>
          <div className="text-[10px] text-rose-700 mt-0.5">
            L1–L3 Escalation Active
          </div>
        </div>

        <div className="bg-white rounded-lg border border-blue-200 p-3.5">
          <div className="text-[11px] text-blue-800 font-semibold">
            Pending H-1..H-5 Handovers
          </div>
          <div className="text-xl font-bold font-mono text-blue-700 mt-1">
            {kpiCounts.pendingHandovers}
          </div>
          <div className="text-[10px] text-blue-700 mt-0.5">
            Awaiting Receiving Dept Custody
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveSubTab('tasks')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'tasks'
              ? 'border-[#14283F] text-[#14283F] bg-white rounded-t'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <ClipboardCheck className="w-4 h-4" />
          Central Task & Verification Queue ({tasks.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('handovers')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'handovers'
              ? 'border-[#14283F] text-[#14283F] bg-white rounded-t'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <ArrowRightLeft className="w-4 h-4" />
          Inter-Department Handovers H-1 to H-5 ({handovers.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('duty_manual')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'duty_manual'
              ? 'border-[#14283F] text-[#14283F] bg-white rounded-t'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          Employee Duty Manual & Daily SOP Checklists
        </button>
      </div>

      {/* TAB 1: CENTRAL TASK & VERIFICATION QUEUE */}
      {activeSubTab === 'tasks' && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <span>Filter Accountability Queue:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs text-slate-800"
              >
                <option value="ALL">All Departments</option>
                <option value="Sales">Sales & Commercial</option>
                <option value="Stores">Stores & PPC</option>
                <option value="Purchase">Purchase</option>
                <option value="Quality">Quality & Lab</option>
                <option value="Dispatch">Dispatch</option>
                <option value="Finance">Finance</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs text-slate-800"
              >
                <option value="ALL">All Verification States</option>
                <option value="pending">Pending Execution</option>
                <option value="in_progress">In Progress</option>
                <option value="submitted_for_verification">
                  Submitted for Verification
                </option>
                <option value="verified_approved">Verified & Approved</option>
                <option value="rejected_rework">Returned for Rework</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-600 border-b border-slate-200 uppercase text-[10px] font-mono">
                  <th className="py-2.5 px-3">Task Ref / Job</th>
                  <th className="py-2.5 px-3">Task & Deliverable</th>
                  <th className="py-2.5 px-3">Dept & Assignee (Maker)</th>
                  <th className="py-2.5 px-3">Due / SLA / Escalation</th>
                  <th className="py-2.5 px-3">Verification Status</th>
                  <th className="py-2.5 px-3">Verifier (Checker)</th>
                  <th className="py-2.5 px-3 text-right">Workflow Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredTasks.map((t) => {
                  const canVerify = canActorVerifyDepartmentTask({
                    actorUid: currentUser.id,
                    actorRole: currentUser.role,
                    actorStatus: currentUser.accountStatus,
                    actorDepartment: currentUser.department,
                    isDepartmentHead: currentUser.isDepartmentHead,
                    managedDepartment: currentUser.managedDepartment,
                    taskDepartment: t.department,
                    taskAssignedToUid: t.assignedToUid,
                  });
                  const isSelfAssignee = currentUser.id === t.assignedToUid;

                  return (
                    <tr key={t.id} className="hover:bg-slate-50/80 align-top">
                      <td className="py-3 px-3 font-mono whitespace-nowrap">
                        <div className="font-bold text-slate-900">{t.taskNumber}</div>
                        {t.linkedJobNumber && (
                          <button
                            type="button"
                            onClick={() =>
                              t.linkedOrderId && onSelectOrder?.(t.linkedOrderId)
                            }
                            className="text-[11px] text-blue-700 hover:underline mt-0.5 cursor-pointer"
                          >
                            {t.linkedJobNumber}
                          </button>
                        )}
                        <div className="mt-1">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                              t.priority === 'critical'
                                ? 'bg-rose-100 text-rose-800'
                                : t.priority === 'high'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {t.priority}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-3 max-w-xs">
                        <div className="font-semibold text-slate-900">{t.title}</div>
                        <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                          {t.description}
                        </p>
                        {t.submissionNotes && (
                          <div className="mt-1.5 p-2 rounded bg-amber-50/70 border border-amber-200 text-[11px] text-slate-700">
                            <span className="font-semibold text-amber-900">
                              Employee Submission Note:{' '}
                            </span>
                            {t.submissionNotes}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-semibold text-[11px]">
                          {t.department}
                        </span>
                        <div className="font-medium text-slate-900 mt-1">
                          {t.assignedToName}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          By: {t.assignedByName}
                        </div>
                      </td>

                      <td className="py-3 px-3 font-mono whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          Due: {t.dueDate}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          SLA: {t.slaHours}h
                        </div>
                        {Number(t.escalationLevel) > 0 && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                            Escalation L{t.escalationLevel}
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        {statusBadge(t.status)}
                      </td>

                      <td className="py-3 px-3">
                        {t.verifiedByName ? (
                          <div>
                            <div className="font-semibold text-emerald-800 flex items-center gap-1">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                              {t.verifiedByName}
                            </div>
                            {t.verificationRemarks && (
                              <div className="text-[11px] text-slate-600 mt-0.5">
                                “{t.verificationRemarks}”
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">
                            Not yet verified
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap space-y-1.5">
                        {t.status !== 'submitted_for_verification' &&
                          t.status !== 'verified_approved' && (
                            <button
                              type="button"
                              onClick={() => {
                                setSubmissionModalTask(t);
                                setModalRemarks(t.submissionNotes || '');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              <Send className="w-3 h-3" />
                              Submit for Verification
                            </button>
                          )}

                        {t.status === 'submitted_for_verification' && (
                          <div className="flex flex-col items-end gap-1">
                            {canVerify.allowed ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setVerificationModalTask(t);
                                  setModalRemarks('');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                <UserCheck className="w-3 h-3" />
                                Supervisor Verify / Reject
                              </button>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[10px]"
                                title="Separation of Duties: Task assignee cannot self-verify. Requires Department Head, CEO, or Super Admin."
                              >
                                <Lock className="w-3 h-3 text-amber-600" />
                                {isSelfAssignee
                                  ? 'Maker ≠ Checker (No Self-Verify)'
                                  : 'Requires Dept Head / CEO'}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: INTER-DEPARTMENTAL HANDOVERS (H-1 TO H-5) */}
      {activeSubTab === 'handovers' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
            {(Object.keys(HANDOVER_STAGE_META) as HandoverStageCode[]).map(
              (code) => {
                const meta = HANDOVER_STAGE_META[code];
                const count = handovers.filter((h) => h.handoverCode === code).length;
                return (
                  <div
                    key={code}
                    className="bg-white rounded-lg border border-slate-200 p-3 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded bg-[#14283F] text-amber-300 font-mono font-bold text-xs">
                        {code}
                      </span>
                      <span className="text-xs font-mono font-semibold text-slate-600">
                        {count} record(s)
                      </span>
                    </div>
                    <div className="text-xs font-bold text-slate-900 mt-1.5">
                      {meta.fromDept} → {meta.toDept}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {meta.description}
                    </p>
                  </div>
                );
              }
            )}
          </div>

          <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-600 border-b border-slate-200 uppercase text-[10px] font-mono">
                  <th className="py-2.5 px-3">Gate / Ref</th>
                  <th className="py-2.5 px-3">Job & Lot Details</th>
                  <th className="py-2.5 px-3">Custody Transfer</th>
                  <th className="py-2.5 px-3">Checklist & Heat Traceability</th>
                  <th className="py-2.5 px-3">Custody Status</th>
                  <th className="py-2.5 px-3 text-right">Dual-Custody Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {handovers.map((h) => {
                  const canResolve = canActorAcceptOrRejectHandover({
                    actorUid: currentUser.id,
                    actorRole: currentUser.role,
                    actorStatus: currentUser.accountStatus,
                    actorDepartment: currentUser.department,
                    initiatedByUid: h.initiatedByUid,
                    toDepartment: h.toDepartment,
                  });

                  return (
                    <tr key={h.id} className="hover:bg-slate-50/80 align-top">
                      <td className="py-3 px-3 font-mono whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-[#14283F] text-amber-300 font-bold text-xs">
                          {h.handoverCode}
                        </span>
                        <div className="text-[11px] text-slate-500 mt-1">{h.id}</div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectOrder?.(h.orderId)}
                          className="font-mono font-bold text-blue-700 hover:underline cursor-pointer"
                        >
                          {h.jobNumber}
                        </button>
                        <div className="text-[11px] text-slate-700 mt-0.5">
                          Qty: <strong>{h.quantityPcs} PCS</strong> ({h.weightMt} MT)
                        </div>
                        {h.heatNumber && (
                          <div className="text-[11px] font-mono text-slate-500">
                            Heat: {h.heatNumber}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          {h.fromDepartment} → {h.toDepartment}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-0.5">
                          Sender: {h.initiatedByName}
                        </div>
                        {h.receivedByName && (
                          <div className="text-[11px] text-emerald-800 font-medium">
                            Receiver: {h.receivedByName}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 max-w-sm">
                        <div className="text-slate-800">{h.checklistSummary}</div>
                        {h.remarks && (
                          <div className="text-[11px] text-slate-500 mt-1 italic">
                            Receiver Note: “{h.remarks}”
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        {h.status === 'accepted' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[11px]">
                            <CheckCircle2 className="w-3 h-3" />
                            Custody Accepted
                          </span>
                        ) : h.status === 'rejected' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 font-semibold text-[11px]">
                            <XCircle className="w-3 h-3" />
                            Custody Rejected
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 font-semibold text-[11px]">
                            <Clock className="w-3 h-3" />
                            Pending {h.toDepartment} Acceptance
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {h.status === 'pending_acceptance' ? (
                          canResolve.allowed ? (
                            <button
                              type="button"
                              onClick={() => {
                                setResolveModalHandover(h);
                                setModalRemarks('');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              <UserCheck className="w-3 h-3" />
                              Accept / Reject Custody
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[10px]">
                              <Lock className="w-3 h-3 text-amber-600" />
                              Awaiting {h.toDepartment} Receiver
                            </span>
                          )
                        ) : (
                          <span className="text-[11px] font-mono text-slate-400">
                            Closed
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: EMPLOYEE DUTY MANUAL & MANDATORY DAILY SOP CHECKLISTS */}
      {activeSubTab === 'duty_manual' && activeDutyManual && (
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <span className="text-[11px] font-mono uppercase text-slate-500 font-semibold">
                Montex Forge Industries — Standard Operating Accountability Manual
              </span>
              <h2 className="text-base font-bold text-slate-900 mt-0.5">
                {activeDutyManual.designationTitle} ({activeDutyManual.department})
              </h2>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {roleDutyManuals.map((m) => (
                <button
                  key={m.role}
                  type="button"
                  onClick={() => setSelectedRoleManual(m.role)}
                  className={`px-3 py-1.5 rounded text-xs font-semibold uppercase cursor-pointer ${
                    selectedRoleManual === m.role
                      ? 'bg-[#14283F] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {m.role}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
            <div className="font-bold text-slate-900 uppercase text-[11px] font-mono">
              Primary Charter & Operational Accountability:
            </div>
            <p className="text-slate-700 mt-1 leading-relaxed">
              {activeDutyManual.primaryAccountability}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-slate-200 rounded-lg p-4 space-y-2.5">
              <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
                <span>Mandatory Daily SOP Checklist</span>
                <span className="text-[11px] font-mono text-emerald-700">
                  Interactive Shift Sign-Off
                </span>
              </div>
              <div className="space-y-2">
                {activeDutyManual.dailyDuties.map((duty, idx) => {
                  const key = `${activeDutyManual.role}-daily-${idx}`;
                  const isChecked = Boolean(checkedSopItems[key]);
                  return (
                    <label
                      key={key}
                      className={`flex items-start gap-2.5 p-2 rounded border text-xs cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() =>
                          setCheckedSopItems((prev) => ({
                            ...prev,
                            [key]: !prev[key],
                          }))
                        }
                        className="mt-0.5 rounded border-slate-300"
                      />
                      <span>{duty}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                <div className="text-xs font-bold text-slate-900">
                  Weekly Review & Governance Duties
                </div>
                <ul className="list-disc list-inside text-xs text-slate-700 space-y-1.5">
                  {activeDutyManual.weeklyDuties.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>

              <div className="border border-slate-200 rounded-lg p-4 space-y-2 bg-slate-50/60">
                <div className="text-xs font-bold text-slate-900">
                  Key Performance Indicators (KPIs) Measured by System
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeDutyManual.mandatoryKpis.map((kpi, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 rounded bg-white border border-slate-200 text-[11px] font-semibold text-slate-800"
                    >
                      {kpi}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ASSIGN NEW TASK */}
      {showNewTaskModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 max-w-lg w-full p-5 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Assign Department Accountability Task
              </h3>
              <button
                type="button"
                onClick={() => setShowNewTaskModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Task Title *
                </label>
                <input
                  type="text"
                  required
                  value={newTaskForm.title}
                  onChange={(e) =>
                    setNewTaskForm((p) => ({ ...p, title: e.target.value }))
                  }
                  placeholder="e.g., Complete UT Class-1 scanning on Step Shaft batch"
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Department
                  </label>
                  <select
                    value={newTaskForm.department}
                    onChange={(e) =>
                      setNewTaskForm((p) => ({ ...p, department: e.target.value }))
                    }
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white"
                  >
                    <option value="Sales">Sales</option>
                    <option value="Stores">Stores</option>
                    <option value="Purchase">Purchase</option>
                    <option value="Quality">Quality</option>
                    <option value="Dispatch">Dispatch</option>
                    <option value="Finance">Finance</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Assign To Employee
                  </label>
                  <select
                    value={newTaskForm.assignedToUid}
                    onChange={(e) => {
                      const emp = usersList.find((u) => u.id === e.target.value);
                      setNewTaskForm((p) => ({
                        ...p,
                        assignedToUid: e.target.value,
                        assignedToName: emp?.name || 'Assigned Officer',
                      }));
                    }}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white"
                  >
                    {usersList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.department})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Linked Job / Order
                  </label>
                  <select
                    value={newTaskForm.linkedOrderId}
                    onChange={(e) =>
                      setNewTaskForm((p) => ({ ...p, linkedOrderId: e.target.value }))
                    }
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white"
                  >
                    {salesOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.jobNumber} ({o.customerName.slice(0, 16)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Priority
                  </label>
                  <select
                    value={newTaskForm.priority}
                    onChange={(e) =>
                      setNewTaskForm((p) => ({
                        ...p,
                        priority: e.target.value as TaskPriority,
                      }))
                    }
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={newTaskForm.dueDate}
                    onChange={(e) =>
                      setNewTaskForm((p) => ({ ...p, dueDate: e.target.value }))
                    }
                    className="w-full px-2.5 py-2 rounded border border-slate-300"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Deliverable & Verification Criteria
                </label>
                <textarea
                  rows={2}
                  value={newTaskForm.description}
                  onChange={(e) =>
                    setNewTaskForm((p) => ({ ...p, description: e.target.value }))
                  }
                  placeholder="Specify required documentary evidence or physical lot inspection required..."
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewTaskModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-[#14283F] text-white font-semibold cursor-pointer"
                >
                  Assign Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EMPLOYEE SUBMIT FOR VERIFICATION */}
      {submissionModalTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 max-w-md w-full p-5 shadow-xl space-y-4 text-xs">
            <h3 className="text-sm font-bold text-slate-900">
              Submit Task {submissionModalTask.taskNumber} for Supervisor Verification
            </h3>
            <p className="text-slate-600">
              Submitting this task marks it as{' '}
              <strong>Submitted for Verification</strong>. Final closure requires
              Department Head, CEO, or Super Admin approval (Maker ≠ Checker).
            </p>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Completion Evidence / Reference Document *
              </label>
              <textarea
                rows={3}
                value={modalRemarks}
                onChange={(e) => setModalRemarks(e.target.value)}
                placeholder="Enter report number, heat number, or completion remarks..."
                className="w-full px-3 py-2 rounded border border-slate-300"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubmissionModalTask(null)}
                className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEmployeeSubmitForVerification}
                className="px-4 py-1.5 rounded bg-blue-600 text-white font-semibold cursor-pointer"
              >
                Submit for Verification
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: SUPERVISOR VERIFY / REJECT */}
      {verificationModalTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 max-w-md w-full p-5 shadow-xl space-y-4 text-xs">
            <h3 className="text-sm font-bold text-slate-900">
              Supervisor Verification: {verificationModalTask.taskNumber}
            </h3>
            <div className="p-3 rounded bg-slate-50 border border-slate-200 space-y-1">
              <div>
                <strong>Assignee (Maker):</strong>{' '}
                {verificationModalTask.assignedToName}
              </div>
              <div>
                <strong>Submission Note:</strong>{' '}
                {verificationModalTask.submissionNotes || 'Submitted'}
              </div>
              <div>
                <strong>Verifier (Checker):</strong> {currentUser.name}
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Supervisor Verification / Rework Remarks
              </label>
              <textarea
                rows={2}
                value={modalRemarks}
                onChange={(e) => setModalRemarks(e.target.value)}
                placeholder="Enter verification sign-off note or reason for rework..."
                className="w-full px-3 py-2 rounded border border-slate-300"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVerificationModalTask(null)}
                className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSupervisorVerify(false)}
                className="px-3 py-1.5 rounded bg-rose-600 text-white font-semibold cursor-pointer"
              >
                Reject for Rework
              </button>
              <button
                type="button"
                onClick={() => handleSupervisorVerify(true)}
                className="px-4 py-1.5 rounded bg-emerald-700 text-white font-semibold cursor-pointer"
              >
                Verify & Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: INITIATE NEW HANDOVER (H-1..H-5) */}
      {showNewHandoverModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 max-w-lg w-full p-5 shadow-xl space-y-4 text-xs">
            <h3 className="text-sm font-bold text-slate-900">
              Initiate Inter-Departmental Handover (H-1 to H-5)
            </h3>
            <form onSubmit={handleInitiateHandover} className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Handover Stage Gate
                </label>
                <select
                  value={newHandoverForm.handoverCode}
                  onChange={(e) =>
                    setNewHandoverForm((p) => ({
                      ...p,
                      handoverCode: e.target.value as HandoverStageCode,
                    }))
                  }
                  className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white"
                >
                  {(Object.keys(HANDOVER_STAGE_META) as HandoverStageCode[]).map(
                    (code) => (
                      <option key={code} value={code}>
                        {HANDOVER_STAGE_META[code].label} (
                        {HANDOVER_STAGE_META[code].fromDept} →{' '}
                        {HANDOVER_STAGE_META[code].toDept})
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Order / Job Number
                  </label>
                  <select
                    value={newHandoverForm.orderId}
                    onChange={(e) =>
                      setNewHandoverForm((p) => ({ ...p, orderId: e.target.value }))
                    }
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white"
                  >
                    {salesOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.jobNumber}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Quantity (PCS)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newHandoverForm.quantityPcs}
                    onChange={(e) =>
                      setNewHandoverForm((p) => ({
                        ...p,
                        quantityPcs: Number(e.target.value),
                      }))
                    }
                    className="w-full px-2.5 py-2 rounded border border-slate-300"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Weight (MT)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0.01}
                    value={newHandoverForm.weightMt}
                    onChange={(e) =>
                      setNewHandoverForm((p) => ({
                        ...p,
                        weightMt: Number(e.target.value),
                      }))
                    }
                    className="w-full px-2.5 py-2 rounded border border-slate-300"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Mill Heat Number
                </label>
                <input
                  type="text"
                  value={newHandoverForm.heatNumber}
                  onChange={(e) =>
                    setNewHandoverForm((p) => ({
                      ...p,
                      heatNumber: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Handover Checklist & Custody Declaration
                </label>
                <textarea
                  rows={2}
                  value={newHandoverForm.checklistSummary}
                  onChange={(e) =>
                    setNewHandoverForm((p) => ({
                      ...p,
                      checklistSummary: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewHandoverModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-[#14283F] text-white font-semibold cursor-pointer"
                >
                  Initiate Handover
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: RESOLVE HANDOVER (ACCEPT / REJECT CUSTODY) */}
      {resolveModalHandover && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 max-w-md w-full p-5 shadow-xl space-y-4 text-xs">
            <h3 className="text-sm font-bold text-slate-900">
              Dual-Custody Sign-Off: {resolveModalHandover.handoverCode} (
              {resolveModalHandover.jobNumber})
            </h3>
            <div className="p-3 rounded bg-slate-50 border border-slate-200 space-y-1">
              <div>
                <strong>From:</strong> {resolveModalHandover.fromDepartment} (
                {resolveModalHandover.initiatedByName})
              </div>
              <div>
                <strong>To:</strong> {resolveModalHandover.toDepartment}
              </div>
              <div>
                <strong>Lot Quantity:</strong> {resolveModalHandover.quantityPcs}{' '}
                PCS ({resolveModalHandover.weightMt} MT) · Heat:{' '}
                {resolveModalHandover.heatNumber}
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Receiving Officer Inspection Remarks
              </label>
              <textarea
                rows={2}
                value={modalRemarks}
                onChange={(e) => setModalRemarks(e.target.value)}
                placeholder="Confirm physical count, heat tags, and documentation..."
                className="w-full px-3 py-2 rounded border border-slate-300"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResolveModalHandover(null)}
                className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleResolveHandover(false)}
                className="px-3 py-1.5 rounded bg-rose-600 text-white font-semibold cursor-pointer"
              >
                Reject Custody
              </button>
              <button
                type="button"
                onClick={() => handleResolveHandover(true)}
                className="px-4 py-1.5 rounded bg-emerald-700 text-white font-semibold cursor-pointer"
              >
                Accept Custody
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
