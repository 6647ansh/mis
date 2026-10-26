import React, { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  Edit2,
  CheckCircle2,
  ShieldAlert,
  FileSpreadsheet,
  FileText,
  Download,
  Trash2,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import { Customer, Product } from '../../types/mis';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import {
  exportMontexCsvFile,
  exportMontexExcelWorkbook,
  MontexPdfDocumentPayload,
  verifyExportPermission,
} from '../../services/documentExportService';

interface MasterDataViewProps {
  initialType?: 'customers' | 'products';
}

export const MasterDataView: React.FC<MasterDataViewProps> = ({ initialType = 'customers' }) => {
  const {
    customers,
    products,
    activeRbacGroup,
    currentUser,
    rtdbError,
    refreshFirestoreSnapshot,
    upsertCustomerRecord,
    upsertProductRecord,
    deleteCustomerRecord,
    deleteProductRecord,
  } = useRtdb();
  const [activeTab, setActiveTab] = useState<'customers' | 'products'>(initialType);
  const [searchTerm, setSearchTerm] = useState('');
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);

  useEffect(() => {
    setActiveTab(initialType);
  }, [initialType]);

  const [localCustomers, setLocalCustomers] = useState<Customer[]>(customers);
  const [localProducts, setLocalProducts] = useState<Product[]>(products);

  useEffect(() => {
    setLocalCustomers(customers);
  }, [customers]);

  useEffect(() => {
    setLocalProducts(products);
  }, [products]);

  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isNewProduct, setIsNewProduct] = useState(false);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const canWriteCustomers =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo', 'sales', 'finance'].includes(currentUser.role);
  const canWriteProducts =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo', 'sales', 'stores', 'quality'].includes(currentUser.role);
  const canDeleteMaster =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo'].includes(currentUser.role);

  const filteredCustomers = localCustomers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.contactPerson.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredProducts = localProducts.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.materialGrade.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.hsnCode.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleExportMastersWorkbook = () => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Sales',
      'Finance',
      'Production',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }

    exportMontexExcelWorkbook(
      `Montex_Customer_Product_Masters_${new Date().toISOString().split('T')[0]}.xlsx`,
      [
        {
          sheetName: 'Customer_Master',
          reportTitle: 'MONTEX FORGE — CUSTOMER MASTER DIRECTORY & CREDIT TERMS',
          reportSubtitle: `Filter: "${searchTerm || 'All'}" (${filteredCustomers.length} Customers) | Exported by ${currentUser.name} (${activeRbacGroup})`,
          headers: [
            'Customer ID',
            'Customer Code',
            'Company Name',
            'Contact Person',
            'Phone',
            'Email',
            'Plant / Location',
            'Industry Sector',
            'Credit Limit (INR)',
            'Credit Days',
            'Assigned Sales Officer',
            'Active Status',
          ],
          rows: filteredCustomers.map((c) => [
            c.id,
            c.code,
            c.name,
            c.contactPerson,
            c.phone,
            c.email,
            c.location,
            c.industry,
            c.creditLimit,
            c.creditDays,
            c.assignedSalesPerson,
            c.active ? 'ACTIVE' : 'INACTIVE',
          ]),
          totalsRow: [
            'TOTAL',
            '',
            `${filteredCustomers.length} Accounts`,
            '',
            '',
            '',
            '',
            '',
            filteredCustomers.reduce((s, c) => s + c.creditLimit, 0),
            '',
            '',
            '',
          ],
        },
        {
          sheetName: 'Product_Master_Catalog',
          reportTitle: 'MONTEX FORGE — FORGED PRODUCT & METALLURGY SPECIFICATION CATALOG',
          reportSubtitle: `Filter: "${searchTerm || 'All'}" (${filteredProducts.length} Products)`,
          headers: [
            'Product ID',
            'Product Code',
            'Description',
            'Category',
            'Size / Rating',
            'Material Grade',
            'Manufacturing Standard',
            'UOM',
            'Std Unit Weight (KG)',
            'HSN Code',
            'Standard List Price (INR)',
          ],
          rows: filteredProducts.map((p) => [
            p.id,
            p.code,
            p.name,
            p.category,
            p.size,
            p.materialGrade,
            p.standard,
            p.uom,
            p.standardWeightKg,
            p.hsnCode,
            p.standardSellingPrice,
          ]),
        },
      ]
    );

    setFeedback({
      type: 'success',
      message: `Downloaded 2-sheet Excel workbook (Customer_Master & Product_Master_Catalog).`,
    });
  };

  const handleExportMasterCsv = () => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Sales',
      'Finance',
      'Production',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }

    if (activeTab === 'customers') {
      exportMontexCsvFile(
        `Montex_Customer_Master_${new Date().toISOString().split('T')[0]}.csv`,
        [
          'Customer ID',
          'Code',
          'Company Name',
          'Contact Person',
          'Phone',
          'Email',
          'Location',
          'Industry',
          'Credit Limit (INR)',
          'Credit Days',
          'Assigned Sales Officer',
        ],
        filteredCustomers.map((c) => [
          c.id,
          c.code,
          c.name,
          c.contactPerson,
          c.phone,
          c.email,
          c.location,
          c.industry,
          c.creditLimit,
          c.creditDays,
          c.assignedSalesPerson,
        ])
      );
      setFeedback({
        type: 'success',
        message: `Exported ${filteredCustomers.length} customer master records to CSV.`,
      });
    } else {
      exportMontexCsvFile(
        `Montex_Product_Master_${new Date().toISOString().split('T')[0]}.csv`,
        [
          'Product ID',
          'Code',
          'Product Name',
          'Category',
          'Size / Rating',
          'Material Grade',
          'Standard',
          'Std Weight (KG)',
          'HSN Code',
          'List Price (INR)',
        ],
        filteredProducts.map((p) => [
          p.id,
          p.code,
          p.name,
          p.category,
          p.size,
          p.materialGrade,
          p.standard,
          p.standardWeightKg,
          p.hsnCode,
          p.standardSellingPrice,
        ])
      );
      setFeedback({
        type: 'success',
        message: `Exported ${filteredProducts.length} product catalog records to CSV.`,
      });
    }
  };

  const handleOpenMasterPdf = () => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Sales',
      'Finance',
      'Production',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }

    const payload: MontexPdfDocumentPayload =
      activeTab === 'customers'
        ? {
            filename: `Montex_Customer_Master_Directory_${new Date().toISOString().split('T')[0]}.pdf`,
            documentCode: `MST-CUST-${new Date().toISOString().split('T')[0].replace(/-/g, '')}`,
            documentTitle: 'CUSTOMER MASTER DIRECTORY & CREDIT TERMS',
            documentSubtitle:
              'Enterprise Master Records — Registered Industrial Accounts, Credit Limits & Payment Terms',
            readiness: 'ready',
            readinessBannerText:
              'READY TO GENERATE — Verified Customer Master Records (/customers)',
            metadataGrid: [
              { label: 'Active Directory View', value: 'Customer Master (/customers)' },
              { label: 'Search Filter Applied', value: searchTerm || 'All Customers' },
              { label: 'Total Accounts Listed', value: filteredCustomers.length },
              {
                label: 'Aggregate Credit Exposure Limit',
                value: `INR ${(
                  filteredCustomers.reduce((s, c) => s + c.creditLimit, 0) / 10000000
                ).toFixed(2)} Cr`,
              },
            ],
            tables: [
              {
                sectionTitle: 'Authorized Customer Master Register',
                headers: [
                  'Code',
                  'Customer Legal Name',
                  'Contact Person & Phone',
                  'Location & Sector',
                  'Credit Limit (INR)',
                  'Terms',
                  'Sales Officer',
                ],
                rows: filteredCustomers.map((c) => [
                  c.code,
                  c.name,
                  `${c.contactPerson} (${c.phone})`,
                  `${c.location} — ${c.industry}`,
                  `INR ${(c.creditLimit / 100000).toFixed(1)}L`,
                  `${c.creditDays} Days`,
                  c.assignedSalesPerson,
                ]),
              },
            ],
            notesAndTerms: [
              'Note: Customer statutory GSTIN and billing street addresses are not yet stored in /customers and are required before statutory tax invoicing.',
            ],
            footerDisclaimer:
              'INTERNAL ENTERPRISE MASTER DIRECTORY — Generated from Montex Forge MIS.',
            generatedBy: currentUser.name,
            generatedRole: activeRbacGroup,
          }
        : {
            filename: `Montex_Product_Master_Catalog_${new Date().toISOString().split('T')[0]}.pdf`,
            documentCode: `MST-PROD-${new Date().toISOString().split('T')[0].replace(/-/g, '')}`,
            documentTitle: 'FORGED PRODUCT & METALLURGY SPECIFICATION CATALOG',
            documentSubtitle:
              'Enterprise Master Records — Standard Forging Weights, ASTM/EN Grades, Standards & HSN Codes',
            readiness: 'ready',
            readinessBannerText:
              'READY TO GENERATE — Verified Product Master Catalog (/products)',
            metadataGrid: [
              { label: 'Active Catalog View', value: 'Product Master (/products)' },
              { label: 'Search Filter Applied', value: searchTerm || 'All Products' },
              { label: 'Total Forged Items Listed', value: filteredProducts.length },
            ],
            tables: [
              {
                sectionTitle: 'Standard Forged Components & Specification Catalog',
                headers: [
                  'Item Code',
                  'Forging Description',
                  'Category',
                  'Size / Rating',
                  'Material Grade',
                  'Standard',
                  'Std Wt (KG)',
                  'HSN Code',
                  'List Price (INR)',
                ],
                rows: filteredProducts.map((p) => [
                  p.code,
                  p.name,
                  p.category,
                  p.size,
                  p.materialGrade,
                  p.standard,
                  `${p.standardWeightKg.toFixed(1)} kg`,
                  p.hsnCode,
                  `INR ${p.standardSellingPrice.toLocaleString('en-IN')}`,
                ]),
              },
            ],
            footerDisclaimer:
              'INTERNAL ENTERPRISE PRODUCT CATALOG — Generated from Montex Forge MIS.',
            generatedBy: currentUser.name,
            generatedRole: activeRbacGroup,
          };

    setPreviewPayload(payload);
  };

  const handleOpenNewCustomer = () => {
    const nextNum = localCustomers.length + 1;
    setIsNewCustomer(true);
    setEditingCustomer({
      id: `CUST-00${nextNum}`,
      code: `MF-CUST-0${nextNum}`,
      name: '',
      contactPerson: '',
      phone: '+91-',
      email: '',
      location: 'Pune, MH',
      industry: 'Process Equipment & EPC',
      creditLimit: 5000000,
      creditDays: 45,
      assignedSalesPerson: 'Anil Verma',
      active: true,
      totalOrders: 0,
      totalOutstanding: 0,
    });
  };

  const handleOpenNewProduct = () => {
    const nextNum = localProducts.length + 1;
    setIsNewProduct(true);
    setEditingProduct({
      id: `PROD-00${nextNum}`,
      code: `FG-FLG-00${nextNum}`,
      name: '',
      category: 'Flange',
      size: '10" Class 300',
      materialGrade: 'ASTM A105',
      standard: 'ASME B16.5',
      uom: 'PCS',
      standardWeightKg: 48.0,
      hsnCode: '73079100',
      standardSellingPrice: 6400,
    });
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer || saving) return;
    if (!canWriteCustomers) {
      setFeedback({
        type: 'error',
        message:
          currentUser.accountStatus !== 'active'
            ? `Access Restricted: Account '${currentUser.email}' is ${currentUser.accountStatus}. Only active accounts can modify Customer Master records.`
            : `Access Restricted: Role '${currentUser.role}' has read-only access to Customer Master records. Only Super Admin, Higher Authority (CEO), Sales, or Finance can create or update customers.`,
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    const res = await upsertCustomerRecord(editingCustomer, isNewCustomer);
    setSaving(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to save customer master record.',
      });
      return;
    }

    const updateList = (prev: Customer[]) =>
      isNewCustomer
        ? [editingCustomer, ...prev]
        : prev.map((c) => (c.id === editingCustomer.id ? editingCustomer : c));

    setLocalCustomers(updateList);
    setEditingCustomer(null);

    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Saved to Cloud Firestore (/customers/${editingCustomer.id}): ${isNewCustomer ? 'Added' : 'Updated'} Customer ${editingCustomer.name} (${editingCustomer.code}).`
        : res.persistedToRtdb
        ? `Saved to Live Firebase Database (/customers/${editingCustomer.id}): ${isNewCustomer ? 'Added' : 'Updated'} Customer ${editingCustomer.name} (${editingCustomer.code}).`
        : `[Demo Preview Mode] ${isNewCustomer ? 'Added' : 'Updated'} Customer ${editingCustomer.name} (${editingCustomer.code}) in session state.`,
    });
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || saving) return;
    if (!canWriteProducts) {
      setFeedback({
        type: 'error',
        message:
          currentUser.accountStatus !== 'active'
            ? `Access Restricted: Account '${currentUser.email}' is ${currentUser.accountStatus}. Only active accounts can modify Product Master catalog.`
            : `Access Restricted: Role '${currentUser.role}' cannot modify Product Master catalog.`,
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    const res = await upsertProductRecord(editingProduct, isNewProduct);
    setSaving(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to save product master record.',
      });
      return;
    }

    const updateList = (prev: Product[]) =>
      isNewProduct
        ? [editingProduct, ...prev]
        : prev.map((p) => (p.id === editingProduct.id ? editingProduct : p));

    setLocalProducts(updateList);
    setEditingProduct(null);

    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Saved to Cloud Firestore (/products/${editingProduct.id}): ${isNewProduct ? 'Added' : 'Updated'} Product ${editingProduct.name} (${editingProduct.code}, ${editingProduct.standardWeightKg} kg).`
        : res.persistedToRtdb
        ? `Saved to Live Firebase Database (/products/${editingProduct.id}): ${isNewProduct ? 'Added' : 'Updated'} Product ${editingProduct.name} (${editingProduct.code}, ${editingProduct.standardWeightKg} kg).`
        : `[Demo Preview Mode] ${isNewProduct ? 'Added' : 'Updated'} Product ${editingProduct.name} (${editingProduct.code}, ${editingProduct.standardWeightKg} kg) in session state.`,
    });
  };

  const handleDeleteCustomer = async (customer: Customer) => {
    if (saving) return;
    setSaving(true);
    setFeedback(null);
    const res = await deleteCustomerRecord(customer.id);
    setSaving(false);
    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || `Cannot delete customer ${customer.name}.`,
      });
      return;
    }
    setLocalCustomers((prev) => prev.filter((c) => c.id !== customer.id));
    setFeedback({
      type: 'success',
      message: `Deleted Customer Master record ${customer.name} (${customer.code}).`,
    });
  };

  const handleDeleteProduct = async (product: Product) => {
    if (saving) return;
    setSaving(true);
    setFeedback(null);
    const res = await deleteProductRecord(product.id);
    setSaving(false);
    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || `Cannot delete product ${product.name}.`,
      });
      return;
    }
    setLocalProducts((prev) => prev.filter((p) => p.id !== product.id));
    setFeedback({
      type: 'success',
      message: `Deleted Product Master record ${product.name} (${product.code}).`,
    });
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <span>Enterprise Master Records</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700 capitalize">{activeTab} Master</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
            {activeTab === 'customers' ? 'Customer Master Directory' : 'Product & Forgings Catalog'}
          </h1>
          <p className="text-slate-500 mt-0.5">
            Authoritative customer credit limits, payment terms, forging specifications, standard piece weights, and HSN codes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-100 p-1 rounded-md">
            <button
              onClick={() => setActiveTab('customers')}
              className={`px-3 py-1 font-semibold rounded transition-colors cursor-pointer ${
                activeTab === 'customers' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Customers ({localCustomers.length})
            </button>
            <button
              onClick={() => setActiveTab('products')}
              className={`px-3 py-1 font-semibold rounded transition-colors cursor-pointer ${
                activeTab === 'products' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Products ({localProducts.length})
            </button>
          </div>

          <button
            onClick={handleExportMastersWorkbook}
            className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-md font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export Masters (.xlsx)</span>
          </button>
          <button
            onClick={handleOpenMasterPdf}
            className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-md font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-indigo-700" />
            <span>Printable Master PDF</span>
          </button>
          <button
            onClick={handleExportMasterCsv}
            className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
            <span>CSV</span>
          </button>

          {activeTab === 'customers' ? (
            canWriteCustomers ? (
              <button
                onClick={handleOpenNewCustomer}
                className="px-3.5 py-2 bg-slate-900 text-white rounded-md font-semibold hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Customer</span>
              </button>
            ) : (
              <span className="px-2.5 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-md font-semibold text-[11px]">
                Read-Only Role ({currentUser.role})
              </span>
            )
          ) : canWriteProducts ? (
            <button
              onClick={handleOpenNewProduct}
              className="px-3.5 py-2 bg-slate-900 text-white rounded-md font-semibold hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Forged Product</span>
            </button>
          ) : (
            <span className="px-2.5 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-md font-semibold text-[11px]">
              Read-Only Role ({currentUser.role})
            </span>
          )}
        </div>
      </div>

      {rtdbError && (
        <div className="p-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-900 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
            <span className="font-medium">Database Notice: {rtdbError}</span>
          </div>
          <button
            onClick={() => refreshFirestoreSnapshot()}
            className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded font-semibold text-[11px] shrink-0 cursor-pointer"
          >
            Retry Live Sync
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={`p-3 rounded-lg border flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-500 hover:text-slate-800 font-bold px-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Search Bar */}
      <div className="bg-white p-3.5 rounded-lg border border-slate-200 flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={
              activeTab === 'customers'
                ? 'Search customers by name, code, city, or contact person...'
                : 'Search products by item name, code, ASTM/EN grade, or HSN...'
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
      </div>

      {activeTab === 'customers' ? (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-3.5">Customer Name & Code</th>
                  <th className="py-3 px-3.5">Contact Person & Phone</th>
                  <th className="py-3 px-3.5">Industry & Location</th>
                  <th className="py-3 px-3.5 text-right">Credit Limit</th>
                  <th className="py-3 px-3.5 text-right">Payment Terms</th>
                  <th className="py-3 px-3.5">Assigned Sales</th>
                  <th className="py-3 px-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 px-4 text-center text-slate-500">
                      {searchTerm
                        ? `No customer records match "${searchTerm}".`
                        : 'No customer master records found in the live database.'}
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900">{c.name}</div>
                        <div className="font-mono text-slate-500 text-[11px]">{c.code}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-medium text-slate-800">{c.contactPerson}</div>
                        <div className="text-slate-500 text-[11px]">
                          {c.phone} · {c.email}
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="text-slate-800 font-medium">{c.industry}</div>
                        <div className="text-slate-500 text-[11px]">{c.location}</div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-slate-900">
                        ₹{(c.creditLimit / 100000).toFixed(0)} Lakhs
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-700">
                        {c.creditDays} Days Net
                      </td>
                      <td className="py-3 px-3.5 text-slate-700">{c.assignedSalesPerson}</td>
                      <td className="py-3 px-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {canWriteCustomers ? (
                            <button
                              onClick={() => {
                                setIsNewCustomer(false);
                                setEditingCustomer(c);
                              }}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Edit2 className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium">View Only</span>
                          )}
                          {canDeleteMaster && (
                            <button
                              onClick={() => handleDeleteCustomer(c)}
                              disabled={saving}
                              title="Delete customer (checked for linked orders/quotations)"
                              className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-3.5">Item Code & Name</th>
                  <th className="py-3 px-3.5">Category</th>
                  <th className="py-3 px-3.5">Size / Rating</th>
                  <th className="py-3 px-3.5">Material Grade</th>
                  <th className="py-3 px-3.5">Standard</th>
                  <th className="py-3 px-3.5 text-right">Std Weight (KG)</th>
                  <th className="py-3 px-3.5">HSN Code</th>
                  <th className="py-3 px-3.5 text-right">List Price</th>
                  <th className="py-3 px-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 px-4 text-center text-slate-500">
                      {searchTerm
                        ? `No product catalog records match "${searchTerm}".`
                        : 'No product master records found in the live database.'}
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900">{p.name}</div>
                        <div className="font-mono text-slate-500 text-[11px]">{p.code}</div>
                      </td>
                      <td className="py-3 px-3.5 font-medium text-slate-700">{p.category}</td>
                      <td className="py-3 px-3.5 font-mono text-slate-800">{p.size}</td>
                      <td className="py-3 px-3.5 font-semibold text-indigo-700">{p.materialGrade}</td>
                      <td className="py-3 px-3.5 text-slate-600 font-mono">{p.standard}</td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-slate-900">
                        {p.standardWeightKg.toFixed(1)} kg
                      </td>
                      <td className="py-3 px-3.5 font-mono text-slate-500">{p.hsnCode}</td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-semibold text-emerald-700">
                        ₹{p.standardSellingPrice.toLocaleString()}
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {canWriteProducts ? (
                            <button
                              onClick={() => {
                                setIsNewProduct(false);
                                setEditingProduct(p);
                              }}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Edit2 className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium">View Only</span>
                          )}
                          {canDeleteMaster && (
                            <button
                              onClick={() => handleDeleteProduct(p)}
                              disabled={saving}
                              title="Delete product (checked for linked orders/quotations)"
                              className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT CUSTOMER */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveCustomer}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isNewCustomer ? 'Add New Customer Account' : `Edit Customer (${editingCustomer.code})`}
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Persists customer details, credit limit, and payment terms to <code className="font-mono">/customers/{editingCustomer.id}</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingCustomer(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Customer Code</label>
                  <input
                    type="text"
                    required
                    value={editingCustomer.code}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, code: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="font-semibold text-slate-700 block mb-1">Company Legal Name</label>
                  <input
                    type="text"
                    required
                    value={editingCustomer.name}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, name: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Contact Person</label>
                  <input
                    type="text"
                    required
                    value={editingCustomer.contactPerson}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, contactPerson: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Phone</label>
                  <input
                    type="text"
                    required
                    value={editingCustomer.phone}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, phone: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={editingCustomer.email}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, email: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Plant / Delivery Location</label>
                  <input
                    type="text"
                    required
                    value={editingCustomer.location}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, location: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Industry Sector</label>
                  <input
                    type="text"
                    required
                    value={editingCustomer.industry}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, industry: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Credit Limit (₹)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={editingCustomer.creditLimit}
                    onChange={(e) =>
                      setEditingCustomer({
                        ...editingCustomer,
                        creditLimit: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Credit Days</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={editingCustomer.creditDays}
                    onChange={(e) =>
                      setEditingCustomer({
                        ...editingCustomer,
                        creditDays: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Assigned Sales Officer</label>
                  <input
                    type="text"
                    required
                    value={editingCustomer.assignedSalesPerson}
                    onChange={(e) =>
                      setEditingCustomer({
                        ...editingCustomer,
                        assignedSalesPerson: e.target.value,
                      })
                    }
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setEditingCustomer(null)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Customer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ADD / EDIT PRODUCT */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveProduct}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isNewProduct ? 'Add Forged Product to Catalog' : `Edit Product (${editingProduct.code})`}
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Persists standard piece weight, metallurgy specification, and list price to <code className="font-mono">/products/{editingProduct.id}</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Product Code</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.code}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, code: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="font-semibold text-slate-700 block mb-1">Forging Item Description</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.name}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, name: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Category</label>
                  <select
                    value={editingProduct.category}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        category: e.target.value as Product['category'],
                      })
                    }
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="Flange">Flange</option>
                    <option value="Forged Ring">Forged Ring</option>
                    <option value="Shaft">Shaft</option>
                    <option value="Blind Flange">Blind Flange</option>
                    <option value="Custom Forging">Custom Forging</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Size / Rating</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.size}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, size: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Material Grade</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.materialGrade}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, materialGrade: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Standard</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.standard}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, standard: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Std Wt (KG)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0.1}
                    required
                    value={editingProduct.standardWeightKg}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        standardWeightKg: Number(e.target.value) || 1,
                      })
                    }
                    className="w-full p-2 border border-slate-300 rounded font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">HSN Code</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.hsnCode}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, hsnCode: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">List Price (₹)</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={editingProduct.standardSellingPrice}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        standardSellingPrice: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full p-2 border border-slate-300 rounded font-mono font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Product'}
              </button>
            </div>
          </form>
        </div>
      )}

      <DocumentPreviewModal
        payload={previewPayload}
        onClose={() => setPreviewPayload(null)}
      />
    </div>
  );
};
