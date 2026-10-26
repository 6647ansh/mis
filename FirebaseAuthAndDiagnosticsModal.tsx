import React, { useState, useEffect } from 'react';
import {
  Lock,
  Database,
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  LogOut,
  KeyRound,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import {
  runRtdbVerificationSuite,
  RtdbDiagnosticTestResult,
} from '../../services/rtdbService';
import {
  runComprehensiveSecurityRuleAudit,
  SecurityRuleTestCase,
} from '../../services/rtdbSecurityEvaluator';
import { databaseURL, FIREBASE_CONFIG_METADATA } from '../../lib/firebase';
import databaseRulesJson from '../../../database.rules.json';
import { MontexLogo } from '../common/MontexLogo';

interface FirebaseAuthAndDiagnosticsModalProps {
  isOpen: boolean;
  initialTab?: 'auth' | 'diagnostics' | 'rules';
  onClose: () => void;
}

export const FirebaseAuthAndDiagnosticsModal: React.FC<
  FirebaseAuthAndDiagnosticsModalProps
> = ({ isOpen, initialTab = 'auth', onClose }) => {
  const {
    firebaseUser,
    currentUser,
    activeRbacGroup,
    loginWithEmail,
    registerOrBootstrapUser,
    submitOrUpdateOwnAccessRequest,
    refreshOwnUserProfile,
    loginWithGoogle,
    logoutUser,
    resetPassword,
    isRtdbConnected,
    dataSource,
    rtdbError,
    seedDatabase,
  } = useRtdb();

  const [activeTab, setActiveTab] = useState<'auth' | 'diagnostics' | 'rules'>(initialTab);
  const [authMode, setAuthMode] = useState<'signin' | 'request_access' | 'reset'>('signin');

  const [email, setEmail] = useState('admin@montexforge.com');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('Ramesh Joshi');
  const [department, setDepartment] = useState('Sales & Marketing');
  const [requestedRole, setRequestedRole] = useState<
    'sales' | 'purchase' | 'stores' | 'quality' | 'dispatch' | 'finance'
  >('sales');

  // Pending / Rejected signed-in user self-service request form state
  const [reqDisplayName, setReqDisplayName] = useState(
    currentUser.displayName || currentUser.name || ''
  );
  const [reqDepartment, setReqDepartment] = useState(
    currentUser.requestedDepartment || currentUser.department || 'Sales & Marketing'
  );
  const [reqRole, setReqRole] = useState<
    'sales' | 'purchase' | 'stores' | 'quality' | 'dispatch' | 'finance'
  >(
    currentUser.requestedRole &&
      currentUser.requestedRole !== 'super_admin' &&
      currentUser.requestedRole !== 'ceo'
      ? currentUser.requestedRole
      : 'sales'
  );

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const [testResults, setTestResults] = useState<RtdbDiagnosticTestResult[]>([]);
  const [securityAuditResults, setSecurityAuditResults] = useState<SecurityRuleTestCase[]>(() =>
    runComprehensiveSecurityRuleAudit()
  );
  const [runningTests, setRunningTests] = useState(false);
  const [copiedRules, setCopiedRules] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (firebaseUser) {
      setReqDisplayName(
        currentUser.displayName || currentUser.name || firebaseUser.displayName || ''
      );
      setReqDepartment(
        currentUser.requestedDepartment || currentUser.department || 'Sales & Marketing'
      );
      if (
        currentUser.requestedRole &&
        currentUser.requestedRole !== 'super_admin' &&
        currentUser.requestedRole !== 'ceo'
      ) {
        setReqRole(currentUser.requestedRole);
      }
    }
  }, [firebaseUser, currentUser]);

  if (!isOpen) return null;

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);

    if (authMode === 'signin') {
      const res = await loginWithEmail(email, password);
      if (res.success) {
        setFeedback({ type: 'success', text: `Signed in successfully as ${email}` });
      } else {
        setFeedback({ type: 'error', text: res.error || 'Sign-in failed' });
      }
    } else if (authMode === 'request_access') {
      const res = await registerOrBootstrapUser(
        fullName,
        email,
        password,
        department,
        requestedRole
      );
      if (res.success) {
        setFeedback({
          type: 'success',
          text: `Access request submitted for ${email} (Requested Role: ${requestedRole.toUpperCase()}, Department: ${department}) with accountStatus="${res.provisionedStatus}". An active Super Admin or CEO must approve your account in the Employee Approval Queue before you can access protected business modules.`,
        });
      } else {
        setFeedback({ type: 'error', text: res.error || 'Account registration failed' });
      }
    } else if (authMode === 'reset') {
      const res = await resetPassword(email);
      if (res.success) {
        setFeedback({
          type: 'success',
          text: `Password reset email sent to ${email}`,
        });
      } else {
        setFeedback({ type: 'error', text: res.error || 'Password reset failed' });
      }
    }
    setBusy(false);
  };

  const handleUpdateOwnAccessRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    const res = await submitOrUpdateOwnAccessRequest({
      displayName: reqDisplayName,
      department: reqDepartment,
      requestedRole: reqRole,
    });
    if (res.success) {
      setFeedback({
        type: 'success',
        text: `Your employee access request (${reqRole.toUpperCase()} — ${reqDepartment}) has been saved to /users/${firebaseUser?.uid}. It is now visible in the Admin Employee Approval Queue.`,
      });
    } else {
      setFeedback({
        type: 'error',
        text: res.error || 'Failed to update access request.',
      });
    }
    setBusy(false);
  };

  const handleRefreshProfileStatus = async () => {
    setBusy(true);
    setFeedback(null);
    const res = await refreshOwnUserProfile();
    if (res.success && res.profile) {
      if (res.profile.accountStatus === 'active') {
        setFeedback({
          type: 'success',
          text: `Account Approved! Your account is now ACTIVE with canonical role "${res.profile.role}" (${res.profile.department}). You may close this modal to access your authorized workspace.`,
        });
      } else if (res.profile.accountStatus === 'rejected') {
        setFeedback({
          type: 'error',
          text: `Your access request status is REJECTED. Reason: ${
            res.profile.rejectionReason || 'Not specified'
          }`,
        });
      } else {
        setFeedback({
          type: 'success',
          text: `Profile synced from database: status is still "${res.profile.accountStatus.toUpperCase()}".`,
        });
      }
    } else {
      setFeedback({
        type: 'error',
        text: res.error || 'Unable to refresh profile from database.',
      });
    }
    setBusy(false);
  };

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setFeedback(null);
    const res = await loginWithGoogle();
    if (res.success) {
      setFeedback({ type: 'success', text: 'Signed in with Google successfully.' });
    } else {
      setFeedback({ type: 'error', text: res.error || 'Google Sign-In failed.' });
    }
    setBusy(false);
  };

  const handleRunDiagnostics = async () => {
    setRunningTests(true);
    setFeedback(null);
    const [liveRes, auditRes] = await Promise.all([
      runRtdbVerificationSuite(activeRbacGroup),
      Promise.resolve(runComprehensiveSecurityRuleAudit()),
    ]);
    setTestResults(liveRes);
    setSecurityAuditResults(auditRes);
    setRunningTests(false);
  };

  const handleSeedDatabase = async () => {
    setBusy(true);
    setFeedback(null);
    const res = await seedDatabase();
    setFeedback({
      type: res.success ? 'success' : 'error',
      text: res.message,
    });
    setBusy(false);
    if (res.success) {
      await handleRunDiagnostics();
    }
  };

  const handleCopyRules = () => {
    navigator.clipboard.writeText(JSON.stringify(databaseRulesJson, null, 2));
    setCopiedRules(true);
    setTimeout(() => setCopiedRules(false), 2000);
  };

  const passedAuditCount = securityAuditResults.filter((t) => t.passed).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs">
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden text-xs">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#14283F] text-white flex items-center justify-between border-b-2 border-[#F28C28]">
          <div className="flex items-center gap-3.5">
            <MontexLogo variant="compact" size="md" surface="dark" />
            <div>
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#F28C28] uppercase tracking-wider">
                <Database className="w-3.5 h-3.5" />
                <span>Firebase Realtime Database Security &amp; RBAC Console</span>
              </div>
              <h2 className="text-base font-bold mt-0.5 text-white">
                Montex Forge MIS — Employee Sign-In &amp; Security Verification Suite
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-300 hover:text-white px-2 py-1 rounded text-sm cursor-pointer"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('auth')}
            className={`py-2.5 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'auth'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>1. Auth & Secure Provisioning</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('diagnostics');
              if (testResults.length === 0) handleRunDiagnostics();
            }}
            className={`py-2.5 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'diagnostics'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>
              2. Security Audit & Live Verification ({passedAuditCount}/{securityAuditResults.length} Passed)
            </span>
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`py-2.5 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'rules'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>3. Remediated database.rules.json</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {feedback && (
            <div
              className={`p-3 rounded-md border flex items-start gap-2 ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{feedback.text}</span>
            </div>
          )}

          {/* TAB 1: AUTHENTICATION & SECURE PROVISIONING */}
          {activeTab === 'auth' && (
            <div className="space-y-5">
              {/* Active Session Card */}
              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block">
                    Firebase Auth Session & Account Status
                  </span>
                  {firebaseUser ? (
                    <div className="mt-1 space-y-1">
                      <div className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Authenticated: {firebaseUser.email}</span>
                      </div>
                      <div className="text-slate-600 font-mono text-[11px]">
                        UID: {firebaseUser.uid} · Account Status:{' '}
                        <strong
                          className={
                            currentUser.accountStatus === 'active'
                              ? 'text-emerald-700'
                              : currentUser.accountStatus === 'rejected' ||
                                currentUser.accountStatus === 'deactivated'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                          }
                        >
                          {currentUser.accountStatus.toUpperCase()}
                        </strong>
                      </div>
                      {currentUser.accountStatus === 'active' ? (
                        <div className="text-slate-700 font-mono text-[11px]">
                          Active Authorization Role:{' '}
                          <strong className="text-emerald-800">
                            {currentUser.role} ({activeRbacGroup})
                          </strong>{' '}
                          · Department: <strong>{currentUser.department}</strong>
                        </div>
                      ) : (
                        <div className="text-slate-700 font-mono text-[11px] space-y-0.5">
                          <div>
                            Active Authorization Role:{' '}
                            <strong className="text-rose-700">
                              NONE (Pending Administrator Approval — Zero Permissions)
                            </strong>
                          </div>
                          <div>
                            Requested Role / Department:{' '}
                            <strong className="text-amber-800">
                              {(currentUser.requestedRole || currentUser.role || 'sales').toUpperCase()}{' '}
                              ({currentUser.requestedDepartment || currentUser.department || 'Sales'})
                            </strong>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 space-y-0.5">
                      <div className="text-sm font-bold text-amber-800">
                        Unauthenticated Session (Preview Persona: {currentUser.name} / {activeRbacGroup})
                      </div>
                      <div className="text-slate-500 text-[11px]">
                        Sign in below to authenticate against Firebase project{' '}
                        <code className="font-mono font-semibold">
                          {FIREBASE_CONFIG_METADATA.projectId}
                        </code>
                        .
                      </div>
                    </div>
                  )}
                </div>

                {firebaseUser && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleRefreshProfileStatus}
                      disabled={busy}
                      className="px-3 py-1.5 bg-white border border-slate-300 text-slate-800 rounded font-semibold hover:bg-slate-100 transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                      <span>Refresh Status</span>
                    </button>
                    <button
                      onClick={logoutUser}
                      className="px-3 py-1.5 bg-rose-600 text-white rounded font-semibold hover:bg-rose-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Pending / Rejected Self-Service Access Request & Status Panel */}
              {firebaseUser && currentUser.accountStatus !== 'active' && (
                <div className="p-5 rounded-lg border-2 border-amber-300 bg-amber-50/40 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200 pb-3">
                    <div>
                      <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-amber-800 block">
                        Employee Approval Workflow · Self-Service Access Request
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                        {currentUser.accountStatus === 'rejected'
                          ? 'Your Access Request Was Rejected — Update & Resubmit for Reconsideration'
                          : 'Your Account Is Awaiting Super Admin / CEO Approval'}
                      </h3>
                    </div>
                    <span className="px-2.5 py-1 rounded bg-amber-100 text-amber-900 font-mono font-bold text-[11px] uppercase self-start">
                      Status: {currentUser.accountStatus}
                    </span>
                  </div>

                  {currentUser.accountStatus === 'rejected' && (
                    <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-900 space-y-1">
                      <div className="font-bold">
                        Rejection Reason: {currentUser.rejectionReason || 'No reason provided'}
                      </div>
                      <div className="text-[11px] text-rose-700 font-mono">
                        Reviewed by: {currentUser.rejectedByEmail || currentUser.rejectedByName || 'Administrator'}{' '}
                        {currentUser.rejectedAt ? `at ${currentUser.rejectedAt}` : ''}
                      </div>
                    </div>
                  )}

                  <p className="text-slate-700 leading-relaxed">
                    While your account status is <code>{currentUser.accountStatus}</code>, you have{' '}
                    <strong>no active RBAC role or business-data permissions</strong>. Confirm or
                    update your requested department and canonical role below so an authorized{' '}
                    <strong>Super Admin</strong> (or <strong>CEO</strong>) can review and approve
                    your account in <strong>Admin → Employee Approval Queue</strong>.
                  </p>

                  <form
                    onSubmit={handleUpdateOwnAccessRequest}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded border border-amber-200"
                  >
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        Employee Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={reqDisplayName}
                        onChange={(e) => setReqDisplayName(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        Requested Department
                      </label>
                      <select
                        value={reqDepartment}
                        onChange={(e) => setReqDepartment(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded bg-white"
                      >
                        <option value="Sales & Marketing">Sales &amp; Marketing</option>
                        <option value="Procurement & Vendor Dev">Procurement &amp; Vendor Dev</option>
                        <option value="Stores & Raw Material">Stores &amp; Raw Material</option>
                        <option value="Production & PPC">Production &amp; PPC</option>
                        <option value="Quality & Metallurgy">Quality &amp; Metallurgy</option>
                        <option value="Dispatch & Logistics">Dispatch &amp; Logistics</option>
                        <option value="Finance & Accounts">Finance &amp; Accounts</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        Requested Canonical Role
                      </label>
                      <select
                        value={reqRole}
                        onChange={(e) => setReqRole(e.target.value as any)}
                        className="w-full p-2 border border-slate-300 rounded bg-white font-mono"
                      >
                        <option value="sales">sales (Sales &amp; Estimation)</option>
                        <option value="purchase">purchase (Procurement)</option>
                        <option value="stores">stores (Stores &amp; Production)</option>
                        <option value="quality">quality (Quality &amp; MTC)</option>
                        <option value="dispatch">dispatch (Dispatch &amp; Logistics)</option>
                        <option value="finance">finance (Finance &amp; Accounts)</option>
                      </select>
                    </div>
                    <div className="sm:col-span-3 flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-slate-500 font-mono">
                        Target Record: /users/{firebaseUser.uid} ({firebaseUser.email})
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleRefreshProfileStatus}
                          disabled={busy}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold cursor-pointer"
                        >
                          Check if Approved
                        </button>
                        <button
                          type="submit"
                          disabled={busy}
                          className="px-4 py-1.5 bg-[#14283F] hover:bg-slate-800 text-white rounded font-semibold cursor-pointer"
                        >
                          {busy
                            ? 'Saving...'
                            : currentUser.accountStatus === 'rejected'
                            ? 'Resubmit Access Request for Reconsideration'
                            : 'Save / Update Pending Access Request'}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}

              {!firebaseUser && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Email/Password Form */}
                  <form onSubmit={handleEmailAuth} className="space-y-3.5 border border-slate-200 bg-white p-5 rounded-lg shadow-xs">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <MontexLogo variant="full" size="sm" surface="light" />
                      <span className="text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-[#F4F6F9] text-[#234765] border border-slate-200">
                        Enterprise Portal
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <span className="font-bold text-slate-900 text-sm">
                        {authMode === 'signin'
                          ? 'Employee Sign In'
                          : authMode === 'request_access'
                          ? 'Request Employee Account'
                          : 'Reset Password'}
                      </span>
                      <div className="flex gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setAuthMode('signin')}
                          className={`underline cursor-pointer ${
                            authMode === 'signin' ? 'font-bold text-[#14283F]' : 'text-slate-500'
                          }`}
                        >
                          Sign In
                        </button>
                        <button
                          type="button"
                          onClick={() => setAuthMode('request_access')}
                          className={`underline cursor-pointer ${
                            authMode === 'request_access'
                              ? 'font-bold text-[#14283F]'
                              : 'text-slate-500'
                          }`}
                        >
                          Request Account
                        </button>
                      </div>
                    </div>

                    {authMode === 'request_access' && (
                      <>
                        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-amber-900 text-[11px] flex items-start gap-2">
                          <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                          <span>
                            <strong>No Self-Assigned Privileged Roles:</strong> New accounts are
                            created with <code>accountStatus: &quot;pending_approval&quot;</code>{' '}
                            and zero permissions. An active <strong>Super Admin</strong> or{' '}
                            <strong>CEO</strong> must approve your account in the Employee Approval
                            Queue.
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="font-semibold text-slate-700 block mb-1">
                              Full Name
                            </label>
                            <input
                              type="text"
                              required
                              value={fullName}
                              onChange={(e) => setFullName(e.target.value)}
                              className="w-full p-2 border rounded"
                            />
                          </div>
                          <div>
                            <label className="font-semibold text-slate-700 block mb-1">
                              Department
                            </label>
                            <select
                              value={department}
                              onChange={(e) => setDepartment(e.target.value)}
                              className="w-full p-2 border rounded bg-white"
                            >
                              <option value="Sales & Marketing">Sales &amp; Marketing</option>
                              <option value="Procurement & Vendor Dev">Procurement</option>
                              <option value="Stores & Raw Material">Stores &amp; Inventory</option>
                              <option value="Quality & Metallurgy">Quality &amp; MTC</option>
                              <option value="Dispatch & Logistics">Dispatch &amp; Logistics</option>
                              <option value="Finance & Accounts">Finance &amp; Accounts</option>
                            </select>
                          </div>
                          <div>
                            <label className="font-semibold text-slate-700 block mb-1">
                              Requested Role
                            </label>
                            <select
                              value={requestedRole}
                              onChange={(e) => setRequestedRole(e.target.value as any)}
                              className="w-full p-2 border rounded bg-white font-mono"
                            >
                              <option value="sales">sales</option>
                              <option value="purchase">purchase</option>
                              <option value="stores">stores</option>
                              <option value="quality">quality</option>
                              <option value="dispatch">dispatch</option>
                              <option value="finance">finance</option>
                            </select>
                          </div>
                        </div>
                      </>
                    )}

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        Corporate Email
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full p-2 border rounded font-mono"
                      />
                    </div>

                    {authMode !== 'reset' && (
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Password</label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          placeholder="Minimum 6 characters"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full p-2 border rounded"
                        />
                      </div>
                    )}

                    <div className="pt-1 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setAuthMode(authMode === 'reset' ? 'signin' : 'reset')}
                        className="text-[11px] text-slate-500 hover:text-slate-900 underline cursor-pointer"
                      >
                        {authMode === 'reset' ? 'Back to Sign In' : 'Forgot Password?'}
                      </button>

                      <button
                        type="submit"
                        disabled={busy}
                        className="px-4 py-2 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                      >
                        {busy
                          ? 'Processing...'
                          : authMode === 'signin'
                          ? 'Sign In'
                          : authMode === 'request_access'
                          ? 'Submit Pending Account'
                          : 'Send Reset Link'}
                      </button>
                    </div>
                  </form>

                  {/* Google OAuth & Security Policy */}
                  <div className="space-y-4 border p-4 rounded-lg bg-slate-50/60 flex flex-col justify-between">
                    <div className="space-y-2">
                      <span className="font-bold text-slate-900 text-sm block">
                        Google Workspace Sign-In
                      </span>
                      <p className="text-slate-600 leading-relaxed">
                        Sign in with your corporate Google account. Access to protected application
                        modules and database paths requires an authoritative{' '}
                        <code className="font-mono">/users/&#123;uid&#125;</code> profile with{' '}
                        <code className="font-mono">accountStatus === &apos;active&apos;</code>{' '}
                        approved by an active Super Administrator in the Employee Approval Queue.
                      </p>
                      <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        disabled={busy}
                        className="w-full py-2.5 px-4 bg-white border border-slate-300 hover:bg-slate-100 text-slate-900 font-semibold rounded shadow-2xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <KeyRound className="w-4 h-4 text-indigo-600" />
                        <span>Continue with Google Account</span>
                      </button>
                    </div>

                    <div className="p-3 bg-white border border-slate-200 rounded space-y-1 text-[11px] text-slate-600">
                      <div className="font-bold text-slate-800">
                        Phase 3 Hardened Auth &amp; Approval Policy:
                      </div>
                      <div>• Employee approval enforced via Admin Employee Approval Queue</div>
                      <div>• Unapproved accounts have zero active RBAC permissions</div>
                      <div>• 8 canonical roles validated server-side and in Firestore rules</div>
                      <div>• Rejected and deactivated accounts are blocked from business data</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SECURITY AUDIT & LIVE DIAGNOSTICS */}
          {activeTab === 'diagnostics' && (
            <div className="space-y-5">
              {/* Top Controls */}
              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span>Target Realtime Database:</span>
                    <code className="font-mono text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                      {databaseURL}
                    </code>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    Socket State:{' '}
                    <strong className={isRtdbConnected ? 'text-emerald-700' : 'text-amber-700'}>
                      {isRtdbConnected ? 'CONNECTED' : 'CONNECTING / STANDBY'}
                    </strong>{' '}
                    · Active Data Source:{' '}
                    <strong className="font-mono">
                      {dataSource === 'live_rtdb'
                        ? 'LIVE REALTIME DATABASE'
                        : 'FALLBACK SEED (AWAITING RTDB SEED / AUTH)'}
                    </strong>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleRunDiagnostics}
                    disabled={runningTests}
                    className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${runningTests ? 'animate-spin' : ''}`} />
                    <span>Re-Run Verification</span>
                  </button>
                  <button
                    onClick={handleSeedDatabase}
                    disabled={busy}
                    title="Safe & Non-Destructive: Only creates missing RTDB nodes (!snapshot.exists()). Never overwrites existing profiles or business records."
                    className="px-3 py-1.5 bg-slate-900 text-white hover:bg-slate-800 rounded font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Seed Missing RTDB Paths (Safe)</span>
                  </button>
                </div>
              </div>

              {/* 22-Case Security Rules Verification Matrix */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      22-Case Security Rule & RBAC Verification Report (Allowed & Denied Matrix)
                    </h3>
                    <p className="text-slate-500 text-[11px]">
                      Evaluates <code>database.rules.json</code> against all 5 roles, self-promotion, deactivated accounts, KPI writes, audit forgery, and negative stock/financial invariants.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-900 font-mono font-bold text-xs">
                    {passedAuditCount} / {securityAuditResults.length} ASSERTIONS PASSED
                  </span>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b uppercase text-[11px] font-semibold">
                      <tr>
                        <th className="py-2 px-3">ID & Category</th>
                        <th className="py-2 px-3">Actor & Path</th>
                        <th className="py-2 px-3">Expected</th>
                        <th className="py-2 px-3">Actual Result</th>
                        <th className="py-2 px-3">Scenario & Rule Decision</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {securityAuditResults.map((tc) => (
                        <tr key={tc.id} className="hover:bg-slate-50/60">
                          <td className="py-2 px-3">
                            <span className="font-mono font-bold text-slate-900">{tc.id}</span>
                            <div className="text-[10px] text-slate-500">{tc.category}</div>
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-800">{tc.actorLabel}</div>
                            <div className="font-mono text-[10px] text-indigo-700">
                              {tc.operation.toUpperCase()} {tc.path}
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px]">
                            {tc.expectedAllowed ? (
                              <span className="text-emerald-700 font-bold">ALLOW</span>
                            ) : (
                              <span className="text-rose-700 font-bold">DENY</span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {tc.passed ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-bold">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                PASS ({tc.actualAllowed ? 'ALLOWED' : 'DENIED'})
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 font-mono text-[10px] font-bold">
                                <XCircle className="w-3 h-3 text-rose-600" />
                                FAIL
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-slate-600 leading-relaxed">
                            <div className="font-medium text-slate-800">{tc.description}</div>
                            <div className="font-mono text-[10px] text-slate-400">{tc.reason}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Live Network Probes against https://montex-mis-default-rtdb.firebaseio.com/ */}
              {testResults.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    Live Network Probes against {databaseURL}
                  </h3>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b uppercase text-[11px] font-semibold">
                        <tr>
                          <th className="py-2.5 px-3">Live Probe</th>
                          <th className="py-2.5 px-3">Operation</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">Diagnostic Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {testResults.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 font-semibold text-slate-900">
                              <div>{r.testName}</div>
                              <div className="font-mono text-[10px] text-slate-400">
                                {r.targetPath}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                              {r.operation}
                            </td>
                            <td className="py-2.5 px-3">
                              {r.status === 'PASSED' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-bold">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  PASSED ({r.latencyMs}ms)
                                </span>
                              )}
                              {r.status === 'BLOCKED_BY_RULES' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-mono text-[10px] font-bold">
                                  <ShieldCheck className="w-3 h-3 text-amber-600" />
                                  RULE ENFORCED
                                </span>
                              )}
                              {r.status === 'UNAUTHENTICATED' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300 font-mono text-[10px] font-bold">
                                  UNAUTHENTICATED
                                </span>
                              )}
                              {r.status === 'ERROR' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 font-mono text-[10px] font-bold">
                                  <XCircle className="w-3 h-3 text-rose-600" />
                                  WARNING / ERROR
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 leading-relaxed">
                              {r.details}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: REMEDIATED REALTIME DATABASE SECURITY RULES */}
          {activeTab === 'rules' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Proposed Remediated Realtime Database Security Rules (database.rules.json)
                  </h3>
                  <p className="text-slate-500">
                    Review these rules before publishing in Firebase Console → Realtime Database → Rules.
                  </p>
                </div>
                <button
                  onClick={handleCopyRules}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedRules ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedRules ? 'Copied JSON Rules' : 'Copy database.rules.json'}</span>
                </button>
              </div>

              <pre className="p-4 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] overflow-x-auto max-h-96">
                {JSON.stringify(databaseRulesJson, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
