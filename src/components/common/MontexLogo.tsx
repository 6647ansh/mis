import React from 'react';

export const MONTEX_OFFICIAL_LOGO_PATH = '/assets/brand/montex-logo.png';

interface MontexLogoProps {
  variant?: 'full' | 'compact';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  surface?: 'light' | 'dark';
  showSubtitle?: boolean;
  className?: string;
}

/**
 * Official Montex Forge Brand Identity Component.
 * - Directly embeds the official attached Montex Forge logo (`/assets/brand/montex-logo.png`).
 * - Strictly preserves the original proportions, orange M-ribbon symbol with flame/leaf emblem,
 *   red MONTEX lettering, and green FORGE text using `object-contain` without stretching,
 *   cropping, recolouring, or distorting.
 * - Wraps the logo in a clean neutral white container so its white background integrates
 *   seamlessly on both dark `#14283F` navy and light `#F4F6F9` surfaces.
 */
export const MontexLogo: React.FC<MontexLogoProps> = ({
  variant = 'full',
  size = 'md',
  surface = 'light',
  showSubtitle = false,
  className = '',
}) => {
  if (variant === 'compact') {
    const compactBoxSize = {
      sm: 'w-9 h-9 p-1',
      md: 'w-11 h-11 p-1',
      lg: 'w-12 h-12 p-1.5',
      xl: 'w-14 h-14 p-1.5',
    }[size];

    return (
      <div
        className={`inline-flex items-center justify-center shrink-0 rounded-lg bg-white shadow-xs border ${
          surface === 'dark' ? 'border-white/25' : 'border-slate-200/90'
        } ${compactBoxSize} ${className}`}
        title="Montex Forge Industries — Enterprise Operations & Commercial MIS"
      >
        <img
          src={MONTEX_OFFICIAL_LOGO_PATH}
          alt="Montex Forge Official Logo"
          className="w-full h-full object-contain select-none"
        />
      </div>
    );
  }

  const fullHeightClass = {
    sm: 'h-9',
    md: 'h-11',
    lg: 'h-14',
    xl: 'h-16',
  }[size];

  const containerStyle =
    surface === 'dark'
      ? 'bg-white px-3 py-1.5 rounded-lg shadow-xs border border-white/20'
      : 'bg-white px-2.5 py-1.5 rounded-lg shadow-2xs border border-slate-200/80';

  return (
    <div className={`inline-flex flex-col ${className}`}>
      <div className={`inline-flex items-center justify-center shrink-0 ${containerStyle}`}>
        <img
          src={MONTEX_OFFICIAL_LOGO_PATH}
          alt="Montex Forge Official Logo"
          className={`${fullHeightClass} w-auto object-contain select-none`}
        />
      </div>
      {showSubtitle && (
        <span
          className={`text-[11px] font-semibold tracking-wide mt-1.5 ${
            surface === 'dark' ? 'text-slate-300' : 'text-slate-600'
          }`}
        >
          Enterprise Operations &amp; Commercial MIS
        </span>
      )}
    </div>
  );
};
