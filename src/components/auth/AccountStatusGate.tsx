import React, { useState } from 'react';
import { Ban, Clock, Loader2, LogOut, RefreshCw, XCircle } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import { MONTEX_OFFICIAL_LOGO_PATH } from '../common/MontexLogo';

const COPY = {
  pending_approval: {
    icon: Clock,
    tone: 'text-bronze-600 bg-bronze-50 border-bronze-200',
    title: 'Your access request is with an administrator',
    body: 'You will be able to use Montex MIS as soon as an administrator approves your account and assigns your role. This page updates on its own once that happens.',
  },
  rejected: {
    icon: XCircle,
    tone: 'text-rose-700 bg-rose-50 border-rose-200',
    title: 'Your access request was not approved',
    body: 'If you think this is a mistake, speak to your department head or the system administrator. They can review your request again.',
  },
  deactivated: {
    icon: Ban,
    tone: 'text-slate-700 bg-slate-100 border-slate-300',
    title: 'Your account is deactivated',
    body: 'Access to Montex MIS has been switched off for this account. Contact the system administrator if you need it restored.',
  },
} as const;

type GateStatus = keyof typeof COPY;

/** Shown to a signed-in employee whose account is not active. No business data is loaded here. */
export function AccountStatusGate() {
  const { firebaseUser, currentUser, logoutUser, refreshOwnUserProfile, rtdbError } = useRtdb();
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const status: GateStatus =
    currentUser.accountStatus === 'rejected' || currentUser.accountStatus === 'deactivated'
      ? currentUser.accountStatus
      : 'pending_approval';
  const { icon: Icon, tone, title, body } = COPY[status];

  const handleCheck = async () => {
    setChecking(true);
    setNote(null);
    const res = await refreshOwnUserProfile();
    setChecking(false);
    if (!res.success) {
      setNote('Could not check your status right now. Check your connection and try again.');
    } else if (res.profile && res.profile.accountStatus !== 'active') {
      setNote('Checked just now. No change yet.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg">
        <img
          src={MONTEX_OFFICIAL_LOGO_PATH}
          alt="Montex Forge Industries"
          className="mx-auto mb-8 h-12 w-auto object-contain"
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border ${tone}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>

          <dl className="mt-6 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Signed in as</dt>
              <dd className="truncate font-medium text-slate-900">
                {firebaseUser?.email || currentUser.email}
              </dd>
            </div>
            {status === 'rejected' && currentUser.rejectionReason && (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Reason given</dt>
                <dd className="text-right font-medium text-slate-900">{currentUser.rejectionReason}</dd>
              </div>
            )}
          </dl>

          {rtdbError && !note && (
            <p role="alert" className="mt-4 text-sm text-rose-700">
              {rtdbError}
            </p>
          )}
          {note && (
            <p role="status" className="mt-4 text-sm text-slate-600">
              {note}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {status === 'pending_approval' && (
              <button
                type="button"
                onClick={handleCheck}
                disabled={checking}
                className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
              >
                {checking ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                )}
                Check status
              </button>
            )}
            <button
              type="button"
              onClick={() => logoutUser()}
              className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition-colors duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze-500 focus-visible:ring-offset-2"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
