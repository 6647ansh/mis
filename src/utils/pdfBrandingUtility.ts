import { jsPDF } from 'jspdf';
import { MONTEX_OFFICIAL_LOGO_PATH } from '../components/common/MontexLogo';
import type { DocumentReadinessStatus } from '../services/documentExportService';

/**
 * Centralized Montex Forge PDF & Report Brand Design Tokens (RGB tuples for jsPDF)
 */
export const MONTEX_PDF_BRAND_TOKENS = {
  colors: {
    primaryNavy: [20, 40, 63] as [number, number, number], // #14283F
    secondaryNavy: [35, 71, 101] as [number, number, number], // #234765
    brandOrange: [242, 140, 40] as [number, number, number], // #F28C28
    brandRed: [200, 35, 44] as [number, number, number], // #C8232C
    appBg: [244, 246, 249] as [number, number, number], // #F4F6F9
    white: [255, 255, 255] as [number, number, number], // #FFFFFF
    textMain: [28, 39, 54] as [number, number, number], // #1C2736
    textSecondary: [104, 117, 135] as [number, number, number], // #687587
    textLight: [209, 219, 232] as [number, number, number], // #D1DBE8
    borderSubtle: [220, 227, 236] as [number, number, number], // #DCE3EC
    borderStrong: [197, 208, 222] as [number, number, number], // #C5D0DE
    draftFill: [254, 243, 199] as [number, number, number], // #FEF3C7
    draftBorder: [217, 119, 6] as [number, number, number], // #D97706
    draftText: [180, 83, 9] as [number, number, number], // #B45309
    readyFill: [236, 253, 245] as [number, number, number], // #ECFDF5
    readyBorder: [16, 185, 129] as [number, number, number], // #10B981
    readyText: [4, 120, 87] as [number, number, number], // #047857
  },
  typography: {
    fontFamily: 'helvetica',
    companyName: 'MONTEX FORGE INDUSTRIES',
    companyTagline:
      'Industrial Closed-Die & Seamless Ring Forgings | Works: MIDC Industrial Area, Pune, MH',
  },
};

interface CachedLogoAsset {
  dataUrl: string;
  width: number;
  height: number;
  aspectRatio: number;
}

let cachedMontexLogo: CachedLogoAsset | null = null;
let logoLoadPromise: Promise<CachedLogoAsset | null> | null = null;

/**
 * Preloads the official Montex Forge logo (`/assets/brand/montex-logo.png`)
 * into an in-memory Base64 data URL with natural image dimensions so that synchronous
 * `jsPDF` exports can embed the official logo at its true aspect ratio without distortion.
 */
export function preloadMontexLogoForPdf(): Promise<CachedLogoAsset | null> {
  if (cachedMontexLogo) {
    return Promise.resolve(cachedMontexLogo);
  }
  if (logoLoadPromise) {
    return logoLoadPromise;
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  logoLoadPromise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const naturalWidth = img.naturalWidth || img.width || 300;
        const naturalHeight = img.naturalHeight || img.height || 180;
        const canvas = document.createElement('canvas');
        canvas.width = naturalWidth;
        canvas.height = naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Fill clean white background so transparent/anti-aliased edges stay crisp
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, naturalWidth, naturalHeight);
          ctx.drawImage(img, 0, 0, naturalWidth, naturalHeight);
          const dataUrl = canvas.toDataURL('image/png');
          cachedMontexLogo = {
            dataUrl,
            width: naturalWidth,
            height: naturalHeight,
            aspectRatio: naturalWidth / Math.max(1, naturalHeight),
          };
          resolve(cachedMontexLogo);
          return;
        }
      } catch {
        // Fallback if canvas tainting occurs
      }
      resolve(null);
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = MONTEX_OFFICIAL_LOGO_PATH;
  });

  return logoLoadPromise;
}

// Eagerly warm the logo cache in browser environments
if (typeof window !== 'undefined') {
  preloadMontexLogoForPdf();
}

