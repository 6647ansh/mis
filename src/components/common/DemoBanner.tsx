import React from 'react';
import { Lock, CheckCircle2, Factory, Info } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';

interface DemoBannerProps {
  onOpenBlueprint?: () => void;
  onOpenFirebaseConsole?: (tab: 'auth' | 'diagnostics' | 'rules') => void;
  onNavigate?: (tabId: string) => void;
}

export const DemoBanner: React.FC<DemoBannerProps> = ({
  onOpenFirebaseConsole,
}) => {
  const { firebaseUser, dataSource, lastSyncedAt } = useRtdb();

  return (
    <div className="bg-[#0F1F32] text-slate-200 px-4 sm:px-6 py-1.5 text-xs flex flex-wrap items-center justify-between gap-3 border-b border-slate-800">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-200 text-[11px]">
          <Factory className="w-3.5 h-3.5 text-[#F28C28]" />
          <span>Montex Forge Industries · Chakan Works (Plant I &amp; II)</span>
        </span>
        <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
          |
        </span>
        {dataSource === 'live_rtdb' ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-400 text-[11px] font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Live Database Sync Active ({lastSyncedAt || 'Connected'})</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-amber-300 text-[11px] font-medium">
            <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              Sample / Demo Dataset Active — Sign in with an employee account for live Firebase Realtime Database sync
            </span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onOpenFirebaseConsole?.('auth')}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded bg-[#14283F] text-slate-100 hover:bg-[#234765] border border-slate-700 transition-colors cursor-pointer"
        >
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>
            {firebaseUser ? `Signed In: ${firebaseUser.email}` : 'Employee Sign In'}
          </span>
        </button>
      </div>
    </div>
  );
};
