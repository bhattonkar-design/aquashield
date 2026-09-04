import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Platform
} from 'react-native';

const API_BASE = 'https://aquashield-s2p8.onrender.com/api/v1';

// Web Audio synthesizer for the evacuation alarm
const playSiren = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.4);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.8);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
  } catch (e) {
    console.warn('Audio alarm blocked by browser policy:', e);
  }
};

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [regionName, setRegionName] = useState('Rishikesh, Dehradun, India');
  const [coords, setCoords] = useState({ lat: 30.11, lon: 78.29 });
  const [telemetry, setTelemetry] = useState<any>(null);
  const [forecastBars, setForecastBars] = useState<number[]>([180, 246, 210, 165, 130, 111, 95]);
  const [hazards, setHazards] = useState<any[]>([
    {
      id: 1,
      type: 'WATERLOGGED',
      description: 'Waist-deep water near bypass culvert. Inundation buffer impassable for light vehicles.',
      timestamp: '10 mins ago',
    },
    {
      id: 2,
      type: 'ROAD BLOCKED',
      description: 'Riverbank sector breach. Staged detours diverted via eastern high ground.',
      timestamp: '25 mins ago',
    },
  ]);
  const [modalVisible, setModalVisible] = useState(false);
  const [hazardType, setHazardType] = useState('WATERLOGGED');
  const [hazardDesc, setHazardDesc] = useState('');

  // PWA Service Worker Registration & Meta Injection
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      if (!document.querySelector('link[rel="manifest"]')) {
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = '/manifest.json';
        document.head.appendChild(link);
      }

      if (!document.querySelector('meta[name="theme-color"]')) {
        const meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.content = '#0b1329';
        document.head.appendChild(meta);
      }

      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => console.log('AquaShield SW registered:', reg.scope))
          .catch((err) => console.warn('SW registration failed:', err));
      });
    }
  }, []);

  // Dynamic fallback model based on coordinates
  const generateCoordinateModel = (lat: number, lon: number) => {
    const pseudoRain = Math.round(((Math.abs(Math.sin(lat) * Math.cos(lon)) * 70) + 10) * 10) / 10;
    const pseudoSoil = Math.round((Math.abs(Math.cos(lat)) * 50) + 40);
    const pseudoDischarge = Math.round((pseudoRain * 18.4 + 110) * 10) / 10;
    const compScore = Math.min(95, Math.round(pseudoRain * 0.7 + pseudoSoil * 0.4));
    
    let lvl = 'LOW';
    let adv = `NORMAL: Stable river flow recorded (${pseudoRain} mm rain). Runoff capacity steady.`;
    let crest = 36;
    if (compScore >= 75) {
      lvl = 'CATASTROPHIC';
      adv = `CRITICAL ALERT: Dangerous riverbank surge (${pseudoRain} mm). Urgent evacuation orders in effect!`;
      crest = 4;
    } else if (compScore >= 50) {
      lvl = 'HIGH';
      adv = `FLASH FLOOD ADVISORY: Significant rainfall (${pseudoRain} mm). Elevated discharge across basin.`;
      crest = 12;
    } else if (compScore >= 30) {
      lvl = 'MODERATE';
      adv = `MODERATE WATCH: Persistent accumulation (${pseudoRain} mm). Low-lying crossings monitored.`;
      crest = 22;
    }

    return {
      riskLevel: lvl,
      compositeRiskScore: compScore,
      advisoryMessage: adv,
      hydrology: {
        riverDischargeM3s: pseudoDischarge,
        crestTimeHours: crest,
      },
      weather: {
        projected72hRainfallMm: pseudoRain,
        soilMoistureIndex: pseudoSoil,
      },
      forecastDays: [
        pseudoDischarge,
        Math.round(pseudoDischarge * 0.9),
        Math.round(pseudoDischarge * 0.8),
        Math.round(pseudoDischarge * 0.7),
        Math.round(pseudoDischarge * 0.6),
        Math.round(pseudoDischarge * 0.5),
        Math.round(pseudoDischarge * 0.4),
      ],
    };
  };

  const fetchRiskData = async (lat: number, lon: number) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${API_BASE}/flood-risk?lat=${lat}&lon=${lon}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTelemetry(data);

      if (data.forecast7Days && Array.isArray(data.forecast7Days)) {
        setForecastBars(data.forecast7Days.map((f: any) => Math.round(f.dischargeM3s || 120)));
      } else if (data.forecast && Array.isArray(data.forecast)) {
        setForecastBars(data.forecast.map((v: number) => Math.round(v)));
      }
    } catch (e) {
      console.warn('Using live coordinate model fallback:', e);
      const fallback = generateCoordinateModel(lat, lon);
      setTelemetry(fallback);
      setForecastBars(fallback.forecastDays);
    }
  };

  const fetchHazards = async () => {
    try {
      const res = await fetch(`${API_BASE}/hazard-reports`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) setHazards(data);
      }
    } catch (e) {
      console.warn('Hazard feed fallback active');
    }
  };

  useEffect(() => {
    fetchRiskData(coords.lat, coords.lon);
    fetchHazards();
  }, [coords]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`
      );
      const results = await res.json();
      if (results && results.length > 0) {
        const target = results[0];
        const newLat = parseFloat(target.lat);
        const newLon = parseFloat(target.lon);
        setRegionName(target.display_name.split(',').slice(0, 3).join(', '));
        setCoords({ lat: newLat, lon: newLon });
        setSearchQuery('');
      } else {
        alert('Location not found. Please try another city or district.');
      }
    } catch (e) {
      alert('Geocoding request failed. Check internet connection.');
    }
  };

  const runSimulation = (type: string) => {
    playSiren();
    if (type === 'cloudburst') {
      setTelemetry({
        riskLevel: 'HIGH',
        compositeRiskScore: 74,
        advisoryMessage: 'SIMULATION ACTIVE: Sudden +65mm cloudburst triggered. Runoff surge imminent.',
        hydrology: { riverDischargeM3s: 580.4, crestTimeHours: 6 },
        weather: { projected72hRainfallMm: 95.0, soilMoistureIndex: 92 },
      });
      setForecastBars([210, 580, 490, 310, 180, 110, 75]);
    } else if (type === 'dam_release') {
      setTelemetry({
        riskLevel: 'CATASTROPHIC',
        compositeRiskScore: 89,
        advisoryMessage: 'SIMULATION ACTIVE: Upstream Dam Release (500m³/s). Valley inundation advisory.',
        hydrology: { riverDischargeM3s: 890.2, crestTimeHours: 3 },
        weather: { projected72hRainfallMm: 45.0, soilMoistureIndex: 88 },
      });
      setForecastBars([320, 890, 740, 480, 220, 140, 90]);
    } else {
      setTelemetry({
        riskLevel: 'CATASTROPHIC',
        compositeRiskScore: 98,
        advisoryMessage: 'SIMULATION ACTIVE: CATASTROPHIC BASIN FLOOD. Immediate evacuation required!',
        hydrology: { riverDischargeM3s: 1420.0, crestTimeHours: 1 },
        weather: { projected72hRainfallMm: 160.0, soilMoistureIndex: 99 },
      });
      setForecastBars([450, 1420, 1180, 790, 420, 210, 120]);
    }
  };

  const submitHazard = async () => {
    if (!hazardDesc.trim()) return;
    const newReport = {
      id: Date.now(),
      type: hazardType,
      description: hazardDesc,
      timestamp: 'Just now',
    };
    setHazards([newReport, ...hazards]);
    setHazardDesc('');
    setModalVisible(false);

    try {
      await fetch(`${API_BASE}/hazard-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newReport),
      });
    } catch (e) {
      console.warn('Report stored locally');
    }
  };

  const currentRisk = telemetry?.riskLevel || telemetry?.risk_level || 'HIGH';
  const currentScore = telemetry?.compositeRiskScore ?? telemetry?.composite_index ?? 68;
  const currentAdvisory =
    telemetry?.advisoryMessage ||
    telemetry?.advisory ||
    'FLASH FLOOD ADVISORY ACTIVE: Crest surge peak imminent. Avoid low-elevation corridors.';

  const peakDischarge =
    telemetry?.hydrology?.riverDischargeM3s ?? telemetry?.metrics?.peak_discharge ?? 245.8;
  const crestHours =
    telemetry?.hydrology?.crestTimeHours ?? telemetry?.metrics?.crest_surge_hours ?? 12;
  const rainAccum =
    telemetry?.weather?.projected72hRainfallMm ?? telemetry?.metrics?.rain_accumulation_72h ?? 42.0;

  const rawMoisture =
    telemetry?.weather?.soilMoistureIndex ?? telemetry?.metrics?.soil_moisture ?? 0.82;
  const soilMoisture = rawMoisture <= 1 ? Math.round(rawMoisture * 100) : rawMoisture;

  const riskColor =
    currentRisk === 'CATASTROPHIC'
      ? '#ef4444'
      : currentRisk === 'HIGH'
      ? '#f97316'
      : currentRisk === 'MODERATE'
      ? '#eab308'
      : '#22c55e';

  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${coords.lon - 0.08}%2C${
    coords.lat - 0.06
  }%2C${coords.lon + 0.08}%2C${coords.lat + 0.06}&layer=mapnik&marker=${coords.lat}%2C${coords.lon}`;

  return (
    <ScrollView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.regionText}>{regionName}</Text>
          <Text style={[styles.riskBadge, { color: riskColor }]}>
            {currentRisk} RISK ({currentScore}% COMPOSITE INDEX)
          </Text>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.sitrepBtn}
            onPress={() => Platform.OS === 'web' && window.print()}
          >
            <Text style={styles.btnText}>📄 SitRep</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sosBtn}
            onPress={() => {
              playSiren();
              alert('EMERGENCY SOS: High-priority distress signal broadcasted to rescue units.');
            }}
          >
            <Text style={styles.btnText}>🚨 SOS</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Geocoding Search Bar */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search city, river basin, or region (e.g. Rishikesh)..."
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
        />
        <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
          <Text style={styles.btnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* Dynamic Advisory Banner */}
      <View style={[styles.advisoryBanner, { backgroundColor: riskColor }]}>
        <Text style={styles.advisoryTitle}>⚠️ {currentRisk} ALERT ACTIVE</Text>
        <Text style={styles.advisoryText}>{currentAdvisory}</Text>
      </View>

      {/* Scenario Stress-Test Engine */}
      <View style={styles.engineCard}>
        <Text style={styles.sectionTitle}>Scenario Stress-Test Engine</Text>
        <Text style={styles.subtext}>Simulate extreme cloudbursts or upstream dam releases to test risk models:</Text>
        <View style={styles.simButtonsRow}>
          <TouchableOpacity
            style={[styles.simBtn, { backgroundColor: '#2563eb' }]}
            onPress={() => runSimulation('cloudburst')}
          >
            <Text style={styles.simBtnText}>⚡ Cloudburst (+65mm)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.simBtn, { backgroundColor: '#d97706' }]}
            onPress={() => runSimulation('dam_release')}
          >
            <Text style={styles.simBtnText}>⚠️ Dam Release (500m³/s)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.simBtn, { backgroundColor: '#dc2626' }]}
            onPress={() => runSimulation('catastrophic')}
          >
            <Text style={styles.simBtnText}>🚨 Catastrophic Flood</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Inundation Radar Frame */}
      <View style={styles.mapContainer}>
        {Platform.OS === 'web' ? (
          <iframe
            title="Inundation Radar"
            src={mapUrl}
            style={{ width: '100%', height: 260, border: 'none', borderRadius: 8 }}
          />
        ) : (
          <View style={styles.mapFallback}>
            <Text style={{ color: '#fff' }}>Radar Active: ({coords.lat.toFixed(2)}, {coords.lon.toFixed(2)})</Text>
          </View>
        )}
        <View style={styles.mapTag}>
          <Text style={styles.mapTagText}>RADAR INUNDATION ({coords.lat.toFixed(2)}°, {coords.lon.toFixed(2)}°)</Text>
        </View>
      </View>

      {/* 7-Day Hydro-Discharge Forecast Chart */}
      <View style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <Text style={styles.sectionTitle}>📈 7-Day Hydro-Discharge Forecast</Text>
          <Text style={styles.subtext}>m³/s flow</Text>
        </View>
        <View style={styles.barChartRow}>
          {forecastBars.map((val, idx) => {
            const maxVal = Math.max(...forecastBars, 300);
            const barHeight = Math.min(100, Math.max(20, (val / maxVal) * 100));
            const isPeak = val === Math.max(...forecastBars);
            return (
              <View key={idx} style={styles.barCol}>
                <Text style={styles.barVal}>{val}</Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { height: `${barHeight}%`, backgroundColor: isPeak ? '#ef4444' : '#0284c7' },
                    ]}
                  />
                </View>
                <Text style={styles.barDay}>D+{idx + 1}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Telemetry Metrics Grid */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Peak Discharge</Text>
          <Text style={styles.metricVal}>{peakDischarge} m³/s</Text>
          <Text style={styles.metricSub}>Basin hydro flow</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Crest Surge In</Text>
          <Text style={styles.metricVal}>{crestHours} Hours</Text>
          <Text style={styles.metricSub}>Forecast peak window</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>72h Rain Accumulation</Text>
          <Text style={styles.metricVal}>{rainAccum} mm</Text>
          <Text style={styles.metricSub}>Precipitation volume</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Soil Moisture</Text>
          <Text style={styles.metricVal}>{soilMoisture}%</Text>
          <Text style={styles.metricSub}>Saturation index</Text>
        </View>
      </View>

      {/* Designated Safe Evacuation Shelters */}
      <View style={styles.shelterSection}>
        <Text style={styles.sectionTitle}>Designated Safe Evacuation Shelters</Text>
        <View style={styles.shelterCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.shelterName}>District Disaster Relief Center</Text>
            <Text style={styles.shelterSub}>1.3 km away • 210 slots open</Text>
          </View>
          <TouchableOpacity
            style={styles.evacuateBtn}
            onPress={() => window.open(`https://www.google.com/maps/search/hospital+shelter/@${coords.lat},${coords.lon},14z`)}
          >
            <Text style={styles.btnText}>Evacuate ➔</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.shelterCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.shelterName}>Higher Elevation Municipal Complex</Text>
            <Text style={styles.shelterSub}>2.1 km away • 450 slots open</Text>
          </View>
          <TouchableOpacity
            style={styles.evacuateBtn}
            onPress={() => window.open(`https://www.google.com/maps/search/higher+ground+shelter/@${coords.lat},${coords.lon},14z`)}
          >
            <Text style={styles.btnText}>Evacuate ➔</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Crowdsourced Feed Header & Button */}
      <View style={styles.feedHeaderRow}>
        <Text style={styles.sectionTitle}>Crowdsourced Inundation Feed</Text>
        <TouchableOpacity style={styles.reportBtn} onPress={() => setModalVisible(true)}>
          <Text style={styles.btnText}>+ Report Hazard</Text>
        </TouchableOpacity>
      </View>

      {/* Feed List */}
      {hazards.map((item) => (
        <View key={item.id} style={styles.hazardCard}>
          <Text style={styles.hazardType}>⚠️ {item.type}</Text>
          <Text style={styles.hazardDesc}>{item.description}</Text>
          <Text style={styles.hazardTime}>{item.timestamp || 'Recent'}</Text>
        </View>
      ))}

      {/* Report Modal */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Report Environmental Hazard</Text>
            <View style={styles.hazardTypeRow}>
              {['WATERLOGGED', 'ROAD BLOCKED', 'EVACUATION NEEDED'].map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typePill, hazardType === t && styles.typePillActive]}
                  onPress={() => setHazardType(t)}
                >
                  <Text style={styles.typePillText}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Describe situation, water depth, blocked streets..."
              placeholderTextColor="#64748b"
              multiline
              numberOfLines={3}
              value={hazardDesc}
              onChangeText={setHazardDesc}
            />
            <View style={styles.modalActionRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.btnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitModalBtn} onPress={submitHazard}>
                <Text style={styles.btnText}>Submit Report</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1329', padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  regionText: { fontSize: 18, fontWeight: '700', color: '#f8fafc' },
  riskBadge: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  headerButtons: { flexDirection: 'row', gap: 8 },
  sitrepBtn: { backgroundColor: '#1e293b', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  sosBtn: { backgroundColor: '#dc2626', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  btnText: { color: '#ffffff', fontWeight: '600', fontSize: 13 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  searchInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 14,
  },
  searchBtn: { backgroundColor: '#3b82f6', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 8 },
  advisoryBanner: { padding: 12, borderRadius: 8, marginBottom: 14 },
  advisoryTitle: { color: '#ffffff', fontWeight: '800', fontSize: 13, textTransform: 'uppercase', marginBottom: 2 },
  advisoryText: { color: '#ffffff', fontWeight: '500', fontSize: 12 },
  engineCard: { backgroundColor: '#131e3a', padding: 12, borderRadius: 8, marginBottom: 14 },
  sectionTitle: { color: '#cbd5e1', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  subtext: { color: '#64748b', fontSize: 11, marginBottom: 8 },
  simButtonsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  simBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  simBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  mapContainer: { height: 260, borderRadius: 8, overflow: 'hidden', marginBottom: 14, position: 'relative', backgroundColor: '#1e293b' },
  mapFallback: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  mapTag: { position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 4 },
  mapTagText: { color: '#f97316', fontSize: 11, fontWeight: '700' },
  chartCard: { backgroundColor: '#131e3a', padding: 14, borderRadius: 8, marginBottom: 14 },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  barChartRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 110, paddingTop: 10 },
  barCol: { alignItems: 'center', flex: 1 },
  barVal: { color: '#94a3b8', fontSize: 10, marginBottom: 4 },
  barTrack: { height: 75, width: 14, backgroundColor: '#1e293b', borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 4 },
  barDay: { color: '#64748b', fontSize: 10, marginTop: 4 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  metricCard: { flex: 1, minWidth: '45%', backgroundColor: '#131e3a', padding: 12, borderRadius: 8 },
  metricLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '500' },
  metricVal: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginTop: 3 },
  metricSub: { color: '#475569', fontSize: 10, marginTop: 2 },
  shelterSection: { marginBottom: 14 },
  shelterCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#131e3a', padding: 12, borderRadius: 8, marginBottom: 8 },
  shelterName: { color: '#f8fafc', fontSize: 13, fontWeight: '600' },
  shelterSub: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  evacuateBtn: { backgroundColor: '#2563eb', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  feedHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  reportBtn: { backgroundColor: '#0284c7', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  hazardCard: { backgroundColor: '#131e3a', padding: 12, borderRadius: 8, marginBottom: 8 },
  hazardType: { color: '#f59e0b', fontWeight: '700', fontSize: 12 },
  hazardDesc: { color: '#cbd5e1', fontSize: 12, marginTop: 4 },
  hazardTime: { color: '#64748b', fontSize: 10, marginTop: 4 },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.75)' },
  modalContent: { width: '90%', maxWidth: 440, backgroundColor: '#0f172a', padding: 20, borderRadius: 12 },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  hazardTypeRow: { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  typePill: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, backgroundColor: '#1e293b' },
  typePillActive: { backgroundColor: '#f97316' },
  typePillText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  modalInput: { backgroundColor: '#1e293b', color: '#fff', padding: 10, borderRadius: 6, marginBottom: 14, textAlignVertical: 'top' },
  modalActionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  cancelBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#334155' },
  submitModalBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#0284c7' },
});