export function getCachedMontexLogo(): CachedLogoAsset | null {
  return cachedMontexLogo;
}

export interface MontexPdfHeaderOptions {
  documentCode: string;
  documentTitle: string;
  documentSubtitle: string;
  readiness: DocumentReadinessStatus;
  readinessBannerText: string;
  reportDate?: string;
  margin?: number;
  startY?: number;
}

/**
 * Applies the official Montex Forge corporate header (Navy #14283F banner,
 * Brand Orange #F28C28 accent bar, official logo in a neutral white frame with
 * `object-fit: contain` aspect ratio math, and document readiness classification bar)
 * to a jsPDF document. Returns the next vertical `cursorY` coordinate in mm.
 */
export function applyMontexPdfHeader(
  doc: jsPDF,
  options: MontexPdfHeaderOptions
): number {
  const {
    documentCode,
    documentTitle,
    documentSubtitle,
    readiness,
    readinessBannerText,
    reportDate = '2026-10-22',
    margin = 14,
    startY = 12,
  } = options;

  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - margin * 2;
  const { colors, typography } = MONTEX_PDF_BRAND_TOKENS;

  let cursorY = startY;
  const headerHeight = 20;

  // 1. Primary Navy Corporate Banner (#14283F)
  doc.setFillColor(...colors.primaryNavy);
  doc.rect(margin, cursorY, contentWidth, headerHeight, 'F');

  // Brand Orange Accent Bar (#F28C28) along the bottom edge of the navy header
  doc.setFillColor(...colors.brandOrange);
  doc.rect(margin, cursorY + headerHeight - 1.4, contentWidth, 1.4, 'F');

  // 2. Official Montex Forge Logo in a clean white container (preserving aspect ratio)
  const logoContainerX = margin + 2.5;
  const logoContainerY = cursorY + 2.2;
  const logoContainerW = 24;
  const logoContainerH = 14.2;

  doc.setFillColor(...colors.white);
  doc.roundedRect(
    logoContainerX,
    logoContainerY,
    logoContainerW,
    logoContainerH,
    1.2,
    1.2,
    'F'
  );

  if (cachedMontexLogo && cachedMontexLogo.dataUrl) {
    try {
      const pad = 1.2;
      const maxW = logoContainerW - pad * 2;
      const maxH = logoContainerH - pad * 2;
      let drawW = maxW;
      let drawH = drawW / cachedMontexLogo.aspectRatio;
      if (drawH > maxH) {
        drawH = maxH;
        drawW = drawH * cachedMontexLogo.aspectRatio;
      }
      const drawX = logoContainerX + (logoContainerW - drawW) / 2;
      const drawY = logoContainerY + (logoContainerH - drawH) / 2;
      doc.addImage(cachedMontexLogo.dataUrl, 'PNG', drawX, drawY, drawW, drawH);
    } catch {
      // Fallback brand mark text inside white box if addImage fails
      doc.setFont(typography.fontFamily, 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...colors.brandRed);
      doc.text('MONTEX', logoContainerX + logoContainerW / 2, logoContainerY + 7.5, {
        align: 'center',
      });
      doc.setFontSize(6);
      doc.setTextColor(...colors.primaryNavy);
      doc.text('FORGE', logoContainerX + logoContainerW / 2, logoContainerY + 11.2, {
        align: 'center',
      });
    }
  } else {
    doc.setFont(typography.fontFamily, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...colors.brandRed);
    doc.text('MONTEX', logoContainerX + logoContainerW / 2, logoContainerY + 7.5, {
      align: 'center',
    });
    doc.setFontSize(6);
    doc.setTextColor(...colors.primaryNavy);
    doc.text('FORGE', logoContainerX + logoContainerW / 2, logoContainerY + 11.2, {
      align: 'center',
    });
  }

  // 3. Company Name & Works Subtitle next to the Logo
  const textLeftX = logoContainerX + logoContainerW + 4;
  doc.setFont(typography.fontFamily, 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...colors.white);
  doc.text(typography.companyName, textLeftX, cursorY + 7.8);

  doc.setFont(typography.fontFamily, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...colors.textLight);
  doc.text(typography.companyTagline, textLeftX, cursorY + 13.5);

  // 4. Right-aligned Document Code & Timestamp
  doc.setFont(typography.fontFamily, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...colors.white);
  doc.text(documentCode, pageWidth - margin - 3.5, cursorY + 7.8, {
    align: 'right',
  });

  doc.setFont(typography.fontFamily, 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(...colors.textLight);
  doc.text(`Generated: ${reportDate}`, pageWidth - margin - 3.5, cursorY + 13.5, {
    align: 'right',
  });

  cursorY += headerHeight + 3;

  // 5. Document Title & Readiness Status Classification Bar
  const isDraft = readiness === 'draft_missing_fields';
  if (isDraft) {
    doc.setFillColor(...colors.draftFill);
    doc.setDrawColor(...colors.draftBorder);
  } else {
    doc.setFillColor(...colors.appBg);
    doc.setDrawColor(...colors.borderStrong);
  }
  doc.setLineWidth(0.3);
  doc.rect(margin, cursorY, contentWidth, 13, 'FD');

  // Left vertical brand accent strip on the title bar
  doc.setFillColor(...(isDraft ? colors.draftBorder : colors.secondaryNavy));
  doc.rect(margin, cursorY, 1.5, 13, 'F');

  doc.setFont(typography.fontFamily, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...colors.textMain);
  doc.text(documentTitle.toUpperCase(), margin + 4, cursorY + 5.5);

  doc.setFont(typography.fontFamily, 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(...colors.textSecondary);
  doc.text(documentSubtitle, margin + 4, cursorY + 10.4);

  // Readiness Status Tag on Right
  doc.setFont(typography.fontFamily, 'bold');
  doc.setFontSize(7.8);
  if (isDraft) {
    doc.setTextColor(...colors.draftText);
  } else {
    doc.setTextColor(...colors.readyText);
  }
  doc.text(readinessBannerText, pageWidth - margin - 3, cursorY + 8, {
    align: 'right',
  });

  return cursorY + 16;
}

/**
 * Returns standardized jspdf-autotable styling aligned with the Montex Forge Global Design System
 */
export function getMontexPdfTableTheme(pageWidth: number, margin: number = 14) {
  const { colors } = MONTEX_PDF_BRAND_TOKENS;
  const halfGridDataWidth = (pageWidth - margin * 2) / 2 - 36;

  return {
    metadataTableStyles: {
      styles: {
        fontSize: 7.8,
        cellPadding: 2,
        lineColor: colors.borderSubtle,
        lineWidth: 0.2,
        textColor: colors.textMain,
      },
      columnStyles: {
        0: {
          fontStyle: 'bold' as const,
          fillColor: colors.appBg,
          cellWidth: 36,
          textColor: colors.textSecondary,
        },
        1: { cellWidth: halfGridDataWidth },
        2: {
          fontStyle: 'bold' as const,
          fillColor: colors.appBg,
          cellWidth: 36,
          textColor: colors.textSecondary,
        },
        3: { cellWidth: halfGridDataWidth },
      },
    },
    dataTableStyles: {
      headStyles: {
        fillColor: colors.primaryNavy,
        textColor: colors.white,
        fontStyle: 'bold' as const,
        fontSize: 7.8,
        cellPadding: 2.3,
      },
      bodyStyles: {
        fontSize: 7.5,
        cellPadding: 2,
        textColor: colors.textMain,
        lineColor: colors.borderSubtle,
        lineWidth: 0.2,
      },
      alternateRowStyles: {
        fillColor: colors.appBg,
      },
      footStyles: {
        fillColor: [232, 238, 245] as [number, number, number],
        textColor: colors.primaryNavy,
        fontStyle: 'bold' as const,
        fontSize: 8,
        cellPadding: 2.4,
        lineColor: colors.borderStrong,
        lineWidth: 0.3,
      },
    },
  };
}

export interface MontexPdfFooterOptions {
  footerDisclaimer: string;
  generatedBy: string;
  generatedRole: string;
  margin?: number;
}

/**
 * Applies the standardized Montex Forge branded footer and page numbering across all pages of a jsPDF instance
 */
export function applyMontexPdfFooterAllPages(
  doc: jsPDF,
  options: MontexPdfFooterOptions
): void {
  const { footerDisclaimer, generatedBy, generatedRole, margin = 14 } = options;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const { colors, typography } = MONTEX_PDF_BRAND_TOKENS;

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    // Top rule of footer with subtle navy & orange accent
    doc.setDrawColor(...colors.borderStrong);
    doc.setLineWidth(0.25);
    doc.line(margin, pageHeight - 16, pageWidth - margin, pageHeight - 16);

    doc.setFillColor(...colors.brandOrange);
    doc.rect(margin, pageHeight - 16.2, 18, 0.7, 'F');

    doc.setFont(typography.fontFamily, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...colors.textSecondary);
    const disclaimerShort =
      footerDisclaimer.length > 115
        ? `${footerDisclaimer.slice(0, 112)}...`
        : footerDisclaimer;
    doc.text(disclaimerShort, margin, pageHeight - 11.5);

    doc.text(
      `Montex Forge MIS · Exported by: ${generatedBy} (${generatedRole}) · Read-Only Official Record`,
      margin,
      pageHeight - 7.5
    );

    doc.setFont(typography.fontFamily, 'bold');
    doc.setTextColor(...colors.primaryNavy);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 9.5, {
      align: 'right',
    });
  }
}

