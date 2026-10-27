import {
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  FileSpreadsheet,
  FileText,
  GitMerge,
  LayoutDashboard,
  Layers,
  ShieldCheck,
  ShoppingCart,
  Target,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem {
  id: string;
  label: string;
  /** One line shown in the command palette and as the page purpose. */
  description: string;
  icon: ComponentType<{ className?: string }>;
  keywords?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Single source for the sidebar, breadcrumbs and the ⌘K palette. Roles filter it. */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { id: 'dashboard', label: 'Command Center', description: 'Plant and business health at a glance', icon: LayoutDashboard, keywords: 'ceo kpi home' },
      { id: 'order_journey', label: 'Order Tracker', description: 'Follow one order from PO to payment', icon: GitMerge, keywords: 'journey lifecycle job' },
      { id: 'tasks_accountability', label: 'Tasks & Handovers', description: 'Assigned work, verification and SOPs', icon: ClipboardCheck, keywords: 'sop handover verify' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { id: 'sales_orders', label: 'Sales Orders', description: 'Customer POs and internal job numbers', icon: FileSpreadsheet, keywords: 'po order job' },
      { id: 'leads', label: 'Enquiries', description: 'New customer enquiries and follow-ups', icon: Target, keywords: 'lead prospect enquiry new customer' },
      { id: 'quotations', label: 'Quotations & Tenders', description: 'RFQs, quotes and PSU tenders', icon: FileText, keywords: 'rfq quote tender' },
      { id: 'customers', label: 'Customers', description: 'Customer master and credit terms', icon: Users },
      { id: 'products', label: 'Products', description: 'Forged product catalogue and specs', icon: Boxes },
    ],
  },
  {
    title: 'Operations',
    items: [
      { id: 'production', label: 'Production', description: 'Shifts, hammers, furnaces and maintenance', icon: Factory, keywords: 'shop floor furnace' },
      { id: 'inventory', label: 'Inventory', description: 'Raw material stock and movements', icon: Layers, keywords: 'stores billet stock grn' },
      { id: 'purchase', label: 'Purchase', description: 'Steel mill POs, indents and receipts', icon: ShoppingCart, keywords: 'procurement mill indent' },
      { id: 'quality', label: 'Quality & MTC', description: 'Inspections, MTCs and quality clearance', icon: CheckCircle2, keywords: 'qc ndt inspection clearance' },
      { id: 'dispatch', label: 'Dispatch', description: 'Consignments for cleared orders', icon: Truck, keywords: 'lr vehicle gate pass' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { id: 'finance', label: 'Finance', description: 'Invoices, collections and finance clearance', icon: Wallet, keywords: 'invoice payment receivable ageing' },
      { id: 'reports', label: 'Reports', description: 'Exports and management reports', icon: BarChart3, keywords: 'excel pdf export' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'notifications', label: 'Alerts', description: 'Open alerts and alert thresholds', icon: Bell, keywords: 'threshold notification' },
      { id: 'admin', label: 'Users & Access', description: 'Approve employees and manage roles', icon: ShieldCheck, keywords: 'employee approve role' },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function findNav(id: string): { item?: NavItem; group?: NavGroup } {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => i.id === id);
    if (item) return { item, group };
  }
  return {};
}
