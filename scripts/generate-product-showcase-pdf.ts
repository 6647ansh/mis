import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightPath =
  '/root/.bun/install/cache/playwright-core@1.64.0-c17905f0d2f6a539@@@1/index.js';
const { chromium } = require(playwrightPath);

const EXECUTABLE_PATH =
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

const ROOT_DIR = process.cwd();
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'public/showcase-screenshots');
const LOGO_PATH = path.join(ROOT_DIR, 'public/assets/brand/montex-logo.png');
const PUBLIC_PDF_PATH = path.join(
  ROOT_DIR,
  'public/Montex_Forge_MIS_Product_Showcase_and_Roadmap.pdf'
);
const ROOT_PDF_PATH = path.join(ROOT_DIR, 'Montex_Forge_MIS_Product_Showcase_and_Roadmap.pdf');
const HTML_PREVIEW_PATH = path.join(
  ROOT_DIR,
  'public/Montex_Forge_MIS_Product_Showcase_and_Roadmap.html'
);

function toBase64DataUrl(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required asset file: ${filePath}`);
  }
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function getShot(filename: string): string {
  return toBase64DataUrl(path.join(SCREENSHOTS_DIR, filename));
}

type StatusBadgeType =
  | 'Verified'
  | 'Implemented'
  | 'Partially Implemented'
  | 'Requires Verification'
  | 'Planned';

function renderBadge(status: StatusBadgeType): string {
  const styles: Record<StatusBadgeType, string> = {
    Verified: 'background:#ECFDF5; color:#047857; border:1px solid #10B981;',
    Implemented: 'background:#EFF6FF; color:#1D4ED8; border:1px solid #60A5FA;',
    'Partially Implemented': 'background:#FEF3C7; color:#B45309; border:1px solid #F59E0B;',
    'Requires Verification': 'background:#FFF7ED; color:#C2410C; border:1px solid #FB923C;',
    Planned: 'background:#F1F5F9; color:#334155; border:1px solid #94A3B8;',
  };
  return `<span class="status-badge" style="${styles[status]}">${status}</span>`;
}

interface TourModuleCard {
  code: string;
  title: string;
  screenshotFile: string;
  caption: string;
  status: StatusBadgeType;
  purpose: string;
  whoUsesIt: string;
  keyInfo: string[];
  actionsAvailable: string[];
  businessBenefit: string;
}

function renderPageHeader(
  logoDataUrl: string,
  sectionNumber: string,
  sectionTitle: string,
  subtitle: string
): string {
  return `
    <header class="page-header">
      <div class="header-left">
        <div class="logo-box">
          <img src="${logoDataUrl}" alt="Montex Forge Official Logo" />
        </div>
        <div class="header-titles">
          <div class="header-kicker">MONTEX FORGE INDUSTRIES · ENTERPRISE MIS SHOWCASE &amp; ROADMAP</div>
          <div class="header-main">${sectionNumber} — ${sectionTitle}</div>
          <div class="header-sub">${subtitle}</div>
        </div>
      </div>
      <div class="header-right">
        <div class="doc-code">MF-MIS-SHOWCASE-2026</div>
        <div class="doc-date">Date: October 2026</div>
      </div>
    </header>
  `;
}

function renderPageFooter(pageNum: number, totalPages: number, sectionLabel: string): string {
  return `
    <footer class="page-footer">
      <div class="footer-left">
        <span class="footer-brand">MONTEX FORGE INDUSTRIES</span> · Product Showcase &amp; Digital Transformation Roadmap · ${sectionLabel}
      </div>
      <div class="footer-right">
        Page <strong>${pageNum}</strong> of <strong>${totalPages}</strong>
      </div>
    </footer>
  `;
}

function renderTourPage(
  logoDataUrl: string,
  pageNum: number,
  totalPages: number,
  pageHeading: string,
  pageSubheading: string,
  cards: [TourModuleCard, TourModuleCard]
): string {
  return `
    <section class="pdf-page" id="page-${pageNum}">
      ${renderPageHeader(logoDataUrl, 'SECTION 7', pageHeading, pageSubheading)}
      <div class="page-body tour-grid">
        ${cards
          .map(
            (c) => `
          <div class="tour-card">
            <div class="tour-card-header">
              <div>
                <span class="tour-code">${c.code}</span>
                <span class="tour-title">${c.title}</span>
              </div>
              ${renderBadge(c.status)}
            </div>
            <div class="tour-body-split">
              <div class="tour-shot-col">
                <div class="shot-frame">
                  <img src="${getShot(c.screenshotFile)}" alt="${c.title}" />
                </div>
                <div class="shot-caption">
                  <strong>Real Application Capture (1440×900):</strong> ${c.caption} <em>[Synthetic Preview Data]</em>
                </div>
              </div>
              <div class="tour-meta-col">
                <div class="meta-row">
                  <span class="meta-label">Page Purpose:</span> ${c.purpose}
                </div>
                <div class="meta-row">
                  <span class="meta-label">Primary Users:</span> <strong>${c.whoUsesIt}</strong>
                </div>
                <div class="meta-columns">
                  <div class="meta-box">
                    <div class="meta-box-title">Key Information Shown</div>
                    <ul>
                      ${c.keyInfo.map((i) => `<li>${i}</li>`).join('')}
                    </ul>
                  </div>
                  <div class="meta-box">
                    <div class="meta-box-title">Actions Available</div>
                    <ul>
                      ${c.actionsAvailable.map((a) => `<li>${a}</li>`).join('')}
                    </ul>
                  </div>
                </div>
                <div class="benefit-strip">
                  <strong>Business Value:</strong> ${c.businessBenefit}
                </div>
              </div>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
      ${renderPageFooter(pageNum, totalPages, 'Section 7 — Page-by-Page Product Tour')}
    </section>
  `;
}

async function main() {
  const logoDataUrl = toBase64DataUrl(LOGO_PATH);
  const TOTAL_PAGES = 22;

  const tourPagesData: {
    pageNum: number;
    heading: string;
    subheading: string;
    cards: [TourModuleCard, TourModuleCard];
  }[] = [
    {
      pageNum: 5,
      heading: 'Product Tour: CEO Command Center & Exception Queue',
      subheading:
        'Single-screen executive visibility into daily dispatches, order backlog, material shortages, quality holds, and receivables.',
      cards: [
        {
          code: '7.1A',
          title: 'CEO & Management Command Center — Executive KPIs',
          screenshotFile: '01_ceo_command_center.png',
          caption:
            'Top 8 live KPI cards with Today/Week/Month/MTD period toggles and KPI Reconciliation Audit.',
          status: 'Verified',
          purpose:
            'Give the Managing Director, CEO, and Plant Heads a 30-second health check of commercial and plant performance.',
          whoUsesIt: 'CEO / Managing Director, Super Admin, Department Heads',
          keyInfo: [
            'Today’s Dispatch value (Rs. Lakhs) and piece count against active customer POs.',
            'Open Orders value (Rs. Crores), active PO count, and undispatched piece balance.',
            'Critical Raw Material Shortages count and Quality/MTC Pending batch count.',
            'Sales vs. Monthly Target (%) and Customer Outstanding Receivables (Rs. Crores).',
          ],
          actionsAvailable: [
            'Switch reporting horizon between Today, Week, Month, and Month-to-Date (MTD).',
            'Toggle between Computed Live Records and Stored Snapshot with KPI Reconciliation Audit.',
            'Click any KPI card to drill directly into Dispatch, Sales Orders, Inventory, Quality, or Finance.',
            'Export the Executive Summary PDF Pack or multi-sheet CEO KPI Excel Workbook (.xlsx).',
          ],
          businessBenefit:
            'Eliminates morning status review delays by consolidating 6 departmental spreadsheets into one verified executive view.',
        },
        {
          code: '7.1B',
          title: 'Priority Exceptions, Action Queue & Shop-Floor Pulse',
          screenshotFile: '02_ceo_action_queue_and_shopfloor.png',
          caption:
            'Lower section of the CEO Command Center showing severity-ranked plant bottlenecks and latest dispatch confirmation.',
          status: 'Verified',
          purpose:
            'Highlight urgent plant bottlenecks (alloy steel shortages, overdue payments, TPI holds) requiring immediate action.',
          whoUsesIt: 'CEO, Plant Head, Stores, Quality, and Finance Heads',
          keyInfo: [
            'Severity-tagged exception queue (Critical / High / Medium) linked to specific Job Numbers.',
            'Departmental filter tabs (All, Critical, Stores/RM, Quality/TPI) with pending badge counts.',
            'Latest Executed Dispatch card showing Customer, Product, Shipped Qty/MT, and Invoice value.',
            'Shop-floor shift production summary (forged tonnage, furnace utilization, rejection rate).',
          ],
          actionsAvailable: [
            'Acknowledge resolved operational alerts with persistent Cloud Firestore tracking (/actionQueue).',
            'Click "Review" on any exception to jump directly to the blocked Order Lifecycle Journey.',
            'Filter action items by responsible department during daily plant coordination meetings.',
          ],
          businessBenefit:
            'Prevents delivery slippages by escalating raw material deficits and TPI holds before hammer/press schedules stall.',
        },
      ],
    },
    {
      pageNum: 6,
      heading: 'Product Tour: 7-Stage Order Lifecycle & Job Traceability',
      subheading:
        'End-to-end commercial and technical tracking from Customer Purchase Order to final GST Invoice.',
      cards: [
        {
          code: '7.2A',
          title: '7-Stage Order Lifecycle & Internal Job Tracker',
          screenshotFile: '03_order_lifecycle_tracker.png',
          caption:
            'Interactive 7-stage visual progress pipeline for BHEL/HYD/PO/2026/8891 (Job JOB-MF-2026-0412).',
          status: 'Verified',
          purpose:
            'Track the exact real-time stage of any customer PO across Sales, Stores, Forging, Quality, TPI, Dispatch, and Billing.',
          whoUsesIt: 'Sales, Production Planning, Quality, Dispatch, CEO',
          keyInfo: [
            '7-stage progress cards: Customer PO → Internal Job No. → Material Heat → Quality/MTC → TPI Clearance → Dispatch/LR → Invoice.',
            'Header summary of PO Number, Job Number, Order Value, Contractual Delivery Date, and Shipped vs. Pending Pcs.',
            'Itemized Ordered Forged Products table with material grade, unit rate, dispatched qty, and balance qty.',
          ],
          actionsAvailable: [
            'Select any active Customer Order from the top dropdown to inspect its 7-stage journey.',
            'Open the "Update Stage / TPI" modal to advance order stage and record TPI clearance reference.',
            'Generate and preview the PO Summary PDF, 7-Stage Progress PDF, or Draft MTC Summary PDF.',
          ],
          businessBenefit:
            'Allows Sales and Management to answer customer delivery inquiries in seconds without calling the shop floor.',
        },
        {
          code: '7.2B',
          title: 'Order Traceability Sub-Tabs: Material Heat, Quality & TPI',
          screenshotFile: '04_order_journey_quality_tab.png',
          caption:
            'Dedicated Quality & MTC (EN 10204) sub-tab inside the Order Lifecycle Tracker linking heat numbers to NDT results.',
          status: 'Implemented',
          purpose:
            'Maintain a single audit chain linking steel mill heat numbers, ultrasonic/MPI tests, TPI release notes, and lorry receipts.',
          whoUsesIt: 'Quality Assurance (NDT), TPI Coordinators, Sales, Customer Auditors',
          keyInfo: [
            '6 specialized drill-down tabs: Overview & Specs, Material & Heat, Quality & MTC, Customer Clearance (TPI), Dispatch & LR, Invoice.',
            'Inspection status, MTC reference number, hardness (HBW), ultrasonic testing status, and dimensional check status.',
            'Third-Party Inspection (TPI) agency details (e.g., Bureau Veritas, Lloyds, EIL) and release certificate date.',
          ],
          actionsAvailable: [
            'Switch across all 6 technical and commercial sub-tabs for the selected Job Number.',
            'Preview or download the Draft MTC Data Summary PDF with explicit readiness classification.',
            'Verify whether TPI clearance is approved before authorizing outward gate dispatch.',
          ],
          businessBenefit:
            'Eliminates dispatch of uncleared lots and keeps complete heat-to-invoice traceability ready for PSU/EPC audits.',
        },
      ],
    },
    {
      pageNum: 7,
      heading: 'Product Tour: Sales Orders Register & Customer Master',
      subheading:
        'Structured registration of Customer Purchase Orders, internal forging job numbers, and customer credit governance.',
      cards: [
        {
          code: '7.3A',
          title: 'Sales Orders & Internal Job Numbers Register',
          screenshotFile: '05_sales_orders_register.png',
          caption:
            'Central Sales Order register with quantity invariant checks, stage badges, and instant Excel/CSV/PDF exports.',
          status: 'Verified',
          purpose:
            'Manage all active, partially dispatched, and completed customer purchase orders with automated quantity validation.',
          whoUsesIt: 'Sales & Marketing, Production Planning, Finance, Management',
          keyInfo: [
            'Complete register of Order ID, Internal Job No., Customer PO No., Customer, Product, Grade, and PO Value.',
            'Live piece accounting: Ordered Pcs, Produced Pcs, QC Passed Pcs, Dispatched Pcs, and Pending Balance Pcs.',
            'Automated Quantity Invariant validation ensuring Dispatched Qty never exceeds QC-Passed or Ordered Qty.',
          ],
          actionsAvailable: [
            'Search orders by PO Number, Job Number, Customer Name, or Forged Product description.',
            'Filter by lifecycle stage (PO Registered, Material Allocated, In Production, QC/TPI, Partially Dispatched).',
            'Register a new Customer Purchase Order via modal form (persisted to Cloud Firestore /salesOrders).',
            'Export filtered orders to branded Excel (.xlsx), CSV, or Order Progress PDF.',
          ],
          businessBenefit:
            'Prevents over-dispatching, missed delivery dates, and manual numbering errors between Sales and Production.',
        },
        {
          code: '7.3B',
          title: 'Customer Master Directory & Credit Terms',
          screenshotFile: '09_customers_master.png',
          caption:
            'Master directory of PSU, EPC, and OEM customers (BHEL, IOCL, Thermax, L&T, Bharat Forge) with credit limits.',
          status: 'Verified',
          purpose:
            'Maintain standardized customer records, GST/location details, assigned sales officers, and approved credit terms.',
          whoUsesIt: 'Sales, Finance & Accounts, Super Admin',
          keyInfo: [
            'Customer Code, Company Name, Primary Plant Location, Industry Sector, and Key Contact details.',
            'Approved Credit Limit (Rs.) and contractual Payment Terms (e.g., 30 Days, 45 Days, 60 Days).',
            'Assigned Montex Sales Officer and active account status.',
          ],
          actionsAvailable: [
            'Search customers by company name, code, plant city, or contact person.',
            'Add new customer profiles or edit credit limits and contact details (persisted to /customers).',
            'Export the complete Customer & Product Master workbook (.xlsx) or CSV.',
          ],
          businessBenefit:
            'Ensures quotations, sales orders, and receivables ageing all reference a single authoritative customer record.',
        },
      ],
    },
    {
      pageNum: 8,
      heading: 'Product Tour: Commercial Quotations & PSU/EPC Tenders',
      subheading:
        'Persistent pre-sales pipeline for commercial RFQs, per-kg forging rate calculations, follow-up dates, and PSU tender bids.',
      cards: [
        {
          code: '7.4A',
          title: 'Commercial Quotations & Sales Follow-Up Register (/quotations)',
          screenshotFile: '07_quotations_register.png',
          caption:
            'Persistent Quotations register with automatic weight-to-piece pricing, margin estimation, and 1-click PO conversion.',
          status: 'Verified',
          purpose:
            'Log customer RFQs, compute per-piece forging prices from standard weight and per-kg rates, and track sales follow-ups.',
          whoUsesIt: 'Sales Team, Commercial Estimators, CEO',
          keyInfo: [
            'Quotation ID, RFQ Reference, Customer, Product, Material Grade, Unit Weight (kg), and Inquiry Qty (Pcs).',
            'Quoted Rate/kg (Rs.), computed Rate/Pc (Rs.), Total Quoted Value, Estimated Margin (%), and Lead Time (Weeks).',
            'Repeat-order indicator, Next Follow-Up Date, Follow-Up Notes, and Quote Status (Sent, Follow-Up, Won, Lost).',
          ],
          actionsAvailable: [
            'Create new Commercial Quotations with live per-kg to per-piece rate calculation (saved to /quotations).',
            'Update follow-up notes and status, or filter solely by pending customer follow-ups.',
            'Convert a "Won" Quotation directly into an active Sales Order (/salesOrders) with 1 click.',
            'Preview or download a branded Commercial Quotation PDF or export the register to Excel (.xlsx).',
          ],
          businessBenefit:
            'Stops RFQ leakage by keeping every quotation, margin calculation, and follow-up date permanently tracked.',
        },
        {
          code: '7.4B',
          title: 'PSU & EPC Tender Bid Pipeline (/tenders)',
          screenshotFile: '08_psu_tenders_pipeline.png',
          caption:
            'Dedicated PSU & EPC Tender register tracking EMD deposits, technical bid dates, and price bid openings.',
          status: 'Verified',
          purpose:
            'Track high-value government, PSU, and refinery tenders (NTPC, ONGC, IOCL, BHEL, EIL) from bid prep to award.',
          whoUsesIt: 'Tender Cell, Sales Head, Finance (for EMD tracking), CEO',
          keyInfo: [
            'Tender Number, Issuing Authority, Project Title, Item Summary, and Estimated Contract Value (Rs. Lakhs).',
            'Earnest Money Deposit (EMD) amount, Bid Submission Deadline, and Price Bid Opening Date.',
            'Current Tender Stage (Bid Preparation, Submitted, Technical Evaluation, Awarded, Lost).',
          ],
          actionsAvailable: [
            'Register new PSU/EPC tenders into the persistent Cloud Firestore /tenders collection.',
            'Generate printable Tender Summary Brief PDFs for management bid-review meetings.',
            'Export the complete Tender Pipeline to Excel (.xlsx) for EMD and bid-calendar tracking.',
          ],
          businessBenefit:
            'Provides clear visibility into upcoming tender submission deadlines and locked EMD capital across PSU bids.',
        },
      ],
    },
    {
      pageNum: 9,
      heading: 'Product Tour: Forged Product Specs & Raw Material Yard',
      subheading:
        'Standardized forging catalog weights and real-time billet/ingot yard balances with job reservation guards.',
      cards: [
        {
          code: '7.5A',
          title: 'Forged Products & Technical Specifications Catalog (/products)',
          screenshotFile: '10_products_specs_master.png',
          caption:
            'Master catalog of closed-die flanges, seamless rolled rings, gear blanks, and valve bodies.',
          status: 'Verified',
          purpose:
            'Define standard finished weights, cut-billet input weights, material grades, dimensional standards, and HSN codes.',
          whoUsesIt: 'Sales, Engineering, Production Planning, Quality',
          keyInfo: [
            'Product Code, Description, Forging Category (Flanges, Rolled Rings, Shafts, Gear Blanks, Valve Bodies).',
            'Material Grade (ASTM A105, A182 F11/F22/F316, 42CrMo4, EN24), Dimensional Standard (ASME B16.5 / B16.47).',
            'Finished Unit Weight (kg), Gross Input Billet Weight (kg), Forging Yield (%), Standard Rate, and HSN Code.',
          ],
          actionsAvailable: [
            'Search products by item code, flange rating, material grade, or HSN code.',
            'Add or update forged product specifications in Cloud Firestore (/products).',
            'Export the Product Technical Catalog to Excel (.xlsx) or CSV.',
          ],
          businessBenefit:
            'Standardizes input-to-output weight calculations across quotations, billet requisitions, and job costing.',
        },
        {
          code: '7.5B',
          title: 'Raw Material Billet Yard Balances & Reorder Alerts (/rawMaterials)',
          screenshotFile: '15_inventory_billet_yard.png',
          caption:
            'Real-time billet and bloom yard stock showing Physical MT, Reserved MT, Free Available MT, and Critical Shortages.',
          status: 'Verified',
          purpose:
            'Monitor alloy and carbon steel billet inventory by grade, section size, and yard bay while preventing stockouts.',
          whoUsesIt: 'Stores Superintendent, Purchase, Production Planning',
          keyInfo: [
            'Material Code, Grade, Billet Section (mm), Primary Steel Mill Supplier, and Storage Yard Bay.',
            'Physical Stock (MT), Reserved for Active Jobs (MT), and net Free Available Stock (MT).',
            'Minimum Safety Stock (MT), Reorder Level (MT), and automatic Critical / Low / Healthy status badges.',
          ],
          actionsAvailable: [
            'Search billet grades or filter to inspect Critical Shortage items blocking active jobs.',
            'Record new Stock Movements (GRN Receipt or Production Issue) with non-negative stock enforcement.',
            'Export the 2-sheet Raw Material & Stock Ledger Excel workbook (.xlsx) or CSV.',
          ],
          businessBenefit:
            'Separates physical stock from job-reserved stock so Sales and Production never double-allocate the same steel heat.',
        },
      ],
    },
    {
      pageNum: 10,
      heading: 'Product Tour: Stock Movement Ledger & Steel Mill POs',
      subheading:
        'Atomic inventory transactions and closed-loop steel procurement from Mill Purchase Order to Goods Receipt Note (GRN).',
      cards: [
        {
          code: '7.6A',
          title: 'Heat-Traceable Raw Material Stock Movement Ledger (/stockMovements)',
          screenshotFile: '16_inventory_stock_movements.png',
          caption:
            'Immutable ledger of every billet receipt (GRN) and shop-floor issue tagged with Steel Mill Heat Numbers.',
          status: 'Verified',
          purpose:
            'Maintain a complete, heat-number-traceable audit log of all inward steel receipts and outward forging issues.',
          whoUsesIt: 'Stores, Quality Assurance, Purchase, Internal Audit',
          keyInfo: [
            'Movement ID, Timestamp, Material Code & Grade, and authoritative Steel Mill Heat Number.',
            'Movement Type (Receipt GRN vs. Production Issue), Signed Delta Qty (MT), and Resulting Yard Balance (MT).',
            'Linked Reference Document (GRN No. or Internal Job No.) and operator name.',
          ],
          actionsAvailable: [
            'Log inward GRN receipts or outward production issues via atomic Firestore transaction.',
            'Generate printable GRN / Material Issue Voucher PDFs directly from any ledger row.',
            'Export the complete Stock Movement History to CSV or Excel (.xlsx).',
          ],
          businessBenefit:
            'Guarantees that yard stock balances and movement history never drift apart, preserving full heat traceability.',
        },
        {
          code: '7.6B',
          title: 'Steel Mill Purchase Orders & GRN Receipt Tracker (/purchaseOrders)',
          screenshotFile: '17_purchase_steel_mill_pos.png',
          caption:
            'Persistent Steel Mill PO register tracking ordered tonnage, received GRN tonnage, pending balance, and heat numbers.',
          status: 'Verified',
          purpose:
            'Issue purchase orders to approved steel mills and record partial or full GRN receipts directly into yard inventory.',
          whoUsesIt: 'Purchase Department, Stores (GRN Receipt), Finance, CEO',
          keyInfo: [
            'Mill PO Number, PO Date, Steel Mill Supplier, Material Grade, Section (mm), and Linked Job Number.',
            'Ordered Tonnage (MT), Received Tonnage (MT), Pending Balance (MT), Rate/MT, and Total PO Value (Rs.).',
            'Expected Delivery Date, Mill Heat Number, and PO Status (Issued, Partially Received, Completed).',
          ],
          actionsAvailable: [
            'Issue new Steel Mill Purchase Orders persisted to Cloud Firestore (/purchaseOrders).',
            'Click "Receive GRN" on any open PO to atomically update PO received tonnage, yard stock, and stock ledger.',
            'Switch to the Shortage Indents tab to see auto-calculated reorder quantities for critical grades.',
            'Preview/download branded Steel Mill PO PDFs or export the 3-sheet Procurement Excel Workbook.',
          ],
          businessBenefit:
            'Eliminates manual re-entry between Purchase and Stores by linking Mill PO receipts directly to yard inventory.',
        },
      ],
    },
    {
      pageNum: 11,
      heading: 'Product Tour: Approved Steel Suppliers & Shop Machine Logs',
      subheading:
        'Qualified steel mill directory and shift-wise hammer, press, and ring-rolling production tracking.',
      cards: [
        {
          code: '7.7A',
          title: 'Approved Steel Mill & Vendor Directory (/suppliers)',
          screenshotFile: '18_purchase_approved_suppliers.png',
          caption:
            'Directory of IBR, EIL, and PED certified primary steel mills (JSW, Kalyani Carpenter, SAIL, Tata Steel, Mukand).',
          status: 'Implemented',
          purpose:
            'Maintain a qualified vendor list with approved alloy/carbon steel grades, lead times, credit terms, and quality ratings.',
          whoUsesIt: 'Purchase, Quality Assurance, Management',
          keyInfo: [
            'Supplier Code, Mill Name, Plant Location, and Primary Contact details.',
            'Approved Steel Grades (ASTM A105, A182 F11/F22, 42CrMo4, SS 304/316L) and Statutory Certifications (IBR, PED, NABL).',
            'Standard Delivery Lead Time (Days), Credit Terms (Days), and Historical Quality Rating (%).',
          ],
          actionsAvailable: [
            'Inspect approved grades and statutory certifications before placing a steel mill PO.',
            'Export the Approved Steel Mill Supplier Directory to Excel (.xlsx).',
          ],
          businessBenefit:
            'Prevents procurement of uncertified raw material heats for regulated PSU and refinery orders.',
        },
        {
          code: '7.7B',
          title: 'Shop-Floor Shift & Hammer/Press Production Logs (/machineLogs)',
          screenshotFile: '11_production_machine_logs.png',
          caption:
            'Persistent shift register for pneumatic hammers, friction screw presses, and CNC ring-rolling mills.',
          status: 'Verified',
          purpose:
            'Capture shift-wise billet input, forged output, OK pieces, scrap rejections, rework, downtime, and press utilization.',
          whoUsesIt: 'Shop-Floor Supervisors, Production Manager, Plant Head',
          keyInfo: [
            'Shift summary cards (Shift A, Shift B, Shift C) showing total forged tonnage (MT) and shift yield (%).',
            'Machine-wise log: Date, Shift, Asset ID/Name, Forging Operator, Linked Job No., and Product Name.',
            'Input Billets (Pcs), Forged Output (Pcs), OK Pcs, Rejected Pcs, Rework Pcs, Downtime (Min), and Utilization (%).',
          ],
          actionsAvailable: [
            'Log new Shift Machine Output entries via validated modal form (persisted to /machineLogs).',
            'Export the 4-sheet Shop-Floor Operations Excel Workbook (.xlsx) or Printable Production PDF.',
          ],
          businessBenefit:
            'Replaces paper shift diaries with structured digital records, exposing press bottlenecks and shift rejection spikes.',
        },
      ],
    },
    {
      pageNum: 12,
      heading: 'Product Tour: Furnace Batch Logs & Maintenance Tickets',
      subheading:
        'Persistent thermal traceability for reheating/heat-treatment furnaces and breakdown/preventive maintenance tracking.',
      cards: [
        {
          code: '7.8A',
          title: 'Reheating & Heat-Treatment Furnace Batch Logs (/furnaceLogs)',
          screenshotFile: '12_production_furnace_logs.png',
          caption:
            'Persistent furnace register tracking charge weight, target vs. peak temperature (°C), soaking time, and PNG/LDO fuel use.',
          status: 'Verified',
          purpose:
            'Record thermal cycle parameters and specific fuel consumption per MT for every forging and normalizing/quenching batch.',
          whoUsesIt: 'Furnace Operators, Metallurgists, Quality Assurance, Plant Head',
          keyInfo: [
            'Batch Number, Date, Shift, Furnace Asset Name, Fuel Type (PNG Natural Gas / LDO / Electric), and Linked Job & Heat No.',
            'Charge Weight (MT), Target Temp (°C), Peak Recorded Temp (°C), and Soaking Duration (Minutes).',
            'Total Fuel Consumed (SCM / Liters / kWh), Specific Fuel per MT, and automatic Over-Temp Deviation flags.',
          ],
          actionsAvailable: [
            'Log new Furnace Charge & Soaking Batches into Cloud Firestore (/furnaceLogs).',
            'Automatically flag batches exceeding the company furnace temperature threshold (e.g., >1240°C).',
            'Include all furnace thermal batches in the multi-sheet Shop-Floor Excel Workbook export.',
          ],
          businessBenefit:
            'Controls fuel cost per ton of steel forged and provides metallurgical soaking proof for EN 10204 3.1 certificates.',
        },
        {
          code: '7.8B',
          title: 'Machine Breakdown & Preventive Maintenance Tickets (/maintenanceTickets)',
          screenshotFile: '13_production_maintenance_tickets.png',
          caption:
            'Persistent maintenance register logging hammer/press breakdowns, root causes, spares replaced, downtime, and repair cost.',
          status: 'Verified',
          purpose:
            'Track unplanned equipment breakdowns and preventive maintenance jobs across hammers, ring mills, saws, and furnaces.',
          whoUsesIt: 'Maintenance Engineers, Shop-Floor Supervisors, Plant Head',
          keyInfo: [
            'Ticket ID, Date, Machine ID & Asset Name, and Maintenance Type (Breakdown, Preventive, Die Changeover).',
            'Issue Description, Engineering Root Cause, and Replacement Spare Parts used.',
            'Downtime Duration (Minutes), Maintenance Cost (Rs.), Assigned Technician, and Ticket Status (Open, In Progress, Resolved).',
          ],
          actionsAvailable: [
            'Log new Maintenance & Downtime Tickets into Cloud Firestore (/maintenanceTickets).',
            'Identify recurring mechanical/hydraulic failure causes and high-downtime forging assets.',
          ],
          businessBenefit:
            'Reduces unplanned hammer and ring-mill downtime by creating a permanent maintenance and spares history per asset.',
        },
      ],
    },
    {
      pageNum: 13,
      heading: 'Product Tour: Plant Power Logs & Quality Lot Inspections',
      subheading:
        'Specific electricity consumption (kWh/MT) monitoring and non-destructive testing (NDT) lot clearance.',
      cards: [
        {
          code: '7.9A',
          title: 'Electricity & Specific Power Consumption Register (/powerLogs)',
          screenshotFile: '14_production_power_logs.png',
          caption:
            'Daily HT electricity register tracking kWh, kVAh, Power Factor, Peak Demand (kVA), and Specific Energy (kWh/MT).',
          status: 'Verified',
          purpose:
            'Monitor daily plant electricity consumption against forged output tonnage to control energy cost per MT and maintain unity power factor.',
          whoUsesIt: 'Electrical Maintenance, Plant Head, Finance/Costing, CEO',
          keyInfo: [
            'Meter Log Date, Daily Total kWh, Apparent Energy kVAh, and computed Power Factor (PF).',
            'Peak Demand Recorded (kVA vs. Sanctioned Load), Daily Forged Output (MT), and Specific Power (kWh/MT).',
            'Daily Energy Cost (Rs.) and automatic alert badge when kWh/MT exceeds threshold (e.g., >480 kWh/MT).',
          ],
          actionsAvailable: [
            'Record daily HT meter readings into Cloud Firestore (/powerLogs) with auto-computed PF and kWh/MT.',
            'Export daily power and specific energy logs to Excel (.xlsx) for monthly MSEB/utility bill reconciliation.',
          ],
          businessBenefit:
            'Prevents power-factor penalties and highlights idle furnace/compressor energy waste on low-tonnage shifts.',
        },
        {
          code: '7.9B',
          title: 'Quality Lot Inspections, NDT & MTC Register (/qualityInspections)',
          screenshotFile: '19_quality_lot_inspections.png',
          caption:
            'Quality Assurance register with enforced quantity invariants (Passed + Rejected <= Inspected) and MTC references.',
          status: 'Verified',
          purpose:
            'Record lot-wise Ultrasonic (UT), Magnetic Particle (MPI), Hardness, and visual inspection outcomes and issue MTC references.',
          whoUsesIt: 'Quality Assurance Engineers (NDT Level II/III), Sales, Dispatch',
          keyInfo: [
            'Top KPI strip: Total Inspected Pcs, Passed Pcs, Rejected Pcs, and overall Plant First-Pass Yield (%).',
            'Inspection ID, Date, Job Number, Customer, Product, Grade, and linked Steel Mill Heat Number.',
            'Inspected Qty, Passed Qty, Rejected Qty, Quantity Invariant Status, NDT Inspector, MTC Reference, and Lot Status.',
          ],
          actionsAvailable: [
            'Log new Quality Lot Inspections into Cloud Firestore (/qualityInspections) with strict quantity validation.',
            'Preview/download Quality Inspection Lot PDFs and Draft EN 10204 3.1 MTC Summary PDFs.',
            'Export the 2-sheet Quality & Dimensional Excel Workbook (.xlsx) or CSV.',
          ],
          businessBenefit:
            'Enforces a hard quality gate so only inspected, passed, and MTC-referenced lots advance to outward dispatch.',
        },
      ],
    },
    {
      pageNum: 14,
      heading: 'Product Tour: Dimensional/TPI Reports & Outward Dispatch',
      subheading:
        'Drawing-level dimensional verification, Third-Party Inspection (TPI) witnessing, and outward vehicle/LR gate control.',
      cards: [
        {
          code: '7.10A',
          title: 'Dimensional Inspection Reports (DIR) & TPI Witnessing (/dimensionalReports)',
          screenshotFile: '20_quality_dimensional_tpi.png',
          caption:
            'Persistent Dimensional Inspection Report register storing nominal vs. measured OD, Bore, PCD, and TPI witness status.',
          status: 'Verified',
          purpose:
            'Document drawing-specific dimensional measurements (OD, ID/Bore, Thickness, PCD, Bolt Holes) and TPI agency sign-off.',
          whoUsesIt: 'QC Inspectors, TPI Engineers (Lloyds, Bureau Veritas, TUV, EIL), Sales',
          keyInfo: [
            'DIR ID, Inspection Date, Linked Job No., Customer, Product, Engineering Drawing No., and Sample Size.',
            'Parameter tolerance table: Characteristic (OD, Bore, PCD), Nominal mm, Tolerance, Measured Range, and OK/Out-of-Spec badge.',
            'Assigned TPI Agency and Offering Status (Internal Cleared, Offered to TPI, Witnessed & Cleared, Hold).',
          ],
          actionsAvailable: [
            'Create new Dimensional Inspection Reports persisted to Cloud Firestore (/dimensionalReports).',
            'Preview and download formatted Dimensional Inspection Report (DIR) PDFs for customer submission.',
          ],
          businessBenefit:
            'Digitizes caliper/CMM inspection sheets so TPI release documentation is permanently linked to the job number.',
        },
        {
          code: '7.10B',
          title: 'Outward Dispatch, Gate Pass & Lorry Receipt Register (/dispatches)',
          screenshotFile: '21_dispatch_logistics_register.png',
          caption:
            'Outward logistics register tracking shipped quantities, PO balances, consignment tonnage, transporters, and LR numbers.',
          status: 'Verified',
          purpose:
            'Record outward factory dispatches, update remaining customer PO balances atomically, and generate Delivery Challans.',
          whoUsesIt: 'Dispatch & Logistics Officer, Security Gate, Sales, Finance (Billing)',
          keyInfo: [
            'Dispatch ID, Date, Customer PO No., Internal Job No., Customer Name, and Forged Product.',
            'Shipped Consignment Qty (Pcs), Remaining PO Balance (Pcs), and Consignment Weight (MT).',
            'Transporter Name, Vehicle Registration No., Lorry Receipt (LR) No., Invoice Ref, and Transit Status.',
          ],
          actionsAvailable: [
            'Record new Outward Dispatches (atomically updating /dispatches and the parent /salesOrders balance).',
            'Preview and download branded Outward Delivery Challan / Gate Pass PDFs.',
            'Export the complete Dispatch & LR Register to Excel (.xlsx) or CSV.',
          ],
          businessBenefit:
            'Prevents over-shipment beyond ordered quantities and gives Finance immediate proof of dispatch for GST invoicing.',
        },
      ],
    },
    {
      pageNum: 15,
      heading: 'Product Tour: Finance, Job Costing & Tally Reconciliation',
      subheading:
        'Receivables ageing buckets (0–90+ days), 8-head order profitability costing, and Tally Prime CSV ledger reconciliation.',
      cards: [
        {
          code: '7.11A',
          title: 'Receivables 0–90+ Day Ageing & Payment Collection (/outstandingAgeing)',
          screenshotFile: '22_finance_receivables_ageing.png',
          caption:
            'Customer-wise receivables schedule with 0–30, 31–60, 61–90, and 90+ day critical buckets and credit-limit alerts.',
          status: 'Verified',
          purpose:
            'Monitor customer payment exposure across ageing buckets, enforce credit limits, and record incoming RTGS/NEFT collections.',
          whoUsesIt: 'Finance & Accounts, Sales Head, CEO / Managing Director',
          keyInfo: [
            'Customer Name, Approved Credit Limit (Rs.), Total Outstanding (Rs.), and Credit-Limit Exceeded warnings.',
            'Bucketed breakdown: 0–30 Days (Current), 31–60 Days, 61–90 Days, and 90+ Days (Critical Overdue).',
            'Session Payment Receipts register with UTR reference numbers and downloadable Payment Receipt Vouchers.',
          ],
          actionsAvailable: [
            'Click "Record Payment" on any customer row to apply incoming collections (FIFO across oldest ageing buckets).',
            'Preview/download official Payment Receipt Voucher PDFs, Tax Invoice Draft PDFs, and Supplier PO Summaries.',
            'Export the complete Receivables Ageing Schedule to Excel (.xlsx).',
          ],
          businessBenefit:
            'Accelerates working-capital recovery by giving Finance and Sales a shared, real-time view of overdue 60+ and 90+ day accounts.',
        },
        {
          code: '7.11B',
          title: '8-Head Order Job Costing & Tally CSV Reconciliation (/jobCostSheets)',
          screenshotFile: '23_finance_job_costing.png',
          caption:
            'Granular 8-head job costing sheet computing net margin per order alongside Tally Prime CSV import reconciliation.',
          status: 'Implemented',
          purpose:
            'Compare actual per-job manufacturing costs against invoiced revenue and reconcile MIS billing with Tally Prime exports.',
          whoUsesIt: 'Cost Accountant, Finance Head, CEO',
          keyInfo: [
            '8 cost heads per Job: Raw Material, Scrap Credit (-), Forging Labour, Electricity, Furnace Fuel, Machining, Testing/TPI, Freight & Overheads.',
            'Computed Total Job Cost (Rs.), Cost per Kg, Cost per Piece, Gross Margin (Rs.), and Net Margin (%).',
            'Dedicated Tally CSV/XLSX Reconciliation tab (Screenshot 24) to match MIS invoices against Tally voucher exports.',
          ],
          actionsAvailable: [
            'Select any Job Number to inspect its 8-head cost breakdown or download a Job Cost Sheet PDF.',
            'Upload/reconcile Tally Prime sales ledger CSV exports in the Tally Reconciliation tab.',
            'Export the All-Orders Costing & Margin Summary to Excel (.xlsx).',
          ],
          businessBenefit:
            'Reveals true per-order profitability after accounting for die setup, furnace fuel, power, scrap recovery, and TPI fees.',
        },
      ],
    },
    {
      pageNum: 16,
      heading: 'Product Tour: Reports Hub, Document Catalog & Alerts',
      subheading:
        'Centralized PDF/Excel/CSV reporting center, 19-document readiness classification, and configurable plant alert rules.',
      cards: [
        {
          code: '7.12A',
          title: 'Enterprise Reports & 19-Document Readiness Hub (/reports)',
          screenshotFile: '25_reports_exports_hub.png',
          caption:
            'Central Reports & Exports Center offering 8 structured MIS reports and an authoritative 19-Document Readiness Matrix.',
          status: 'Verified',
          purpose:
            'Provide one-click generation of standardized management reports and transparent readiness classification for all 19 plant documents.',
          whoUsesIt: 'All Authorized Roles (Role-Checked Export Permissions), CEO, Auditors',
          keyInfo: [
            '8 interactive report views: Daily Dispatch, Shop-Floor Production, Receivables Ageing, Quality/Rejection, Stock Ledger, Job Costing, Requirements Register, and Document Readiness Catalog.',
            'Authoritative classification of all 19 MIS documents into "Ready Now" vs. "Draft Summary — Missing Statutory/Lab Fields".',
          ],
          actionsAvailable: [
            'Switch across all 8 report categories with live data previews and summary totals.',
            'Export multi-sheet branded Excel workbooks (.xlsx), CSV data files, or formatted PDF packs.',
          ],
          businessBenefit:
            'Standardizes management reporting while preventing incomplete draft documents from being mistaken for statutory certificates.',
        },
        {
          code: '7.12B',
          title: 'Operational Alerts Queue & Threshold Rules (/actionQueue & /alertThresholds)',
          screenshotFile: '28_alerts_threshold_rules.png',
          caption:
            'Company-wide Alert Threshold Configuration panel alongside the active Operational Exception Queue.',
          status: 'Verified',
          purpose:
            'Configure plant-wide warning thresholds and manage open operational exceptions across Stores, Quality, Production, and Finance.',
          whoUsesIt: 'Super Admin (Threshold Config), All Department Heads (Alert Acknowledgement)',
          keyInfo: [
            'Configurable numeric thresholds: Max Furnace Temp (°C), Max Rejection Rate (%), Overdue Payment Days, Machine Downtime (Min), and Power (kWh/MT).',
            'Active Alerts & Action Queue tab (Screenshot 27) with severity filters and automated quantity-invariant advisories.',
          ],
          actionsAvailable: [
            'Adjust and save company alert thresholds directly to Cloud Firestore (/alertThresholds).',
            'Acknowledge open operational alerts or drill down to the affected order/module.',
          ],
          businessBenefit:
            'Gives management control over plant tolerance limits without requiring code changes.',
        },
      ],
    },
    {
      pageNum: 17,
      heading: 'Product Tour: Users, 8-Role RBAC, Audit Trail & Architecture',
      subheading:
        'Zero-trust employee account provisioning, 8 canonical roles, immutable security audit logs, and database diagnostics.',
      cards: [
        {
          code: '7.13A',
          title: 'Employee Directory & 8-Role RBAC Matrix (/users)',
          screenshotFile: '29_admin_users_rbac_matrix.png',
          caption:
            'Admin governance console showing active employee profiles, canonical role assignment, password reset, and RBAC matrix.',
          status: 'Verified',
          purpose:
            'Provision employee accounts securely, assign canonical roles, deactivate departing staff, and enforce module-level permissions.',
          whoUsesIt: 'Super Administrator (Full Control), CEO / Management (Read-Only Directory)',
          keyInfo: [
            'Employee profile cards showing Name, Email, Department, Designation, Canonical Role, and Active/Deactivated status.',
            '8 Canonical Roles: super_admin, ceo, sales, stores, purchase, quality, dispatch, and finance.',
            'Built-in Self-Lockout Guard and Last-Super-Admin Guard preventing accidental administrative lockout.',
          ],
          actionsAvailable: [
            'Provision new employee accounts via server-side Firebase Admin SDK (/api/admin/employees).',
            'Update an employee’s canonical role, toggle active/deactivated status, or trigger a safe password-reset flow.',
            'Export the Employee Directory, RBAC Matrix, and Security Audit Governance Pack to Excel (.xlsx).',
          ],
          businessBenefit:
            'Ensures employees only view or modify data belonging to their department, eliminating unauthorized edits.',
        },
        {
          code: '7.13B',
          title: 'Immutable Security Audit Trail & Cloud Architecture (/auditLogs)',
          screenshotFile: '30_admin_security_audit_logs.png',
          caption:
            'Append-only Security Audit Trail recording actor UID, target collection, action type, timestamp, and outcome.',
          status: 'Verified',
          purpose:
            'Maintain a tamper-resistant record of sensitive administrative and operational actions alongside live Firestore diagnostics.',
          whoUsesIt: 'Super Administrator, CEO, Internal / Statutory Auditors',
          keyInfo: [
            'Chronological audit entries: Audit ID, Timestamp, Actor Name/UID, Target Collection & Document ID, Action, and Summary.',
            'Strict secret redaction ensuring passwords, tokens, and private keys are never written to audit logs.',
            'System Diagnostics & Architecture tab (Screenshot 31) displaying Firestore collection health and security rules.',
          ],
          actionsAvailable: [
            'Inspect and filter security audit logs or export them to CSV for compliance reviews.',
            'Open the Firebase Auth & Diagnostics Modal to verify live database connectivity and rules.',
          ],
          businessBenefit:
            'Provides complete accountability for role changes, account deactivations, stock adjustments, and order updates.',
        },
      ],
    },
  ];

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>MONtex Forge Industries — MIS Dashboard | Product Showcase & Digital Transformation Roadmap</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Liberation Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1C2736;
      background: #E2E8F0;
      font-size: 9pt;
      line-height: 1.38;
    }
    a {
      color: inherit;
      text-decoration: none;
    }
    .pdf-page {
      width: 210mm;
      height: 297mm;
      background: #FFFFFF;
      position: relative;
      page-break-after: always;
      break-after: page;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 10mm 12mm 9mm 12mm;
    }
    .pdf-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }

    /* COVER PAGE */
    .cover-page {
      background: linear-gradient(160deg, #0D1B2A 0%, #14283F 58%, #1D3557 100%);
      color: #FFFFFF;
      padding: 14mm 15mm 12mm 15mm;
    }
    .cover-top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #F28C28;
      padding-bottom: 5mm;
    }
    .cover-logo-card {
      background: #FFFFFF;
      padding: 3mm 5mm;
      border-radius: 3mm;
      display: inline-flex;
      align-items: center;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
    }
    .cover-logo-card img {
      height: 15mm;
      width: auto;
      object-fit: contain;
    }
    .cover-doc-badge {
      text-align: right;
      font-size: 8.5pt;
      color: #CBD5E1;
    }
    .cover-doc-badge strong {
      display: block;
      color: #F28C28;
      font-size: 9.5pt;
      letter-spacing: 0.5px;
    }
    .cover-hero {
      margin-top: 7mm;
      margin-bottom: 6mm;
    }
    .cover-pill {
      display: inline-block;
      background: rgba(242, 140, 40, 0.18);
      border: 1px solid #F28C28;
      color: #FDBA74;
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      padding: 1.5mm 3.5mm;
      border-radius: 1.5mm;
      margin-bottom: 3.5mm;
    }
    .cover-title {
      font-size: 23pt;
      font-weight: 800;
      line-height: 1.15;
      color: #FFFFFF;
      letter-spacing: -0.3px;
    }
    .cover-subtitle {
      font-size: 13.5pt;
      font-weight: 600;
      color: #F28C28;
      margin-top: 2mm;
    }
    .cover-tagline {
      font-size: 10.5pt;
      font-weight: 600;
      color: #E2E8F0;
      margin-top: 2.5mm;
      padding-left: 3mm;
      border-left: 3px solid #F28C28;
    }
    .cover-preview-showcase {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 3mm;
      padding: 3.5mm;
      margin-bottom: 5mm;
    }
    .cover-preview-frame {
      border-radius: 2mm;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.25);
      height: 76mm;
      background: #0F172A;
    }
    .cover-preview-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top center;
    }
    .cover-preview-caption {
      font-size: 7.5pt;
      color: #CBD5E1;
      margin-top: 2mm;
      display: flex;
      justify-content: space-between;
    }
    .cover-kpi-strip {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 3.5mm;
      margin-bottom: 5mm;
    }
    .cover-kpi-box {
      background: rgba(15, 31, 50, 0.85);
      border: 1px solid rgba(242, 140, 40, 0.4);
      border-radius: 2.5mm;
      padding: 3mm 3.5mm;
    }
    .cover-kpi-num {
      font-size: 14pt;
      font-weight: 800;
      color: #F28C28;
    }
    .cover-kpi-label {
      font-size: 7.8pt;
      font-weight: 700;
      color: #FFFFFF;
      margin-top: 0.8mm;
    }
    .cover-kpi-sub {
      font-size: 7pt;
      color: #94A3B8;
      margin-top: 0.5mm;
    }
    .cover-meta-grid {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 2.5mm;
      padding: 3.5mm 4.5mm;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2.5mm 6mm;
      font-size: 8pt;
    }
    .cover-meta-item span {
      color: #94A3B8;
      display: inline-block;
      width: 38mm;
    }
    .cover-meta-item strong {
      color: #F8FAFC;
    }
    .cover-disclaimer {
      font-size: 7.2pt;
      color: #94A3B8;
      border-top: 1px solid rgba(255,255,255,0.15);
      padding-top: 2.5mm;
      display: flex;
      justify-content: space-between;
    }

    /* STANDARD PAGE HEADER & FOOTER */
    .page-header {
      background: #14283F;
      color: #FFFFFF;
      padding: 2.8mm 4mm;
      border-radius: 2mm;
      border-bottom: 2.5px solid #F28C28;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 3.5mm;
      flex-shrink: 0;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 3.5mm;
    }
    .logo-box {
      background: #FFFFFF;
      border-radius: 1.5mm;
      padding: 1mm 2mm;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 10.5mm;
      width: 20mm;
      flex-shrink: 0;
    }
    .logo-box img {
      max-height: 8.5mm;
      max-width: 17mm;
      object-fit: contain;
    }
    .header-kicker {
      font-size: 6.5pt;
      font-weight: 700;
      color: #FDBA74;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }
    .header-main {
      font-size: 10.5pt;
      font-weight: 800;
      color: #FFFFFF;
      line-height: 1.2;
    }
    .header-sub {
      font-size: 7.3pt;
      color: #CBD5E1;
    }
    .header-right {
      text-align: right;
      font-size: 7pt;
      color: #CBD5E1;
      flex-shrink: 0;
    }
    .header-right .doc-code {
      font-weight: 700;
      color: #F28C28;
      font-size: 7.5pt;
    }
    .page-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2.2mm;
      overflow: hidden;
    }
    .page-footer {
      border-top: 1px solid #CBD5E1;
      padding-top: 1.5mm;
      margin-top: 1.5mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 6.9pt;
      color: #64748B;
      flex-shrink: 0;
    }
    .footer-brand {
      font-weight: 700;
      color: #14283F;
    }

    /* COMMON COMPONENTS */
    .status-badge {
      display: inline-block;
      padding: 0.5mm 2mm;
      border-radius: 1mm;
      font-size: 6.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      white-space: nowrap;
    }
    .section-block {
      background: #FFFFFF;
      border: 1px solid #DCE3EC;
      border-radius: 2mm;
      padding: 2.3mm 3mm;
    }
    .section-block-slate {
      background: #F8FAFC;
      border: 1px solid #DCE3EC;
      border-radius: 2mm;
      padding: 2.2mm 3mm;
    }
    .block-title {
      font-size: 8.9pt;
      font-weight: 800;
      color: #14283F;
      border-left: 3px solid #F28C28;
      padding-left: 2mm;
      margin-bottom: 1.5mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2.4mm;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2.2mm;
    }
    .grid-4 {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2mm;
    }
    ul.compact-list {
      padding-left: 3.5mm;
      font-size: 7.3pt;
      line-height: 1.32;
      color: #334155;
    }
    ul.compact-list li {
      margin-bottom: 0.7mm;
    }
    ul.compact-list li strong {
      color: #0F172A;
    }

    /* TABLES */
    table.corp-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7pt;
      line-height: 1.28;
    }
    table.corp-table th {
      background: #14283F;
      color: #FFFFFF;
      font-weight: 700;
      text-align: left;
      padding: 1.3mm 2mm;
      border: 1px solid #14283F;
      font-size: 6.8pt;
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }
    table.corp-table td {
      padding: 1.15mm 2mm;
      border: 1px solid #DCE3EC;
      vertical-align: top;
      color: #1E293B;
    }
    table.corp-table tr:nth-child(even) td {
      background: #F8FAFC;
    }

    /* TOUR CARDS (PAGES 5-17) */
    .tour-grid {
      display: flex;
      flex-direction: column;
      gap: 2.8mm;
      justify-content: space-between;
    }
    .tour-card {
      border: 1px solid #CBD5E1;
      border-radius: 2.2mm;
      background: #FFFFFF;
      padding: 2.4mm 3mm;
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .tour-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #E2E8F0;
      padding-bottom: 1.3mm;
      margin-bottom: 1.8mm;
    }
    .tour-code {
      background: #14283F;
      color: #F28C28;
      font-weight: 800;
      font-size: 7.2pt;
      padding: 0.5mm 1.8mm;
      border-radius: 1mm;
      margin-right: 2mm;
    }
    .tour-title {
      font-size: 9.2pt;
      font-weight: 800;
      color: #14283F;
    }
    .tour-body-split {
      display: grid;
      grid-template-columns: 48% 52%;
      gap: 3mm;
      align-items: stretch;
      flex: 1;
    }
    .tour-shot-col {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .shot-frame {
      border: 1px solid #94A3B8;
      border-radius: 1.5mm;
      overflow: hidden;
      background: #0F1F32;
      height: 55.5mm;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .shot-frame img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      object-position: center;
    }
    .shot-caption {
      font-size: 6.6pt;
      color: #475569;
      background: #F1F5F9;
      padding: 1mm 1.8mm;
      border-radius: 1mm;
      margin-top: 1mm;
      border-left: 2px solid #F28C28;
    }
    .tour-meta-col {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding-right: 0.5mm;
    }
    .meta-row {
      font-size: 7.3pt;
      color: #334155;
      margin-bottom: 0.8mm;
    }
    .meta-label {
      font-weight: 700;
      color: #14283F;
    }
    .meta-columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2mm;
      margin: 0.8mm 0;
    }
    .meta-box {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 1.5mm;
      padding: 1.5mm 1.8mm;
    }
    .meta-box-title {
      font-size: 6.8pt;
      font-weight: 800;
      color: #234765;
      text-transform: uppercase;
      margin-bottom: 0.8mm;
      border-bottom: 1px solid #E2E8F0;
      padding-bottom: 0.5mm;
    }
    .meta-box ul {
      padding-left: 3mm;
      font-size: 6.8pt;
      color: #334155;
      line-height: 1.28;
    }
    .meta-box ul li {
      margin-bottom: 0.6mm;
    }
    .benefit-strip {
      background: #FFFBEB;
      border: 1px solid #FDE68A;
      border-left: 3px solid #F28C28;
      padding: 1.3mm 1.8mm;
      border-radius: 1.2mm;
      font-size: 7pt;
      color: #78350F;
    }

    /* TOC STYLING */
    .toc-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.4mm 4mm;
    }
    .toc-item {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px dashed #CBD5E1;
      padding: 0.75mm 0;
      font-size: 7.4pt;
    }
    .toc-item-sec {
      font-weight: 800;
      color: #14283F;
      margin-right: 1.5mm;
    }
    .toc-page-num {
      font-weight: 800;
      color: #F28C28;
      background: #14283F;
      padding: 0.3mm 1.6mm;
      border-radius: 0.8mm;
      font-size: 7pt;
      flex-shrink: 0;
    }

    /* ARCHITECTURE & WORKFLOW DIAGRAMS */
    .arch-layer {
      border: 1px solid #CBD5E1;
      border-left: 4px solid #14283F;
      border-radius: 1.8mm;
      padding: 2mm 3mm;
      background: #F8FAFC;
      margin-bottom: 1.8mm;
    }
    .arch-layer-title {
      font-size: 8pt;
      font-weight: 800;
      color: #14283F;
      display: flex;
      justify-content: space-between;
      margin-bottom: 1mm;
    }
    .arch-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5mm;
    }
    .arch-chip {
      background: #FFFFFF;
      border: 1px solid #CBD5E1;
      border-radius: 1mm;
      padding: 0.7mm 2mm;
      font-size: 7pt;
      font-weight: 600;
      color: #1E293B;
    }
    .workflow-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2.2mm;
    }
    .wf-step {
      border: 1px solid #CBD5E1;
      border-top: 3px solid #F28C28;
      border-radius: 1.8mm;
      padding: 2mm 2.5mm;
      background: #FFFFFF;
    }
    .wf-step-num {
      font-size: 7pt;
      font-weight: 800;
      color: #F28C28;
      text-transform: uppercase;
    }
    .wf-step-title {
      font-size: 8pt;
      font-weight: 800;
      color: #14283F;
      margin: 0.5mm 0 1mm 0;
    }
    .wf-step-desc {
      font-size: 6.9pt;
      color: #475569;
    }
  </style>
