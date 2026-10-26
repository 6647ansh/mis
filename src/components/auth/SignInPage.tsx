import React, { useState } from 'react';
import {
  AlertCircle,
  Factory,
  Loader2,
  ShieldCheck,
  Truck,
  Wallet,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import { MONTEX_OFFICIAL_LOGO_PATH } from '../common/MontexLogo';

// Forging/metalwork photograph used behind the cover. A navy gradient sits
// underneath, so the page still reads correctly if the image cannot load.
const COVER_IMAGE_URL =
  'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=1800&q=70';

const HIGHLIGHTS = [
  { icon: Factory, title: 'Order to dispatch', text: 'Sales, material, production, quality and dispatch in one flow.' },
  { icon: Wallet, title: 'Finance follow-up', text: 'Invoices, collections and outstanding balances by customer.' },
  { icon: Truck, title: 'Exceptions first', text: 'Shortages, holds and delays surface before they cost a delivery.' },
];

/** Official multi-colour Google "G" mark, as required by Google's sign-in branding guidelines. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function SignInPage() {
  const { loginWithGoogle } = useRtdb();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await loginWithGoogle();
    // On success the auth listener replaces this page; keep the spinner until then.
    if (!res.success) {
      setBusy(false);
      if (!res.cancelled) setError(res.error || 'Google sign-in did not complete. Please try again.');
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      {/* Cover imagery with navy wash */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-35"
        style={{ backgroundImage: `url(${COVER_IMAGE_URL})` }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-950/90 to-slate-900/70"
        aria-hidden="true"
      />
      <div
        className="absolute -left-40 top-1/3 h-[520px] w-[520px] rounded-full bg-bronze-500/15 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative mx-auto grid min-h-screen max-w-7xl grid-cols-1 items-center gap-12 px-6 py-10 lg:grid-cols-[1.15fr_1fr] lg:px-10">
        {/* Company introduction */}
        <section className="max-w-xl">
          <div className="inline-flex items-center rounded-xl bg-white px-3 py-2 shadow-lg shadow-black/30">
            <img
              src={MONTEX_OFFICIAL_LOGO_PATH}
              alt="Montex Forge Industries"
              className="h-12 w-auto object-contain"
            />
          </div>

          <p className="mt-10 text-xs font-semibold uppercase tracking-[0.22em] text-bronze-300">
            Montex Forge Industries
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            Strong processes.
            <br />
            <span className="text-bronze-300">Stronger performance.</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-slate-300">
            The management information system for every order, from enquiry to dispatch and
            collection.
          </p>

          <ul className="mt-10 hidden gap-5 sm:grid">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                  <Icon className="h-5 w-5 text-bronze-300" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-0.5 text-sm text-slate-400">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Sign-in card */}
        <section className="w-full max-w-md justify-self-center lg:justify-self-end">
          <div className="rounded-2xl border border-white/10 bg-white p-8 text-slate-900 shadow-2xl shadow-black/40 sm:p-10">
            <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Use your Google account. Access is available to Montex employees once an
              administrator has approved it.
            </p>

            <button
              type="button"
              onClick={handleSignIn}
              disabled={busy}
              aria-busy={busy}
              className="mt-8 flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm transition-[background-color,box-shadow,border-color] duration-200 hover:border-slate-400 hover:bg-slate-50 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze-500 focus-visible:ring-offset-2 active:bg-slate-100 disabled:cursor-wait disabled:opacity-70"
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden="true" />
              ) : (
                <GoogleMark />
              )}
              {busy ? 'Waiting for Google…' : 'Continue with Google'}
            </button>

            {error && (
              <div
                role="alert"
                className="mt-4 flex gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-8 flex gap-2.5 border-t border-slate-200 pt-6 text-xs leading-relaxed text-slate-500">
              <ShieldCheck className="h-4 w-4 shrink-0 text-bronze-600" aria-hidden="true" />
              <span>
                First time here? Sign in once and your access request goes to an administrator
                for approval.
              </span>
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-slate-500">
            © {new Date().getFullYear()} Montex Forge Industries
          </p>
        </section>
      </div>
    </div>
  );
}
