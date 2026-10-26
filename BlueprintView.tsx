import React, { useState } from 'react';
import {
  FileCode2,
  Database,
  Network,
  ShieldCheck,
  HelpCircle,
  CheckSquare,
  Layers,
  Copy,
  Check,
  Server,
  FileSpreadsheet,
  AlertOctagon,
  ArrowRight,
  Flame,
  Lock,
  KeyRound,
  RefreshCw,
} from 'lucide-react';
import { BLUEPRINT_DATA } from '../../data/blueprintData';

export const BlueprintView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<
    | 'assessment'
    | 'requirements'
    | 'roles'
    | 'firestore_model'
    | 'security_rules'
    | 'auth_architecture'
    | 'transactions'
    | 'questions'
    | 'step2_plan'
    | 'checklist'
  >('assessment');

  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(id);
    setTimeout(() => setCopiedItem(null), 2000);
  };

  const sections = [
    { id: 'assessment', label: '1. Repository & Runtime Assessment', icon: Server },
    { id: 'requirements', label: '2. Requirements & Exclusions', icon: FileSpreadsheet },
    { id: 'roles', label: '3. Role & Permissions Matrix', icon: ShieldCheck },
    { id: 'firestore_model', label: '4. Cloud Firestore Data Model', icon: Database },
    { id: 'security_rules', label: '5. Firebase Security Rules Draft', icon: Flame },
    { id: 'auth_architecture', label: '6. Auth & Employee Onboarding', icon: Lock },
    { id: 'transactions', label: '7. Firestore Transactions Blueprint', icon: RefreshCw },
    { id: 'questions', label: '8. Unresolved Questions for Montex', icon: HelpCircle },
    { id: 'step2_plan', label: '9. Step 2 Plan (Firebase Stack)', icon: Layers },
    { id: 'checklist', label: '10. Step 1 Acceptance Checklist', icon: CheckSquare },
  ];

  return (
    <div className="space-y-6">
      {/* Blueprint Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span>Technical Architecture</span>
            <span aria-hidden="true">·</span>
            <span>Firebase Realtime Database & Auth</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700">Specification Blueprint</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
            Montex MIS Architecture Blueprint (Firebase Stack)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Firebase Realtime Database (<code>https://montex-mis-default-rtdb.firebaseio.com/</code>), Firebase Authentication, Security Rules, and 5-tier RBAC governance.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs bg-amber-500 text-slate-950 px-3 py-1.5 rounded-md font-mono font-semibold">
          <Flame className="w-4 h-4 text-slate-950" />
          <span>Active: Firebase Realtime Database + Auth</span>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="flex flex-wrap gap-1.5 bg-slate-100 p-1.5 rounded-lg border border-slate-200">
        {sections.map((sec) => {
          const Icon = sec.icon;
          const active = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id as any)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                active
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{sec.label}</span>
            </button>
          );
        })}
      </div>

      {/* Section Content */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        {/* 1. REPOSITORY & RUNTIME ASSESSMENT */}
        {activeSection === 'assessment' && (
          <div className="space-y-5 text-xs">
            <div className="border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Repository, Runtime & Realtime Database Architecture</h2>
              <p className="text-slate-500">
                Connected to <code>https://montex-mis-default-rtdb.firebaseio.com/</code> via singleton Firebase JS SDK (<code>getDatabase(app, databaseURL)</code>).
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2">
                <span className="font-bold text-slate-800 text-sm block">Approved Environment Stack:</span>
                <div className="space-y-2 pt-1">
                  <div>
                    <span className="text-slate-500 block">Realtime Database Instance:</span>
                    <span className="font-mono font-bold text-indigo-700">https://montex-mis-default-rtdb.firebaseio.com/</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Firebase Project ID:</span>
                    <span className="font-mono font-semibold text-slate-900">montex-mis</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Frontend Framework:</span>
                    <span className="font-semibold text-slate-900">{BLUEPRINT_DATA.repositoryAssessment.frontend}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Authentication Provider:</span>
                    <span className="font-semibold text-slate-900">Firebase Authentication (Email/Password & Google Sign-In)</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">RBAC Role Groups:</span>
                    <span className="font-mono font-semibold text-slate-900">Admin · Management · Finance · Sales · Production</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3">
                <span className="font-bold text-slate-800 text-sm block">Realtime Database JSON Tree Structure:</span>
                <pre className="p-3 bg-slate-900 text-emerald-400 rounded font-mono text-[11px] overflow-x-auto leading-relaxed">
{`{
  "metadata": { "company", "databaseVersion", "lastSeededAt" },
  "users": { "$uid": { "email", "rbacGroup", "accountStatus" } },
  "dashboard": { "kpis": { "monthlyProductionMt", ... } },
  "production": {
    "summary": { "monthlyTargetMt", "rejectionRatePct" },
    "shiftYields": [ ... ],
    "weeklyRunRate": [ ... ]
  },
  "salesOrders": { "$orderId": { "poNumber", "jobNumber", ... } },
  "dispatch": { "shipments": { "$dispatchId": { "lrNumber", ... } } },
  "outstandingPayments": { "$customerId": { "totalOutstanding", ... } },
  "inventory": {
    "rawMaterials": { "$materialId": { "currentStockMt", ... } },
    "stockMovements": { "$movId": { "heatNumber", "quantityMt", ... } }
  },
  "quality": { "inspections": { "$qcId": { "mtcNumber", ... } } },
  "alerts": {
    "queue": { "$alertId": { "severity", "acknowledged", ... } },
    "thresholds": { "rejectionPercent", "criticalAgeingDays", ... }
  },
  "auditLogs": { "$logId": { "action", "path", "actorUid", ... } }
}`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* 2. REQUIREMENTS & EXCLUSIONS */}
        {activeSection === 'requirements' && (
          <div className="space-y-5 text-xs">
            <div className="border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Requirements, Assumptions & Exclusions Register</h2>
              <p className="text-slate-500">
                Categorized directly from Montex Forge MIS 12-page specification (October 2026).
              </p>
            </div>

            <div className="space-y-4">
              {BLUEPRINT_DATA.requirementsRegister.map((cat, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg p-4 bg-slate-50/30 space-y-2">
                  <h3 className="font-bold text-slate-900 text-sm">{cat.category}</h3>
                  <ul className="space-y-1.5 list-disc pl-4 text-slate-700">
                    {cat.items.map((item, i) => (
                      <li key={i} className="leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. ROLE & PERMISSIONS MATRIX */}
        {activeSection === 'roles' && (
          <div className="space-y-5 text-xs">
            <div className="border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Role-Based Access Control (RBAC) Governance</h2>
              <p className="text-slate-500">
                Departmental separation of duties enforced through Firestore Security Rules and server-side Admin SDK verification.
              </p>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-700 border-b font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Role Title</th>
                    <th className="py-2.5 px-3">Role Code</th>
                    <th className="py-2.5 px-3">Authorized Operational Scope</th>
                    <th className="py-2.5 px-3">Strictly Prohibited Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">Super Administrator</td>
                    <td className="py-2.5 px-3 font-mono text-indigo-700 font-medium">super_admin</td>
                    <td className="py-2.5 px-3 text-slate-700">User account invitation, role assignment, account deactivation, security rules governance, full system audit review.</td>
                    <td className="py-2.5 px-3 text-slate-500">None. All administrative mutations are permanently logged in /audit_logs.</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">CEO / Managing Director</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 font-medium">ceo</td>
                    <td className="py-2.5 px-3 text-slate-700">Executive dashboard view, company target monitoring, order approval, high-priority Action Queue resolution, financial outstanding review.</td>
                    <td className="py-2.5 px-3 text-rose-700 font-medium">Cannot invite employees, modify user roles, or record shop-floor GRNs/QC coupons.</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">VP Sales & Marketing</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 font-medium">sales</td>
                    <td className="py-2.5 px-3 text-slate-700">Customer Master, Customer PO registration, Quotations, Sales Order tracking, Customer Outstanding summary.</td>
                    <td className="py-2.5 px-3 text-rose-700 font-medium">Cannot edit raw material stock or issue official Mill Test Certificates.</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">Stores & Yard Superintendent</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 font-medium">stores</td>
                    <td className="py-2.5 px-3 text-slate-700">Raw Material master, GRN receipt entry, production issues, stock reservations to internal jobs, scrap returns.</td>
                    <td className="py-2.5 px-3 text-rose-700 font-medium">Cannot approve customer clearances, alter sales prices, or edit invoices.</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">Head of Strategic Procurement</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 font-medium">purchase</td>
                    <td className="py-2.5 px-3 text-slate-700">Steel mill suppliers, Purchase Orders for raw material billets/ingots, PO vs GRN reconciliation, shortage alarms.</td>
                    <td className="py-2.5 px-3 text-rose-700 font-medium">Cannot edit customer orders, sign QC reports, or release dispatches.</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">Quality Assurance Head</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 font-medium">quality</td>
                    <td className="py-2.5 px-3 text-slate-700">NDT tests (UT, MPI, Hardness), Mill Test Certificate (EN 10204 3.1) issuance, rejection logging, TPI coordination.</td>
                    <td className="py-2.5 px-3 text-rose-700 font-medium">Cannot dispatch vehicles or edit finance ledger entries.</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">Dispatch & Logistics Officer</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 font-medium">dispatch</td>
                    <td className="py-2.5 px-3 text-slate-700">Dispatch challan preparation, transporter booking, vehicle LR logging, gate pass generation, partial shipments.</td>
                    <td className="py-2.5 px-3 text-rose-700 font-medium">Cannot clear unapproved QC lots or modify customer master records.</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">Chief Financial Officer</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 font-medium">finance</td>
                    <td className="py-2.5 px-3 text-slate-700">Customer Outstanding ageing (0-30, 31-60, 61-90, 90+ days), Tally CSV batch import, payment reconciliation.</td>
                    <td className="py-2.5 px-3 text-rose-700 font-medium">Cannot override technical QA rejections or edit raw material billets.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. CLOUD FIRESTORE DATA MODEL */}
        {activeSection === 'firestore_model' && (
          <div className="space-y-5 text-xs">
            <div className="border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Cloud Firestore Data Model (Collections & Subcollections)</h2>
              <p className="text-slate-500">
                Document schemas, subcollections, references, access patterns, and query index requirements for Montex Forge MIS.
              </p>
            </div>

            <div className="space-y-4">
              {BLUEPRINT_DATA.firestoreCollections.map((col) => (
                <div key={col.collection} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-slate-900 text-sm">/{col.collection}</span>
                      <span className="text-slate-500 text-xs ml-3">{col.purpose}</span>
                    </div>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-800">
                      ID: {col.documentIdFormat}
                    </span>
                  </div>

                  <div className="p-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-slate-500 border-b border-slate-100 font-semibold text-[11px]">
                        <tr>
                          <th className="py-1.5 px-2">Field Name</th>
                          <th className="py-1.5 px-2">Data Type</th>
                          <th className="py-1.5 px-2">Description</th>
                          <th className="py-1.5 px-2">Indexed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {col.sampleFields.map((f, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="py-1.5 px-2 font-mono font-medium text-slate-900">{f.field}</td>
                            <td className="py-1.5 px-2 font-mono text-indigo-700">{f.type}</td>
                            <td className="py-1.5 px-2 text-slate-600">{f.description}</td>
                            <td className="py-1.5 px-2 font-mono text-slate-500">
                              {f.indexed ? <span className="text-emerald-700 font-bold">Yes</span> : 'No'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
                      <strong>Access Pattern:</strong> {col.accessPattern}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 5. FIREBASE SECURITY RULES */}
        {activeSection === 'security_rules' && (
          <div className="space-y-5 text-xs">
            <div className="border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Firebase Security Rules Blueprint (firestore.rules)</h2>
              <p className="text-slate-500">
                Direct client-side access control enforcing RBAC and verifying active employee account status on every document request.
              </p>
            </div>

            <div className="p-4 bg-slate-900 rounded-lg text-slate-200 font-mono text-xs overflow-x-auto">
              <div className="flex justify-between items-center pb-2 mb-2 border-b border-slate-800">
                <span className="text-slate-400 font-semibold">firestore.rules (Production Security Blueprint)</span>
                <button
                  onClick={() => copyToClipboard(BLUEPRINT_DATA.firestoreSecurityRulesBlueprint, 'rules')}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex items-center gap-1 text-[11px]"
                >
                  {copiedItem === 'rules' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedItem === 'rules' ? 'Copied' : 'Copy Rules'}</span>
                </button>
              </div>
              <pre className="whitespace-pre">{BLUEPRINT_DATA.firestoreSecurityRulesBlueprint}</pre>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 border rounded-lg bg-slate-50">
                <span className="font-bold text-slate-900 block mb-1">Active Account Enforcement:</span>
                <p className="text-slate-600 leading-relaxed">
                  Every rule executes <code>isActiveUser()</code> which verifies that <code>accountStatus == 'active'</code>. If an admin disables an employee, access is immediately revoked across all Firestore collections.
                </p>
              </div>
              <div className="p-3 border rounded-lg bg-slate-50">
                <span className="font-bold text-slate-900 block mb-1">Strict Immutability for Audit & Stock Ledger:</span>
                <p className="text-slate-600 leading-relaxed">
                  Documents in <code>stock_ledger</code> and <code>audit_logs</code> have <code>allow update, delete: if false;</code>. No user or client can alter historical stock movements or audit logs.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 6. AUTH & EMPLOYEE ONBOARDING */}
        {activeSection === 'auth_architecture' && (
          <div className="space-y-5 text-xs">
            <div className="border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Firebase Authentication & Employee Onboarding</h2>
              <p className="text-slate-500">
                Zero public self-registration. Admin-only invitations, separate employee accounts, and initial Super Admin bootstrap.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 border rounded-lg bg-slate-50 space-y-2">
                <span className="font-bold text-slate-900 text-sm block">1. Employee Onboarding Workflow:</span>
                <ol className="space-y-1.5 list-decimal pl-4 text-slate-700">
                  {BLUEPRINT_DATA.authArchitecture.onboardingWorkflow.map((step, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="p-4 border rounded-lg bg-slate-50 space-y-3">
                <div>
                  <span className="font-bold text-slate-900 text-sm block">2. Super Admin Initial Bootstrap:</span>
                  <ul className="space-y-1.5 list-disc pl-4 text-slate-700 mt-1">
                    {BLUEPRINT_DATA.authArchitecture.superAdminBootstrap.map((item, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-2 border-t">
                  <span className="font-bold text-slate-900 text-sm block">3. Instant Account Deactivation:</span>
                  <ul className="space-y-1.5 list-disc pl-4 text-slate-700 mt-1">
                    {BLUEPRINT_DATA.authArchitecture.accountDeactivationPolicy.map((item, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 7. FIRESTORE TRANSACTIONS BLUEPRINT */}
        {activeSection === 'transactions' && (
          <div className="space-y-5 text-xs">
            <div className="border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Firestore Atomic Transactions Blueprint</h2>
              <p className="text-slate-500">
                Server-authoritative and client transaction logic to maintain absolute consistency, prevent negative stock, and manage partial dispatches.
              </p>
            </div>

            <div className="space-y-4">
              {BLUEPRINT_DATA.transactionsBlueprint.map((tx, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg p-4 bg-slate-50/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-sm">{tx.operation}</span>
                    <span className="text-indigo-700 font-mono text-[11px] bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                      Trigger: {tx.trigger}
                    </span>
                  </div>
                  <ol className="space-y-1 list-decimal pl-4 text-slate-700 font-mono text-[11px] pt-1">
                    {tx.steps.map((st, i) => (
                      <li key={i}>{st}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 8. MANAGEMENT QUESTIONS */}
        {activeSection === 'questions' && (
          <div className="space-y-5 text-xs">
            <div className="border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Unresolved Questions for Montex Top Management</h2>
              <p className="text-slate-500">
                Key policy confirmations required from Montex leadership prior to Step 2 database activation.
              </p>
            </div>

            <div className="space-y-3">
              <div className="p-3 border rounded-lg bg-slate-50">
                <span className="font-bold text-slate-900 block text-xs">1. Authoritative Source of Truth:</span>
                <p className="text-slate-600 mt-1">
                  Will Montex MIS be the sole primary authority for raw material inventory from Day 1, or will stores maintain a dual physical ledger during the transition period?
                </p>
              </div>
              <div className="p-3 border rounded-lg bg-slate-50">
                <span className="font-bold text-slate-900 block text-xs">2. Job Number Sequence Convention:</span>
                <p className="text-slate-600 mt-1">
                  Please confirm the internal Job Number format (e.g. <code>JOB-MF-YYYY-XXXX</code> or department-coded prefix).
                </p>
              </div>
              <div className="p-3 border rounded-lg bg-slate-50">
                <span className="font-bold text-slate-900 block text-xs">3. Rejection & Scrap Tolerance Thresholds:</span>
                <p className="text-slate-600 mt-1">
                  What is the company threshold for automated management alerts on NDT rejection rates (currently defaulted to 2.0%)?
                </p>
              </div>
              <div className="p-3 border rounded-lg bg-slate-50">
                <span className="font-bold text-slate-900 block text-xs">4. Tally Reconciliation Cadence:</span>
                <p className="text-slate-600 mt-1">
                  What is the approved procedure and frequency (daily vs weekly) for the Finance department to export and upload Tally CSV registers?
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 9. STEP 2 IMPLEMENTATION PLAN */}
        {activeSection === 'step2_plan' && (
          <div className="space-y-5 text-xs">
            <div className="border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Step 2 Implementation Plan (Approved Firebase Architecture)</h2>
              <p className="text-slate-500">
                Detailed plan to provision Firebase, configure Authentication, deploy Firestore Security Rules, and establish persistent data storage.
              </p>
            </div>

            <div className="space-y-3">
              {BLUEPRINT_DATA.step2ImplementationPlan.map((p, idx) => (
                <div key={idx} className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
                  <span className="font-bold text-slate-900 text-sm block">{p.phase}</span>
                  <p className="text-slate-600 leading-relaxed">{p.details}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 10. ACCEPTANCE CHECKLIST */}
        {activeSection === 'checklist' && (
          <div className="space-y-5 text-xs">
            <div className="border-b pb-3">
              <h2 className="text-base font-bold text-slate-900">Step 1 Acceptance Checklist (Firebase Corrected)</h2>
              <p className="text-slate-500">
                Review each deliverable against the user brief to approve Step 1 and authorize proceeding to Step 2.
              </p>
            </div>

            <div className="space-y-2">
              {BLUEPRINT_DATA.acceptanceChecklist.map((chk, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/30 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5">
                    <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-medium text-slate-800">{chk.item}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase font-mono tracking-wider">
                    {chk.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
