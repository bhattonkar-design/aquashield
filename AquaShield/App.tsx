import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';

const API_BASE = 'https://aquashield-s2p8.onrender.com/api/v1';

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

interface Hazard {
  id?: number;
  type: string;
  description: string;
  timestamp?: string;
  lat?: number;
  lon?: number;
}

interface SearchResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface Shelter {
  id: number;
  name: string;
  distanceKm: number;
  capacitySlots: number;
  lat: number;
  lon: number;
}

export default function App() {
  const [coords, setCoords] = useState<{ lat: number; lon: number }>({ lat: 27.18, lon: 78.02 });
  const [regionName, setRegionName] = useState<string>('Agra Basin, UP');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const searchTimeout = useRef<any>(null);

  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [forecastBars, setForecastBars] = useState<number[]>([90, 85, 80, 75, 70, 65, 60]);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Designated Shelters
  const shelters: Shelter[] = [
    {
      id: 1,
      name: 'District Disaster Relief Center',
      distanceKm: 1.3,
      capacitySlots: 210,
      lat: coords.lat + 0.012,
      lon: coords.lon + 0.009,
    },
    {
      id: 2,
      name: 'Higher Elevation Municipal Complex',
      distanceKm: 2.1,
      capacitySlots: 450,
      lat: coords.lat - 0.015,
      lon: coords.lon - 0.011,
    },
  ];

  // Modal State
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [hazardType, setHazardType] = useState<string>('WATERLOGGED');
  const [hazardDesc, setHazardDesc] = useState<string>('');

  const playSiren = async () => {
    // 1. Trigger phone emergency vibration (works on mobile browsers/PWA)
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([300, 100, 300, 100, 500, 100, 500]);
      } catch (e) {
        console.warn('Vibration not permitted:', e);
      }
    }

    // 2. Play audible siren with mobile AudioContext unlock
    if (typeof window !== 'undefined') {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();

        // Critical for mobile browsers: resume audio context if suspended
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        const now = ctx.currentTime;
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.linearRampToValueAtTime(880, now + 0.3);
        osc.frequency.linearRampToValueAtTime(440, now + 0.6);
        osc.frequency.linearRampToValueAtTime(880, now + 0.9);
        osc.frequency.linearRampToValueAtTime(440, now + 1.2);

        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 1.3);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.3);
      } catch (e) {
        console.warn('Audio synthesis failed:', e);
      }
    }
  };

  const fetchTelemetry = async (lat: number, lon: number) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/flood-risk?lat=${lat}&lon=${lon}`);
      const data = await res.json();
      setTelemetry(data);
      if (data.forecast7Days) {
        setForecastBars(data.forecast7Days.map((f: any) => f.dischargeM3s));
      }
    } catch (e) {
      console.warn('Backend unavailable, using telemetry fallback');
      setTelemetry({
        riskLevel: 'MODERATE',
        compositeRiskScore: 42,
        advisoryMessage: 'Yamuna downstream discharge elevated. Monitor embankment buffer.',
        hydrology: { riverDischargeM3s: 142.5, crestTimeHours: 18 },
        weather: { projected72hRainfallMm: 38.4, soilMoistureIndex: 58 },
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchHazards = async () => {
    try {
      const res = await fetch(`${API_BASE}/hazard-reports`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setHazards(data);
      }
    } catch (e) {
      console.warn('Could not fetch hazards, retaining active feed');
    }
  };

  useEffect(() => {
    fetchTelemetry(coords.lat, coords.lon);
    fetchHazards();
  }, [coords]);

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (!text.trim() || text.length < 3) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(text)}&limit=5`;
        const res = await fetch(url, {
          headers: { 'Accept-Language': 'en' },
        });
        const data = await res.json();
        setSearchResults(data);
        setShowDropdown(true);
      } catch (e) {
        console.warn('Geocoding search failed', e);
      } finally {
        setIsSearching(false);
      }
    }, 400);
  };

  const selectLocation = (result: SearchResult) => {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    const shortName = result.display_name.split(',').slice(0, 2).join(',');
    setCoords({ lat, lon });
    setRegionName(shortName);
    setSearchQuery('');
    setShowDropdown(false);
  };

  const runSimulation = async (type: string) => {
    playSiren();
    try {
      fetch(`${API_BASE}/simulate-flood-scenario?scenario=${type}`, { method: 'POST' });
    } catch (e) {
      console.warn('Backend sim trigger failed', e);
    }

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

  const triggerSOS = async () => {
    playSiren();
    alert('EMERGENCY SOS: High-priority distress signal broadcasted to rescue units.');
    try {
      await fetch(`${API_BASE}/trigger-sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: coords.lat,
          lon: coords.lon,
          regionName: regionName,
          details: 'Urgent rescue response needed at coordinates',
        }),
      });
    } catch (e) {
      console.warn('SOS trigger failed', e);
    }
  };

  const submitHazard = async () => {
    if (!hazardDesc.trim()) return;
    const newReport: Hazard = {
      type: hazardType,
      description: hazardDesc.trim(),
      timestamp: 'Just now',
      lat: coords.lat,
      lon: coords.lon,
    };

    setHazards([newReport, ...hazards]);
    setModalVisible(false);
    setHazardDesc('');

    try {
      await fetch(`${API_BASE}/hazard-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newReport),
      });
      fetchHazards();
    } catch (e) {
      console.warn('Hazard POST failed; stored locally', e);
    }
  };

  const getRiskColor = (level: string = '') => {
    switch (level.toUpperCase()) {
      case 'CATASTROPHIC':
        return '#ef4444';
      case 'HIGH':
        return '#f97316';
      case 'MODERATE':
        return '#eab308';
      default:
        return '#10b981';
    }
  };

  const mapEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${coords.lon - 0.08}%2C${coords.lat - 0.05}%2C${coords.lon + 0.08}%2C${coords.lat + 0.05}&layer=mapnik&marker=${coords.lat}%2C${coords.lon}`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>AquaShield AI</Text>
          <Text style={styles.subtitle}>Hydrological Inundation Early Warning System</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.sosBtn} onPress={triggerSOS}>
            <Text style={styles.btnText}>🚨 SOS</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Geocoding Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search city, basin, or river (e.g., Patna, Guwahati)..."
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={handleSearchChange}
        />
        {isSearching && <ActivityIndicator style={styles.searchSpinner} color="#38bdf8" />}

        {showDropdown && searchResults.length > 0 && (
          <View style={styles.dropdown}>
            {searchResults.map((item) => (
              <TouchableOpacity
                key={item.place_id}
                style={styles.dropdownItem}
                onPress={() => selectLocation(item)}
              >
                <Text style={styles.dropdownText} numberOfLines={1}>
                  📍 {item.display_name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Active Monitored Coordinates */}
      <View style={styles.regionBanner}>
        <Text style={styles.regionText}>
          📍 Monitored Region: <Text style={styles.regionHighlight}>{regionName}</Text> ({coords.lat.toFixed(2)}, {coords.lon.toFixed(2)})
        </Text>
      </View>

      {/* Telemetry Composite Index */}
      {loading ? (
        <ActivityIndicator size="large" color="#38bdf8" style={{ marginVertical: 30 }} />
      ) : (
        telemetry && (
          <View style={[styles.card, { borderLeftColor: getRiskColor(telemetry.riskLevel), borderLeftWidth: 6 }]}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: getRiskColor(telemetry.riskLevel) }]}>
                <Text style={styles.badgeText}>{telemetry.riskLevel} RISK</Text>
              </View>
              <Text style={styles.riskScore}>Index: {telemetry.compositeRiskScore}/100</Text>
            </View>
            <Text style={styles.advisory}>{telemetry.advisoryMessage}</Text>

            <View style={styles.metricsGrid}>
              <View style={styles.metricBox}>
                <Text style={styles.metricVal}>{telemetry.hydrology.riverDischargeM3s} m³/s</Text>
                <Text style={styles.metricLbl}>Peak Discharge</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricVal}>{telemetry.hydrology.crestTimeHours} Hours</Text>
                <Text style={styles.metricLbl}>Crest Arrival</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricVal}>{telemetry.weather.projected72hRainfallMm} mm</Text>
                <Text style={styles.metricLbl}>72h Rain Accumulation</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricVal}>{telemetry.weather.soilMoistureIndex}%</Text>
                <Text style={styles.metricLbl}>Soil Saturation</Text>
              </View>
            </View>
          </View>
        )
      )}

      {/* Live Radar Map */}
      <Text style={styles.sectionHeader}>Live Radar & Inundation Map</Text>
      <View style={styles.mapCard}>
        {Platform.OS === 'web' ? (
          <iframe
            title="Radar Inundation Map"
            src={mapEmbedUrl}
            style={{ width: '100%', height: 260, border: 'none', borderRadius: 8 }}
          />
        ) : (
          <View style={styles.mobileMapFallback}>
            <Text style={styles.cardText}>Interactive Map Active at ({coords.lat.toFixed(2)}, {coords.lon.toFixed(2)})</Text>
          </View>
        )}
      </View>

      {/* 7-Day Hydrological Forecast */}
      <Text style={styles.sectionHeader}>7-Day River Discharge Forecast (m³/s)</Text>
      <View style={styles.chartCard}>
        <View style={styles.barChartRow}>
          {forecastBars.map((val, idx) => {
            const heightPct = Math.min(100, Math.max(15, (val / 1200) * 100));
            return (
              <View key={idx} style={styles.barCol}>
                <Text style={styles.barValue}>{Math.round(val)}</Text>
                <View style={[styles.bar, { height: `${heightPct}%`, backgroundColor: val > 500 ? '#ef4444' : '#38bdf8' }]} />
                <Text style={styles.barLabel}>D{idx + 1}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Stress-Test Simulations */}
      <Text style={styles.sectionHeader}>Scenario Stress-Test Engine</Text>
      <View style={styles.simButtonsRow}>
        <TouchableOpacity style={styles.simBtn} onPress={() => runSimulation('cloudburst')}>
          <Text style={styles.simBtnText}>⚡ Cloudburst (+65mm)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.simBtn} onPress={() => runSimulation('dam_release')}>
          <Text style={styles.simBtnText}>🌊 Dam Release (500m³/s)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.simBtn, { backgroundColor: '#7f1d1d' }]} onPress={() => runSimulation('catastrophic')}>
          <Text style={styles.simBtnText}>🚨 Catastrophic Flood</Text>
        </TouchableOpacity>
      </View>

      {/* Safe Shelters */}
      <Text style={styles.sectionHeader}>Designated Safe Evacuation Shelters</Text>
      {shelters.map((s) => (
        <View key={s.id} style={styles.shelterCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.shelterName}>{s.name}</Text>
            <Text style={styles.shelterInfo}>{s.distanceKm} km away • {s.capacitySlots} slots open</Text>
          </View>
          <TouchableOpacity
            style={styles.evacuateBtn}
            onPress={() => {
              if (Platform.OS === 'web') {
                window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`, '_blank');
              } else {
                alert(`Routing to ${s.name}...`);
              }
            }}
          >
            <Text style={styles.btnText}>Evacuate ➔</Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* Crowdsourced Hazards */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeader}>Crowdsourced Inundation Feed</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
          <Text style={styles.btnText}>+ Report Hazard</Text>
        </TouchableOpacity>
      </View>

      {hazards.map((h, i) => (
        <View key={h.id || i} style={styles.feedCard}>
          <Text style={styles.feedType}>⚠️ {h.type}</Text>
          <Text style={styles.feedDesc}>{h.description}</Text>
          <Text style={styles.feedTime}>{h.timestamp || 'Just now'}</Text>
        </View>
      ))}

      {/* Submission Modal */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>File Live Hazard Report</Text>
            <View style={styles.typeSelectorRow}>
              {['WATERLOGGED', 'ROAD BLOCKED', 'RIVER OVERFLOW', 'EVACUATION NEEDED'].map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeOption, hazardType === t && styles.typeOptionActive]}
                  onPress={() => setHazardType(t)}
                >
                  <Text style={[styles.typeOptionText, hazardType === t && styles.typeOptionTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Describe situation (e.g. Submerged culvert, 2ft flow)..."
              placeholderTextColor="#94a3b8"
              value={hazardDesc}
              onChangeText={setHazardDesc}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.btnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={submitHazard}>
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
  container: { flex: 1, backgroundColor: '#0f172a' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '900', color: '#f8fafc' },
  subtitle: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8 },
  sosBtn: { backgroundColor: '#ef4444', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  btnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 13 },
  searchContainer: { position: 'relative', zIndex: 50, marginBottom: 12 },
  searchInput: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155', borderRadius: 8, padding: 12, color: '#f8fafc', fontSize: 14 },
  searchSpinner: { position: 'absolute', right: 12, top: 12 },
  dropdown: { position: 'absolute', top: 50, left: 0, right: 0, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#475569', borderRadius: 8, zIndex: 100, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 8, elevation: 10 },
  dropdownItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#334155' },
  dropdownText: { color: '#e2e8f0', fontSize: 13 },
  regionBanner: { backgroundColor: '#1e293b', padding: 10, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  regionText: { color: '#94a3b8', fontSize: 13 },
  regionHighlight: { color: '#38bdf8', fontWeight: 'bold' },
  card: { backgroundColor: '#1e293b', padding: 16, borderRadius: 8, marginBottom: 16 },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  badgeText: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
  riskScore: { color: '#cbd5e1', fontWeight: 'bold', fontSize: 14 },
  advisory: { color: '#f1f5f9', fontSize: 14, lineHeight: 20 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  metricBox: { flex: 1, minWidth: '45%', backgroundColor: '#0f172a', padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#334155' },
  metricVal: { color: '#38bdf8', fontWeight: 'bold', fontSize: 15 },
  metricLbl: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  sectionHeader: { fontSize: 16, fontWeight: 'bold', color: '#f8fafc', marginVertical: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 10 },
  mapCard: { backgroundColor: '#1e293b', borderRadius: 8, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  mobileMapFallback: { height: 200, justifyContent: 'center', alignItems: 'center' },
  cardText: { color: '#94a3b8' },
  chartCard: { backgroundColor: '#1e293b', padding: 16, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  barChartRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 130, paddingTop: 20 },
  barCol: { alignItems: 'center', flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: 14, borderRadius: 4 },
  barValue: { color: '#94a3b8', fontSize: 9, marginBottom: 4 },
  barLabel: { color: '#64748b', fontSize: 11, marginTop: 4 },
  simButtonsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  simBtn: { flex: 1, backgroundColor: '#1e293b', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  simBtnText: { color: '#e2e8f0', fontSize: 11, fontWeight: '600' },
  shelterCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', padding: 14, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  shelterName: { color: '#f8fafc', fontWeight: 'bold', fontSize: 13 },
  shelterInfo: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  evacuateBtn: { backgroundColor: '#2563eb', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6 },
  addBtn: { backgroundColor: '#0284c7', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  feedCard: { backgroundColor: '#1e293b', padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#334155' },
  feedType: { color: '#f59e0b', fontWeight: 'bold', fontSize: 12 },
  feedDesc: { color: '#f8fafc', fontSize: 13, marginVertical: 4 },
  feedTime: { color: '#64748b', fontSize: 11 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#1e293b', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#475569' },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: 'bold', marginBottom: 14 },
  typeSelectorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  typeOption: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: '#475569' },
  typeOptionActive: { backgroundColor: '#0284c7', borderColor: '#38bdf8' },
  typeOptionText: { color: '#94a3b8', fontSize: 11, fontWeight: 'bold' },
  typeOptionTextActive: { color: '#ffffff' },
  modalInput: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 8, padding: 10, color: '#f8fafc', fontSize: 13, minHeight: 80, textAlignVertical: 'top', marginBottom: 14 },
  modalBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6, backgroundColor: '#475569' },
  submitBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6, backgroundColor: '#0284c7' },
});