export const SHOWCASE_PDF_FILENAME =
  'Montex_Forge_MIS_Product_Showcase_and_Roadmap.pdf';

/**
 * Resolves the publicly accessible URL for the 22-page Product Showcase & Roadmap PDF
 * using Vite's configured `import.meta.env.BASE_URL`.
 */
export function getShowcasePdfPublicUrl(): string {
  const rawBase =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : '/';
  const normalizedBase = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  return `${normalizedBase}${SHOWCASE_PDF_FILENAME}`;
}

/**
 * Fetches, validates (checking the `%PDF-` magic header), and triggers a reliable
 * client-side Blob download for `Montex_Forge_MIS_Product_Showcase_and_Roadmap.pdf`
 * so that downloads work inside sandboxed/cross-origin preview iframes and production deployments.
 */
export async function downloadShowcaseRoadmapPdf(): Promise<{
  success: boolean;
  filename: string;
  byteLength?: number;
  error?: string;
}> {
  const rawBase =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : '/';
  const normalizedBase = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  const candidateUrls = [
    `${normalizedBase}${SHOWCASE_PDF_FILENAME}`,
    `${normalizedBase}api/showcase-pdf`,
  ];

  let lastError = 'Unable to fetch the Product Showcase PDF.';

  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/pdf' },
        cache: 'no-cache',
      });

      if (!response.ok) {
        lastError = `HTTP ${response.status} when requesting ${url}`;
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength < 1024) {
        lastError = 'Received an unexpectedly small response instead of the PDF document.';
        continue;
      }

      // Verify %PDF- magic bytes (0x25 0x50 0x44 0x46 0x2D)
      const headerBytes = new Uint8Array(arrayBuffer, 0, 5);
      const headerSignature = String.fromCharCode(...headerBytes);
      if (headerSignature !== '%PDF-') {
        lastError = `Invalid file signature (${headerSignature}); expected %PDF- header.`;
        continue;
      }

      const pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(pdfBlob);

      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = SHOWCASE_PDF_FILENAME;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 15000);

      return {
        success: true,
        filename: SHOWCASE_PDF_FILENAME,
        byteLength: arrayBuffer.byteLength,
      };
    } catch (err: any) {
      lastError = err?.message || 'Network error while downloading PDF.';
    }
  }

  return {
    success: false,
    filename: SHOWCASE_PDF_FILENAME,
    error: lastError,
  };
}

