import { jsPDF } from 'jspdf';

interface TelemetryData {
  riskLevel: string;
  compositeRiskScore: number;
  advisoryMessage: string;
  hydrology: {
    riverDischargeM3s: number;
    crestTimeHours: number;
  };
  weather: {
    projected72hRainfallMm: number;
    soilMoistureIndex: number;
  };
}

interface Shelter {
  id: number;
  name: string;
  distanceKm: number;
  capacitySlots: number;
  lat: number;
  lon: number;
}

interface Hazard {
  id?: number;
  type: string;
  description: string;
  timestamp?: string;
}

export function generateEvacuationBriefingPdf(
  regionName: string,
  coords: { lat: number; lon: number },
  telemetry: TelemetryData | null,
  shelters: Shelter[],
  hazards: Hazard[]
) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 40;
  let y = 50;

  // Header Banner
  doc.setFillColor(15, 23, 42); // #0f172a
  doc.rect(0, 0, 612, 85, 'F');

  doc.setTextColor(248, 250, 252);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('AquaShield AI — Incident Evacuation Dossier', margin, 40);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  const dateStr = new Date().toLocaleString();
  doc.text(`Sector: ${regionName} (${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)}) | Generated: ${dateStr}`, margin, 60);

  y = 110;

  // Telemetry Risk Assessment Box
  const risk = telemetry ? telemetry.riskLevel : 'UNKNOWN';
  const score = telemetry ? telemetry.compositeRiskScore : 0;
  
  if (risk === 'CATASTROPHIC') {
    doc.setFillColor(239, 68, 68);
  } else if (risk === 'HIGH') {
    doc.setFillColor(249, 115, 22);
  } else {
    doc.setFillColor(16, 185, 129);
  }

  doc.rect(margin, y, 532, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`STATUS: ${risk} FLOOD RISK — Composite Hazard Index: ${score}/100`, margin + 12, y + 18);

  y += 45;

  // Core Metrics Summary
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const discharge = telemetry ? `${telemetry.hydrology.riverDischargeM3s} m³/s` : 'N/A';
  const crest = telemetry ? `${telemetry.hydrology.crestTimeHours} Hours` : 'N/A';
  const rain = telemetry ? `${telemetry.weather.projected72hRainfallMm} mm` : 'N/A';
  const saturation = telemetry ? `${telemetry.weather.soilMoistureIndex}%` : 'N/A';

  doc.text(`• Peak River Discharge: ${discharge}`, margin, y);
  doc.text(`• Projected Crest Arrival: ${crest}`, margin + 270, y);
  y += 18;
  doc.text(`• 72h Rain Accumulation: ${rain}`, margin, y);
  doc.text(`• Topsoil Saturation: ${saturation}`, margin + 270, y);
  y += 24;

  // Advisory Message Box
  if (telemetry?.advisoryMessage) {
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, y, 532, 40, 4, 4, 'FD');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text(`Directive: "${telemetry.advisoryMessage}"`, margin + 10, y + 24, { maxWidth: 510 });
    y += 55;
  }

  // Section 1: Designated Shelters
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Designated Evacuation Reception Centers', margin, y);
  y += 15;

  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, 572, y);
  y += 18;

  doc.setFontSize(10);
  shelters.forEach((s, idx) => {
    doc.setFont('helvetica', 'bold');
    doc.text(`${idx + 1}. ${s.name}`, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`Distance: ${s.distanceKm} km  |  Open Capacity: ${s.capacitySlots} slots  |  Coordinates: ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`, margin + 16, y + 14);
    y += 32;
  });

  y += 10;

  // Section 2: Active Hazard Log
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('2. Real-Time Active Sector Hazards Log', margin, y);
  y += 15;
  doc.line(margin, y, 572, y);
  y += 18;

  doc.setFontSize(9);
  const recentHazards = hazards.slice(0, 5);
  if (recentHazards.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.text('No active roadblocks or submerged culverts reported in current sector.', margin, y);
    y += 20;
  } else {
    recentHazards.forEach((h) => {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(185, 28, 28);
      doc.text(`[${h.type}]`, margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      doc.text(`${h.description} (${h.timestamp || 'Active'})`, margin + 120, y, { maxWidth: 390 });
      y += 22;
    });
  }

  // Footer Disclaimer
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text('AquaShield Disaster Engine — Official Evacuation Dossier. Valid for active crest operational cycle.', margin, 740);

  // Trigger browser download
  const filename = `AquaShield-Evac-Plan-${regionName.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}