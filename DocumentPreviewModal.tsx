import React, { useState, useEffect } from 'react';
import {
  Download,
  Printer,
  AlertTriangle,
  CheckCircle2,
  FileText,
  X,
} from 'lucide-react';
import {
  MontexPdfDocumentPayload,
  generateMontexPdfDocument,
  preloadMontexLogoForPdf,
} from '../../services/documentExportService';
import { MontexLogo } from './MontexLogo';

interface DocumentPreviewModalProps {
  payload: MontexPdfDocumentPayload | null;
  onClose: () => void;
  onDownloaded?: (filename: string) => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  payload,
  onClose,
  onDownloaded,
}) => {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    preloadMontexLogoForPdf();
  }, []);

  if (!payload) return null;

  const isDraft = payload.readiness === 'draft_missing_fields';

  const handleDownloadPdf = async () => {
    await preloadMontexLogoForPdf();
    const res = generateMontexPdfDocument(payload, 'download');
    if (res.success) {
      setStatusMessage(`Downloaded ${res.filename}`);
      if (onDownloaded) onDownloaded(res.filename);
    } else {
      setStatusMessage(`Export Failed: ${res.error}`);
    }
  };

  const handlePrintPdf = async () => {
    await preloadMontexLogoForPdf();
    const res = generateMontexPdfDocument(payload, 'print');
    if (res.success) {
      setStatusMessage(`Opened print dialog for ${res.filename}`);
    } else {
      setStatusMessage(`Print Failed: ${res.error}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/75 backdrop-blur-xs">
      <div className="bg-white rounded-xl border border-slate-300 shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden text-xs">
        {/* Top Modal Action Bar with Navy & Brand Orange Accent */}
        <div className="px-5 py-3.5 bg-[#14283F] border-b-2 border-[#F28C28] text-white flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <MontexLogo variant="compact" size="sm" surface="dark" />
            <div>
              <div className="font-bold text-sm tracking-tight text-white">
                {payload.documentTitle}
              </div>
              <div className="text-[11px] text-slate-300 font-mono">
                {payload.filename} · {payload.documentCode}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrintPdf}
              className="px-3 py-1.5 bg-[#234765] hover:bg-slate-700 text-slate-100 border border-slate-600 rounded-md font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="px-3.5 py-1.5 bg-[#F28C28] hover:bg-[#D97716] text-white rounded-md font-semibold inline-flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Official PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-300 hover:text-white rounded-md transition-colors cursor-pointer"
              aria-label="Close document preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Toast Inside Modal */}
        {statusMessage && (
          <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-200 text-emerald-900 flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>{statusMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-emerald-700 hover:text-emerald-950 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Scrollable Document Sheet Body */}
        <div className="p-6 overflow-y-auto space-y-5 bg-[#F4F6F9] flex-1">
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            {/* Official Corporate Letterhead Banner */}
            <div className="bg-[#14283F] text-white px-6 py-4 border-b-4 border-[#F28C28] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <MontexLogo variant="full" size="md" surface="dark" />
                <div>
                  <div className="text-base font-bold tracking-tight text-white">
                    MONTEX FORGE INDUSTRIES
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Industrial Closed-Die &amp; Seamless Ring Forgings · Works: MIDC Industrial Area, Pune, MH
                  </div>
                </div>
              </div>
              <div className="text-left sm:text-right space-y-1">
                <div className="font-mono font-bold text-white text-xs">
                  {payload.documentCode}
                </div>
                <div className="text-[11px] text-slate-300 font-mono">
                  Report Date: 2026-10-22
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Document Title & Readiness Classification Bar */}
              <div
                className={`p-3.5 rounded-md border-l-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isDraft
                    ? 'bg-amber-50/90 border-l-amber-600 border border-amber-200'
                    : 'bg-[#F4F6F9] border-l-[#234765] border border-slate-200'
                }`}
              >
                <div>
                  <div className="font-bold text-slate-900 text-xs uppercase tracking-tight flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#234765] shrink-0" />
                    <span>{payload.documentTitle}</span>
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5">
                    {payload.documentSubtitle}
                  </div>
                </div>
                <div
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold shrink-0 ${
                    isDraft
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  }`}
                >
                  {isDraft ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  )}
                  <span>{payload.readinessBannerText}</span>
                </div>
              </div>

            {/* Draft / Missing Fields / Data Integrity Notice */}
            {((payload.missingFieldsList && payload.missingFieldsList.length > 0) ||
              (payload.integrityWarnings && payload.integrityWarnings.length > 0)) && (
              <div className="p-3.5 rounded-md bg-amber-50 border border-amber-300 text-amber-950 space-y-2">
                {payload.missingFieldsList && payload.missingFieldsList.length > 0 && (
                  <div>
                    <div className="font-bold text-amber-900 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                      <span>
                        Document Classification: Draft — Missing Required Source Fields (Never Fabricated):
                      </span>
                    </div>
                    <ul className="list-disc list-inside pl-4 mt-1 text-[11px] text-amber-900 space-y-0.5">
                      {payload.missingFieldsList.map((mf, i) => (
                        <li key={i}>{mf}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {payload.integrityWarnings && payload.integrityWarnings.length > 0 && (
                  <div>
                    <div className="font-bold text-rose-900">
                      Underlying Record Quantity Audit Note (Preserved Read-Only):
                    </div>
                    <ul className="list-disc list-inside pl-4 mt-1 text-[11px] text-rose-800 font-mono space-y-0.5">
                      {payload.integrityWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Metadata Grid */}
            {payload.metadataGrid.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded">
                {payload.metadataGrid.map((item, idx) => (
                  <div key={idx} className="border-b border-slate-200/70 pb-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 block font-semibold">
                      {item.label}
                    </span>
                    <span className="font-mono font-bold text-slate-900 break-words">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Tables */}
            {payload.tables.map((tbl, tIdx) => (
              <div key={tIdx} className="space-y-2">
                {tbl.sectionTitle && (
                  <h4 className="font-bold text-slate-900 text-xs">
                    {tbl.sectionTitle}
                  </h4>
                )}
                <div className="overflow-x-auto border border-slate-200 rounded">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#14283F] text-white text-[10px] uppercase font-semibold">
                      <tr>
                        {tbl.headers.map((h, hIdx) => (
                          <th key={hIdx} className="py-2 px-2.5 border-r border-slate-700 last:border-r-0">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-[11px]">
                      {tbl.rows.map((r, rIdx) => (
                        <tr key={rIdx} className="odd:bg-white even:bg-slate-50/70">
                          {r.map((cell, cIdx) => (
                            <td
                              key={cIdx}
                              className="py-2 px-2.5 border-r border-slate-200 last:border-r-0 font-mono text-slate-800 whitespace-pre-line"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {tbl.foot && tbl.foot.length > 0 && (
                      <tfoot className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300 text-[11px]">
                        {tbl.foot.map((fRow, fIdx) => (
                          <tr key={fIdx}>
                            {fRow.map((fCell, fcIdx) => (
                              <td key={fcIdx} className="py-2 px-2.5 font-mono">
                                {fCell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            ))}

            {/* Notes & Terms */}
            {payload.notesAndTerms && payload.notesAndTerms.length > 0 && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1 text-[11px] text-slate-700">
                <div className="font-bold text-slate-900">
                  Recorded Commercial Notes &amp; Conditions:
                </div>
                {payload.notesAndTerms.map((n, idx) => (
                  <div key={idx}>• {n}</div>
                ))}
              </div>
            )}

              {/* Footer */}
              <div className="pt-3 border-t-2 border-[#F28C28]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500">
                <div>{payload.footerDisclaimer}</div>
                <div className="font-mono">
                  Exported by: {payload.generatedBy} ({payload.generatedRole}) · Read-Only
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
