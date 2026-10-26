import React, { useState } from 'react';
import {
  Factory,
  Flame,
  Wrench,
  Zap,
  Plus,
  CheckCircle2,
  ShieldAlert,
  FileSpreadsheet,
  FileText,
  Download,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import {
  FurnaceBatchLog,
  MachineMaintenanceTicket,
  PowerConsumptionLog,
  ShopMachineLog,
} from '../../types/mis';
import { StatusBadge } from '../common/StatusBadge';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import {
  exportMontexCsvFile,
  exportMontexExcelWorkbook,
  MontexPdfDocumentPayload,
  verifyExportPermission,
} from '../../services/documentExportService';

export const ProductionShopFloorView: React.FC = () => {
  const {
    productionSummary,
    alertThresholds,
    salesOrders,
    activeRbacGroup,
    currentUser,
    machineLogs,
    furnaceLogs,
    maintenanceTickets,
    powerLogs,
    ppcSchedules,
    setPpcSchedules,
    createMachineLogRecord,
    createFurnaceLogRecord,
    createMaintenanceTicketRecord,
    createPowerLogRecord,
  } = useRtdb();
  const [activeTab, setActiveTab] = useState<
    'shifts' | 'ppc_schedule' | 'furnace' | 'maintenance' | 'power'
  >('shifts');
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);

  const [showMachineModal, setShowMachineModal] = useState(false);
  const [showFurnaceModal, setShowFurnaceModal] = useState(false);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [showPowerModal, setShowPowerModal] = useState(false);

  // Machine Log Form State
  const [mShift, setMShift] = useState<ShopMachineLog['shift']>('Shift A (06:00-14:00)');
  const [mMachineName, setMMachineName] = useState('3.0 Ton Closed-Die Pneumatic Hammer #1');
  const [mOperator, setMOperator] = useState('Dattatray Pawar');
  const [mJobNo, setMJobNo] = useState(salesOrders[0]?.jobNumber || 'JOB-MF-2026-0412');
  const [mInputPcs, setMInputPcs] = useState<number>(80);
  const [mOkPcs, setMOkPcs] = useState<number>(77);
  const [mRejectedPcs, setMRejectedPcs] = useState<number>(1);
  const [mReworkPcs, setMReworkPcs] = useState<number>(2);
  const [mDowntimeMin, setMDowntimeMin] = useState<number>(15);

  // Furnace Form State
  const [fFurnaceName, setFFurnaceName] = useState('Pusher Reheating Furnace #1 (PNG Fired)');
  const [fFuelType, setFFuelType] = useState<FurnaceBatchLog['fuelType']>('PNG (Natural Gas)');
  const [fJobNo, setFJobNo] = useState('JOB-MF-2026-0412');
  const [fHeatNo, setFHeatNo] = useState('HEAT-JSW-8841-A');
  const [fChargeMt, setFChargeMt] = useState<number>(9.2);
  const [fTargetTempC, setFTargetTempC] = useState<number>(1210);
  const [fPeakTempC, setFPeakTempC] = useState<number>(1225);
  const [fSoakingMin, setFSoakingMin] = useState<number>(100);
  const [fFuelQty, setFFuelQty] = useState<number>(530);

  // Maintenance Form State
  const [mntMachineName, setMntMachineName] = useState('Radial-Axial CNC Ring Rolling Mill #2');
  const [mntType, setMntType] = useState<MachineMaintenanceTicket['maintenanceType']>('Breakdown');
  const [mntIssue, setMntIssue] = useState('');
  const [mntRootCause, setMntRootCause] = useState('');
  const [mntParts, setMntParts] = useState('');
  const [mntDowntime, setMntDowntime] = useState<number>(35);
  const [mntCost, setMntCost] = useState<number>(12500);
  const [mntTech, setMntTech] = useState('Ramesh Chavan');

  // Power Form State
  const [pwrDate, setPwrDate] = useState('2026-10-22');
  const [pwrKwh, setPwrKwh] = useState<number>(26400);
  const [pwrKvah, setPwrKvah] = useState<number>(26660);
  const [pwrPeakKva, setPwrPeakKva] = useState<number>(1410);
  const [pwrForgedMt, setPwrForgedMt] = useState<number>(55.8);
  const [pwrTariffInr, setPwrTariffInr] = useState<number>(8.8);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const canWriteProduction =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo', 'stores', 'quality'].includes(currentUser.role);

  const handleExportShopFloorWorkbook = () => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Production',
      'Finance',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }

    exportMontexExcelWorkbook(
      `Montex_ShopFloor_Operations_Workbook_${new Date().toISOString().split('T')[0]}.xlsx`,
      [
        {
          sheetName: 'Shift_Machine_Logs',
          reportTitle: 'MONTEX FORGE — SHOP-FLOOR SHIFT & MACHINE PRODUCTION REGISTER',
          reportSubtitle: `Total Shift Entries: ${machineLogs.length} | Exported by ${currentUser.name} (${activeRbacGroup})`,
          headers: [
            'Log ID',
            'Date',
            'Shift',
            'Machine ID',
            'Machine Name',
            'Operator Name',
            'Job Number',
            'Product Name',
            'Input Billets (PCS)',
            'Forged Output (PCS)',
            'OK Pcs',
            'Rejected Pcs',
            'Rework Pcs',
            'Downtime (Min)',
            'Capacity Utilization (%)',
          ],
          rows: machineLogs.map((m) => [
            m.id,
            m.date,
            m.shift,
            m.machineId,
            m.machineName,
            m.operatorName,
            m.jobNumber,
            m.productName,
            m.inputBilletsPcs,
            m.forgedOutputPcs,
            m.okPcs,
            m.rejectedPcs,
            m.reworkPcs,
            m.downtimeMinutes,
            m.capacityUtilizationPercent,
          ]),
          totalsRow: [
            'TOTAL',
            '',
            `${machineLogs.length} Logs`,
            '',
            '',
            '',
            '',
            '',
            machineLogs.reduce((s, m) => s + m.inputBilletsPcs, 0),
            machineLogs.reduce((s, m) => s + m.forgedOutputPcs, 0),
            machineLogs.reduce((s, m) => s + m.okPcs, 0),
            machineLogs.reduce((s, m) => s + m.rejectedPcs, 0),
            machineLogs.reduce((s, m) => s + m.reworkPcs, 0),
            machineLogs.reduce((s, m) => s + m.downtimeMinutes, 0),
            '',
          ],
        },
        {
          sheetName: 'Furnace_Batches',
          reportTitle: 'MONTEX FORGE — FURNACE CHARGE, TEMPERATURE & FUEL TRACEABILITY LOG',
          reportSubtitle: `Total Charges: ${furnaceLogs.length} | Max Temp Threshold: ${alertThresholds.furnaceTemp}°C`,
          headers: [
            'Batch ID',
            'Batch Number',
            'Date',
            'Shift',
            'Furnace Name',
            'Fuel Type',
            'Job Number',
            'Mill Heat Number',
            'Charge Weight (MT)',
            'Target Temp (°C)',
            'Peak Temp (°C)',
            'Soaking Time (Min)',
            'Fuel Consumed',
            'Fuel Unit',
            'Specific Fuel / MT',
            'Status',
          ],
          rows: furnaceLogs.map((b) => [
            b.id,
            b.batchNumber,
            b.date,
            b.shift,
            b.furnaceName,
            b.fuelType,
            b.jobNumber,
            b.heatNumber,
            b.chargeWeightMt,
            b.targetTempC,
            b.peakRecordedTempC,
            b.soakingTimeMinutes,
            b.fuelConsumedQty,
            b.fuelUnit,
            b.specificFuelPerMt,
            b.peakRecordedTempC > alertThresholds.furnaceTemp ? 'TEMP DEVIATION' : 'WITHIN SPEC',
          ]),
        },
        {
          sheetName: 'Maintenance_Downtime',
          reportTitle: 'MONTEX FORGE — MACHINE MAINTENANCE, BREAKDOWN & SPARES REGISTER',
          reportSubtitle: `Total Tickets: ${maintenanceTickets.length} | Downtime Alert Limit: ${alertThresholds.machineDowntimeMinutes} mins`,
          headers: [
            'Ticket ID',
            'Date',
            'Machine ID',
            'Machine Name',
            'Category',
            'Issue Description',
            'Root Cause',
            'Replacement Parts',
            'Downtime (Min)',
            'Maintenance Cost (INR)',
            'Technician',
            'Status',
          ],
          rows: maintenanceTickets.map((t) => [
            t.id,
            t.ticketDate,
            t.machineId,
            t.machineName,
            t.maintenanceType,
            t.issueDescription,
            t.rootCause,
            t.replacementParts,
            t.downtimeMinutes,
            t.maintenanceCostInr,
            t.technicianName,
            t.status.toUpperCase(),
          ]),
          totalsRow: [
            'TOTAL',
            '',
            '',
            `${maintenanceTickets.length} Tickets`,
            '',
            '',
            '',
            '',
            maintenanceTickets.reduce((s, t) => s + t.downtimeMinutes, 0),
            maintenanceTickets.reduce((s, t) => s + t.maintenanceCostInr, 0),
            '',
            '',
          ],
        },
        {
          sheetName: 'HT_Power_Logs',
          reportTitle: 'MONTEX FORGE — HT ELECTRICITY METER & SPECIFIC ENERGY (kWh/MT) LOG',
          reportSubtitle: `Total Meter Readings: ${powerLogs.length} | Target Specific Energy: <= 480.0 kWh/MT`,
          headers: [
            'Reading ID',
            'Date',
            'Active Energy (kWh)',
            'Apparent Energy (kVAh)',
            'Power Factor (PF)',
            'Peak Demand (kVA)',
            'Forged Output (MT)',
            'Specific Energy (kWh/MT)',
            'Target (kWh/MT)',
            'Electricity Cost (INR)',
          ],
          rows: powerLogs.map((p) => [
            p.id,
            p.date,
            p.totalKwh,
            p.totalKvah,
            p.powerFactor,
            p.peakDemandKva,
            p.forgedOutputMt,
            p.specificEnergyKwhPerMt,
            p.targetKwhPerMt,
            p.electricityCostInr,
          ]),
        },
      ]
    );

    setFeedback({
      type: 'success',
      message: `Downloaded 4-sheet Shop-Floor Operations Excel workbook (Shifts, Furnace, Maintenance & HT Power).`,
    });
  };

  const handleOpenProductionPdf = () => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Production',
      'Finance',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }

    const payload: MontexPdfDocumentPayload = {
      filename: `Montex_ShopFloor_Production_Report_${new Date().toISOString().split('T')[0]}.pdf`,
      documentCode: `PROD-RPT-${new Date().toISOString().split('T')[0].replace(/-/g, '')}`,
      documentTitle: 'SHOP-FLOOR PRODUCTION, FURNACE, MAINTENANCE & POWER REPORT',
      documentSubtitle: 'Chakan Works — Shift Forging Output, Thermal Soaking, Breakdowns & Specific Energy',
      readiness: 'ready',
      readinessBannerText:
        'READY TO GENERATE — Verified Shop-Floor Shift, Furnace, Maintenance & HT Power Records',
      metadataGrid: [
        { label: 'Plant Location', value: 'Montex Forge — Chakan Works, Pune' },
        { label: 'Active View Tab', value: activeTab.toUpperCase() },
        {
          label: 'Total Shift Tonnage',
          value: `${Object.values(productionSummary.shifts)
            .reduce((s, sh) => s + sh.tonnageMt, 0)
            .toFixed(1)} MT`,
        },
        {
          label: 'Overall Shop Rejection',
          value: `${productionSummary.totalRejectionPercent}% (Target < 2.0%)`,
        },
        {
          label: 'Furnace Temp Threshold',
          value: `${alertThresholds.furnaceTemp}°C`,
        },
        {
          label: 'Latest Specific Energy',
          value: `${powerLogs[0]?.specificEnergyKwhPerMt || 465} kWh/MT (Target ≤ 480)`,
        },
      ],
      tables: [
        {
          sectionTitle: '1. Shift-Wise Machine Production & Yield Register',
          headers: [
            'Date & Shift',
            'Machine / Press',
            'Operator',
            'Job No.',
            'Input (PCS)',
            'OK (PCS)',
            'Rej / Rwk',
            'Downtime',
            'Util %',
          ],
          rows: machineLogs.map((m) => [
            `${m.date} (${m.shift.split(' ')[1] || m.shift})`,
            m.machineName,
            m.operatorName,
            m.jobNumber,
            m.inputBilletsPcs,
            m.okPcs,
            `${m.rejectedPcs} / ${m.reworkPcs}`,
            `${m.downtimeMinutes}m`,
            `${m.capacityUtilizationPercent}%`,
          ]),
        },
        {
          sectionTitle: '2. Furnace Charge, Soaking Temperature & Fuel Traceability',
          headers: [
            'Batch #',
            'Date',
            'Furnace',
            'Job / Heat No.',
            'Charge (MT)',
            'Target / Peak (°C)',
            'Soak (Min)',
            'Fuel Consumed',
            'Status',
          ],
          rows: furnaceLogs.map((b) => [
            b.batchNumber,
            b.date,
            b.furnaceName,
            `${b.jobNumber} / ${b.heatNumber}`,
            b.chargeWeightMt.toFixed(1),
            `${b.targetTempC}°C / ${b.peakRecordedTempC}°C`,
            b.soakingTimeMinutes,
            `${b.fuelConsumedQty} ${b.fuelUnit}`,
            b.peakRecordedTempC > alertThresholds.furnaceTemp ? 'TEMP DEVIATION' : 'WITHIN SPEC',
          ]),
        },
        {
          sectionTitle: '3. Machine Maintenance & Breakdown Tickets',
          headers: [
            'Ticket ID',
            'Date',
            'Machine',
            'Type',
            'Issue & Root Cause',
            'Downtime (Min)',
            'Cost (INR)',
          ],
          rows: maintenanceTickets.map((t) => [
            t.id,
            t.ticketDate,
            t.machineName,
            t.maintenanceType,
            `${t.issueDescription} (${t.rootCause})`,
            t.downtimeMinutes,
            `INR ${t.maintenanceCostInr.toLocaleString('en-IN')}`,
          ]),
        },
      ],
      notesAndTerms: [
        'All shift logs enforce OK + Rejected + Rework <= Input Billets.',
        `Furnace charges exceeding ${alertThresholds.furnaceTemp}°C are flagged for metallurgical grain-size re-verification.`,
      ],
      footerDisclaimer:
        'INTERNAL SHOP-FLOOR OPERATIONS REPORT — Generated from Montex Forge MIS (/production).',
      generatedBy: currentUser.name,
      generatedRole: activeRbacGroup,
    };

    setPreviewPayload(payload);
  };

  const handleAddMachineLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!canWriteProduction) {
      setFeedback({
        type: 'error',
        message:
          currentUser.accountStatus !== 'active'
            ? `Access Restricted: Account '${currentUser.email}' is ${currentUser.accountStatus}. Only active accounts can log shop-floor production.`
            : `Access Restricted: Role '${currentUser.role}' (${activeRbacGroup}) cannot log shop-floor production. Switch to Super Admin or Production.`,
      });
      return;
    }
    if (mInputPcs <= 0 || mOkPcs < 0 || mRejectedPcs < 0 || mReworkPcs < 0 || mDowntimeMin < 0) {
      setFeedback({
        type: 'error',
        message: 'Input billets must be > 0 and output/downtime quantities cannot be negative.',
      });
      return;
    }
    if (mOkPcs + mRejectedPcs + mReworkPcs > mInputPcs) {
      setFeedback({
        type: 'error',
        message: `Quantity Invariant Violation: OK (${mOkPcs}) + Rejected (${mRejectedPcs}) + Rework (${mReworkPcs}) = ${
          mOkPcs + mRejectedPcs + mReworkPcs
        } PCS cannot exceed Input Billets (${mInputPcs} PCS).`,
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    const order = salesOrders.find((o) => o.jobNumber === mJobNo) || salesOrders[0];
    const newLog: ShopMachineLog = {
      id: `MLOG-2026-${Math.floor(110 + Math.random() * 880)}`,
      date: new Date().toISOString().split('T')[0],
      shift: mShift,
      machineId: mMachineName.includes('Hammer')
        ? 'MCH-HAM-01'
        : mMachineName.includes('Ring')
        ? 'MCH-RRM-02'
        : 'MCH-PSP-03',
      machineName: mMachineName,
      operatorName: mOperator,
      jobNumber: mJobNo,
      productName: order?.lineItems?.[0]?.productName || 'Forged Component',
      inputBilletsPcs: mInputPcs,
      forgedOutputPcs: mOkPcs + mRejectedPcs + mReworkPcs,
      okPcs: mOkPcs,
      rejectedPcs: mRejectedPcs,
      reworkPcs: mReworkPcs,
      downtimeMinutes: mDowntimeMin,
      capacityUtilizationPercent: Number(
        Math.max(50, Math.min(99, ((480 - mDowntimeMin) / 480) * 100)).toFixed(1)
      ),
    };

    const res = await createMachineLogRecord(newLog);
    setSaving(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to persist shop-floor machine log.',
      });
      return;
    }

    setShowMachineModal(false);
    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Saved to Cloud Firestore (/machineLogs/${newLog.id}): Recorded shop-floor shift entry ${newLog.id} (${mOkPcs} OK, ${mRejectedPcs} Rejected, ${mReworkPcs} Rework) for ${mJobNo}.`
        : `[Demo Preview Mode] Recorded shop-floor shift entry ${newLog.id} (${mOkPcs} OK, ${mRejectedPcs} Rejected, ${mReworkPcs} Rework) for ${mJobNo} and updated shift summary in session state.`,
    });
  };

  const handleAddFurnaceBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!canWriteProduction) {
      setFeedback({
        type: 'error',
        message: `Access Restricted: Role '${currentUser.role}' (${currentUser.accountStatus}) cannot log furnace batches.`,
      });
      return;
    }
    if (fChargeMt <= 0 || fFuelQty <= 0) {
      setFeedback({
        type: 'error',
        message: 'Charge weight (MT) and fuel consumed must be greater than zero.',
      });
      return;
    }

    const isTempExceeding = fPeakTempC > alertThresholds.furnaceTemp;
    const fuelUnit: FurnaceBatchLog['fuelUnit'] =
      fFuelType === 'LDO (Light Diesel Oil)'
        ? 'Liters'
        : fFuelType === 'PNG (Natural Gas)'
        ? 'SCM'
        : 'kWh';

    const newBatch: FurnaceBatchLog = {
      id: `FURN-2026-${Math.floor(410 + Math.random() * 500)}`,
      batchNumber: `CHG-OCT-${Math.floor(410 + Math.random() * 500)}`,
      date: new Date().toISOString().split('T')[0],
      shift: 'Shift A',
      furnaceId: fFurnaceName.includes('#1') ? 'FUR-01' : fFurnaceName.includes('#2') ? 'FUR-02' : 'FUR-03',
      furnaceName: fFurnaceName,
      fuelType: fFuelType,
      jobNumber: fJobNo,
      heatNumber: fHeatNo,
      chargeWeightMt: fChargeMt,
      targetTempC: fTargetTempC,
      peakRecordedTempC: fPeakTempC,
      soakingTimeMinutes: fSoakingMin,
      fuelConsumedQty: fFuelQty,
      fuelUnit,
      specificFuelPerMt: Number((fFuelQty / fChargeMt).toFixed(1)),
      status: isTempExceeding ? 'temp_deviation' : 'within_spec',
    };

    setSaving(true);
    setFeedback(null);
    const res = await createFurnaceLogRecord(newBatch);
    setSaving(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to persist furnace batch log.',
      });
      return;
    }

    setShowFurnaceModal(false);
    setFeedback({
      type: isTempExceeding ? 'error' : 'success',
      message: isTempExceeding
        ? `Saved Furnace Batch ${newBatch.batchNumber} (${res.persistedToFirestore ? 'Cloud Firestore /furnaceLogs' : 'Demo Session'}) — TEMPERATURE ALERT: Peak ${fPeakTempC}°C exceeds threshold (${alertThresholds.furnaceTemp}°C). QA metallurgist notified.`
        : res.persistedToFirestore
        ? `Saved to Cloud Firestore (/furnaceLogs/${newBatch.id}): Recorded Furnace Charge ${newBatch.batchNumber} (${fChargeMt} MT, Peak ${fPeakTempC}°C, Specific Fuel: ${newBatch.specificFuelPerMt} ${fuelUnit}/MT).`
        : `[Demo Preview Mode] Recorded Furnace Charge ${newBatch.batchNumber} (${fChargeMt} MT, Peak ${fPeakTempC}°C, Specific Fuel: ${newBatch.specificFuelPerMt} ${fuelUnit}/MT) in session register.`,
    });
  };

  const handleAddMaintenanceTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!canWriteProduction) {
      setFeedback({
        type: 'error',
        message: `Access Restricted: Role '${currentUser.role}' (${currentUser.accountStatus}) cannot log maintenance tickets.`,
      });
      return;
    }
    if (mntDowntime < 0 || mntCost < 0) {
      setFeedback({
        type: 'error',
        message: 'Downtime minutes and maintenance cost cannot be negative.',
      });
      return;
    }

    const newTicket: MachineMaintenanceTicket = {
      id: `MNT-2026-0${Math.floor(46 + Math.random() * 50)}`,
      ticketDate: new Date().toISOString().split('T')[0],
      machineId: mntMachineName.includes('Hammer')
        ? 'MCH-HAM-01'
        : mntMachineName.includes('Ring')
        ? 'MCH-RRM-02'
        : 'MCH-SAW-04',
      machineName: mntMachineName,
      maintenanceType: mntType,
      issueDescription: mntIssue.trim() || 'Scheduled inspection and wear adjustment',
      rootCause: mntRootCause.trim() || 'Normal cyclic forging wear',
      replacementParts: mntParts.trim() || 'Standard consumables & seals',
      downtimeMinutes: mntDowntime,
      maintenanceCostInr: mntCost,
      technicianName: mntTech.trim() || 'Maintenance Team',
      status: 'resolved',
    };

    setSaving(true);
    setFeedback(null);
    const res = await createMaintenanceTicketRecord(newTicket);
    setSaving(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to persist machine maintenance ticket.',
      });
      return;
    }

    setShowMaintenanceModal(false);
    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Saved to Cloud Firestore (/maintenanceTickets/${newTicket.id}): Logged Maintenance Ticket ${newTicket.id} for ${newTicket.machineName} (Downtime: ${mntDowntime} mins, Cost: ₹${mntCost.toLocaleString()}).`
        : `[Demo Preview Mode] Logged Maintenance Ticket ${newTicket.id} for ${newTicket.machineName} (Downtime: ${mntDowntime} mins, Cost: ₹${mntCost.toLocaleString()}) in session register.`,
    });
  };

  const handleAddPowerLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!canWriteProduction) {
      setFeedback({
        type: 'error',
        message: `Access Restricted: Role '${currentUser.role}' (${currentUser.accountStatus}) cannot log HT power consumption.`,
      });
      return;
    }
    if (pwrKwh <= 0 || pwrForgedMt <= 0) {
      setFeedback({
        type: 'error',
        message: 'Total kWh and forged output tonnage (MT) must be greater than zero.',
      });
      return;
    }

    const pf = Number(Math.min(1.0, pwrKwh / Math.max(pwrKwh, pwrKvah)).toFixed(3));
    const sec = Number((pwrKwh / pwrForgedMt).toFixed(1));
    const cost = Math.round(pwrKwh * pwrTariffInr);

    const newLog: PowerConsumptionLog = {
      id: `PWR-${pwrDate.replace(/-/g, '')}`,
      date: pwrDate,
      totalKwh: pwrKwh,
      totalKvah: pwrKvah,
      powerFactor: pf,
      peakDemandKva: pwrPeakKva,
      forgedOutputMt: pwrForgedMt,
      specificEnergyKwhPerMt: sec,
      targetKwhPerMt: 480.0,
      electricityCostInr: cost,
      furnaceSharePercent: 46,
      pressHammerSharePercent: 39,
    };

    setSaving(true);
    setFeedback(null);
    const res = await createPowerLogRecord(newLog);
    setSaving(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to persist HT power consumption log.',
      });
      return;
    }

    setShowPowerModal(false);
    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Saved to Cloud Firestore (/powerLogs/${newLog.id}): Recorded HT Power Log for ${pwrDate}: ${pwrKwh.toLocaleString()} kWh · Specific Energy: ${sec} kWh/MT (Target: 480 kWh/MT).`
        : `[Demo Preview Mode] Recorded HT Power Log for ${pwrDate}: ${pwrKwh.toLocaleString()} kWh · Specific Energy: ${sec} kWh/MT (Target: 480 kWh/MT) in session register.`,
    });
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <span>Plant Operations & Engineering</span>
            <span aria-hidden="true">·</span>
            <span>Forging Shop, Furnaces, Maintenance & HT Power</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700">Chakan Works</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
            Shop-Floor Production, Furnace, Maintenance & Power
          </h1>
          <p className="text-slate-500 mt-0.5">
            Shift-wise hammer/press output, furnace soaking temperature & fuel logs, breakdown maintenance, and specific energy (kWh/MT).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportShopFloorWorkbook}
            className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-md font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export Shop-Floor Workbook (.xlsx)</span>
          </button>
          <button
            onClick={handleOpenProductionPdf}
            className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-md font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-indigo-700" />
            <span>Printable Production PDF</span>
          </button>
          {activeTab === 'shifts' && (
            <button
              onClick={() => setShowMachineModal(true)}
              className="px-3.5 py-2 bg-slate-900 text-white rounded-md font-semibold hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Shift Machine Output</span>
            </button>
          )}
          {activeTab === 'furnace' && (
            <button
              onClick={() => setShowFurnaceModal(true)}
              className="px-3.5 py-2 bg-slate-900 text-white rounded-md font-semibold hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Record Furnace Charge Batch</span>
            </button>
          )}
          {activeTab === 'maintenance' && (
            <button
              onClick={() => setShowMaintenanceModal(true)}
              className="px-3.5 py-2 bg-slate-900 text-white rounded-md font-semibold hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Maintenance / Breakdown</span>
            </button>
          )}
          {activeTab === 'power' && (
            <button
              onClick={() => setShowPowerModal(true)}
              className="px-3.5 py-2 bg-slate-900 text-white rounded-md font-semibold hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Record Daily HT Power Meter</span>
            </button>
          )}
        </div>
      </div>

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

      {/* Module Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('shifts')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            activeTab === 'shifts'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Factory className="w-3.5 h-3.5" />
          <span>Shifts &amp; Machine Logs ({machineLogs.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('ppc_schedule')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            activeTab === 'ppc_schedule'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
          <span>PPC Master Schedule &amp; Billet Cutting ({ppcSchedules.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('furnace')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            activeTab === 'furnace'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Flame className="w-3.5 h-3.5 text-amber-600" />
          <span>Furnace & Fuel Traceability ({furnaceLogs.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('maintenance')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            activeTab === 'maintenance'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Wrench className="w-3.5 h-3.5 text-indigo-600" />
          <span>Machine Maintenance & Downtime ({maintenanceTickets.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('power')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            activeTab === 'power'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Zap className="w-3.5 h-3.5 text-emerald-600" />
          <span>Electricity & Power Targets ({powerLogs.length})</span>
        </button>
      </div>

      {/* TAB 1: SHIFTS & MACHINE LOGS */}
      {activeTab === 'shifts' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(productionSummary.shifts).map(([key, sh]) => (
              <div key={key} className="bg-white p-4 rounded-lg border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{sh.name}</span>
                  <span className="font-mono text-emerald-700 font-bold">{sh.yieldPercent}% Yield</span>
                </div>
                <div className="flex items-baseline justify-between font-mono pt-1">
                  <div>
                    <span className="text-slate-500 text-[11px] block">Forged Output</span>
                    <span className="text-base font-bold text-slate-900">{sh.tonnageMt} MT</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500 text-[11px] block">Shift Rejections</span>
                    <span className="text-sm font-bold text-rose-700">{sh.rejectedPcs} PCS</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Machine-Wise Operator Production & Rework Register
                </h3>
                <p className="text-slate-500">
                  Tracks input billets, OK forgings, scrap rejections, die-rework pieces, and press utilization.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Date & Shift</th>
                    <th className="py-3 px-3.5">Machine / Press Asset</th>
                    <th className="py-3 px-3.5">Operator</th>
                    <th className="py-3 px-3.5">Job No. & Product</th>
                    <th className="py-3 px-3.5 text-right">Input / OK / Rej / Rework</th>
                    <th className="py-3 px-3.5 text-right">Downtime</th>
                    <th className="py-3 px-3.5 text-right">Capacity Util.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {machineLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5">
                        <div className="font-mono font-bold text-slate-900">{log.date}</div>
                        <div className="text-[11px] text-slate-500">{log.shift}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900">{log.machineName}</div>
                        <div className="font-mono text-[11px] text-slate-400">{log.machineId}</div>
                      </td>
                      <td className="py-3 px-3.5 font-medium text-slate-800">{log.operatorName}</td>
                      <td className="py-3 px-3.5">
                        <span className="font-mono font-bold text-indigo-700">{log.jobNumber}</span>
                        <div className="text-[11px] text-slate-500">{log.productName}</div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                        <span className="font-bold text-slate-900">{log.inputBilletsPcs}</span>
                        <span className="text-slate-400"> / </span>
                        <span className="text-emerald-700 font-bold">{log.okPcs} OK</span>
                        <span className="text-slate-400"> / </span>
                        <span className="text-rose-700 font-bold">{log.rejectedPcs} Rej</span>
                        <span className="text-slate-400"> / </span>
                        <span className="text-amber-700 font-semibold">{log.reworkPcs} Rwk</span>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono text-slate-700">
                        {log.downtimeMinutes} mins
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono font-bold text-emerald-800">
                        {log.capacityUtilizationPercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: FURNACE & FUEL LOGS */}
      {activeTab === 'furnace' && (
        <div className="space-y-4">
          <div className="p-3.5 bg-slate-900 text-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Metallurgical Soaking Guard:</strong> Company threshold for maximum furnace temperature is{' '}
                <code className="text-amber-300 font-mono">{alertThresholds.furnaceTemp}°C</code>. Any charge exceeding this limit is automatically flagged for grain-size & hardness re-verification.
              </span>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Batch # & Date</th>
                    <th className="py-3 px-3.5">Furnace & Fuel Type</th>
                    <th className="py-3 px-3.5">Job # & Mill Heat #</th>
                    <th className="py-3 px-3.5 text-right">Charge Wt (MT)</th>
                    <th className="py-3 px-3.5 text-right">Target / Peak Temp</th>
                    <th className="py-3 px-3.5 text-right">Soak Time</th>
                    <th className="py-3 px-3.5 text-right">Fuel & Specific Rate</th>
                    <th className="py-3 px-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {furnaceLogs.map((b) => {
                    const overTemp = b.peakRecordedTempC > alertThresholds.furnaceTemp;
                    return (
                      <tr key={b.id} className={overTemp ? 'bg-rose-50/40' : 'hover:bg-slate-50/60'}>
                        <td className="py-3 px-3.5">
                          <div className="font-mono font-bold text-slate-900">{b.batchNumber}</div>
                          <div className="text-[11px] text-slate-500">
                            {b.date} · {b.shift}
                          </div>
                        </td>
                        <td className="py-3 px-3.5">
                          <div className="font-bold text-slate-900">{b.furnaceName}</div>
                          <div className="text-[11px] text-slate-500">{b.fuelType}</div>
                        </td>
                        <td className="py-3 px-3.5 font-mono">
                          <div className="font-bold text-indigo-700">{b.jobNumber}</div>
                          <div className="text-[11px] text-slate-500">{b.heatNumber}</div>
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900">
                          {b.chargeWeightMt.toFixed(1)} MT
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                          <span className="text-slate-600">{b.targetTempC}°C / </span>
                          <span className={overTemp ? 'text-rose-700 font-bold' : 'text-slate-900 font-bold'}>
                            {b.peakRecordedTempC}°C
                          </span>
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono text-slate-700">
                          {b.soakingTimeMinutes} mins
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                          <div className="font-bold text-slate-900">
                            {b.fuelConsumedQty.toLocaleString()} {b.fuelUnit}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {b.specificFuelPerMt} {b.fuelUnit}/MT
                          </div>
                        </td>
                        <td className="py-3 px-3.5">
                          <StatusBadge
                            status={overTemp ? 'rejected' : 'completed'}
                            label={overTemp ? 'TEMP DEVIATION' : 'WITHIN SPEC'}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MACHINE MAINTENANCE & BREAKDOWNS */}
      {activeTab === 'maintenance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <span className="text-slate-500 block">Total Logged Downtime</span>
              <span className="text-lg font-bold font-mono text-slate-900 mt-0.5 block">
                {maintenanceTickets.reduce((acc, m) => acc + m.downtimeMinutes, 0)} Minutes
              </span>
              <span className="text-[11px] text-slate-500">
                Alert Threshold: {alertThresholds.machineDowntimeMinutes} mins/event
              </span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <span className="text-slate-500 block">Maintenance & Spares Cost</span>
              <span className="text-lg font-bold font-mono text-slate-900 mt-0.5 block">
                ₹{maintenanceTickets.reduce((acc, m) => acc + m.maintenanceCostInr, 0).toLocaleString()}
              </span>
              <span className="text-[11px] text-slate-500">October MTD Spares & Hydraulics</span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <span className="text-slate-500 block">Events Exceeding Threshold</span>
              <span className="text-lg font-bold font-mono text-amber-700 mt-0.5 block">
                {
                  maintenanceTickets.filter(
                    (m) => m.downtimeMinutes > alertThresholds.machineDowntimeMinutes
                  ).length
                }{' '}
                Event(s)
              </span>
              <span className="text-[11px] text-slate-500">Ring Rolling Mill Hydraulic Seal</span>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Ticket # & Date</th>
                    <th className="py-3 px-3.5">Machine & Category</th>
                    <th className="py-3 px-3.5">Issue & Root Cause</th>
                    <th className="py-3 px-3.5">Replacement Spare Parts</th>
                    <th className="py-3 px-3.5 text-right">Downtime</th>
                    <th className="py-3 px-3.5 text-right">Repair Cost</th>
                    <th className="py-3 px-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {maintenanceTickets.map((t) => {
                    const exceedsDowntime =
                      t.downtimeMinutes > alertThresholds.machineDowntimeMinutes;
                    return (
                      <tr key={t.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-3.5">
                          <div className="font-mono font-bold text-slate-900">{t.id}</div>
                          <div className="font-mono text-[11px] text-slate-500">{t.ticketDate}</div>
                        </td>
                        <td className="py-3 px-3.5">
                          <div className="font-bold text-slate-900">{t.machineName}</div>
                          <div className="text-[11px] text-indigo-700 font-semibold">
                            {t.maintenanceType}
                          </div>
                        </td>
                        <td className="py-3 px-3.5 max-w-xs">
                          <div className="font-medium text-slate-900">{t.issueDescription}</div>
                          <div className="text-[11px] text-slate-500">Root Cause: {t.rootCause}</div>
                        </td>
                        <td className="py-3 px-3.5 text-slate-700">
                          <div>{t.replacementParts}</div>
                          <div className="text-[11px] text-slate-400">By: {t.technicianName}</div>
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono">
                          <span
                            className={`font-bold ${
                              exceedsDowntime ? 'text-rose-700' : 'text-slate-900'
                            }`}
                          >
                            {t.downtimeMinutes} mins
                          </span>
                          {exceedsDowntime && (
                            <div className="text-[10px] text-rose-600 font-semibold">
                              &gt; {alertThresholds.machineDowntimeMinutes}m limit
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900">
                          ₹{t.maintenanceCostInr.toLocaleString()}
                        </td>
                        <td className="py-3 px-3.5">
                          <StatusBadge status="completed" label={t.status.toUpperCase()} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: ELECTRICITY & POWER CONSUMPTION */}
      {activeTab === 'power' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <span className="text-slate-500 block">Latest Specific Energy</span>
              <span className="text-lg font-bold font-mono text-emerald-700 mt-0.5 block">
                {powerLogs[0]?.specificEnergyKwhPerMt} kWh / MT
              </span>
              <span className="text-[11px] text-slate-500">Management Target: ≤ 480.0 kWh/MT</span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <span className="text-slate-500 block">HT Power Factor (PF)</span>
              <span className="text-lg font-bold font-mono text-slate-900 mt-0.5 block">
                {powerLogs[0]?.powerFactor} PF
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold">
                MSEDCL Unity PF Incentive Eligible
              </span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <span className="text-slate-500 block">Peak Demand Recorded</span>
              <span className="text-lg font-bold font-mono text-slate-900 mt-0.5 block">
                {powerLogs[0]?.peakDemandKva} kVA
              </span>
              <span className="text-[11px] text-slate-500">Contract Demand: 1,650 kVA</span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <span className="text-slate-500 block">Latest Daily Power Cost</span>
              <span className="text-lg font-bold font-mono text-slate-900 mt-0.5 block">
                ₹{((powerLogs[0]?.electricityCostInr || 0) / 100000).toFixed(2)} Lakhs
              </span>
              <span className="text-[11px] text-slate-500">
                {powerLogs[0]?.totalKwh.toLocaleString()} kWh Consumed
              </span>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Date</th>
                    <th className="py-3 px-3.5 text-right">Total kWh / kVAh</th>
                    <th className="py-3 px-3.5 text-right">Power Factor</th>
                    <th className="py-3 px-3.5 text-right">Forged Output (MT)</th>
                    <th className="py-3 px-3.5 text-right">Specific Energy (kWh/MT)</th>
                    <th className="py-3 px-3.5 text-right">Target (kWh/MT)</th>
                    <th className="py-3 px-3.5 text-right">Daily Cost (₹)</th>
                    <th className="py-3 px-3.5">Target Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {powerLogs.map((p) => {
                    const overTarget = p.specificEnergyKwhPerMt > p.targetKwhPerMt;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-3.5 font-mono font-bold text-slate-900">{p.date}</td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                          <span className="font-bold text-slate-900">
                            {p.totalKwh.toLocaleString()}
                          </span>
                          <span className="text-slate-400"> / </span>
                          <span className="text-slate-600">{p.totalKvah.toLocaleString()}</span>
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-semibold text-emerald-700">
                          {p.powerFactor}
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900">
                          {p.forgedOutputMt.toFixed(1)} MT
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-bold">
                          <span className={overTarget ? 'text-amber-700' : 'text-emerald-700'}>
                            {p.specificEnergyKwhPerMt} kWh/MT
                          </span>
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono text-slate-500">
                          {p.targetKwhPerMt.toFixed(1)} kWh/MT
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900">
                          ₹{p.electricityCostInr.toLocaleString()}
                        </td>
                        <td className="py-3 px-3.5">
                          <StatusBadge
                            status={overTarget ? 'warning' : 'completed'}
                            label={overTarget ? 'ABOVE TARGET' : 'WITHIN TARGET'}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: PPC MASTER SCHEDULE & BILLET CUTTING RELEASE */}
      {activeTab === 'ppc_schedule' && (
        <div className="space-y-4">
          <div className="bg-slate-900 text-white p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="font-bold text-amber-400 uppercase tracking-wider text-[11px]">
                PPC Master Schedule, Machine Capacity &amp; Band-Saw Billet Cutting Release
              </span>
              <p className="text-slate-300 text-[11px] mt-0.5">
                Tracks planned vs. actual forged output, band-saw billet cutting clearance, and job release to 3.0T Hammer, CNC Ring Mill, and 1600T Screw Press.
              </p>
            </div>
            <div className="font-mono text-xs bg-slate-800 px-3 py-1.5 rounded border border-slate-700">
              Released Jobs: {ppcSchedules.filter((s) => s.billetCuttingStatus === 'billets_released').length} / {ppcSchedules.length}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Job No. &amp; Customer</th>
                    <th className="py-3 px-3.5">Product &amp; Heat No.</th>
                    <th className="py-3 px-3.5">Assigned Hammer / Press</th>
                    <th className="py-3 px-3.5">Schedule Window</th>
                    <th className="py-3 px-3.5 text-right">Planned vs Actual</th>
                    <th className="py-3 px-3.5">Billet Cutting Status</th>
                    <th className="py-3 px-3.5">PPC Schedule Status</th>
                    <th className="py-3 px-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ppcSchedules.map((sch) => (
                    <tr key={sch.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5">
                        <div className="font-mono font-bold text-slate-900">{sch.jobNumber}</div>
                        <div className="text-[11px] text-slate-600 font-semibold">{sch.customerName}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-slate-800">{sch.productName}</div>
                        <div className="font-mono text-[11px] text-indigo-700">
                          {sch.materialGrade} · Heat: {sch.heatNumber}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 font-medium text-slate-800">{sch.machineName}</td>
                      <td className="py-3 px-3.5 font-mono text-[11px]">
                        <div>Start: {sch.plannedStartDate}</div>
                        <div>End: {sch.plannedEndDate}</div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono">
                        <span className="font-bold text-emerald-700">{sch.actualForgedPcs}</span>
                        <span className="text-slate-400"> / </span>
                        <span className="font-bold text-slate-900">{sch.plannedQtyPcs} PCS</span>
                      </td>
                      <td className="py-3 px-3.5">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                            sch.billetCuttingStatus === 'billets_released'
                              ? 'bg-emerald-100 text-emerald-800'
                              : sch.billetCuttingStatus === 'sawing_in_progress'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {sch.billetCuttingStatus.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-3.5">
                        <StatusBadge
                          status={
                            sch.status === 'completed'
                              ? 'completed'
                              : sch.status === 'delayed'
                              ? 'rejected'
                              : 'in_progress'
                          }
                          label={(sch.status || 'scheduled').replace(/_/g, ' ').toUpperCase()}
                        />
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        {sch.billetCuttingStatus !== 'billets_released' ? (
                          <button
                            onClick={() => {
                              setPpcSchedules((prev) =>
                                prev.map((item) =>
                                  item.id === sch.id
                                    ? {
                                        ...item,
                                        billetCuttingStatus: 'billets_released',
                                        status: 'in_progress',
                                      }
                                    : item
                                )
                              );
                              setFeedback({
                                type: 'success',
                                message: `PPC Schedule ${sch.jobNumber}: Released cut billets from Band-Saw #4 to ${sch.machineName}.`,
                              });
                            }}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] cursor-pointer"
                          >
                            Release Cut Billets
                          </button>
                        ) : (
                          <span className="text-[11px] font-mono text-emerald-700 font-semibold">
                            Released to Shop
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: LOG MACHINE SHIFT OUTPUT */}
      {showMachineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleAddMachineLog}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Log Shift Machine Output & Yield
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Validates that OK + Rejected + Rework pieces do not exceed input billets and updates <code className="font-mono">/production</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMachineModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Shift</label>
                  <select
                    value={mShift}
                    onChange={(e) => setMShift(e.target.value as ShopMachineLog['shift'])}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="Shift A (06:00-14:00)">Shift A (06:00-14:00)</option>
                    <option value="Shift B (14:00-22:00)">Shift B (14:00-22:00)</option>
                    <option value="Shift C (22:00-06:00)">Shift C (22:00-06:00)</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Job Number</label>
                  <select
                    value={mJobNo}
                    onChange={(e) => setMJobNo(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded bg-white font-mono"
                  >
                    {salesOrders.map((o) => (
                      <option key={o.id} value={o.jobNumber}>
                        {o.jobNumber} ({o.customerName.split(' ')[0]})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Forging Hammer / Press</label>
                  <select
                    value={mMachineName}
                    onChange={(e) => setMMachineName(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="3.0 Ton Closed-Die Pneumatic Hammer #1">
                      3.0 Ton Closed-Die Pneumatic Hammer #1
                    </option>
                    <option value="Radial-Axial CNC Ring Rolling Mill #2">
                      Radial-Axial CNC Ring Rolling Mill #2
                    </option>
                    <option value="1600 Ton Friction Screw Press #3">
                      1600 Ton Friction Screw Press #3
                    </option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Lead Operator</label>
                  <input
                    type="text"
                    required
                    value={mOperator}
                    onChange={(e) => setMOperator(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Input Billets</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={mInputPcs}
                    onChange={(e) => setMInputPcs(Number(e.target.value) || 1)}
                    className="w-full p-2 border border-slate-300 rounded font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="font-semibold text-emerald-700 block mb-1">OK Pcs</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={mOkPcs}
                    onChange={(e) => setMOkPcs(Number(e.target.value) || 0)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-rose-700 block mb-1">Rejected</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={mRejectedPcs}
                    onChange={(e) => setMRejectedPcs(Number(e.target.value) || 0)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-amber-700 block mb-1">Rework</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={mReworkPcs}
                    onChange={(e) => setMReworkPcs(Number(e.target.value) || 0)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Shift Downtime (Minutes)</label>
                <input
                  type="number"
                  min={0}
                  max={480}
                  required
                  value={mDowntimeMin}
                  onChange={(e) => setMDowntimeMin(Number(e.target.value) || 0)}
                  className="w-full p-2 border border-slate-300 rounded font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowMachineModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 cursor-pointer"
              >
                {saving ? 'Syncing /production...' : 'Save Machine Log'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: RECORD FURNACE CHARGE BATCH */}
      {showFurnaceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleAddFurnaceBatch}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Record Furnace Charge & Temperature Log
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Checks peak soaking temperature against <code className="font-mono">{alertThresholds.furnaceTemp}°C</code> threshold.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFurnaceModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Furnace Unit</label>
                  <select
                    value={fFurnaceName}
                    onChange={(e) => setFFurnaceName(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="Pusher Reheating Furnace #1 (PNG Fired)">
                      Pusher Reheating Furnace #1 (PNG Fired)
                    </option>
                    <option value="Bogie Hearth Forging Furnace #2 (LDO Fired)">
                      Bogie Hearth Forging Furnace #2 (LDO Fired)
                    </option>
                    <option value="Electric Normalizing & Tempering Furnace #3">
                      Electric Normalizing & Tempering Furnace #3
                    </option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Fuel Source</label>
                  <select
                    value={fFuelType}
                    onChange={(e) => setFFuelType(e.target.value as FurnaceBatchLog['fuelType'])}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="PNG (Natural Gas)">PNG (Natural Gas - SCM)</option>
                    <option value="LDO (Light Diesel Oil)">LDO (Light Diesel Oil - Liters)</option>
                    <option value="Electric Induction">Electric Resistance/Induction (kWh)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Job Number</label>
                  <input
                    type="text"
                    required
                    value={fJobNo}
                    onChange={(e) => setFJobNo(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Mill Cast Heat Number</label>
                  <input
                    type="text"
                    required
                    value={fHeatNo}
                    onChange={(e) => setFHeatNo(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Charge Wt (MT)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0.5}
                    required
                    value={fChargeMt}
                    onChange={(e) => setFChargeMt(Number(e.target.value) || 1)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Target Temp (°C)</label>
                  <input
                    type="number"
                    required
                    value={fTargetTempC}
                    onChange={(e) => setFTargetTempC(Number(e.target.value) || 1200)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Peak Recorded (°C)</label>
                  <input
                    type="number"
                    required
                    value={fPeakTempC}
                    onChange={(e) => setFPeakTempC(Number(e.target.value) || 1220)}
                    className="w-full p-2 border border-slate-300 rounded font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Soaking Duration (Mins)</label>
                  <input
                    type="number"
                    min={10}
                    required
                    value={fSoakingMin}
                    onChange={(e) => setFSoakingMin(Number(e.target.value) || 90)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Fuel Consumed Qty</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={fFuelQty}
                    onChange={(e) => setFFuelQty(Number(e.target.value) || 100)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowFurnaceModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 cursor-pointer"
              >
                Save Furnace Batch
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: LOG MAINTENANCE / BREAKDOWN TICKET */}
      {showMaintenanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleAddMaintenanceTicket}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Log Machine Maintenance / Breakdown Ticket
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Records downtime minutes, root cause, replacement spares, and maintenance cost.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMaintenanceModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Machine Asset</label>
                  <select
                    value={mntMachineName}
                    onChange={(e) => setMntMachineName(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="Radial-Axial CNC Ring Rolling Mill #2">
                      Radial-Axial CNC Ring Rolling Mill #2
                    </option>
                    <option value="3.0 Ton Closed-Die Pneumatic Hammer #1">
                      3.0 Ton Closed-Die Pneumatic Hammer #1
                    </option>
                    <option value="1600 Ton Friction Screw Press #3">
                      1600 Ton Friction Screw Press #3
                    </option>
                    <option value="Horizontal CNC Band Saw Billet Cutter #4">
                      Horizontal CNC Band Saw Billet Cutter #4
                    </option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Maintenance Category</label>
                  <select
                    value={mntType}
                    onChange={(e) =>
                      setMntType(e.target.value as MachineMaintenanceTicket['maintenanceType'])
                    }
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="Breakdown">Breakdown Repair</option>
                    <option value="Preventive (PM)">Preventive Maintenance (PM)</option>
                    <option value="Die Changeover">Die Changeover & Alignment</option>
                    <option value="Calibration">Pyrometer / Gauge Calibration</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Issue / Symptom Description</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Clutch pneumatic pressure drop during stroke"
                  value={mntIssue}
                  onChange={(e) => setMntIssue(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Root Cause</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Solenoid valve seal wear"
                    value={mntRootCause}
                    onChange={(e) => setMntRootCause(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Replacement Spares Used</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Festo 5/2 Valve Seal Kit"
                    value={mntParts}
                    onChange={(e) => setMntParts(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Downtime (Mins)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={mntDowntime}
                    onChange={(e) => setMntDowntime(Number(e.target.value) || 0)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Repair Cost (₹)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={mntCost}
                    onChange={(e) => setMntCost(Number(e.target.value) || 0)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Technician</label>
                  <input
                    type="text"
                    required
                    value={mntTech}
                    onChange={(e) => setMntTech(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowMaintenanceModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 cursor-pointer"
              >
                Save Maintenance Ticket
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 4: RECORD DAILY HT POWER METER */}
      {showPowerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleAddPowerLog}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Record Daily HT Power Meter</h3>
                <p className="text-slate-500 mt-0.5">
                  Computes Power Factor (PF) and Specific Energy Consumption (kWh/MT) against 480 kWh/MT target.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPowerModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Meter Reading Date</label>
                <input
                  type="date"
                  required
                  value={pwrDate}
                  onChange={(e) => setPwrDate(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Active Energy (kWh)</label>
                  <input
                    type="number"
                    min={100}
                    required
                    value={pwrKwh}
                    onChange={(e) => setPwrKwh(Number(e.target.value) || 1000)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Apparent Energy (kVAh)</label>
                  <input
                    type="number"
                    min={100}
                    required
                    value={pwrKvah}
                    onChange={(e) => setPwrKvah(Number(e.target.value) || 1000)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Peak Demand (kVA)</label>
                  <input
                    type="number"
                    min={100}
                    required
                    value={pwrPeakKva}
                    onChange={(e) => setPwrPeakKva(Number(e.target.value) || 1200)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Forged Output (MT)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={1}
                    required
                    value={pwrForgedMt}
                    onChange={(e) => setPwrForgedMt(Number(e.target.value) || 50)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">HT Tariff (₹/kWh)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={1}
                    required
                    value={pwrTariffInr}
                    onChange={(e) => setPwrTariffInr(Number(e.target.value) || 8.8)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowPowerModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 cursor-pointer"
              >
                Save Power Reading
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
