import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightPath =
  '/root/.bun/install/cache/playwright-core@1.64.0-c17905f0d2f6a539@@@1/index.js';
const { chromium } = require(playwrightPath);

const EXECUTABLE_PATH =
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

const OUT_DIR = path.resolve(process.cwd(), 'public/showcase-screenshots');

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dismissAnyModal(page: any) {
  const modalOverlay = page.locator('div.fixed.inset-0.z-50');
  if ((await modalOverlay.count()) > 0) {
    const cancelBtn = modalOverlay
      .locator('button')
      .filter({ hasText: /Cancel|Close/i })
      .first();
    if ((await cancelBtn.count()) > 0) {
      await cancelBtn.click({ force: true });
      await sleep(200);
    } else {
      await page.keyboard.press('Escape');
      await sleep(200);
    }
  }
}

async function clickSidebarItem(page: any, labelSubstring: string) {
  await dismissAnyModal(page);
  const navBtn = page
    .locator('aside nav button')
    .filter({ hasText: labelSubstring })
    .first();
  await navBtn.click();
  await sleep(300);
}

async function clickMainButton(page: any, labelSubstring: string) {
  await dismissAnyModal(page);
  const btn = page
    .locator('main button')
    .filter({ hasText: labelSubstring })
    .first();
  if ((await btn.count()) > 0) {
    await btn.click();
    await sleep(250);
    return true;
  }
  return false;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Launching headless Chromium for real application screenshot capture...');
  const browser = await chromium.launch({
    executablePath: EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    const cleanRupeeSymbol = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.includes('\u20B9')) {
          node.nodeValue = node.nodeValue.replace(/\u20B9\s*/g, 'Rs. ');
        }
      }
    };
    window.addEventListener('DOMContentLoaded', () => {
      cleanRupeeSymbol(document.body);
      const obs = new MutationObserver(() => cleanRupeeSymbol(document.body));
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await sleep(600);
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes('\u20B9')) {
        node.nodeValue = node.nodeValue.replace(/\u20B9\s*/g, 'Rs. ');
      }
    }
  });

  const captures: { file: string; title: string }[] = [];

  async function snap(filename: string, title: string) {
    await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.includes('\u20B9')) {
          node.nodeValue = node.nodeValue.replace(/\u20B9\s*/g, 'Rs. ');
        }
      }
    });
    const filePath = path.join(OUT_DIR, filename);
    await page.screenshot({ path: filePath, fullPage: false });
    console.log(`Captured: ${filename} (${title})`);
    captures.push({ file: filename, title });
  }

  // 1. CEO Command Center (Top KPIs & Executive Overview)
  await snap('01_ceo_command_center.png', 'CEO & Management Command Center — Executive KPIs');

  // Scroll Priority Exceptions & Shop-Floor Summary into view
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('h2, h3, div')).find(
      (n) => n.textContent && n.textContent.includes('Priority Exceptions & Pending Actions')
    );
    if (el) {
      el.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
    window.scrollTo({ top: 580, behavior: 'instant' });
    const main = document.querySelector('main');
    if (main) main.scrollTo({ top: 580, behavior: 'instant' });
  });
  await sleep(250);
  await snap(
    '02_ceo_action_queue_and_shopfloor.png',
    'CEO Command Center — Action Queue & Shop-Floor Summary'
  );
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const main = document.querySelector('main');
    if (main) main.scrollTo({ top: 0, behavior: 'instant' });
  });

  // 2. Order Lifecycle Tracker (7-Stage Journey)
  await clickSidebarItem(page, 'Order Lifecycle Tracker');
  await snap('03_order_lifecycle_tracker.png', '7-Stage Order Lifecycle & Job Tracker');

  await clickMainButton(page, 'Quality');
  await snap(
    '04_order_journey_quality_tab.png',
    'Order Lifecycle Tracker — Quality & MTC Traceability Tab'
  );

  // 3. Sales Orders & Jobs Register
  await clickSidebarItem(page, 'Sales Orders & Jobs');
  await snap('05_sales_orders_register.png', 'Sales Orders & Internal Job Numbers Register');

  const openedNewOrder = await clickMainButton(page, 'New Customer PO');
  if (openedNewOrder) {
    await snap('06_sales_order_new_po_modal.png', 'Register New Customer Purchase Order Form');
    await dismissAnyModal(page);
  }

  // 4. Quotations & Tenders
  await clickSidebarItem(page, 'Quotations & Tenders');
  await snap('07_quotations_register.png', 'Commercial Quotations & RFQ Register');

  await clickMainButton(page, 'Tenders');
  await snap('08_psu_tenders_pipeline.png', 'PSU & EPC Tender Bid Pipeline');

  // 5. Customers Master
  await clickSidebarItem(page, 'Customers');
  await snap('09_customers_master.png', 'Customer Master Directory & Credit Terms');

  // 6. Products & Specs Master
  await clickSidebarItem(page, 'Products & Specs');
  await snap('10_products_specs_master.png', 'Forged Products & Technical Specifications Catalog');

  // 7. Production & Shop Floor (4 Sub-tabs)
  await clickSidebarItem(page, 'Production & Shop Floor');
  await snap(
    '11_production_machine_logs.png',
    'Production & Shop Floor — Shift & Hammer/Press Logs'
  );

  await clickMainButton(page, 'Furnace');
  await snap(
    '12_production_furnace_logs.png',
    'Heat-Treatment & Reheating Furnace Batch Logs'
  );

  await clickMainButton(page, 'Maintenance');
  await snap(
    '13_production_maintenance_tickets.png',
    'Machine Breakdown & Preventive Maintenance Tickets'
  );

  await clickMainButton(page, 'Power');
  await snap(
    '14_production_power_logs.png',
    'Plant Power Consumption (kWh/MT & Power Factor) Register'
  );

  // 8. Inventory & Stores (2 Sub-tabs)
  await clickSidebarItem(page, 'Inventory & Stores');
  await snap(
    '15_inventory_billet_yard.png',
    'Raw Material Billet Yard Balances & Reorder Alerts'
  );

  await clickMainButton(page, 'Stock Movement History Log');
  await snap(
    '16_inventory_stock_movements.png',
    'Heat-Traceable Raw Material Stock Movement Ledger'
  );

  // 9. Purchase & Steel Mills (Sub-tabs)
  await clickSidebarItem(page, 'Purchase & Steel Mills');
  await snap(
    '17_purchase_steel_mill_pos.png',
    'Steel Mill Purchase Orders & GRN Receipt Tracker'
  );

  await clickMainButton(page, 'Approved');
  await snap(
    '18_purchase_approved_suppliers.png',
    'Approved Steel Mill & Vendor Performance Directory'
  );

  // 10. Quality & MTC (2 Sub-tabs)
  await clickSidebarItem(page, 'Quality & MTC');
  await snap(
    '19_quality_lot_inspections.png',
    'Quality Lot Inspections, NDT & EN 10204 3.1 MTC Register'
  );

  await clickMainButton(page, 'Dimensional');
  await snap(
    '20_quality_dimensional_tpi.png',
    'Dimensional Inspection Reports & Third-Party (TPI) Witnessing'
  );

  // 11. Dispatch & Logistics
  await clickSidebarItem(page, 'Dispatch & Logistics');
  await snap(
    '21_dispatch_logistics_register.png',
    'Outward Dispatch, Gate Pass, Vehicle & LR Register'
  );

  // 12. Finance, Invoices, Costing & Receivables (Sub-tabs)
  await clickSidebarItem(page, 'Invoices & Receivables');
  await snap(
    '22_finance_receivables_ageing.png',
    'Accounts Receivable 0–90+ Day Bucketed Ageing & Credit Control'
  );

  await clickMainButton(page, 'Costing');
  await snap(
    '23_finance_job_costing.png',
    '8-Head Order-Wise Job Costing & Gross Margin Analysis'
  );

  await clickMainButton(page, 'Tally CSV/XLSX Reconciliation');
  await snap(
    '24_finance_tally_reconciliation.png',
    'Tally Prime CSV/XLSX Sales Ledger Reconciliation'
  );

  // 13. Reports & Exports Hub
  await clickSidebarItem(page, 'Reports & Exports');
  await snap('25_reports_exports_hub.png', 'Enterprise MIS Reports & Branded Exports Center');

  await clickMainButton(page, '8. Document & Export Readiness');
  await snap(
    '26_reports_document_readiness.png',
    '19-Document Export Readiness & Classification Matrix'
  );

  // 14. Alerts & Thresholds
  await clickSidebarItem(page, 'Alerts & Thresholds');
  await snap('27_alerts_action_queue.png', 'Active Operational Alerts & Exception Queue');

  await clickMainButton(page, 'Alert Rules & Threshold Configuration');
  await snap(
    '28_alerts_threshold_rules.png',
    'Company-Wide Alert Rules & Threshold Configuration'
  );

  // 15. Users, Roles & Settings (Admin)
  await clickSidebarItem(page, 'Users, Roles & Settings');
  await snap(
    '29_admin_users_rbac_matrix.png',
    'Employee Directory & 8-Role Granular RBAC Governance Matrix'
  );

  await clickMainButton(page, 'Security Audit Trail');
  await snap(
    '30_admin_security_audit_logs.png',
    'Immutable Security & Operational Audit Trail'
  );

  await clickMainButton(page, 'System Diagnostics');
  await snap(
    '31_admin_architecture_blueprint.png',
    'Cloud Firestore Architecture & Cutover Diagnostics'
  );

  await browser.close();
  console.log(`Successfully captured ${captures.length} real screenshots in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
