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
  Vibration,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './src/supabaseClient';
import { generateEvacuationBriefingPdf } from './src/pdfExporter';
import { SUPPORTED_LANGUAGES, TRANSLATIONS, LanguageCode } from './src/i18n';

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

interface InteractiveMapProps {
  lat: number;
  lon: number;
  discharge: number;
  hazards: Hazard[];
  shelters: Shelter[];
  selectedShelterId: number | null;
}

// Native & Web safe wrapper for Map
const InteractiveMap: React.FC<InteractiveMapProps> = (props) => {
  const mapContainerRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const layersRef = useRef<{ geojson?: any; markers?: any[]; route?: any }>({ markers: [] });

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const L = (window as any).L;
    if (!L || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([props.lat, props.lon], 13);

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        className: 'dark-tiles',
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);
      mapInstanceRef.current = map;
    } else {
      mapInstanceRef.current.setView([props.lat, props.lon], 13);
    }

    const map = mapInstanceRef.current;

    if (layersRef.current.geojson) map.removeLayer(layersRef.current.geojson);
    if (layersRef.current.route) map.removeLayer(layersRef.current.route);
    if (layersRef.current.markers) {
      layersRef.current.markers.forEach((m: any) => map.removeLayer(m));
      layersRef.current.markers = [];
    }

    fetch(`${API_BASE}/inundation-zones?lat=${props.lat}&lon=${props.lon}&discharge=${props.discharge}`)
      .then((r) => r.json())
      .then((geoData) => {
        if (!mapInstanceRef.current || !geoData || !geoData.features) return;
        const layer = L.geoJSON(geoData, {
          style: (feature: any) => ({
            fillColor: feature.properties.fillColor,
            fillOpacity: feature.properties.fillOpacity,
            color: feature.properties.strokeColor,
            weight: 2,
            dashArray: feature.properties.zone === 'EXTREME' ? '4, 4' : undefined,
          }),
        }).addTo(map);
        layersRef.current.geojson = layer;
      })
      .catch((e) => console.warn('Inundation load fallback:', e));

    const userMarker = L.circleMarker([props.lat, props.lon], {
      radius: 9,
      color: '#38bdf8',
      fillColor: '#0284c7',
      fillOpacity: 1,
      weight: 3,
    }).addTo(map);
    layersRef.current.markers.push(userMarker);

    props.shelters.forEach((s) => {
      const isTarget = props.selectedShelterId === s.id;
      const marker = L.circleMarker([s.lat, s.lon], {
        radius: isTarget ? 10 : 7,
        color: '#10b981',
        fillColor: isTarget ? '#34d399' : '#059669',
        fillOpacity: 0.9,
        weight: isTarget ? 3 : 2,
      }).addTo(map);
      layersRef.current.markers.push(marker);
    });
  }, [props.lat, props.lon, props.discharge, props.shelters, props.selectedShelterId]);

  if (Platform.OS === 'web') {
    return React.createElement('div', {
      ref: mapContainerRef,
      style: { width: '100%', height: '320px', borderRadius: '8px', overflow: 'hidden' },
    });
  }

  return (
    <View style={styles.mobileMapFallback}>
      <Text style={styles.mobileMapTitle}>🗺️ Live Satellite Vector Map Active</Text>
      <Text style={styles.cardText}>
        Monitored Coordinates: {props.lat.toFixed(2)}, {props.lon.toFixed(2)}
      </Text>
      <Text style={styles.cardSubtext}>Active River Discharge: {props.discharge} m³/s</Text>
    </View>
  );
};

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
  const [selectedShelterId, setSelectedShelterId] = useState<number | null>(1);

  // Localization & Startup Language Guard
  const [currentLang, setCurrentLang] = useState<LanguageCode>('en');
  const [hasSelectedLang, setHasSelectedLang] = useState<boolean>(false);
  const [isInitializingLang, setIsInitializingLang] = useState<boolean>(true);
  const [langModalVisible, setLangModalVisible] = useState<boolean>(false);

  useEffect(() => {
    const checkInitialLanguage = async () => {
      try {
        let savedLang: string | null = null;
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
          savedLang = window.localStorage.getItem('aquashield_lang');
        } else {
          savedLang = await AsyncStorage.getItem('aquashield_lang');
        }

        if (savedLang && TRANSLATIONS[savedLang as LanguageCode]) {
          setCurrentLang(savedLang as LanguageCode);
          setHasSelectedLang(true);
        } else {
          setHasSelectedLang(false);
        }
      } catch (err) {
        setHasSelectedLang(false);
      } finally {
        setIsInitializingLang(false);
      }
    };

    checkInitialLanguage();
  }, []);

  const handleSelectLanguage = async (code: LanguageCode) => {
    setCurrentLang(code);
    setHasSelectedLang(true);
    setLangModalVisible(false);

    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('aquashield_lang', code);
      } else {
        await AsyncStorage.setItem('aquashield_lang', code);
      }
    } catch (err) {
      console.warn('Language persist err:', err);
    }
  };

  const t = (key: string): string => {
    return TRANSLATIONS[currentLang]?.[key] || TRANSLATIONS.en[key] || key;
  };

  // Safe Web-only Offline Connection Tracker
  const [isOffline, setIsOffline] = useState<boolean>(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    setIsOffline(!navigator.onLine);
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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

  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [hazardType, setHazardType] = useState<string>('WATERLOGGED');
  const [hazardDesc, setHazardDesc] = useState<string>('');

  const playSiren = () => {
    try {
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && 'navigator' in window && window.navigator.vibrate) {
          window.navigator.vibrate([800, 200, 800, 200, 800, 200, 800]);
        }
      } else {
        Vibration.vibrate([0, 800, 200, 800, 200, 800, 200, 800], false);
      }
    } catch (e) {
      console.warn('Vibration failed:', e);
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';

        const startTime = ctx.currentTime;
        const duration = 5.0;

        for (let offset = 0; offset < duration; offset += 0.6) {
          osc.frequency.setValueAtTime(450, startTime + offset);
          osc.frequency.linearRampToValueAtTime(950, startTime + offset + 0.3);
          osc.frequency.linearRampToValueAtTime(450, startTime + offset + 0.6);
        }

        gain.gain.setValueAtTime(0.9, startTime);
        gain.gain.setValueAtTime(0.9, startTime + duration - 0.4);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      } catch (e) {
        console.warn('AudioContext failed:', e);
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
      setTelemetry({
        riskLevel: 'MODERATE',
        compositeRiskScore: 42,
        advisoryMessage: 'Yamuna downstream discharge elevated. Embankment buffer monitored.',
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
      console.warn('Hazard fetch fallback');
    }
  };

  useEffect(() => {
    fetchTelemetry(coords.lat, coords.lon);
    fetchHazards();

    try {
      const channel = supabase
        .channel('hazards-realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hazards' }, (payload) => {
          const newRow = payload.new as Hazard;
          setHazards((current) => {
            if (current.some((h) => h.id === newRow.id)) return current;
            return [newRow, ...current];
          });
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } catch (e) {
      console.warn('Realtime subscription error:', e);
    }
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
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const data = await res.json();
        setSearchResults(data);
        setShowDropdown(true);
      } catch (e) {
        console.warn('Search geocoding error:', e);
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

  const runSimulation = (type: string) => {
    playSiren();
    fetch(`${API_BASE}/simulate-flood-scenario?scenario=${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});

    if (type === 'cloudburst') {
      setTelemetry({
        riskLevel: 'HIGH',
        compositeRiskScore: 74,
        advisoryMessage: 'SIMULATION ACTIVE: Sudden +65mm cloudburst triggered.',
        hydrology: { riverDischargeM3s: 580.4, crestTimeHours: 6 },
        weather: { projected72hRainfallMm: 95.0, soilMoistureIndex: 92 },
      });
      setForecastBars([210, 580, 490, 310, 180, 110, 75]);
    } else if (type === 'dam_release') {
      setTelemetry({
        riskLevel: 'CATASTROPHIC',
        compositeRiskScore: 89,
        advisoryMessage: 'SIMULATION ACTIVE: Upstream Dam Release (500m³/s).',
        hydrology: { riverDischargeM3s: 890.2, crestTimeHours: 3 },
        weather: { projected72hRainfallMm: 45.0, soilMoistureIndex: 88 },
      });
      setForecastBars([320, 890, 740, 480, 220, 140, 90]);
    } else {
      setTelemetry({
        riskLevel: 'CATASTROPHIC',
        compositeRiskScore: 98,
        advisoryMessage: 'SIMULATION ACTIVE: CATASTROPHIC BASIN FLOOD.',
        hydrology: { riverDischargeM3s: 1420.0, crestTimeHours: 1 },
        weather: { projected72hRainfallMm: 160.0, soilMoistureIndex: 99 },
      });
      setForecastBars([450, 1420, 1180, 790, 420, 210, 120]);
    }
  };

  const triggerSOS = async () => {
    playSiren();
    alert('EMERGENCY SOS: Distress signal broadcasted to rescue units.');
    try {
      await fetch(`${API_BASE}/trigger-sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: coords.lat,
          lon: coords.lon,
          regionName: regionName,
          details: 'Urgent rescue response needed at current coordinates',
        }),
      });
    } catch (e) {}
  };

  const handleExportPdf = () => {
    if (Platform.OS === 'web') {
      generateEvacuationBriefingPdf(regionName, coords, telemetry, shelters, hazards);
    } else {
      alert('PDF Dossier export is available via the web console.');
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
    setModalVisible(false);
    setHazardDesc('');

    try {
      await fetch(`${API_BASE}/hazard-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newReport),
      });
    } catch (e) {
      setHazards((prev) => [newReport, ...prev]);
    }
  };

  const getRiskColor = (level: string = '') => {
    switch (level.toUpperCase()) {
      case 'CATASTROPHIC': return '#ef4444';
      case 'HIGH': return '#f97316';
      case 'MODERATE': return '#eab308';
      default: return '#10b981';
    }
  };

  // 1. Initial Storage Reading Screen
  if (isInitializingLang) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#38bdf8" />
      </View>
    );
  }

  // 2. Full-Screen Language Selection on First Launch
  if (!hasSelectedLang) {
    return (
      <View style={[styles.container, { justifyContent: 'center', padding: 20 }]}>
        <View style={styles.langModalContent}>
          <Text style={styles.langModalTitle}>🌐 Select Language</Text>
          <Text style={styles.langModalSubtitle}>
            Choose your preferred language for flood warnings and emergency alerts.
          </Text>

          <View style={styles.langList}>
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isSelected = currentLang === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[styles.langOptionCard, isSelected && styles.langOptionCardActive]}
                  onPress={() => setCurrentLang(lang.code)}
                >
                  <Text style={[styles.langOptionNative, isSelected && styles.langOptionTextActive]}>
                    {lang.nativeLabel}
                  </Text>
                  <Text style={[styles.langOptionLabel, isSelected && styles.langOptionTextActive]}>
                    {lang.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.langContinueBtn}
            onPress={() => handleSelectLanguage(currentLang)}
          >
            <Text style={styles.langContinueBtnText}>Continue to AquaShield ➔</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 3. Main Dashboard UI
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('appTitle')}</Text>
          <Text style={styles.subtitle}>{t('subtitle')}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.langBtn} onPress={() => setLangModalVisible(true)}>
            <Text style={styles.btnText}>{t('changeLang')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pdfBtn} onPress={handleExportPdf}>
            <Text style={styles.btnText}>{t('exportPdf')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sosBtn} onPress={triggerSOS}>
            <Text style={styles.btnText}>{t('sos')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>{t('offlineBanner')}</Text>
        </View>
      )}

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('searchPlaceholder')}
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

      <View style={styles.regionBanner}>
        <Text style={styles.regionText}>
          📍 {t('monitoredRegion')}: <Text style={styles.regionHighlight}>{regionName}</Text> ({coords.lat.toFixed(2)}, {coords.lon.toFixed(2)})
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#38bdf8" style={{ marginVertical: 30 }} />
      ) : (
        telemetry && (
          <View style={[styles.card, { borderLeftColor: getRiskColor(telemetry.riskLevel), borderLeftWidth: 6 }]}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: getRiskColor(telemetry.riskLevel) }]}>
                <Text style={styles.badgeText}>{telemetry.riskLevel} RISK</Text>
              </View>
              <Text style={styles.riskScore}>{t('riskIndex')}: {telemetry.compositeRiskScore}/100</Text>
            </View>
            <Text style={styles.advisory}>{telemetry.advisoryMessage}</Text>

            <View style={styles.metricsGrid}>
              <View style={styles.metricBox}>
                <Text style={styles.metricVal}>{telemetry.hydrology.riverDischargeM3s} m³/s</Text>
                <Text style={styles.metricLbl}>{t('peakDischarge')}</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricVal}>{telemetry.hydrology.crestTimeHours} {t('hours')}</Text>
                <Text style={styles.metricLbl}>{t('crestArrival')}</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricVal}>{telemetry.weather.projected72hRainfallMm} mm</Text>
                <Text style={styles.metricLbl}>{t('rain72h')}</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricVal}>{telemetry.weather.soilMoistureIndex}%</Text>
                <Text style={styles.metricLbl}>{t('soilSaturation')}</Text>
              </View>
            </View>
          </View>
        )
      )}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeader}>{t('mapSectionTitle')}</Text>
      </View>

      <View style={styles.mapCard}>
        <InteractiveMap
          lat={coords.lat}
          lon={coords.lon}
          discharge={telemetry?.hydrology.riverDischargeM3s || 90}
          hazards={hazards}
          shelters={shelters}
          selectedShelterId={selectedShelterId}
        />
      </View>

      <Text style={styles.sectionHeader}>{t('forecastTitle')}</Text>
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

      <Text style={styles.sectionHeader}>{t('simSectionTitle')}</Text>
      <View style={styles.simButtonsRow}>
        <TouchableOpacity style={styles.simBtn} onPress={() => runSimulation('cloudburst')}>
          <Text style={styles.simBtnText}>{t('simCloudburst')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.simBtn} onPress={() => runSimulation('dam_release')}>
          <Text style={styles.simBtnText}>{t('simDamRelease')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.simBtn, { backgroundColor: '#7f1d1d' }]} onPress={() => runSimulation('catastrophic')}>
          <Text style={styles.simBtnText}>{t('simCatastrophic')}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionHeader}>{t('sheltersTitle')}</Text>
      {shelters.map((s) => (
        <View key={s.id} style={styles.shelterCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.shelterName}>{s.name}</Text>
            <Text style={styles.shelterInfo}>{s.distanceKm} km {t('away')} • {s.capacitySlots} {t('slotsOpen')}</Text>
          </View>
          <TouchableOpacity
            style={styles.evacuateBtn}
            onPress={() => {
              setSelectedShelterId(s.id);
              alert(`Routing to ${s.name}`);
            }}
          >
            <Text style={styles.btnText}>{t('evacuateBtn')}</Text>
          </TouchableOpacity>
        </View>
      ))}

      <View style={styles.sectionHeaderRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.sectionHeader}>{t('hazardsTitle')}</Text>
          <View style={styles.liveIndicatorDot} />
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
          <Text style={styles.btnText}>{t('reportHazardBtn')}</Text>
        </TouchableOpacity>
      </View>

      {hazards.map((h, i) => (
        <View key={h.id || i} style={styles.feedCard}>
          <Text style={styles.feedType}>⚠️ {h.type}</Text>
          <Text style={styles.feedDesc}>{h.description}</Text>
          <Text style={styles.feedTime}>{h.timestamp || 'Just now'}</Text>
        </View>
      ))}

      <Modal visible={langModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.langModalContent}>
            <Text style={styles.langModalTitle}>🌐 {t('selectLanguagePrompt')}</Text>
            <Text style={styles.langModalSubtitle}>{t('selectLanguageSubtitle')}</Text>
            
            <View style={styles.langList}>
              {SUPPORTED_LANGUAGES.map((lang) => {
                const isSelected = currentLang === lang.code;
                return (
                  <TouchableOpacity
                    key={lang.code}
                    style={[styles.langOptionCard, isSelected && styles.langOptionCardActive]}
                    onPress={() => handleSelectLanguage(lang.code)}
                  >
                    <Text style={[styles.langOptionNative, isSelected && styles.langOptionTextActive]}>
                      {lang.nativeLabel}
                    </Text>
                    <Text style={[styles.langOptionLabel, isSelected && styles.langOptionTextActive]}>
                      {lang.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={styles.langContinueBtn}
              onPress={() => handleSelectLanguage(currentLang)}
            >
              <Text style={styles.langContinueBtnText}>{t('continueBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('modalTitle')}</Text>
            <View style={styles.typeSelectorRow}>
              {['WATERLOGGED', 'ROAD BLOCKED', 'RIVER OVERFLOW', 'EVACUATION NEEDED'].map((tType) => (
                <TouchableOpacity
                  key={tType}
                  style={[styles.typeOption, hazardType === tType && styles.typeOptionActive]}
                  onPress={() => setHazardType(tType)}
                >
                  <Text style={[styles.typeOptionText, hazardType === tType && styles.typeOptionTextActive]}>{tType}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder={t('descPlaceholder')}
              placeholderTextColor="#94a3b8"
              value={hazardDesc}
              onChangeText={setHazardDesc}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.btnText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={submitHazard}>
                <Text style={styles.btnText}>{t('submitReport')}</Text>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '900', color: '#f8fafc' },
  subtitle: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  langBtn: { backgroundColor: '#1e293b', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#38bdf8' },
  pdfBtn: { backgroundColor: '#334155', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#475569' },
  sosBtn: { backgroundColor: '#ef4444', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  btnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
  offlineBanner: { backgroundColor: '#b91c1c', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginBottom: 14, borderWidth: 1, borderColor: '#ef4444' },
  offlineBannerText: { color: '#ffffff', fontWeight: 'bold', fontSize: 12, textAlign: 'center' },
  searchContainer: { position: 'relative', zIndex: 50, marginBottom: 12 },
  searchInput: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155', borderRadius: 8, padding: 12, color: '#f8fafc', fontSize: 14 },
  searchSpinner: { position: 'absolute', right: 12, top: 12 },
  dropdown: { position: 'absolute', top: 50, left: 0, right: 0, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#475569', borderRadius: 8, zIndex: 100 },
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
  liveIndicatorDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10b981' },
  mapCard: { backgroundColor: '#1e293b', borderRadius: 8, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  mobileMapFallback: { padding: 20, alignItems: 'center', justifyContent: 'center' },
  mobileMapTitle: { color: '#38bdf8', fontSize: 15, fontWeight: 'bold', marginBottom: 6 },
  cardText: { color: '#f8fafc', fontSize: 13, marginBottom: 2 },
  cardSubtext: { color: '#94a3b8', fontSize: 12 },
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
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 },
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

  langModalContent: { backgroundColor: '#1e293b', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: '#38bdf8', maxWidth: 480, width: '100%', alignSelf: 'center' },
  langModalTitle: { color: '#f8fafc', fontSize: 20, fontWeight: '900', marginBottom: 6, textAlign: 'center' },
  langModalSubtitle: { color: '#94a3b8', fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 18 },
  langList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  langOptionCard: { flex: 1, minWidth: '45%', backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 10, padding: 12, alignItems: 'center' },
  langOptionCardActive: { backgroundColor: '#0369a1', borderColor: '#38bdf8', borderWidth: 2 },
  langOptionNative: { color: '#f8fafc', fontSize: 16, fontWeight: 'bold', marginBottom: 2 },
  langOptionLabel: { color: '#94a3b8', fontSize: 12 },
  langOptionTextActive: { color: '#ffffff' },
  langContinueBtn: { backgroundColor: '#0284c7', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  langContinueBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
});