import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StatusBar,
  Dimensions,
  Platform,
  Modal,
  Linking,
} from 'react-native';
import * as Location from 'expo-location';
import {
  AlertTriangle,
  Droplets,
  ShieldAlert,
  Navigation,
  Compass,
  Waves,
  Search,
  X,
  MapPin,
  CheckCircle2,
  Clock,
  TrendingUp,
  PhoneCall,
  Radio,
  BellRing,
  Sliders,
  RotateCcw,
  Zap,
  PlusCircle,
  FileDown,
  Volume2,
  VolumeX,
} from 'lucide-react-native';
import { FloodHazardData, RiskLevel, LocationResult, CitizenHazardReport } from './src/types/flood';
import {
  getFloodData,
  searchLocations,
  getEvacuationRoute,
  runFloodSimulation,
  getHazardReports,
  submitHazardReport,
  EvacuationRouteData,
} from './src/services/floodService';
import {
  saveHazardSnapshot,
  getCachedHazardSnapshot,
  saveCachedRoute,
  getCachedRoute,
} from './src/services/storageService';
import { exportSituationReport } from './src/services/reportService';
import { audioAlertService } from './src/services/audioAlertService';

let MapView: any = null;
let Marker: any = null;
let Circle: any = null;
let PROVIDER_DEFAULT: any = null;

if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
  Circle = Maps.Circle;
  PROVIDER_DEFAULT = Maps.PROVIDER_DEFAULT;
}

const { width } = Dimensions.get('window');

const getRiskColor = (level: RiskLevel) => {
  switch (level) {
    case 'CRITICAL': return '#EF4444';
    case 'HIGH': return '#F97316';
    case 'MODERATE': return '#FACC15';
    case 'LOW': return '#10B981';
  }
};

