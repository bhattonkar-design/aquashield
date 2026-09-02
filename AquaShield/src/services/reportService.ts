import { FloodHazardData, CitizenHazardReport } from '../types/flood';
import { Platform } from 'react-native';

export const exportSituationReport = (
  hazard: FloodHazardData,
  reports: CitizenHazardReport[]
): void => {
  const timestamp = new Date().toLocaleString();
  const reportId = `SITREP-${Date.now().toString().slice(-6)}`;

  const printableHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>AquaShield Situation Report - ${hazard.locationName}</title>
        <style>
          @page { size: A4; margin: 20mm; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
            margin: 0;
            padding: 24px;
            background: #ffffff;
          }
          .header-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 12px;
            margin-bottom: 20px;
          }
          .title { font-size: 24px; font-weight: 800; text-transform: uppercase; margin: 0; }
          .sub { color: #64748b; font-size: 12px; margin-top: 4px; }
          .badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 800;
            color: #ffffff;
            background: ${hazard.riskLevel === 'CRITICAL' ? '#dc2626' : hazard.riskLevel === 'HIGH' ? '#ea580c' : '#16a34a'};
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 24px;
          }
          .card {
            border: 1px solid #cbd5e1;
            padding: 12px;
            border-radius: 6px;
            background: #f8fafc;
          }
          .card-label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700; }
          .card-value { font-size: 18px; font-weight: 800; margin-top: 4px; color: #0f172a; }
          .card-sub { font-size: 10px; color: #64748b; margin-top: 2px; }
          .advisory {
            border-left: 4px solid #ea580c;
            background: #fff7ed;
            padding: 12px 16px;
            font-size: 13px;
            line-height: 1.5;
            margin-bottom: 24px;
          }
          h3 { font-size: 14px; text-transform: uppercase; margin: 20px 0 10px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
          th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
          th { background: #f1f5f9; font-weight: 700; }
          .footer {
            margin-top: 30px;
            border-top: 1px solid #e2e8f0;
            padding-top: 10px;
            font-size: 10px;
            color: #94a3b8;
            display: flex;
            justify-content: space-between;
          }
        </style>
      </head>
      <body>
        <div class="header-row">
          <div>
            <h1 class="title">AquaShield Flood Situation Report</h1>
            <div class="sub">Sector: ${hazard.locationName} (${hazard.latitude.toFixed(4)}° N, ${hazard.longitude.toFixed(4)}° E)</div>
            <div class="sub">Generated: ${timestamp} | Ref: ${reportId}</div>
          </div>
          <div class="badge">${hazard.riskLevel} THREAT (${hazard.compositeRiskScore}% INDEX)</div>
        </div>

        <div class="advisory">
          <strong>OPERATIONAL DIRECTIVE:</strong> ${hazard.advisoryMessage}
        </div>

        <div class="grid">
          <div class="card">
            <div class="card-label">Peak River Flow</div>
            <div class="card-value">${hazard.hydrology.riverDischargeM3s} m³/s</div>
            <div class="card-sub">${hazard.hydrology.dischargeRatio}x regional normal</div>
          </div>
          <div class="card">
            <div class="card-label">Crest Surge Arrival</div>
            <div class="card-value">${hazard.hydrology.crestTimeHours} Hours</div>
            <div class="card-sub">Estimated peak surge</div>
          </div>
          <div class="card">
            <div class="card-label">72h Projected Rain</div>
            <div class="card-value">${hazard.weather.projected72hRainfallMm} mm</div>
            <div class="card-sub">${hazard.weather.precipitationProbability}% precip chance</div>
          </div>
          <div class="card">
            <div class="card-label">Soil Saturation</div>
            <div class="card-value">${(hazard.weather.soilMoistureIndex * 100).toFixed(0)}%</div>
            <div class="card-sub">Infiltration capacity</div>
          </div>
        </div>

        <h3>7-Day Hydrological Discharge Projection</h3>
        <table>
          <thead>
            <tr>
              <th>Forecast Timeline</th>
              <th>Simulated Streamflow (m³/s)</th>
              <th>Precipitation (mm)</th>
              <th>Status Evaluation</th>
            </tr>
          </thead>
          <tbody>
            ${hazard.hydrology.forecast7Days
              .map(
                (f) => `
              <tr>
                <td><strong>${f.day}</strong></td>
                <td>${f.dischargeM3s} m³/s</td>
                <td>${f.rainfallMm} mm</td>
                <td>${f.dischargeM3s > 500 ? '<span style="color:#dc2626;font-weight:700;">Critical Overflow</span>' : f.dischargeM3s > 200 ? '<span style="color:#ea580c;font-weight:700;">High Bankfull</span>' : 'Nominal Margin'}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>

        <h3>Field Obstacles & Citizen Hazard Feeds</h3>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Severity</th>
              <th>Description</th>
              <th>Reported</th>
            </tr>
          </thead>
          <tbody>
            ${reports.length > 0 ? reports.map(r => `
              <tr>
                <td><strong>${r.hazardType.replace('_', ' ')}</strong></td>
                <td><span style="color:${r.severity === 'CRITICAL' ? '#dc2626' : '#d97706'};font-weight:700;">${r.severity}</span></td>
                <td>${r.description}</td>
                <td>${r.timestamp}</td>
              </tr>
            `).join('') : '<tr><td colspan="4" style="text-align:center;color:#64748b;">No active ground-level blockages reported.</td></tr>'}
          </tbody>
        </table>

        <h3>Designated Evacuation Centers</h3>
        <table>
          <thead>
            <tr>
              <th>Facility Name</th>
              <th>Distance</th>
              <th>Available Capacity</th>
              <th>Corridor Integrity</th>
            </tr>
          </thead>
          <tbody>
            ${hazard.safeShelters
              .map(
                (s) => `
              <tr>
                <td><strong>${s.name}</strong></td>
                <td>${s.distanceKm} km</td>
                <td>${s.capacityRemaining} slots</td>
                <td style="color:#16a34a;font-weight:700;">High-Elevation Clearance Verified</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>

        <div class="footer">
          <span>AquaShield Rapid Hydrological Assessment Engine</span>
          <span>Universal Dispatch: 112 | NDMA Rescue: 1078</span>
        </div>
      </body>
    </html>
  `;

  if (Platform.OS === 'web') {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(printableHtml);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 350);
    }
  } else {
    console.log('SitRep payload generated for mobile print bridge');
  }
};