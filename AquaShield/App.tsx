import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  Platform
} from 'react-native';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://aquashield-s2p8.onrender.com/api/v1';

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [regionName, setRegionName] = useState('Agra, Monitored Region, India');
  const [coords, setCoords] = useState({ lat: 27.18, lon: 78.02 });
  const [telemetry, setTelemetry] = useState<any>(null);
  const [hazards, setHazards] = useState<any[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [hazardType, setHazardType] = useState('WATERLOGGED');
  const [hazardDesc, setHazardDesc] = useState('');

  // Fetch telemetry dynamically whenever coordinates change
  const fetchRiskData = async (lat: number, lon: number) => {
    try {
      const res = await fetch(`${API_BASE}/flood-risk?lat=${lat}&lon=${lon}`);
      const data = await res.json();
      setTelemetry(data);
    } catch (e) {
      console.error('Failed to load risk telemetry', e);
    }
  };

  const fetchHazards = async () => {
    try {
      const res = await fetch(`${API_BASE}/hazard-reports`);
      const data = await res.json();
      setHazards(data);
    } catch (e) {
      console.error('Failed to load hazard reports', e);
    }
  };

  useEffect(() => {
    fetchRiskData(coords.lat, coords.lon);
    fetchHazards();
  }, [coords]);

  // Geocoding handler for search bar
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery
        )}`
      );
      const results = await res.json();
      if (results && results.length > 0) {
        const target = results[0];
        const newLat = parseFloat(target.lat);
        const newLon = parseFloat(target.lon);
        setRegionName(target.display_name.split(',').slice(0, 2).join(', '));
        setCoords({ lat: newLat, lon: newLon });
        setSearchQuery('');
      } else {
        alert('Location not found. Please try another query.');
      }
    } catch (e) {
      console.error('Search error', e);
      alert('Geocoding request failed.');
    }
  };

  const runSimulation = async (type: string) => {
    try {
      const res = await fetch(`${API_BASE}/simulate-flood-scenario?scenario=${type}`, {
        method: 'POST',
      });
      const data = await res.json();
      setTelemetry(data);
    } catch (e) {
      console.error('Simulation error', e);
    }
  };

  const submitHazard = async () => {
    if (!hazardDesc.trim()) return;
    try {
      await fetch(`${API_BASE}/hazard-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: hazardType,
          description: hazardDesc,
          lat: coords.lat,
          lon: coords.lon,
        }),
      });
      setHazardDesc('');
      setModalVisible(false);
      fetchHazards();
    } catch (e) {
      console.error('Submission failed', e);
    }
  };

  const riskColor =
    telemetry?.risk_level === 'CATASTROPHIC'
      ? '#ef4444'
      : telemetry?.risk_level === 'HIGH'
      ? '#f97316'
      : telemetry?.risk_level === 'MODERATE'
      ? '#eab308'
      : '#22c55e';

  // Embed dynamic OSM radar bounding box based on current coordinates
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${coords.lon - 0.1}%2C${
    coords.lat - 0.1
  }%2C${coords.lon + 0.1}%2C${coords.lat + 0.1}&layer=mapnik&marker=${coords.lat}%2C${coords.lon}`;

  return (
    <ScrollView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.regionText}>{regionName}</Text>
          <Text style={[styles.riskBadge, { color: riskColor }]}>
            {telemetry?.risk_level || 'LOADING'} ({telemetry?.composite_index ?? '--'}% COMPOSITE INDEX)
          </Text>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.sitrepBtn}
            onPress={() => Platform.OS === 'web' && window.print()}
          >
            <Text style={styles.btnText}>SitRep</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sosBtn}
            onPress={() => alert('EMERGENCY SOS: Dispatch teams notified.')}
          >
            <Text style={styles.btnText}>SOS</Text>
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

      {/* Advisory Banner */}
      <View style={[styles.advisoryBanner, { backgroundColor: riskColor }]}>
        <Text style={styles.advisoryText}>
          {telemetry?.advisory || 'Synchronizing hydrological sensor models...'}
        </Text>
      </View>

      {/* Stress-Test Simulator Panel */}
      <View style={styles.engineCard}>
        <Text style={styles.sectionTitle}>Scenario Stress-Test Engine</Text>
        <View style={styles.simButtonsRow}>
          <TouchableOpacity
            style={[styles.simBtn, { backgroundColor: '#2563eb' }]}
            onPress={() => runSimulation('cloudburst')}
          >
            <Text style={styles.simBtnText}>Cloudburst (+65mm)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.simBtn, { backgroundColor: '#d97706' }]}
            onPress={() => runSimulation('dam_release')}
          >
            <Text style={styles.simBtnText}>Dam Release (500m³/s)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.simBtn, { backgroundColor: '#dc2626' }]}
            onPress={() => runSimulation('catastrophic')}
          >
            <Text style={styles.simBtnText}>Catastrophic Flood</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Interactive Map */}
      <View style={styles.mapContainer}>
        {Platform.OS === 'web' ? (
          <iframe
            title="Inundation Radar"
            src={mapUrl}
            style={{ width: '100%', height: 260, border: 'none', borderRadius: 8 }}
          />
        ) : (
          <View style={[styles.mapFallback]}>
            <Text style={{ color: '#fff' }}>Interactive Radar Active ({coords.lat.toFixed(2)}, {coords.lon.toFixed(2)})</Text>
          </View>
        )}
        <View style={styles.mapTag}>
          <Text style={styles.mapTagText}>RADAR ({coords.lat.toFixed(2)}°, {coords.lon.toFixed(2)}°)</Text>
        </View>
      </View>

      {/* Telemetry Metrics Grid */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Peak Discharge</Text>
          <Text style={styles.metricVal}>{telemetry?.metrics?.peak_discharge ?? '--'} m³/s</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Crest Surge In</Text>
          <Text style={styles.metricVal}>{telemetry?.metrics?.crest_surge_hours ?? '--'} Hours</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>72h Rain Accumulation</Text>
          <Text style={styles.metricVal}>{telemetry?.metrics?.rain_accumulation_72h ?? '--'} mm</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Soil Moisture</Text>
          <Text style={styles.metricVal}>{telemetry?.metrics?.soil_moisture ?? '--'} %</Text>
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
  advisoryText: { color: '#ffffff', fontWeight: '600', fontSize: 13 },
  engineCard: { backgroundColor: '#131e3a', padding: 12, borderRadius: 8, marginBottom: 14 },
  sectionTitle: { color: '#cbd5e1', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  simButtonsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  simBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  simBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  mapContainer: { height: 260, borderRadius: 8, overflow: 'hidden', marginBottom: 14, position: 'relative', backgroundColor: '#1e293b' },
  mapFallback: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  mapTag: { position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.7)', padding: 4, borderRadius: 4 },
  mapTagText: { color: '#f97316', fontSize: 11, fontWeight: '700' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  metricCard: { flex: 1, minWidth: '45%', backgroundColor: '#131e3a', padding: 12, borderRadius: 8 },
  metricLabel: { color: '#94a3b8', fontSize: 12 },
  metricVal: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginTop: 4 },
  feedHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  reportBtn: { backgroundColor: '#0284c7', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  hazardCard: { backgroundColor: '#131e3a', padding: 12, borderRadius: 8, marginBottom: 8 },
  hazardType: { color: '#f59e0b', fontWeight: '700', fontSize: 13 },
  hazardDesc: { color: '#cbd5e1', fontSize: 13, marginTop: 4 },
  hazardTime: { color: '#64748b', fontSize: 11, marginTop: 4 },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)' },
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