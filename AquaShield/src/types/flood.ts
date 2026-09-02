export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface Shelter {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  capacityRemaining: number;
}

export interface ForecastPoint {
  day: string;
  dischargeM3s: number;
  rainfallMm: number;
}

export interface WeatherMetrics {
  currentRainfallMm: number;
  precipitationProbability: number;
  soilMoistureIndex: number;
  projected72hRainfallMm: number;
}

export interface HydrologicalMetrics {
  riverDischargeM3s: number;
  baselineDischargeM3s: number;
  dischargeRatio: number;
  crestTimeHours: number;
  forecast7Days: ForecastPoint[];
}

export interface FloodHazardData {
  locationName: string;
  latitude: number;
  longitude: number;
  compositeRiskScore: number;
  riskLevel: RiskLevel;
  advisoryMessage: string;
  weather: WeatherMetrics;
  hydrology: HydrologicalMetrics;
  safeShelters: Shelter[];
}

export interface LocationResult {
  id: number;
  name: string;
  country: string;
  admin1?: string;
  latitude: number;
  longitude: number;
}

export interface CitizenHazardReport {
  id: string;
  latitude: number;
  longitude: number;
  hazardType: 'ROAD_BLOCKED' | 'WATERLOGGED' | 'STRANDED_PERSON' | 'BRIDGE_COLLAPSE';
  severity: 'MODERATE' | 'SEVERE' | 'CRITICAL';
  description: string;
  timestamp: string;
}