</head>
<body>

  <!-- ==================== PAGE 1: COVER PAGE (SECTION 1) ==================== -->
  <section class="pdf-page cover-page" id="page-1">
    <div>
      <div class="cover-top-bar">
        <div class="cover-logo-card">
          <img src="${logoDataUrl}" alt="Montex Forge Official Logo" />
        </div>
        <div class="cover-doc-badge">
          <strong>EXECUTIVE PRODUCT SHOWCASE &amp; DIGITAL ROADMAP</strong>
          Document Ref: MF-MIS-SHOWCASE-2026-V1 · Date: October 2026<br/>
          Works: Chakan MIDC Industrial Area (Plant I &amp; II), Pune, Maharashtra
        </div>
      </div>

      <div class="cover-hero">
        <div class="cover-pill">Enterprise Management Information System (MIS)</div>
        <h1 class="cover-title">MONtex Forge Industries — MIS Dashboard</h1>
        <div class="cover-subtitle">Product Showcase &amp; Digital Transformation Roadmap</div>
        <div class="cover-tagline">One Platform. Connected Operations. Better Decisions.</div>
      </div>

      <div class="cover-preview-showcase">
        <div class="cover-preview-frame">
          <img src="${getShot('01_ceo_command_center.png')}" alt="Montex Forge MIS CEO Command Center" />
        </div>
        <div class="cover-preview-caption">
          <span><strong>Live Application Capture:</strong> CEO Command Center &amp; Plant Operations Console (1440×900 Desktop Viewport)</span>
          <span>Status: Phase 5 Cloud Firestore Architecture Verified</span>
        </div>
      </div>

      <div class="cover-kpi-strip">
        <div class="cover-kpi-box">
          <div class="cover-kpi-num">16 Modules</div>
          <div class="cover-kpi-label">Connected Plant &amp; Commercial Views</div>
          <div class="cover-kpi-sub">Sales, Stores, Purchase, Shop Floor, QC, Dispatch, Finance &amp; Admin</div>
        </div>
        <div class="cover-kpi-box">
          <div class="cover-kpi-num">19 Collections</div>
          <div class="cover-kpi-label">Cloud Firestore Data Model</div>
          <div class="cover-kpi-sub">Includes all 8 persistent operational registers &amp; atomic ledgers</div>
        </div>
        <div class="cover-kpi-box">
          <div class="cover-kpi-num">8 RBAC Roles</div>
          <div class="cover-kpi-label">Zero-Trust Access Governance</div>
          <div class="cover-kpi-sub">Super Admin, CEO, Sales, Stores, Purchase, Quality, Dispatch, Finance</div>
        </div>
        <div class="cover-kpi-box">
          <div class="cover-kpi-num">31 / 31 Tests</div>
          <div class="cover-kpi-label">Automated Verification Suites</div>
          <div class="cover-kpi-sub">Phase 3 Auth, Phase 4 Firestore CRUD &amp; Phase 5 Cutover Verified</div>
        </div>
      </div>

      <div class="cover-meta-grid">
        <div class="cover-meta-item"><span>Prepared For:</span> <strong>Managing Director, CEO &amp; Management Board</strong></div>
        <div class="cover-meta-item"><span>Application Stack:</span> <strong>React 19, TypeScript, Express Admin API, Cloud Firestore</strong></div>
        <div class="cover-meta-item"><span>Organization:</span> <strong>Montex Forge Industries (Closed-Die &amp; Ring Forgings)</strong></div>
        <div class="cover-meta-item"><span>Document Scope:</span> <strong>Current Capabilities, Honest Status &amp; Stage A/B/C Roadmap</strong></div>
      </div>
    </div>

    <div class="cover-disclaimer">
      <span><strong>Presentation Governance Note:</strong> This document presents the current application implementation and proposed future enhancements. Screenshots display labeled synthetic preview data to protect confidential customer and plant records.</span>
      <span><strong>Page 1 of ${TOTAL_PAGES}</strong></span>
    </div>
  </section>

  <!-- ==================== PAGE 2: TABLE OF CONTENTS & STATUS KEY (SECTION 2) ==================== -->
  <section class="pdf-page" id="page-2">
    ${renderPageHeader(
      logoDataUrl,
      'SECTION 2',
      'Table of Contents & Feature Classification Governance',
      'Structured navigation guide and transparent implementation status definitions used across this showcase.'
    )}
    <div class="page-body">
      <div class="section-block">
        <div class="block-title">
          <span>Complete Document Table of Contents (Clickable Navigation)</span>
          <span style="font-size:7.5pt; color:#64748B;">19 Executive Sections · 22 Pages</span>
        </div>
        <div class="toc-grid">
          <a class="toc-item" href="#page-1"><span><span class="toc-item-sec">Sec 1.</span> Cover Page &amp; Executive Overview</span><span class="toc-page-num">Page 1</span></a>
          <a class="toc-item" href="#page-2"><span><span class="toc-item-sec">Sec 2.</span> Table of Contents &amp; Classification Key</span><span class="toc-page-num">Page 2</span></a>
          <a class="toc-item" href="#page-3"><span><span class="toc-item-sec">Sec 3.</span> Executive Summary: Purpose &amp; Connected Departments</span><span class="toc-page-num">Page 3</span></a>
          <a class="toc-item" href="#page-3"><span><span class="toc-item-sec">Sec 4.</span> Business Challenges Solved (Before vs. After Matrix)</span><span class="toc-page-num">Page 3</span></a>
          <a class="toc-item" href="#page-4"><span><span class="toc-item-sec">Sec 5.</span> System Overview &amp; Technical Architecture Diagram</span><span class="toc-page-num">Page 4</span></a>
          <a class="toc-item" href="#page-4"><span><span class="toc-item-sec">Sec 6.</span> End-to-End 9-Stage Forging Business Workflow</span><span class="toc-page-num">Page 4</span></a>
          <a class="toc-item" href="#page-5"><span><span class="toc-item-sec">Sec 7.1</span> Tour: CEO Command Center &amp; Exception Queue</span><span class="toc-page-num">Page 5</span></a>
          <a class="toc-item" href="#page-6"><span><span class="toc-item-sec">Sec 7.2</span> Tour: 7-Stage Order Lifecycle &amp; Quality/MTC Tabs</span><span class="toc-page-num">Page 6</span></a>
          <a class="toc-item" href="#page-7"><span><span class="toc-item-sec">Sec 7.3</span> Tour: Sales Orders Register &amp; Customer Master</span><span class="toc-page-num">Page 7</span></a>
          <a class="toc-item" href="#page-8"><span><span class="toc-item-sec">Sec 7.4</span> Tour: Commercial Quotations &amp; PSU/EPC Tenders</span><span class="toc-page-num">Page 8</span></a>
          <a class="toc-item" href="#page-9"><span><span class="toc-item-sec">Sec 7.5</span> Tour: Forged Products Catalog &amp; Billet Yard Stock</span><span class="toc-page-num">Page 9</span></a>
          <a class="toc-item" href="#page-10"><span><span class="toc-item-sec">Sec 7.6</span> Tour: Stock Movement Ledger &amp; Steel Mill POs</span><span class="toc-page-num">Page 10</span></a>
          <a class="toc-item" href="#page-11"><span><span class="toc-item-sec">Sec 7.7</span> Tour: Approved Steel Mills &amp; Shop Machine Logs</span><span class="toc-page-num">Page 11</span></a>
          <a class="toc-item" href="#page-12"><span><span class="toc-item-sec">Sec 7.8</span> Tour: Furnace Batch Logs &amp; Maintenance Tickets</span><span class="toc-page-num">Page 12</span></a>
          <a class="toc-item" href="#page-13"><span><span class="toc-item-sec">Sec 7.9</span> Tour: Plant Power Logs &amp; Quality Lot Inspections</span><span class="toc-page-num">Page 13</span></a>
          <a class="toc-item" href="#page-14"><span><span class="toc-item-sec">Sec 7.10</span> Tour: Dimensional/TPI Reports &amp; Outward Dispatch</span><span class="toc-page-num">Page 14</span></a>
          <a class="toc-item" href="#page-15"><span><span class="toc-item-sec">Sec 7.11</span> Tour: Finance, 8-Head Job Costing &amp; Tally Sync</span><span class="toc-page-num">Page 15</span></a>
          <a class="toc-item" href="#page-16"><span><span class="toc-item-sec">Sec 7.12</span> Tour: Reports Hub, Document Catalog &amp; Alerts</span><span class="toc-page-num">Page 16</span></a>
          <a class="toc-item" href="#page-17"><span><span class="toc-item-sec">Sec 7.13</span> Tour: Employee RBAC, Audit Trail &amp; Architecture</span><span class="toc-page-num">Page 17</span></a>
          <a class="toc-item" href="#page-18"><span><span class="toc-item-sec">Sec 8 &amp; 9</span> 8-Role Security Matrix &amp; Cloud Firestore Persistence</span><span class="toc-page-num">Page 18</span></a>
          <a class="toc-item" href="#page-19"><span><span class="toc-item-sec">Sec 10 &amp; 11</span> Business Benefits &amp; Honest Current Limitations</span><span class="toc-page-num">Page 19</span></a>
          <a class="toc-item" href="#page-20"><span><span class="toc-item-sec">Sec 12–14</span> Future Roadmap: Stages A, B &amp; C Enhancements</span><span class="toc-page-num">Page 20</span></a>
          <a class="toc-item" href="#page-21"><span><span class="toc-item-sec">Sec 15–17</span> Recommended KPIs, Rollout Steps &amp; Montex Inputs</span><span class="toc-page-num">Page 21</span></a>
          <a class="toc-item" href="#page-22"><span><span class="toc-item-sec">Sec 18 &amp; 19</span> Executive Glossary &amp; Closing Action Plan</span><span class="toc-page-num">Page 22</span></a>
        </div>
      </div>

      <div class="section-block">
        <div class="block-title">
          <span>Honest Feature Status Classification Standard</span>
          <span style="font-size:7.5pt; color:#64748B;">Every capability in this document is classified using one of five strict status levels</span>
        </div>
        <table class="corp-table">
          <thead>
            <tr>
              <th style="width:22%;">Status Badge</th>
              <th style="width:43%;">Engineering &amp; Operational Meaning</th>
              <th style="width:35%;">Examples in Current Montex MIS Build</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${renderBadge('Verified')}</td>
              <td>Implemented in the codebase and verified passing via automated test suites (Phases 3, 4 &amp; 5 verification scripts).</td>
              <td>8-Role RBAC matrix, Admin provisioning API, Firestore CRUD &amp; Cutover Engine, all 8 operational registers, atomic stock/GRN/dispatch writes.</td>
            </tr>
            <tr>
              <td>${renderBadge('Implemented')}</td>
              <td>Present and interactive in the current React UI and wired to context/services, ready for plant UAT.</td>
              <td>All 16 workspace views, 6-tab Order Journey details, 8-head Job Costing UI, Tally CSV upload reconciliation, PDF/Excel/CSV client exports.</td>
            </tr>
            <tr>
              <td>${renderBadge('Partially Implemented')}</td>
              <td>Core screen and workflow exist, but specific statutory/laboratory fields or external connectors remain to be added.</td>
              <td>Draft MTC &amp; Tax Invoice PDFs (marked as Draft Summaries pending chemical/mechanical lab fields &amp; e-Invoice IRN/QR fields).</td>
            </tr>
            <tr>
              <td>${renderBadge('Requires Verification')}</td>
              <td>Code and architecture are built, but production cutover requires live cloud credentials, company master data, or plant UAT.</td>
              <td>Live production Firebase Admin SDK credentials in hosting, cloud deployment of <code>firestore.rules</code>, multi-user plant UAT with real Montex data.</td>
            </tr>
            <tr>
              <td>${renderBadge('Planned')}</td>
              <td>Recommended future enhancement proposed in Stage A, B, or C of the Digital Transformation Roadmap.</td>
              <td>Scheduled email/WhatsApp digests, background cron alert triggers, direct Tally XML/API 2-way sync, IoT pyrometer/energy meter integration.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section-block-slate">
        <div class="block-title">
          <span>Complete Module Inventory &amp; Verification Summary (At a Glance)</span>
        </div>
        <div class="grid-3">
          <div>
            <ul class="compact-list">
              <li><strong>CEO Command Center:</strong> ${renderBadge('Verified')}</li>
              <li><strong>7-Stage Order Journey:</strong> ${renderBadge('Verified')}</li>
              <li><strong>Sales Orders Register:</strong> ${renderBadge('Verified')}</li>
              <li><strong>Quotations Register:</strong> ${renderBadge('Verified')}</li>
              <li><strong>PSU/EPC Tenders:</strong> ${renderBadge('Verified')}</li>
              <li><strong>Customers &amp; Products:</strong> ${renderBadge('Verified')}</li>
            </ul>
          </div>
          <div>
            <ul class="compact-list">
              <li><strong>Billet Yard Inventory:</strong> ${renderBadge('Verified')}</li>
              <li><strong>Stock Movement Ledger:</strong> ${renderBadge('Verified')}</li>
              <li><strong>Steel Mill POs &amp; GRN:</strong> ${renderBadge('Verified')}</li>
              <li><strong>Shift Machine Logs:</strong> ${renderBadge('Verified')}</li>
              <li><strong>Furnace Batch Logs:</strong> ${renderBadge('Verified')}</li>
              <li><strong>Maintenance &amp; Power Logs:</strong> ${renderBadge('Verified')}</li>
            </ul>
          </div>
          <div>
            <ul class="compact-list">
              <li><strong>Quality &amp; NDT Lots:</strong> ${renderBadge('Verified')}</li>
              <li><strong>Dimensional &amp; TPI (DIR):</strong> ${renderBadge('Verified')}</li>
              <li><strong>Outward Dispatch &amp; LR:</strong> ${renderBadge('Verified')}</li>
              <li><strong>Receivables &amp; Costing:</strong> ${renderBadge('Verified')}</li>
              <li><strong>Reports &amp; 19-Doc Hub:</strong> ${renderBadge('Verified')}</li>
              <li><strong>8-Role Admin &amp; Audit:</strong> ${renderBadge('Verified')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    ${renderPageFooter(2, TOTAL_PAGES, 'Section 2 — Table of Contents & Status Classification')}
  </section>

  <!-- ==================== PAGE 3: EXECUTIVE SUMMARY & CHALLENGES SOLVED (SECTIONS 3 & 4) ==================== -->
  <section class="pdf-page" id="page-3">
    ${renderPageHeader(
      logoDataUrl,
      'SECTIONS 3 & 4',
      'Executive Summary & Business Challenges Solved',
      'Why the Montex Forge MIS was built, how it connects all 8 departments, and the operational friction it eliminates.'
    )}
    <div class="page-body">
      <div class="grid-2">
        <div class="section-block">
          <div class="block-title">Section 3A — What the Montex MIS Dashboard Is</div>
          <ul class="compact-list">
            <li><strong>Unified Industrial Operations Platform:</strong> A purpose-built web application designed specifically for Montex Forge Industries’ closed-die and seamless ring-forging operations.</li>
            <li><strong>Single Source of Truth:</strong> Connects commercial inquiries, customer POs, billet yard stock, steel mill POs, hammer/furnace shifts, quality inspections, outward dispatches, and receivables in one database.</li>
            <li><strong>Role-Based Departmental Workspaces:</strong> Tailors navigation, write permissions, and document exports across 8 canonical company roles.</li>
            <li><strong>Real-Time Executive Command Center:</strong> Gives the MD and CEO immediate visibility into daily dispatches, order backlog, critical steel shortages, and overdue customer payments.</li>
          </ul>
        </div>
        <div class="section-block">
          <div class="block-title">Section 3B — Why It Was Built for Montex Forge</div>
          <ul class="compact-list">
            <li><strong>End-to-End Heat &amp; Job Traceability:</strong> PSU, refinery, and EPC clients (BHEL, IOCL, NTPC, Thermax, L&amp;T) require strict linkage from Steel Mill Heat Number to Forging Batch, MTC, TPI Release, and Invoice.</li>
            <li><strong>Eliminate Siloed Spreadsheets:</strong> Replaces disconnected departmental Excel sheets and verbal/WhatsApp status updates that cause data mismatches.</li>
            <li><strong>Protect Order Profitability:</strong> Tracks billet input weights, furnace fuel (PNG/LDO), HT power (kWh/MT), scrap credit, and TPI costs at the individual Job Number level.</li>
            <li><strong>Zero-Trust Governance:</strong> Enforces active employee authentication, departmental write boundaries, and an immutable security audit log.</li>
          </ul>
        </div>
      </div>

      <div class="section-block-slate">
        <div class="block-title">Section 3C — Eight Connected Departments on One Shared Platform</div>
        <div class="grid-4" style="font-size:7.3pt;">
          <div style="background:#fff; padding:2mm; border-radius:1.5mm; border:1px solid #DCE3EC;">
            <strong style="color:#14283F;">1. Top Management (CEO / MD)</strong><br/>Live KPI command center, bottleneck queue, KPI reconciliation, and margin visibility.
          </div>
          <div style="background:#fff; padding:2mm; border-radius:1.5mm; border:1px solid #DCE3EC;">
            <strong style="color:#14283F;">2. Sales &amp; Tendering</strong><br/>RFQs, per-kg quotation calculator, PSU tender EMD tracker, and Customer PO registration.
          </div>
          <div style="background:#fff; padding:2mm; border-radius:1.5mm; border:1px solid #DCE3EC;">
            <strong style="color:#14283F;">3. Purchase &amp; Procurement</strong><br/>Shortage indents, approved steel mill directory, and Mill Purchase Order tracking.
          </div>
          <div style="background:#fff; padding:2mm; border-radius:1.5mm; border:1px solid #DCE3EC;">
            <strong style="color:#14283F;">4. Raw Material Stores</strong><br/>Billet yard balances, job reservations, Mill GRN receipts, and heat-traceable stock movements.
          </div>
          <div style="background:#fff; padding:2mm; border-radius:1.5mm; border:1px solid #DCE3EC;">
            <strong style="color:#14283F;">5. Production &amp; Maintenance</strong><br/>Hammer/ring-mill shift logs, furnace temperature/fuel logs, maintenance tickets, and kWh/MT power logs.
          </div>
          <div style="background:#fff; padding:2mm; border-radius:1.5mm; border:1px solid #DCE3EC;">
            <strong style="color:#14283F;">6. Quality Assurance &amp; TPI</strong><br/>NDT lot inspections (UT/MPI), dimensional reports (DIR), TPI witnessing, and MTC references.
          </div>
          <div style="background:#fff; padding:2mm; border-radius:1.5mm; border:1px solid #DCE3EC;">
            <strong style="color:#14283F;">7. Outward Dispatch</strong><br/>Vehicle gate passes, transporter LR tracking, delivery challans, and automatic PO balance deduction.
          </div>
          <div style="background:#fff; padding:2mm; border-radius:1.5mm; border:1px solid #DCE3EC;">
            <strong style="color:#14283F;">8. Finance &amp; IT Admin</strong><br/>0–90+ day receivables ageing, payment receipts, 8-head job costing, Tally CSV sync, and RBAC governance.
          </div>
        </div>
      </div>

      <div class="section-block">
        <div class="block-title">Section 4 — Business Challenges Solved: Before vs. After Montex MIS</div>
        <table class="corp-table">
          <thead>
            <tr>
              <th style="width:18%;">Operational Area</th>
              <th style="width:41%;">Before (Manual Spreadsheets, Paper Diaries &amp; WhatsApp)</th>
              <th style="width:41%;">After (Connected Montex Forge MIS Platform)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>1. Order Status Visibility</strong></td>
              <td>Sales must call Stores, Shop Floor, QC, and Dispatch separately to answer a customer’s delivery status query.</td>
              <td><strong>7-Stage Order Lifecycle Tracker</strong> shows live PO progress from billet allocation to LR number and invoice on one screen.</td>
            </tr>
            <tr>
              <td><strong>2. Quotation &amp; Tender Follow-Up</strong></td>
              <td>RFQs and PSU tender deadlines sit in individual emails; repeat-order rates and follow-up dates are easily missed.</td>
              <td><strong>Persistent Quotations &amp; Tenders Registers</strong> auto-calculate per-piece rates from weight, track EMD/bid dates, and convert won quotes to POs.</td>
            </tr>
            <tr>
              <td><strong>3. Billet Yard &amp; Heat Control</strong></td>
              <td>Physical yard stock is confused with stock already promised to active jobs, causing sudden alloy steel shortages on the press.</td>
              <td><strong>Inventory Engine</strong> separates Physical MT, Reserved MT, and Free Available MT with non-negative stock guards and Mill Heat traceability.</td>
            </tr>
            <tr>
              <td><strong>4. Shop-Floor, Furnace &amp; Power Logs</strong></td>
              <td>Shift output, furnace soaking temperatures, machine breakdowns, and daily kWh readings remain trapped in paper registers.</td>
              <td><strong>4 Persistent Shop-Floor Registers</strong> log machine shifts, furnace fuel/MT, maintenance root causes, and daily kWh/MT energy intensity.</td>
            </tr>
            <tr>
              <td><strong>5. Quality, Dimensional &amp; TPI</strong></td>
              <td>NDT lot results, dimensional caliper sheets, and TPI release status are compiled manually right before dispatch.</td>
              <td><strong>Quality &amp; DIR Registers</strong> enforce quantity invariants (<code>Passed + Rejected &lt;= Inspected</code>) and link MTC/TPI status directly to the Job No.</td>
            </tr>
            <tr>
              <td><strong>6. Dispatch &amp; PO Balance Control</strong></td>
              <td>Partial shipments require manual subtraction of shipped pieces from PO quantities, risking over-shipment or billing gaps.</td>
              <td><strong>Atomic Dispatch Transactions</strong> record transporter LR details and automatically deduct shipped pieces from the open Customer PO balance.</td>
            </tr>
            <tr>
              <td><strong>7. Receivables &amp; Job Costing</strong></td>
              <td>Overdue 60+/90+ day receivables and order-level margin erosion are discovered weeks after month-end closing.</td>
              <td><strong>Live 0–90+ Day Ageing &amp; 8-Head Job Costing</strong> highlight credit-limit breaches immediately and compute net margin per forging job.</td>
            </tr>
            <tr>
              <td><strong>8. Access Control &amp; Auditability</strong></td>
              <td>Shared spreadsheets allow any user to overwrite formulas, delete rows, or view sensitive financial/pricing data without trace.</td>
              <td><strong>8-Role RBAC &amp; Immutable Audit Trail</strong> restrict write actions by department and log every sensitive change with actor UID and timestamp.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    ${renderPageFooter(3, TOTAL_PAGES, 'Sections 3 & 4 — Executive Summary & Business Challenges Solved')}
  </section>

  <!-- ==================== PAGE 4: SYSTEM ARCHITECTURE & 9-STAGE WORKFLOW (SECTIONS 5 & 6) ==================== -->
  <section class="pdf-page" id="page-4">
    ${renderPageHeader(
      logoDataUrl,
      'SECTIONS 5 & 6',
      'System Architecture & End-to-End Business Workflow',
      'How the frontend, role-based security layer, Cloud Firestore database, and reporting engine work together.'
    )}
    <div class="page-body">
      <div class="section-block">
        <div class="block-title">
          <span>Section 5 — Multi-Layer Enterprise System Architecture Diagram</span>
          ${renderBadge('Verified')}
        </div>
        <div class="arch-layer">
          <div class="arch-layer-title">
            <span>LAYER 1: Role-Aware Enterprise Frontend SPA (React 19 + TypeScript + Tailwind CSS)</span>
            <span style="color:#F28C28;">16 Interactive Modules</span>
          </div>
          <div class="arch-chips">
            <span class="arch-chip">CEO Command Center</span>
            <span class="arch-chip">7-Stage Order Journey</span>
            <span class="arch-chip">Sales Orders</span>
            <span class="arch-chip">Quotations &amp; Tenders</span>
            <span class="arch-chip">Customers &amp; Products</span>
            <span class="arch-chip">Production, Furnace, Maint. &amp; Power</span>
            <span class="arch-chip">Inventory &amp; Mill POs</span>
            <span class="arch-chip">Quality, DIR &amp; Dispatch</span>
            <span class="arch-chip">Finance, Costing, Reports &amp; Admin</span>
          </div>
        </div>

        <div class="arch-layer" style="border-left-color:#F28C28;">
          <div class="arch-layer-title">
            <span>LAYER 2: Authentication, 8-Role RBAC &amp; Server-Side Admin SDK Governance</span>
            <span style="color:#047857;">Phase 3 Verified (11/11 Tests)</span>
          </div>
          <div class="arch-chips">
            <span class="arch-chip">Firebase Authentication (ID Tokens)</span>
            <span class="arch-chip">8 Canonical Roles (super_admin to finance)</span>
            <span class="arch-chip">Active Account Guard (accountStatus === 'active')</span>
            <span class="arch-chip">Express Admin API (/api/admin/employees)</span>
            <span class="arch-chip">Self-Lockout &amp; Last-Super-Admin Guards</span>
          </div>
        </div>

        <div class="arch-layer" style="border-left-color:#234765;">
          <div class="arch-layer-title">
            <span>LAYER 3: Validated Data Service &amp; Controlled Cutover Engine</span>
            <span style="color:#047857;">Phase 4 &amp; 5 Verified (20/20 Tests)</span>
          </div>
          <div class="arch-chips">
            <span class="arch-chip">MontexFirestoreService (Typed CRUD &amp; Pagination)</span>
            <span class="arch-chip">MontexCutoverEngine (Dual-Mode Context Bridge)</span>
            <span class="arch-chip">Quantity &amp; Stock Invariant Validators</span>
            <span class="arch-chip">Duplicate-Submission Locks</span>
            <span class="arch-chip">Clean Empty-Collection Isolation (No Mock Leakage)</span>
          </div>
        </div>

        <div class="arch-layer" style="border-left-color:#10B981;">
          <div class="arch-layer-title">
            <span>LAYER 4: Cloud Firestore Named Database (19 Collections) + RTDB Rollback Readiness</span>
            <span style="color:#1D4ED8;">DB: ai-studio-montexmis-...</span>
          </div>
          <div class="arch-chips">
            <span class="arch-chip">Core: /users, /customers, /products, /suppliers</span>
            <span class="arch-chip">Commercial: /quotations, /tenders, /salesOrders</span>
            <span class="arch-chip">Stores: /rawMaterials, /stockMovements, /purchaseOrders</span>
            <span class="arch-chip">Shop: /machineLogs, /furnaceLogs, /maintenanceTickets, /powerLogs</span>
            <span class="arch-chip">QC/Dispatch/Finance: /qualityInspections, /dimensionalReports, /dispatches, /outstandingAgeing, /jobCostSheets, /auditLogs</span>
          </div>
        </div>

        <div class="arch-layer" style="border-left-color:#C8232C; margin-bottom:0;">
          <div class="arch-layer-title">
            <span>LAYER 5: Branded Document &amp; Reporting Engine (jsPDF + SheetJS XLSX + CSV)</span>
            <span style="color:#B45309;">19 Classified Document Types</span>
          </div>
          <div class="arch-chips">
            <span class="arch-chip">Official Montex Navy/Orange PDF Header &amp; Logo</span>
            <span class="arch-chip">Multi-Sheet Excel Workbooks (.xlsx)</span>
            <span class="arch-chip">Standardized CSV Exports</span>
            <span class="arch-chip">Readiness Classification Banner (Ready vs. Draft Summary)</span>
          </div>
        </div>
      </div>

      <div class="section-block">
        <div class="block-title">
          <span>Section 6 — End-to-End 9-Stage Montex Forging Business Workflow</span>
          <span style="font-size:7.4pt; color:#64748B;">Connected data flow from customer inquiry to executive reporting</span>
        </div>
        <div class="workflow-grid">
          <div class="wf-step">
            <div class="wf-step-num">Stage 1 · Sales &amp; Tendering</div>
            <div class="wf-step-title">Inquiry, Quotation &amp; Tender</div>
            <div class="wf-step-desc">Log customer RFQs in <code>/quotations</code> or PSU bids in <code>/tenders</code>; calculate per-piece forging rates from standard weight and follow up to win.</div>
          </div>
          <div class="wf-step">
            <div class="wf-step-num">Stage 2 · Order Registration</div>
            <div class="wf-step-title">Sales Order &amp; Job Number</div>
            <div class="wf-step-desc">Convert won quote or register Customer PO in <code>/salesOrders</code>; assign internal Job Number (<code>JOB-MF-2026-XXXX</code>) and target delivery date.</div>
          </div>
          <div class="wf-step">
            <div class="wf-step-num">Stage 3 · Procurement</div>
            <div class="wf-step-title">Material Check &amp; Mill PO</div>
            <div class="wf-step-desc">Check free available billet stock in <code>/rawMaterials</code>; if below reorder level, issue Steel Mill PO in <code>/purchaseOrders</code> to approved vendor.</div>
          </div>
          <div class="wf-step">
            <div class="wf-step-num">Stage 4 · Stores &amp; Yard</div>
            <div class="wf-step-title">Mill GRN &amp; Heat Allocation</div>
            <div class="wf-step-desc">Receive steel mill delivery via atomic GRN transaction; log Mill Heat Number in <code>/stockMovements</code> and allocate billets to the Job Number.</div>
          </div>
          <div class="wf-step">
            <div class="wf-step-num">Stage 5 · Shop Floor</div>
            <div class="wf-step-title">Forging, Furnace &amp; Power</div>
            <div class="wf-step-desc">Execute shift production on hammers/ring mills (<code>/machineLogs</code>), track furnace soaking &amp; fuel (<code>/furnaceLogs</code>), maintenance, and daily kWh/MT.</div>
          </div>
          <div class="wf-step">
            <div class="wf-step-num">Stage 6 · Quality &amp; TPI</div>
            <div class="wf-step-title">NDT Lot, Dimensional &amp; MTC</div>
            <div class="wf-step-desc">Record UT/MPI lot results in <code>/qualityInspections</code>, log drawing measurements in <code>/dimensionalReports</code>, and record TPI clearance.</div>
          </div>
          <div class="wf-step">
            <div class="wf-step-num">Stage 7 · Outward Logistics</div>
            <div class="wf-step-title">Dispatch, Gate Pass &amp; LR</div>
            <div class="wf-step-desc">Ship cleared pieces in <code>/dispatches</code> with transporter &amp; vehicle LR number; atomically deduct shipped quantity from PO balance.</div>
          </div>
          <div class="wf-step">
            <div class="wf-step-num">Stage 8 · Finance &amp; Costing</div>
            <div class="wf-step-title">Invoice, Costing &amp; Ageing</div>
            <div class="wf-step-desc">Link GST invoice reference, track 0–90+ day receivables in <code>/outstandingAgeing</code>, compute 8-head job margin, and reconcile Tally CSV.</div>
          </div>
          <div class="wf-step">
            <div class="wf-step-num">Stage 9 · Executive MIS</div>
            <div class="wf-step-title">CEO Dashboard &amp; Reports</div>
            <div class="wf-step-desc">Monitor live plant KPIs, acknowledge threshold alerts in <code>/actionQueue</code>, and export branded PDF/Excel management packs.</div>
          </div>
        </div>
      </div>
    </div>
    ${renderPageFooter(4, TOTAL_PAGES, 'Sections 5 & 6 — System Architecture & 9-Stage Business Workflow')}
  </section>

  <!-- ==================== PAGES 5 TO 17: PAGE-BY-PAGE PRODUCT TOUR (SECTION 7) ==================== -->
  ${tourPagesData
    .map((p) =>
      renderTourPage(logoDataUrl, p.pageNum, TOTAL_PAGES, p.heading, p.subheading, p.cards)
    )
    .join('\n')}

  <!-- ==================== PAGE 18: RBAC SECURITY & DATA PERSISTENCE (SECTIONS 8 & 9) ==================== -->
  <section class="pdf-page" id="page-18">
    ${renderPageHeader(
      logoDataUrl,
      'SECTIONS 8 & 9',
      'Role-Based Access Security & Cloud Firestore Persistence',
      'How the 8 canonical employee roles, security safeguards, and persistent operational registers protect company data.'
    )}
    <div class="page-body">
      <div class="section-block">
        <div class="block-title">
          <span>Section 8 — Canonical 8-Role Access &amp; Permission Governance Matrix</span>
          ${renderBadge('Verified')}
        </div>
        <table class="corp-table">
          <thead>
            <tr>
              <th style="width:14%;">Canonical Role</th>
              <th style="width:13%;">RBAC Group</th>
              <th style="width:27%;">Accessible Modules (View)</th>
              <th style="width:28%;">Authorized Write / Create / Edit Actions</th>
              <th style="width:18%;">Export &amp; Admin Scope</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>super_admin</code></td>
              <td><strong>Admin</strong></td>
              <td>All 16 Modules + Admin, Audit Trail &amp; Diagnostics</td>
              <td>Full write access across all collections + Employee provisioning, role assignment, account activation &amp; alert thresholds</td>
              <td>All PDF/XLSX/CSV exports + Admin Governance Pack</td>
            </tr>
            <tr>
              <td><code>ceo</code></td>
              <td><strong>Management</strong></td>
              <td>CEO Dashboard, Order Journey, All Commercial, Plant &amp; Finance Views, Read-Only Employee Directory</td>
              <td>Executive read-only oversight + Alert acknowledgement (prevents accidental operational edits by top management)</td>
              <td>All Executive, Sales, Plant &amp; Finance PDF/XLSX exports</td>
            </tr>
            <tr>
              <td><code>sales</code></td>
              <td><strong>Sales</strong></td>
              <td>Dashboard, Order Journey, Sales Orders, Quotations, Tenders, Customers, Products, Quality/Dispatch (View)</td>
              <td>Create/update Quotations, Tenders, Customer POs (<code>/salesOrders</code>), Customer &amp; Product Masters, Order stage updates</td>
              <td>Quotations, Tenders, Orders &amp; Customer exports</td>
            </tr>
            <tr>
              <td><code>purchase</code></td>
              <td><strong>Production</strong></td>
              <td>Purchase &amp; Steel Mills, Inventory &amp; Stores, Suppliers, Order Journey</td>
              <td>Issue Steel Mill Purchase Orders (<code>/purchaseOrders</code>), record Mill GRN receipts, update Supplier records</td>
              <td>Procurement, Mill PO &amp; Shortage Indent exports</td>
            </tr>
            <tr>
              <td><code>stores</code></td>
              <td><strong>Production</strong></td>
              <td>Inventory &amp; Stores, Purchase/GRN, Production Shop Floor, Order Journey</td>
              <td>Record Raw Material Stock Movements (<code>/stockMovements</code>), Mill GRNs, Machine/Furnace/Maintenance/Power logs</td>
              <td>Inventory, GRN Voucher &amp; Shop-Floor exports</td>
            </tr>
            <tr>
              <td><code>quality</code></td>
              <td><strong>Production</strong></td>
              <td>Quality &amp; MTC, Dimensional/TPI, Production, Order Journey, Products</td>
              <td>Record Lot Quality Inspections (<code>/qualityInspections</code>), Dimensional Reports (<code>/dimensionalReports</code>), TPI clearance status</td>
              <td>Quality Lot, DIR &amp; Draft MTC Summary exports</td>
            </tr>
            <tr>
              <td><code>dispatch</code></td>
              <td><strong>Production</strong></td>
              <td>Dispatch &amp; Logistics, Order Journey, Sales Orders (View), Quality (View)</td>
              <td>Record Outward Dispatches &amp; LR consignments (<code>/dispatches</code>) and update Order dispatch stage</td>
              <td>Delivery Challan PDF &amp; Dispatch LR Register exports</td>
            </tr>
            <tr>
              <td><code>finance</code></td>
              <td><strong>Finance</strong></td>
              <td>Finance &amp; Receivables, 8-Head Job Costing, Tally Sync, Sales Orders, Purchase Orders, Reports</td>
              <td>Record Customer Payment Receipts (<code>/outstandingAgeing</code>), update Invoice status &amp; Job Costing sheets</td>
              <td>Receivables, Payment Voucher, Costing &amp; Invoice exports</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid-2">
        <div class="section-block-slate">
          <div class="block-title">5 Verified Security &amp; Governance Safeguards</div>
          <ul class="compact-list">
            <li><strong>1. Active Account Enforcement:</strong> Both frontend guards and <code>firestore.rules</code> verify <code>accountStatus === 'active'</code>. Deactivated employees are immediately blocked from reads, writes, and exports.</li>
            <li><strong>2. Server-Side Employee Provisioning:</strong> Only an active <code>super_admin</code> can create accounts or assign roles via <code>/api/admin/employees</code>. Self-registration cannot self-assign privileged roles.</li>
            <li><strong>3. Self-Lockout &amp; Last-Admin Protection:</strong> Built-in guards prevent a Super Admin from deactivating their own account or demoting the last active Super Admin.</li>
            <li><strong>4. Non-Enumerable User Directory:</strong> Collection-wide listing of <code>/users</code> is restricted to active <code>super_admin</code> and <code>ceo</code> roles; other staff can only read their own <code>/users/{uid}</code> profile.</li>
            <li><strong>5. Secret-Redacted Immutable Audit Logs:</strong> Sensitive operations write append-only records to <code>/auditLogs</code> with automatic redaction of passwords, tokens, and private keys.</li>
          </ul>
        </div>

        <div class="section-block">
          <div class="block-title">
            <span>Section 9 — Cloud Firestore Persistence &amp; 8 Operational Registers</span>
            ${renderBadge('Verified')}
          </div>
          <p style="font-size:7.6pt; color:#334155; margin-bottom:1.8mm;">
            In Phases 4 and 5, the application’s data foundation was upgraded to <strong>Cloud Firestore</strong> with a controlled cutover engine (<code>MontexCutoverEngine</code>) and bidirectional schema mappers:
          </p>
          <ul class="compact-list">
            <li><strong>All 8 Operational Registers Are Now Persistent:</strong>
              <code>/quotations</code>, <code>/tenders</code>, <code>/purchaseOrders</code>, <code>/machineLogs</code>, <code>/furnaceLogs</code>, <code>/maintenanceTickets</code>, <code>/powerLogs</code>, and <code>/dimensionalReports</code> persist directly to Cloud Firestore alongside the 11 core collections.</li>
            <li><strong>Atomic Multi-Document Transactions:</strong> Stock movements, Mill GRN receipts, and outward dispatches use atomic Firestore transactions so inventory balances and PO/order balances never go out of sync.</li>
            <li><strong>Strict Demo vs. Production Isolation:</strong> Unauthenticated preview sessions use labeled synthetic data; authenticated production sessions read strictly from Cloud Firestore and display clean empty states when a collection is empty (never mixing demo data into live records).</li>
          </ul>
        </div>
      </div>
    </div>
    ${renderPageFooter(18, TOTAL_PAGES, 'Sections 8 & 9 — Role-Based Security & Cloud Firestore Persistence')}
  </section>

  <!-- ==================== PAGE 19: BUSINESS BENEFITS & CURRENT LIMITATIONS (SECTIONS 10 & 11) ==================== -->
  <section class="pdf-page" id="page-19">
    ${renderPageHeader(
      logoDataUrl,
      'SECTIONS 10 & 11',
      'Business Benefits for Montex & Honest Current Limitations',
      'Expected operational value by department and transparent disclosure of items requiring live plant confirmation.'
    )}
    <div class="page-body">
      <div class="section-block">
        <div class="block-title">
          <span>Section 10 — Expected Business &amp; Operational Benefits by Department</span>
          <span style="font-size:7.2pt; color:#64748B;">Presented as expected operational improvements (subject to plant adoption)</span>
        </div>
        <div class="grid-2" style="gap:2.2mm;">
          <div style="background:#F8FAFC; border:1px solid #DCE3EC; border-radius:1.5mm; padding:2mm 2.5mm;">
            <strong style="color:#14283F; font-size:8pt;">1. Management &amp; CEO Oversight</strong>
            <ul class="compact-list" style="margin-top:0.8mm;">
              <li>Instant single-screen visibility into daily dispatches, order backlog, critical steel shortages, and 90+ day receivables.</li>
              <li>KPI Reconciliation panel verifies whether summary numbers match underlying order, stock, and invoice records.</li>
            </ul>
          </div>
          <div style="background:#F8FAFC; border:1px solid #DCE3EC; border-radius:1.5mm; padding:2mm 2.5mm;">
            <strong style="color:#14283F; font-size:8pt;">2. Sales, Quotations &amp; Customer Service</strong>
            <ul class="compact-list" style="margin-top:0.8mm;">
              <li>Faster RFQ turnaround using standardized forged product weights and per-kg rate calculators.</li>
              <li>Immediate customer PO stage answers via the 7-Stage Order Lifecycle Tracker without phone follow-ups.</li>
            </ul>
          </div>
          <div style="background:#F8FAFC; border:1px solid #DCE3EC; border-radius:1.5mm; padding:2mm 2.5mm;">
            <strong style="color:#14283F; font-size:8pt;">3. Purchase &amp; Raw Material Stores</strong>
            <ul class="compact-list" style="margin-top:0.8mm;">
              <li>Clear separation of Physical Stock vs. Job-Reserved Stock prevents unexpected billet shortages on forging hammers.</li>
              <li>Closed-loop Mill PO to GRN receipt updates yard stock and heat-number ledgers in one atomic step.</li>
            </ul>
          </div>
          <div style="background:#F8FAFC; border:1px solid #DCE3EC; border-radius:1.5mm; padding:2mm 2.5mm;">
            <strong style="color:#14283F; font-size:8pt;">4. Production, Furnace, Maintenance &amp; Power</strong>
            <ul class="compact-list" style="margin-top:0.8mm;">
              <li>Digital shift logs, furnace fuel/MT tracking, and daily kWh/MT logs expose energy waste and press downtime root causes.</li>
              <li>Configurable alert thresholds flag furnace over-temperature and specific power spikes immediately.</li>
            </ul>
          </div>
          <div style="background:#F8FAFC; border:1px solid #DCE3EC; border-radius:1.5mm; padding:2mm 2.5mm;">
            <strong style="color:#14283F; font-size:8pt;">5. Quality Assurance, NDT &amp; TPI</strong>
            <ul class="compact-list" style="margin-top:0.8mm;">
              <li>Enforced quantity invariants and structured Dimensional Inspection Reports (DIR) keep TPI and MTC records audit-ready.</li>
              <li>End-to-end linkage from Steel Mill Heat Number to final inspection lot reduces audit preparation effort.</li>
            </ul>
          </div>
          <div style="background:#F8FAFC; border:1px solid #DCE3EC; border-radius:1.5mm; padding:2mm 2.5mm;">
            <strong style="color:#14283F; font-size:8pt;">6. Dispatch, Finance &amp; Cost Control</strong>
            <ul class="compact-list" style="margin-top:0.8mm;">
              <li>Outward dispatch logs automatically update pending PO piece balances and generate branded Delivery Challans.</li>
              <li>8-head job costing and 0–90+ day ageing schedules protect order margins and prioritize overdue collections.</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="section-block">
        <div class="block-title">
          <span>Section 11 — Honest Current Limitations &amp; Items Requiring Live Confirmation</span>
          ${renderBadge('Requires Verification')}
        </div>
        <p style="font-size:7.5pt; color:#475569; margin-bottom:2mm;">
          To ensure complete transparency for Montex management, the following items are not yet active in a live production environment and require credentials, company master data, or Phase-2 enhancements before full plant cutover:
        </p>
        <table class="corp-table">
          <thead>
            <tr>
              <th style="width:22%;">Area / Component</th>
              <th style="width:16%;">Current Status</th>
              <th style="width:62%;">Honest Limitation &amp; What Is Required Before Production Cutover</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>1. Server Admin SDK Credentials</strong></td>
              <td>${renderBadge('Requires Verification')}</td>
              <td>The backend employee provisioning routes (<code>/api/admin/*</code>) and system init script are implemented and tested against mocks, but require live Firebase Admin service-account credentials (<code>FIREBASE_SERVICE_ACCOUNT_JSON</code>) in the production hosting environment.</td>
            </tr>
            <tr>
              <td><strong>2. Cloud Firestore Rules Deployment</strong></td>
              <td>${renderBadge('Requires Verification')}</td>
              <td><code>firestore.rules</code> are written and reviewed locally for all 19 collections and 8 roles, but must be deployed to the live Firebase project and verified with authenticated employee accounts before production traffic is switched.</td>
            </tr>
            <tr>
              <td><strong>3. Statutory Tax Invoice &amp; e-Way Bill</strong></td>
              <td>${renderBadge('Partially Implemented')}</td>
              <td>The system generates a clearly labeled <strong>Draft Commercial Billing Summary PDF</strong>, but does not yet integrate with the NIC GST e-Invoice portal (IRN/QR code generation) or automated e-Way Bill APIs.</td>
            </tr>
            <tr>
              <td><strong>4. Final EN 10204 3.1 MTC Lab Values</strong></td>
              <td>${renderBadge('Partially Implemented')}</td>
              <td>The system generates a <strong>Draft MTC Data Summary PDF</strong> (linking heat number, UT/MPI, hardness, and DIR), without fabricating chemical composition (%C, %Mn, %Cr, %Mo) or tensile/impact lab test numbers, which require spectrometer/UTM data entry fields in Stage A.</td>
            </tr>
            <tr>
              <td><strong>5. Tally Prime Integration Mode</strong></td>
              <td>${renderBadge('Partially Implemented')}</td>
              <td>Currently supports <strong>CSV/XLSX file upload reconciliation</strong> and CSV export. Direct two-way Tally Prime XML/HTTP bridge synchronization is not yet connected and requires confirmation of Montex’s Tally ledger names and voucher types.</td>
            </tr>
            <tr>
              <td><strong>6. External Email / WhatsApp Alerts</strong></td>
              <td>${renderBadge('Planned')}</td>
              <td>Operational alerts and threshold breaches are displayed and acknowledged inside the web application’s <strong>Alerts &amp; Action Queue</strong>. Automated external email/WhatsApp push notifications and scheduled daily report emails are planned for Stage B.</td>
            </tr>
            <tr>
              <td><strong>7. Shop-Floor IoT &amp; Sensor Input</strong></td>
              <td>${renderBadge('Planned')}</td>
              <td>Furnace temperatures, shift production counts, and daily kWh readings are currently entered via validated web forms by supervisors. Direct PLC, pyrometer, and smart energy-meter telemetry is a Stage C roadmap item.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    ${renderPageFooter(19, TOTAL_PAGES, 'Sections 10 & 11 — Business Benefits & Honest Current Limitations')}
  </section>

  <!-- ==================== PAGE 20: FUTURE DIGITAL TRANSFORMATION ROADMAP (SECTIONS 12, 13 & 14) ==================== -->
  <section class="pdf-page" id="page-20">
    ${renderPageHeader(
      logoDataUrl,
      'SECTIONS 12, 13 & 14',
      'Future Digital Transformation Roadmap (Stages A, B & C)',
      'Phased, practical recommendations to take Montex Forge from initial live cutover to advanced industrial intelligence.'
    )}
    <div class="page-body">
      <div class="section-block">
        <div class="block-title">
          <span>Section 12 — Stage A: Immediate Production Readiness (Next 2–4 Weeks)</span>
          ${renderBadge('Requires Verification')}
        </div>
        <table class="corp-table">
          <thead>
            <tr>
              <th style="width:24%;">Recommended Feature</th>
              <th style="width:16%;">Target Users</th>
              <th style="width:32%;">Business Benefit</th>
              <th style="width:10%;">Complexity</th>
              <th style="width:18%;">Key Dependencies</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>A1. Live Cloud Rules &amp; Admin Cutover</strong></td>
              <td>IT Admin, All Staff</td>
              <td>Activates real multi-user authentication, server-side employee provisioning, and live Cloud Firestore security rules.</td>
              <td><strong>Low</strong></td>
              <td>Production Firebase Admin credentials &amp; rules deploy.</td>
            </tr>
            <tr>
              <td><strong>A2. Master Data &amp; Opening Stock Onboarding</strong></td>
              <td>Sales, Stores, Purchase, Finance</td>
              <td>Populates real Montex customers, forged products, steel suppliers, billet yard stock by heat, and open POs.</td>
              <td><strong>Low</strong></td>
              <td>Verified Excel/CSV master lists from Montex teams.</td>
            </tr>
            <tr>
              <td><strong>A3. Full EN 10204 3.1 Lab Certificate Fields</strong></td>
              <td>Quality / Metallurgy Lab</td>
              <td>Upgrades Draft MTC Summary to complete EN 10204 3.1 MTC with ladle/check chemical % and tensile/yield/impact values.</td>
              <td><strong>Medium</strong></td>
              <td>Approved Montex MTC format &amp; grade spec table.</td>
            </tr>
            <tr>
              <td><strong>A4. Multi-User Departmental UAT Sign-Off</strong></td>
              <td>All 8 Department Leads</td>
              <td>Validates real-world workflows, print layouts, and role boundaries across 1–2 live customer orders before plant-wide rollout.</td>
              <td><strong>Low</strong></td>
              <td>Nomination of 1 champion user per department.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section-block">
        <div class="block-title">
          <span>Section 13 — Stage B: High-Impact Operational Automation (1–3 Months)</span>
          ${renderBadge('Planned')}
        </div>
        <table class="corp-table">
          <thead>
            <tr>
              <th style="width:24%;">Recommended Feature</th>
              <th style="width:16%;">Target Users</th>
              <th style="width:32%;">Business Benefit</th>
              <th style="width:10%;">Complexity</th>
              <th style="width:18%;">Key Dependencies</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>B1. Automated Morning CEO &amp; Plant Email/WhatsApp Digest</strong></td>
              <td>CEO, MD, Plant Head</td>
              <td>Delivers an automated 8:30 AM summary of yesterday’s dispatches, shift tonnage, furnace fuel, and critical alerts.</td>
              <td><strong>Medium</strong></td>
              <td>SMTP / WhatsApp Business API credentials.</td>
            </tr>
            <tr>
              <td><strong>B2. Barcode / QR Billet &amp; Heat Tagging</strong></td>
              <td>Stores, Cutting, Forging Shop</td>
              <td>Prints QR heat tags at GRN receipt so operators scan billet bundles on the shop floor, eliminating heat-number typos.</td>
              <td><strong>Medium</strong></td>
              <td>Industrial label printer &amp; mobile/tablet camera scan.</td>
            </tr>
            <tr>
              <td><strong>B3. Customer / TPI Document Portal View</strong></td>
              <td>Sales, TPI Inspectors, Key Clients</td>
              <td>Provides a secure, token-scoped read-only link for TPI agencies to review DIRs, MTCs, and lot status for their PO.</td>
              <td><strong>Medium</strong></td>
              <td>Management approval of external TPI sharing rules.</td>
            </tr>
            <tr>
              <td><strong>B4. Two-Way Tally Prime XML / Voucher Bridge</strong></td>
              <td>Finance &amp; Accounts</td>
              <td>Automates sales invoice, purchase GRN, and receipt voucher push/pull with Tally Prime without manual CSV uploads.</td>
              <td><strong>Medium</strong></td>
              <td>Tally Prime ledger mapping &amp; local connector agent.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section-block">
        <div class="block-title">
          <span>Section 14 — Stage C: Advanced Industrial Intelligence (3–6+ Months)</span>
          ${renderBadge('Planned')}
        </div>
        <table class="corp-table">
          <thead>
            <tr>
              <th style="width:24%;">Recommended Feature</th>
              <th style="width:16%;">Target Users</th>
              <th style="width:32%;">Business Benefit</th>
              <th style="width:10%;">Complexity</th>
              <th style="width:18%;">Key Dependencies</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>C1. Furnace Pyrometer &amp; Smart Energy Meter IoT Sync</strong></td>
              <td>Production, Electrical, Quality</td>
              <td>Captures live furnace soaking curves (°C), PNG gas flow, and HT panel kWh/kVA automatically without manual form entry.</td>
              <td><strong>High</strong></td>
              <td>RS-485 / Modbus gateway on furnaces &amp; HT meters.</td>
            </tr>
            <tr>
              <td><strong>C2. Die Life &amp; Tooling Shop Management</strong></td>
              <td>Tool Room, Production, Costing</td>
              <td>Tracks forging die blow counts, re-sinking cycles, and die cost amortization per forged piece across hammers/presses.</td>
              <td><strong>Medium</strong></td>
              <td>Tool-room die numbering catalog &amp; life norms.</td>
            </tr>
            <tr>
              <td><strong>C3. Predictive Delivery Risk &amp; Capacity Scheduler</strong></td>
              <td>Production Planning, Sales, CEO</td>
              <td>Forecasts PO delivery dates based on hammer/ring-mill queue load, furnace availability, and incoming steel mill POs.</td>
              <td><strong>High</strong></td>
              <td>3+ months of historical shift &amp; cycle-time data in MIS.</td>
            </tr>
            <tr>
              <td><strong>C4. AI Executive Briefing &amp; Cost Anomaly Assistant</strong></td>
              <td>CEO, Finance Head, Plant Head</td>
              <td>Highlights unusual job margin drops, supplier price hikes, or recurring machine breakdown patterns in plain language.</td>
              <td><strong>Medium</strong></td>
              <td>Verified historical Firestore dataset &amp; Gemini API policy.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    ${renderPageFooter(20, TOTAL_PAGES, 'Sections 12, 13 & 14 — Future Digital Transformation Roadmap')}
  </section>

  <!-- ==================== PAGE 21: KPIS, IMPLEMENTATION ROADMAP & REQUESTED INPUTS (SECTIONS 15, 16 & 17) ==================== -->
  <section class="pdf-page" id="page-21">
    ${renderPageHeader(
      logoDataUrl,
      'SECTIONS 15, 16 & 17',
      'Recommended KPIs, Rollout Roadmap & Information Needed',
      'Core metrics Montex leadership should review, the 6-step go-live sequence, and the onboarding checklist.'
    )}
    <div class="page-body">
      <div class="section-block">
        <div class="block-title">Section 15 — Recommended Management KPIs Enabled by the MIS</div>
        <table class="corp-table">
          <thead>
            <tr>
              <th style="width:14%;">Domain</th>
              <th style="width:22%;">KPI Name</th>
              <th style="width:27%;">Formula / Operational Meaning</th>
              <th style="width:13%;">Owner &amp; Cadence</th>
              <th style="width:24%;">Management Decision Enabled</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Commercial</strong></td>
              <td>Quotation Win Rate &amp; Price/Kg</td>
              <td>Won Quote Value / Total Quoted Value; Avg Realized Rs./Kg</td>
              <td>Sales Head · Weekly</td>
              <td>Adjust bidding margins and prioritize high-conversion customers/grades.</td>
            </tr>
            <tr>
              <td><strong>Order Delivery</strong></td>
              <td>On-Time Delivery (OTD %)</td>
              <td>Orders Dispatched &lt;= Contractual PO Date / Total Dispatched Orders</td>
              <td>CEO / Planning · Weekly</td>
              <td>Reallocate hammer shifts or expedite TPI witnessing for at-risk POs.</td>
            </tr>
            <tr>
              <td><strong>Stores &amp; Purchase</strong></td>
              <td>Net Free Billet Coverage (MT)</td>
              <td>Physical Stock MT minus Reserved Job Stock MT vs. Reorder Level</td>
              <td>Stores / Purchase · Daily</td>
              <td>Trigger Steel Mill POs before alloy steel deficits halt production.</td>
            </tr>
            <tr>
              <td><strong>Production</strong></td>
              <td>Press Utilization &amp; Fuel/MT</td>
              <td>Run Hours / Available Shift Hours; Furnace PNG SCM or LDO Ltr / MT</td>
              <td>Plant Head · Daily</td>
              <td>Optimize furnace batch loading and reduce die-changeover downtime.</td>
            </tr>
            <tr>
              <td><strong>Energy</strong></td>
              <td>Specific Energy (kWh / MT)</td>
              <td>Daily Plant HT Electricity (kWh) / Daily Forged Output (MT)</td>
              <td>Electrical · Daily</td>
              <td>Control energy cost per ton and maintain Power Factor &gt; 0.98.</td>
            </tr>
            <tr>
              <td><strong>Quality</strong></td>
              <td>First-Pass Yield &amp; COPQ (%)</td>
              <td>QC Passed Pcs / Total Inspected Pcs; Scrap &amp; Rework Cost</td>
              <td>QA Head · Weekly</td>
              <td>Correct die wear, overheating, or dimensional drift on specific jobs.</td>
            </tr>
            <tr>
              <td><strong>Finance</strong></td>
              <td>60+ / 90+ Day Ageing &amp; Job Margin</td>
              <td>Receivables &gt; 60 Days (Rs.); (Invoiced Revenue - 8-Head Cost) / Revenue</td>
              <td>Finance / CEO · Weekly</td>
              <td>Enforce credit holds on overdue accounts and re-price low-margin jobs.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid-2">
        <div class="section-block-slate">
          <div class="block-title">Section 16 — 6-Step Practical Rollout Roadmap</div>
          <ul class="compact-list">
            <li><strong>Step 1 — Master Data &amp; Rules Setup (Week 1):</strong> Deploy <code>firestore.rules</code>, configure live Firebase Admin credentials, and import verified Customers, Products, and Suppliers.</li>
            <li><strong>Step 2 — Provision Employee Accounts (Week 1):</strong> Super Admin provisions named employee logins across all 8 roles via the Admin Console and verifies role access.</li>
            <li><strong>Step 3 — Pilot Sales, Stores &amp; Purchase (Week 2):</strong> Go live with Quotations, Customer PO registration, Billet Yard opening balances, and Steel Mill PO/GRN entry.</li>
            <li><strong>Step 4 — Enable Shop-Floor, Quality &amp; Dispatch (Week 3):</strong> Train shift supervisors, QA engineers, and dispatch officers to log daily shifts, furnace batches, DIRs, and vehicle LRs.</li>
            <li><strong>Step 5 — Activate Finance, Costing &amp; CEO Reviews (Week 4):</strong> Load receivables ageing, run weekly CEO Command Center reviews, and export official PDF/Excel packs.</li>
            <li><strong>Step 6 — Phase-2 Automation (Month 2+):</strong> Add full lab MTC fields, scheduled email/WhatsApp digests, and Tally XML sync.</li>
          </ul>
        </div>

        <div class="section-block">
          <div class="block-title">Section 17 — Information Requested from Montex</div>
          <p style="font-size:7.3pt; color:#475569; margin-bottom:1.2mm;">
            To transition the system from synthetic preview data to live plant operation, we request the following inputs from Montex management:
          </p>
          <ul class="compact-list">
            <li><strong>1. Employee Access List:</strong> Names, official email addresses, designations, and assigned role (from the 8 canonical roles) for initial users.</li>
            <li><strong>2. Customer &amp; Supplier Masters:</strong> Current Excel list of active customers (with credit days/limits) and approved steel mills.</li>
            <li><strong>3. Forged Product Catalog:</strong> Standard item codes, grades, finished weights (kg), gross input billet weights (kg), and HSN codes.</li>
            <li><strong>4. Opening Billet Stock &amp; Open POs:</strong> Current yard stock by grade, section, and heat number, plus active customer &amp; steel mill POs.</li>
            <li><strong>5. Sample Plant Documents:</strong> 1 sample each of Montex’s current Quotation, MTC (EN 10204 3.1), Dimensional Report, Delivery Challan, and Tax Invoice.</li>
            <li><strong>6. Alert Threshold Sign-Off:</strong> Confirmation of target limits for furnace temp (°C), rejection %, overdue days, downtime, and kWh/MT.</li>
          </ul>
        </div>
      </div>
    </div>
    ${renderPageFooter(21, TOTAL_PAGES, 'Sections 15, 16 & 17 — KPIs, Implementation Roadmap & Requested Inputs')}
  </section>

  <!-- ==================== PAGE 22: GLOSSARY & CLOSING PAGE (SECTIONS 18 & 19) ==================== -->
  <section class="pdf-page" id="page-22">
    ${renderPageHeader(
      logoDataUrl,
      'SECTIONS 18 & 19',
      'Executive Glossary & Closing Transformation Summary',
      'Plain-language reference of technical and forging MIS terms and recommended next steps for Montex leadership.'
    )}
    <div class="page-body">
      <div class="section-block">
        <div class="block-title">Section 18 — Glossary of Key Technical &amp; Forging Operations Terms</div>
        <table class="corp-table">
          <thead>
            <tr>
              <th style="width:22%;">Term / Acronym</th>
              <th style="width:78%;">Simple Business &amp; Plant Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>MIS (Management Information System)</strong></td>
              <td>A centralized digital platform that collects operational and financial data from every department and turns it into live dashboards, alerts, and management reports.</td>
            </tr>
            <tr>
              <td><strong>RBAC (Role-Based Access Control)</strong></td>
              <td>A security mechanism where each employee’s login role (e.g., Sales, Stores, Quality, Finance, CEO) strictly determines which screens they can view, edit, or export.</td>
            </tr>
            <tr>
              <td><strong>Cloud Firestore</strong></td>
              <td>Google Cloud’s enterprise document database used by the Montex MIS to store all 19 operational collections persistently with real-time synchronization and security rules.</td>
            </tr>
            <tr>
              <td><strong>Mill Heat Number</strong></td>
              <td>The unique melt/cast batch identifier stamped by the primary steel mill (e.g., JSW, SAIL, Kalyani) on raw steel billets, providing chemical traceability through forging to final MTC.</td>
            </tr>
            <tr>
              <td><strong>GRN (Goods Receipt Note)</strong></td>
              <td>The official inward stores record confirming that a specific tonnage and heat number of raw steel billets has been received and inspected against a Steel Mill Purchase Order.</td>
            </tr>
            <tr>
              <td><strong>MTC (EN 10204 3.1 Certificate)</strong></td>
              <td>A statutory Metallic Material Test Certificate verifying that forged components comply with customer PO chemical, mechanical, heat-treatment, and non-destructive testing specs.</td>
            </tr>
            <tr>
              <td><strong>DIR (Dimensional Inspection Report)</strong></td>
              <td>Quality Assurance record comparing actual measured dimensions (Outer Diameter, Bore, Thickness, PCD) of sampled forgings against the approved engineering drawing tolerances.</td>
            </tr>
            <tr>
              <td><strong>TPI (Third-Party Inspection)</strong></td>
              <td>Independent inspection agency (such as Lloyds, Bureau Veritas, TUV, or EIL) appointed by the customer to witness testing and issue a dispatch clearance certificate.</td>
            </tr>
            <tr>
              <td><strong>Receivables Ageing Bucket</strong></td>
              <td>Grouping of unpaid customer invoices by how many days they have been outstanding (0–30, 31–60, 61–90, and 90+ days) to prioritize payment follow-up and credit control.</td>
            </tr>
            <tr>
              <td><strong>Immutable Audit Log</strong></td>
              <td>A tamper-resistant security ledger (<code>/auditLogs</code>) that permanently records who performed a sensitive action, what record was changed, and when it occurred.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section-block" style="background: linear-gradient(155deg, #14283F 0%, #1E3A5F 100%); color:#FFFFFF; border:none; padding:5mm 6mm;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1.5px solid #F28C28; padding-bottom:3mm; margin-bottom:3.5mm;">
          <div>
            <div style="font-size:7.5pt; color:#FDBA74; font-weight:700; text-transform:uppercase; letter-spacing:0.8px;">Section 19 — Closing Executive Summary</div>
            <div style="font-size:13pt; font-weight:800; color:#FFFFFF; margin-top:0.5mm;">Ready for Controlled Plant Onboarding &amp; Executive Review</div>
          </div>
          <div style="background:#FFFFFF; padding:1.5mm 3mm; border-radius:1.5mm;">
            <img src="${logoDataUrl}" alt="Montex Forge Logo" style="height:9mm; width:auto; object-fit:contain;" />
          </div>
        </div>

        <p style="font-size:8.3pt; color:#E2E8F0; line-height:1.45; margin-bottom:3.5mm;">
          The <strong>MONtex Forge Industries MIS Dashboard</strong> establishes a complete, role-secured digital backbone across Sales, Tendering, Procurement, Billet Stores, Forging Shop Floor, Heat-Treatment Furnaces, Maintenance, Power Monitoring, Quality/MTC, Dispatch, and Finance. With <strong>16 interactive modules</strong>, <strong>19 Cloud Firestore collections</strong> (including all 8 persistent operational registers), and <strong>31 passing automated verification suites</strong>, the platform is ready to transition from synthetic preview data to a controlled pilot with real Montex plant data.
        </p>

        <div class="grid-3" style="margin-bottom:3.5mm;">
          <div style="background:rgba(255,255,255,0.08); border:1px solid rgba(242,140,40,0.45); border-radius:1.8mm; padding:2.5mm 3mm;">
            <div style="font-size:7.5pt; font-weight:800; color:#F28C28;">1. Review &amp; Walkthrough</div>
            <div style="font-size:7.2pt; color:#CBD5E1; margin-top:0.8mm;">Conduct a 45-minute live walkthrough of the 16 modules with the MD, CEO, and department heads.</div>
          </div>
          <div style="background:rgba(255,255,255,0.08); border:1px solid rgba(242,140,40,0.45); border-radius:1.8mm; padding:2.5mm 3mm;">
            <div style="font-size:7.5pt; font-weight:800; color:#F28C28;">2. Share Onboarding Inputs</div>
            <div style="font-size:7.2pt; color:#CBD5E1; margin-top:0.8mm;">Provide the employee email/role list, master data sheets, and sample MTC/Invoice formats (Section 17).</div>
          </div>
          <div style="background:rgba(255,255,255,0.08); border:1px solid rgba(242,140,40,0.45); border-radius:1.8mm; padding:2.5mm 3mm;">
            <div style="font-size:7.5pt; font-weight:800; color:#F28C28;">3. Launch 2-Week Pilot</div>
            <div style="font-size:7.2pt; color:#CBD5E1; margin-top:0.8mm;">Deploy live Cloud Firestore rules and track initial live customer orders end-to-end across all 8 roles.</div>
          </div>
        </div>

        <div style="font-size:7.5pt; color:#94A3B8; display:flex; justify-content:space-between; border-top:1px solid rgba(255,255,255,0.15); padding-top:2.5mm;">
          <span><strong>One Platform. Connected Operations. Better Decisions.</strong></span>
          <span>MONtex Forge Industries · Chakan MIDC, Pune</span>
        </div>
      </div>
    </div>
    ${renderPageFooter(22, TOTAL_PAGES, 'Sections 18 & 19 — Executive Glossary & Closing Summary')}
  </section>

</body>
</html>`;

  fs.writeFileSync(HTML_PREVIEW_PATH, html, 'utf8');
  console.log(`Wrote HTML presentation source to ${HTML_PREVIEW_PATH}`);

  console.log('Launching headless Chromium to render 22-page A4 PDF...');
  const browser = await chromium.launch({
    executablePath: EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });

  const context = await browser.newContext({
    viewport: { width: 794, height: 1123 }, // A4 at 96 DPI
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });

  // Render A4 PDF
  await page.pdf({
    path: PUBLIC_PDF_PATH,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
  });

  // Optimize embedded PNG streams using Ghostscript (/printer 300 DPI) so the 22-page PDF is fast to download (~4.6 MB)
  try {
    const { execFileSync } = require('node:child_process');
    const tmpOptimized = `${PUBLIC_PDF_PATH}.opt.pdf`;
    execFileSync('gs', [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      '-dPDFSETTINGS=/printer',
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      `-sOutputFile=${tmpOptimized}`,
      PUBLIC_PDF_PATH,
    ]);
    if (fs.existsSync(tmpOptimized) && fs.statSync(tmpOptimized).size > 100000) {
      fs.renameSync(tmpOptimized, PUBLIC_PDF_PATH);
    }
  } catch (gsErr) {
    console.warn('Ghostscript stream optimization skipped:', gsErr);
  }

  fs.copyFileSync(PUBLIC_PDF_PATH, ROOT_PDF_PATH);

  const stats = fs.statSync(PUBLIC_PDF_PATH);
  console.log(
    `Generated PDF successfully: ${PUBLIC_PDF_PATH} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`
  );

  // Render visual verification PNGs of representative PDF pages so we can inspect them with view_file
  for (const pageIdx of [1, 2, 3, 4, 5, 10, 18, 19, 20, 21, 22]) {
    const el = page.locator(`#page-${pageIdx}`);
    const outPng = path.join(SCREENSHOTS_DIR, `verified_pdf_page_${String(pageIdx).padStart(2, '0')}.png`);
    await el.screenshot({ path: outPng });
    console.log(`Rendered visual verification PNG for Page ${pageIdx}: ${outPng}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Failed to generate Product Showcase PDF:', err);
  process.exit(1);
});
