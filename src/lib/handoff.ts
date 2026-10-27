/**
 * One-shot hand-off between pages (e.g. an enquiry opening a pre-filled quotation).
 * Read once by the receiving page, then cleared, so a refresh never replays it.
 */
export type QuoteFromLead = { leadId: string; customerId: string; productHint: string };

let pendingQuote: QuoteFromLead | null = null;

export function handOffQuoteFromLead(v: QuoteFromLead) {
  pendingQuote = v;
}

export function takeQuoteFromLead(): QuoteFromLead | null {
  const v = pendingQuote;
  pendingQuote = null;
  return v;
}