export default function App() {
  const [data, setData] = useState<FloodHazardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [simulating, setSimulating] = useState<boolean>(false);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number }>({
    latitude: 27.1833,
    longitude: 78.0167,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LocationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);

  const [selectedRoute, setSelectedRoute] = useState<EvacuationRouteData | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [showSosModal, setShowSosModal] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [isSirenOn, setIsSirenOn] = useState(false);

  // Crowdsourced Reporting States
  const [hazardReports, setHazardReports] = useState<CitizenHazardReport[]>([]);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportType, setReportType] = useState<'WATERLOGGED' | 'ROAD_BLOCKED' | 'STRANDED_PERSON'>('WATERLOGGED');
  const [reportSeverity, setReportSeverity] = useState<'MODERATE' | 'SEVERE' | 'CRITICAL'>('SEVERE');
  const [reportDesc, setReportDesc] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  const loadHazardData = async (lat: number, lon: number, name?: string) => {
    setLoading(true);
    setAlertDismissed(false);
    setIsSimulated(false);
    audioAlertService.stopEmergencySiren();
    setIsSirenOn(false);
    try {
      const floodData = await getFloodData(lat, lon, name || 'Monitored Region');
      setData(floodData);
      setCoords({ latitude: lat, longitude: lon });
      await saveHazardSnapshot(floodData);

      if (floodData.riskLevel === 'CRITICAL') {
        audioAlertService.playEmergencySiren();
        setIsSirenOn(true);
      }
    } catch {
      const cached = await getCachedHazardSnapshot();
      if (cached) setData(cached);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    audioAlertService.requestNotificationPermission();

    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          let loc = await Location.getCurrentPositionAsync({});
          await loadHazardData(loc.coords.latitude, loc.coords.longitude, 'Your Current Location');
        } else {
          await loadHazardData(coords.latitude, coords.longitude, 'Agra, Uttar Pradesh, India');
        }
      } catch {
        await loadHazardData(coords.latitude, coords.longitude, 'Agra, Uttar Pradesh, India');
      }
    })();

    getHazardReports().then(setHazardReports);
  }, []);

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (text.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      const results = await searchLocations(text);
      setSearchResults(results);
      setSearching(false);
    }, 400);
  };

  const handleSelectLocation = async (item: LocationResult) => {
    const locDisplayName = `${item.name}${item.admin1 ? ', ' + item.admin1 : ''}, ${item.country}`;
    setSearchQuery('');
    setSearchResults([]);
    await loadHazardData(item.latitude, item.longitude, locDisplayName);
  };

  const handleOpenRoute = async (shelterId: string) => {
    setRouteLoading(true);
    setShowRouteModal(true);
    try {
      const route = await getEvacuationRoute(coords.latitude, coords.longitude, shelterId);
      setSelectedRoute(route);
      await saveCachedRoute(shelterId, route);
    } catch {
      console.warn('Network offline, checking cached evacuation route...');
      const cached = await getCachedRoute(shelterId);
      if (cached) setSelectedRoute(cached);
    } finally {
      setRouteLoading(false);
    }
  };

  const handleTriggerScenario = async (rainMm: number, dischargeMul: number, damRelease: number) => {
    setSimulating(true);
    try {
      const simResult = await runFloodSimulation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        simulatedAdditionalRainfallMm: rainMm,
        simulatedDischargeMultiplier: dischargeMul,
        upstreamDamReleaseM3s: damRelease,
      });
      setData(simResult);
      setIsSimulated(true);
      setAlertDismissed(false);

      if (simResult.riskLevel === 'CRITICAL') {
        audioAlertService.playEmergencySiren();
        setIsSirenOn(true);
        audioAlertService.sendPushAlert(
          'CRITICAL FLOOD INUNDATION ALERT',
          `Severe river surge detected: ${simResult.hydrology.riverDischargeM3s} m³/s. Immediate evacuation ordered.`
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSimulating(false);
    }
  };

  const handleResetScenario = () => {
    audioAlertService.stopEmergencySiren();
    setIsSirenOn(false);
    loadHazardData(coords.latitude, coords.longitude);
  };

  const handleCreateReport = async () => {
    if (!reportDesc.trim()) return;
    setSubmittingReport(true);
    try {
      const newReport = await submitHazardReport({
        latitude: coords.latitude + (Math.random() - 0.5) * 0.01,
        longitude: coords.longitude + (Math.random() - 0.5) * 0.01,
        hazardType: reportType,
        severity: reportSeverity,
        description: reportDesc,
      });
      setHazardReports((prev) => [newReport, ...prev]);
      setReportDesc('');
      setShowReportModal(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleCallEmergency = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };

  const riskColor = data ? getRiskColor(data.riskLevel) : '#38BDF8';
  const isHighRisk = data?.riskLevel === 'HIGH' || data?.riskLevel === 'CRITICAL';

  const maxDischargeInForecast = data?.hydrology?.forecast7Days
    ? Math.max(...data.hydrology.forecast7Days.map((d) => d.dischargeM3s), 100)
    : 100;

  const mapEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${coords.longitude - 0.04}%2C${coords.latitude - 0.03}%2C${coords.longitude + 0.04}%2C${coords.latitude + 0.03}&layer=mapnik&marker=${coords.latitude}%2C${coords.longitude}`;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: riskColor }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeftGroup}>
            <ShieldAlert color={riskColor} size={28} />
            <View style={styles.headerTitles}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {isSimulated ? `[SIMULATION] ${data?.locationName}` : data?.locationName || 'AquaShield'}
              </Text>
              {data && (
                <Text style={[styles.badge, { color: riskColor }]}>
                  {data.riskLevel} RISK ({data.compositeRiskScore}% COMPOSITE INDEX)
                </Text>
              )}
            </View>
          </View>

          {/* Action Buttons */}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TouchableOpacity
              style={styles.exportButton}
              onPress={() => data && exportSituationReport(data, hazardReports)}
              activeOpacity={0.8}
            >
              <FileDown color="#38BDF8" size={15} />
              <Text style={styles.exportButtonText}>SitRep</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sosButton}
              onPress={() => setShowSosModal(true)}
              activeOpacity={0.8}
            >
              <Radio color="#FFFFFF" size={16} />
              <Text style={styles.sosButtonText}>SOS</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchBarContainer}>
          <Search color="#94A3B8" size={18} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search city, river basin, or region..."
            placeholderTextColor="#64748B"
            value={searchQuery}
            onChangeText={handleSearchChange}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => handleSearchChange('')} style={styles.clearBtn}>
              <X color="#94A3B8" size={16} />
            </TouchableOpacity>
          )}
          {searching && <ActivityIndicator size="small" color="#38BDF8" style={{ marginRight: 8 }} />}
        </View>

        {searchResults.length > 0 && (
          <View style={styles.searchResultsDropdown}>
            {searchResults.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.searchResultItem}
                onPress={() => handleSelectLocation(item)}
              >
                <MapPin color="#38BDF8" size={16} />
                <View style={{ marginLeft: 8 }}>
                  <Text style={styles.searchResultName}>{item.name}</Text>
                  <Text style={styles.searchResultSub}>
                    {item.admin1 ? `${item.admin1}, ` : ''}{item.country} • ({item.latitude.toFixed(2)}°, {item.longitude.toFixed(2)}°)
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {data && <Text style={styles.advisoryText}>{data.advisoryMessage}</Text>}
      </View>

      {/* Emergency Advisory Flash */}
      {isHighRisk && !alertDismissed && (
        <View style={[styles.emergencyBanner, { backgroundColor: riskColor }]}>
          <BellRing color="#FFFFFF" size={18} />
          <View style={{ flex: 1, marginHorizontal: 10 }}>
            <Text style={styles.emergencyBannerTitle}>
              {isSimulated ? 'SIMULATED FLOOD SURGE TRIGGERED' : 'FLASH FLOOD ADVISORY ACTIVE'}
            </Text>
            <Text style={styles.emergencyBannerSub}>
              Crest surge peak expected in {data?.hydrology.crestTimeHours}h. Avoid low-elevation corridors.
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => {
              if (isSirenOn) {
                audioAlertService.stopEmergencySiren();
                setIsSirenOn(false);
              } else {
                audioAlertService.playEmergencySiren();
                setIsSirenOn(true);
              }
            }}
            style={{ marginRight: 12, padding: 4 }}
          >
            {isSirenOn ? <VolumeX color="#FFFFFF" size={18} /> : <Volume2 color="#FFFFFF" size={18} />}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              audioAlertService.stopEmergencySiren();
              setIsSirenOn(false);
              setAlertDismissed(true);
            }}
          >
            <X color="#FFFFFF" size={18} />
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#38BDF8" />
          <Text style={styles.loadingText}>Computing hydrological discharge metrics...</Text>
        </View>
      ) : data ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Stress-Test Deck */}
          <View style={styles.simulationCard}>
            <View style={styles.simHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Sliders color="#38BDF8" size={16} />
                <Text style={styles.simTitle}>Scenario Stress-Test Engine</Text>
                {simulating && <ActivityIndicator size="small" color="#38BDF8" style={{ marginLeft: 6 }} />}
              </View>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <TouchableOpacity
                  style={styles.reportTriggerBtn}
                  onPress={() => setShowReportModal(true)}
                >
                  <PlusCircle color="#F59E0B" size={14} />
                  <Text style={styles.reportTriggerText}>Report Hazard</Text>
                </TouchableOpacity>
                {isSimulated && (
                  <TouchableOpacity onPress={handleResetScenario} style={styles.resetBtn}>
                    <RotateCcw color="#94A3B8" size={14} />
                    <Text style={styles.resetBtnText}>Reset</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <Text style={styles.simSubtitle}>
              Simulate extreme cloudbursts or upstream dam releases to test risk models:
            </Text>

            <View style={styles.presetButtonsRow}>
              <TouchableOpacity
                style={[styles.scenarioBtn, { backgroundColor: '#1E3A8A' }]}
                onPress={() => handleTriggerScenario(65, 1.4, 150)}
              >
                <Zap color="#60A5FA" size={14} />
                <Text style={styles.scenarioBtnText}>Cloudburst (+65mm)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.scenarioBtn, { backgroundColor: '#7C2D12' }]}
                onPress={() => handleTriggerScenario(120, 2.2, 500)}
              >
                <AlertTriangle color="#F97316" size={14} />
                <Text style={styles.scenarioBtnText}>Dam Release (500m³/s)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.scenarioBtn, { backgroundColor: '#7F1D1D' }]}
                onPress={() => handleTriggerScenario(220, 3.5, 1200)}
              >
                <ShieldAlert color="#EF4444" size={14} />
                <Text style={styles.scenarioBtnText}>Catastrophic Flood</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Map */}
          <View style={styles.mapCard}>
            {Platform.OS === 'web' ? (
              <View style={{ flex: 1, position: 'relative' }}>
                <iframe
                  title="Inundation Map"
                  src={mapEmbedUrl}
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    filter: 'invert(90%) hue-rotate(180deg) brightness(95%) contrast(90%)',
                  } as any}
                />
                <View style={[styles.webOverlayBadge, { borderColor: riskColor }]}>
                  <Waves color={riskColor} size={14} />
                  <Text style={[styles.webOverlayText, { color: riskColor }]}>
                    {data.riskLevel} INUNDATION RADAR ({coords.latitude.toFixed(2)}°, {coords.longitude.toFixed(2)}°)
                  </Text>
                </View>
              </View>
            ) : MapView ? (
              <MapView
                style={styles.map}
                provider={PROVIDER_DEFAULT}
                region={{
                  latitude: coords.latitude,
                  longitude: coords.longitude,
                  latitudeDelta: 0.08,
                  longitudeDelta: 0.08,
                }}
              >
                <Marker coordinate={coords} title={data.locationName} pinColor="#38BDF8" />
                <Circle
                  center={coords}
                  radius={2500}
                  fillColor={`${riskColor}33`}
                  strokeColor={riskColor}
                  strokeWidth={2}
                />
                {data.safeShelters.map((shelter) => (
                  <Marker
                    key={shelter.id}
                    coordinate={{ latitude: shelter.latitude, longitude: shelter.longitude }}
                    title={shelter.name}
                    description={`Slots Open: ${shelter.capacityRemaining}`}
                    pinColor="#10B981"
                  />
                ))}
              </MapView>
            ) : null}
          </View>

          {/* 7-Day Trend Chart */}
          <View style={styles.chartSection}>
            <View style={styles.chartHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TrendingUp color="#38BDF8" size={18} />
                <Text style={styles.chartTitle}>7-Day Hydro-Discharge Forecast</Text>
              </View>
              <Text style={styles.chartLegend}>m³/s flow (Rain mm)</Text>
            </View>

            <View style={styles.chartBarsRow}>
              {data.hydrology?.forecast7Days &&
                data.hydrology.forecast7Days.map((item, index) => {
                  const ratio = item.dischargeM3s / (maxDischargeInForecast || 1);
                  const barHeight = Math.max(Math.round(ratio * 68), 16);
                  const isPeak = item.dischargeM3s === maxDischargeInForecast;

                  return (
                    <View key={index} style={styles.barColumn}>
                      <Text style={styles.barDischargeValue}>{Math.round(item.dischargeM3s)}</Text>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.barFill,
                            {
                              height: barHeight,
                              backgroundColor: isPeak ? '#EF4444' : '#38BDF8',
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.barDayLabel}>{item.day}</Text>
                      <View style={styles.rainBadge}>
                        <Droplets color="#60A5FA" size={10} />
                        <Text style={styles.rainText}>{item.rainfallMm}</Text>
                      </View>
                    </View>
                  );
                })}
            </View>
          </View>

          {/* Telemetry Metrics */}
          <Text style={styles.sectionHeading}>Early Warning Telemetry</Text>
          <View style={styles.grid}>
            <View style={styles.metricCard}>
              <Waves color="#38BDF8" size={22} />
              <Text style={styles.metricLabel}>Peak Discharge</Text>
              <Text style={styles.metricValue}>{data.hydrology.riverDischargeM3s} m³/s</Text>
              <Text style={styles.metricSub}>{data.hydrology.dischargeRatio}x baseline</Text>
            </View>

            <View style={styles.metricCard}>
              <Compass color="#FACC15" size={22} />
              <Text style={styles.metricLabel}>Crest Surge In</Text>
              <Text style={styles.metricValue}>{data.hydrology.crestTimeHours} Hours</Text>
              <Text style={styles.metricSub}>Forecast Peak Time</Text>
            </View>

            <View style={styles.metricCard}>
              <Droplets color="#60A5FA" size={22} />
              <Text style={styles.metricLabel}>72h Rain Accumulation</Text>
              <Text style={styles.metricValue}>{data.weather.projected72hRainfallMm} mm</Text>
              <Text style={styles.metricSub}>{data.weather.precipitationProbability}% probability</Text>
            </View>

            <View style={styles.metricCard}>
              <AlertTriangle color="#F87171" size={22} />
              <Text style={styles.metricLabel}>Soil Moisture</Text>
              <Text style={styles.metricValue}>{(data.weather.soilMoistureIndex * 100).toFixed(0)}%</Text>
              <Text style={styles.metricSub}>Saturation index</Text>
            </View>
          </View>

          {/* Crowdsourced Field Hazard Feed */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={[styles.sectionHeading, { marginBottom: 0 }]}>Crowdsourced Inundation Feed</Text>
            <TouchableOpacity onPress={() => setShowReportModal(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <PlusCircle color="#38BDF8" size={14} />
              <Text style={{ color: '#38BDF8', fontSize: 12, fontWeight: '700' }}>Submit</Text>
            </TouchableOpacity>
          </View>
          {hazardReports.map((report) => (
            <View key={report.id} style={styles.reportCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle
                    color={report.severity === 'CRITICAL' ? '#EF4444' : report.severity === 'SEVERE' ? '#F97316' : '#FACC15'}
                    size={16}
                  />
                  <Text style={styles.reportType}>{report.hazardType.replace('_', ' ')}</Text>
                </View>
                <Text style={styles.reportTime}>{report.timestamp}</Text>
              </View>
              <Text style={styles.reportDescription}>{report.description}</Text>
            </View>
          ))}

          {/* Shelters */}
          <Text style={[styles.sectionHeading, { marginTop: 10 }]}>Designated Safe Evacuation Shelters</Text>
          {data.safeShelters.map((shelter) => (
            <View key={shelter.id} style={styles.shelterCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.shelterName}>{shelter.name}</Text>
                <Text style={styles.shelterSub}>
                  {shelter.distanceKm} km away • {shelter.capacityRemaining} slots open
                </Text>
              </View>
              <TouchableOpacity
                style={styles.routeBtn}
                onPress={() => handleOpenRoute(shelter.id)}
              >
                <Navigation color="#FFFFFF" size={15} />
                <Text style={styles.routeBtnText}>Evacuate</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {/* Evacuation Route Modal */}
      <Modal visible={showRouteModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <CheckCircle2 color="#10B981" size={20} />
                <Text style={styles.modalTitle}>Safe Evacuation Corridor</Text>
              </View>
              <TouchableOpacity onPress={() => setShowRouteModal(false)} style={styles.closeBtn}>
                <X color="#94A3B8" size={20} />
              </TouchableOpacity>
            </View>

            {routeLoading || !selectedRoute ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#38BDF8" />
                <Text style={{ color: '#94A3B8', marginTop: 12, fontSize: 13 }}>
                  Calculating high-elevation routes...
                </Text>
              </View>
            ) : (
              <View>
                <Text style={styles.modalShelterName}>{selectedRoute.shelterName}</Text>
                <View style={styles.modalStatsRow}>
                  <View style={styles.badgeRow}>
                    <Clock color="#94A3B8" size={14} />
                    <Text style={styles.modalStatText}>{selectedRoute.estimatedTimeMinutes} min</Text>
                  </View>
                  <View style={styles.badgeRow}>
                    <Navigation color="#94A3B8" size={14} />
                    <Text style={styles.modalStatText}>{selectedRoute.totalDistanceKm} km</Text>
                  </View>
                  <Text style={styles.safeBadge}>{selectedRoute.safeCorridorRating}</Text>
                </View>

                <Text style={styles.stepsHeading}>Turn-by-Turn Safe Path</Text>
                {selectedRoute.steps.map((step, idx) => (
                  <View key={idx} style={styles.stepRow}>
                    <Text style={styles.stepNum}>{idx + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stepInstruction}>{step.instruction}</Text>
                      <Text style={styles.stepDistance}>{step.distanceMeters} meters away</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Citizen Hazard Report Submission Modal */}
      <Modal visible={showReportModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <AlertTriangle color="#F59E0B" size={20} />
                <Text style={styles.modalTitle}>Report Field Hazard</Text>
              </View>
              <TouchableOpacity onPress={() => setShowReportModal(false)} style={styles.closeBtn}>
                <X color="#94A3B8" size={20} />
              </TouchableOpacity>
            </View>

            <Text style={styles.stepsHeading}>Hazard Type</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {(['WATERLOGGED', 'ROAD_BLOCKED', 'STRANDED_PERSON'] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.scenarioBtn,
                    { backgroundColor: reportType === type ? '#2563EB' : '#0F172A' },
                  ]}
                  onPress={() => setReportType(type)}
                >
                  <Text style={styles.scenarioBtnText}>{type.replace('_', ' ')}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.stepsHeading}>Severity</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {(['MODERATE', 'SEVERE', 'CRITICAL'] as const).map((sev) => (
                <TouchableOpacity
                  key={sev}
                  style={[
                    styles.scenarioBtn,
                    {
                      backgroundColor:
                        reportSeverity === sev
                          ? sev === 'CRITICAL'
                            ? '#DC2626'
                            : '#D97706'
                          : '#0F172A',
                    },
                  ]}
                  onPress={() => setReportSeverity(sev)}
                >
                  <Text style={styles.scenarioBtnText}>{sev}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.stepsHeading}>Situation Description</Text>
            <TextInput
              style={[styles.searchInput, { height: 74, textAlignVertical: 'top', padding: 8, marginBottom: 16 }]}
              placeholder="e.g., Highway underpass inundated, water depth ~1.5m, impassable..."
              placeholderTextColor="#64748B"
              multiline
              value={reportDesc}
              onChangeText={setReportDesc}
            />

            <TouchableOpacity
              style={[styles.routeBtn, { justifyContent: 'center', height: 42 }]}
              onPress={handleCreateReport}
              disabled={submittingReport || !reportDesc.trim()}
            >
              {submittingReport ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={[styles.routeBtnText, { textAlign: 'center', fontSize: 13 }]}>Broadcast Field Hazard</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SOS Modal */}
      <Modal visible={showSosModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Radio color="#EF4444" size={22} />
                <Text style={[styles.modalTitle, { color: '#EF4444' }]}>Emergency SOS Contacts</Text>
              </View>
              <TouchableOpacity onPress={() => setShowSosModal(false)} style={styles.closeBtn}>
                <X color="#94A3B8" size={20} />
              </TouchableOpacity>
            </View>

            <Text style={styles.sosNotice}>
              Direct emergency connection to flood rescue command centers.
            </Text>

            <TouchableOpacity style={styles.sosCard} onPress={() => handleCallEmergency('112')}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sosContactName}>National Emergency Helpline</Text>
                <Text style={styles.sosContactSub}>Universal 24/7 Dispatch</Text>
              </View>
              <View style={[styles.callBtn, { backgroundColor: '#EF4444' }]}>
                <PhoneCall color="#FFFFFF" size={16} />
                <Text style={styles.callBtnText}>112</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sosCard} onPress={() => handleCallEmergency('1078')}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sosContactName}>Disaster Management Authority (NDMA)</Text>
                <Text style={styles.sosContactSub}>Flood Relief & Boat Rescue</Text>
              </View>
              <View style={[styles.callBtn, { backgroundColor: '#2563EB' }]}>
                <PhoneCall color="#FFFFFF" size={16} />
                <Text style={styles.callBtnText}>1078</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sosCard} onPress={() => handleCallEmergency('1070')}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sosContactName}>State Emergency Operations Center</Text>
                <Text style={styles.sosContactSub}>Regional Inundation Control</Text>
              </View>
              <View style={[styles.callBtn, { backgroundColor: '#059669' }]}>
                <PhoneCall color="#FFFFFF" size={16} />
                <Text style={styles.callBtnText}>1070</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A', padding: 20 },
  loadingText: { color: '#94A3B8', marginTop: 12, fontSize: 14 },
  header: {
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 16,
    backgroundColor: '#1E293B',
    borderBottomWidth: 3,
    zIndex: 50,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  headerTitles: { marginLeft: 12, flex: 1 },
  headerTitle: { color: '#F8FAFC', fontSize: 17, fontWeight: '700' },
  badge: { fontSize: 11, fontWeight: '800', marginTop: 2, letterSpacing: 0.5 },
  exportButton: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
  },
  exportButtonText: { color: '#38BDF8', fontWeight: '700', fontSize: 13 },
  sosButton: {
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  sosButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  emergencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  emergencyBannerTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  emergencyBannerSub: { color: '#F1F5F9', fontSize: 11, marginTop: 1 },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    marginTop: 12,
    height: 40,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: '#F8FAFC', fontSize: 13 },
  clearBtn: { padding: 4 },
  searchResultsDropdown: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#475569',
    marginTop: 6,
    overflow: 'hidden',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  searchResultName: { color: '#F8FAFC', fontSize: 13, fontWeight: '600' },
  searchResultSub: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  advisoryText: { color: '#CBD5E1', fontSize: 12, marginTop: 10, lineHeight: 16 },
  scrollContent: { padding: 16 },

  simulationCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  simHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  simTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '700' },
  simSubtitle: { color: '#94A3B8', fontSize: 11, marginVertical: 6 },
  reportTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  reportTriggerText: { color: '#F59E0B', fontSize: 11, fontWeight: '700' },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  resetBtnText: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  presetButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  scenarioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  scenarioBtnText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },

  mapCard: {
    height: 240,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
    backgroundColor: '#0F172A',
  },
  map: { width: '100%', height: '100%' },
  webOverlayBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  webOverlayText: { fontSize: 11, fontWeight: '700' },
  chartSection: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#334155',
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  chartTitle: { color: '#F8FAFC', fontSize: 14, fontWeight: '700', marginLeft: 6 },
  chartLegend: { color: '#94A3B8', fontSize: 11 },
  chartBarsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
    paddingTop: 15,
  },
  barColumn: { alignItems: 'center', flex: 1 },
  barDischargeValue: { color: '#94A3B8', fontSize: 10, fontWeight: '700', marginBottom: 4 },
  barTrack: {
    width: 14,
    height: 70,
    backgroundColor: '#0F172A',
    borderRadius: 7,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 7 },
  barDayLabel: { color: '#CBD5E1', fontSize: 10, marginTop: 6, fontWeight: '600' },
  rainBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 2 },
  rainText: { color: '#60A5FA', fontSize: 9, fontWeight: '600' },
  sectionHeading: { color: '#F1F5F9', fontSize: 15, fontWeight: '700', marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 20 },
  metricCard: {
    width: (width > 500 ? 500 : width - 44) / 2,
    backgroundColor: '#1E293B',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 12,
  },
  metricLabel: { color: '#94A3B8', fontSize: 11, marginTop: 6 },
  metricValue: { color: '#F8FAFC', fontSize: 17, fontWeight: '700', marginVertical: 4 },
  metricSub: { color: '#64748B', fontSize: 11 },

  reportCard: {
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  reportType: { color: '#F8FAFC', fontSize: 12, fontWeight: '700' },
  reportTime: { color: '#64748B', fontSize: 10 },
  reportDescription: { color: '#94A3B8', fontSize: 12, marginTop: 4, lineHeight: 16 },

  shelterCard: {
    backgroundColor: '#1E293B',
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  shelterName: { color: '#F8FAFC', fontSize: 14, fontWeight: '600' },
  shelterSub: { color: '#94A3B8', fontSize: 11, marginTop: 4 },
  routeBtn: {
    backgroundColor: '#2563EB',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 5,
  },
  routeBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '700', marginLeft: 8 },
  closeBtn: { padding: 4 },
  modalShelterName: { color: '#38BDF8', fontSize: 15, fontWeight: '600', marginBottom: 8 },
  modalStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 16, alignItems: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0F172A', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  modalStatText: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  safeBadge: { backgroundColor: '#064E3B', color: '#34D399', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, fontSize: 11, fontWeight: '700' },
  stepsHeading: { color: '#F8FAFC', fontSize: 13, fontWeight: '700', marginBottom: 12 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  stepNum: { backgroundColor: '#2563EB', color: '#FFF', width: 22, height: 22, borderRadius: 11, textAlign: 'center', lineHeight: 22, fontSize: 12, marginRight: 10, fontWeight: '700' },
  stepInstruction: { color: '#F1F5F9', fontSize: 13, lineHeight: 18 },
  stepDistance: { color: '#64748B', fontSize: 11, marginTop: 2 },
  sosNotice: { color: '#94A3B8', fontSize: 12, marginBottom: 16, lineHeight: 16 },
  sosCard: {
    backgroundColor: '#0F172A',
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sosContactName: { color: '#F8FAFC', fontSize: 13, fontWeight: '600' },
  sosContactSub: { color: '#64748B', fontSize: 11, marginTop: 2 },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 4,
  },
  callBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});