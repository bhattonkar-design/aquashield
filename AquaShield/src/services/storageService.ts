import AsyncStorage from '@react-native-async-storage/async-storage';
import { FloodHazardData } from '../types/flood';
import { EvacuationRouteData } from './floodService';

const HAZARD_KEY = '@aquashield_last_hazard_snapshot';
const ROUTE_KEY_PREFIX = '@aquashield_cached_route_';

export const saveHazardSnapshot = async (data: FloodHazardData): Promise<void> => {
  try {
    await AsyncStorage.setItem(HAZARD_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Failed to save offline emergency snapshot:', err);
  }
};

export const getCachedHazardSnapshot = async (): Promise<FloodHazardData | null> => {
  try {
    const raw = await AsyncStorage.getItem(HAZARD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Failed to load cached emergency snapshot:', err);
    return null;
  }
};

export const saveCachedRoute = async (shelterId: string, route: EvacuationRouteData): Promise<void> => {
  try {
    await AsyncStorage.setItem(`${ROUTE_KEY_PREFIX}${shelterId}`, JSON.stringify(route));
  } catch (err) {
    console.error('Failed to cache evacuation route:', err);
  }
};

export const getCachedRoute = async (shelterId: string): Promise<EvacuationRouteData | null> => {
  try {
    const raw = await AsyncStorage.getItem(`${ROUTE_KEY_PREFIX}${shelterId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Failed to load cached evacuation route:', err);
    return null;
  }
};