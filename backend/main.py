from fastapi import FastAPI, Query, BackgroundTasks, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import urllib.request
import json
import os
import httpx
from supabase import create_client, Client

app = FastAPI(
    title="AquaShield Hydrological Telemetry & Dispatch API",
    version="2.3.0",
    description="Real-time river discharge forecasting, Supabase disaster persistence, dynamic GeoJSON contour generation, and automated Telegram dispatch webhooks."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Credentials & Database Configuration
# ---------------------------------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://aqkivwbsrmymogiilpyw.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8892785626:AAGBr72vvOVFPQHP-_Rx98ZWm2XUMqUgWtk")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "1889659746")

supabase_client: Optional[Client] = None

if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("INFO:     Connected successfully to Supabase PostgreSQL.")
    except Exception as err:
        print(f"WARNING:  Failed to initialize Supabase client: {err}")
else:
    print("WARNING:  Supabase credentials missing, falling back to local memory store.")

# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------
class HydrologyMetric(BaseModel):
    riverDischargeM3s: float
    crestTimeHours: int

class WeatherMetric(BaseModel):
    projected72hRainfallMm: float
    soilMoistureIndex: float

class DailyForecast(BaseModel):
    day: str
    dischargeM3s: float
    rainfallMm: float

class FloodRiskResponse(BaseModel):
    locationName: str
    latitude: float
    longitude: float
    riskLevel: str
    compositeRiskScore: int
    advisoryMessage: str
    hydrology: HydrologyMetric
    weather: WeatherMetric
    forecast7Days: List[DailyForecast]

class HazardReport(BaseModel):
    id: Optional[int] = None
    type: str = Field(..., example="WATERLOGGED")
    description: str = Field(..., example="Culvert inundated near bypass route")
    timestamp: Optional[str] = "Just now"
    lat: Optional[float] = 27.18
    lon: Optional[float] = 78.02

class SOSPayload(BaseModel):
    lat: float
    lon: float
    regionName: str
    details: Optional[str] = "Immediate civilian rescue required at current coordinates"

# ---------------------------------------------------------------------------
# In-Memory Seed Data
# ---------------------------------------------------------------------------
fallback_hazards: List[HazardReport] = [
    HazardReport(
        id=1,
        type="WATERLOGGED",
        description="Waist-deep water near bypass culvert. Inundation buffer impassable for light vehicles.",
        timestamp="10 mins ago",
        lat=27.18,
        lon=78.02
    ),
    HazardReport(
        id=2,
        type="ROAD BLOCKED",
        description="Riverbank sector breach. Staged detours diverted via eastern high ground.",
        timestamp="25 mins ago",
        lat=27.18,
        lon=78.02
    )
]

# ---------------------------------------------------------------------------
# Telegram Dispatch Engine
# ---------------------------------------------------------------------------
async def send_telegram_notification(text: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("WARNING:  Telegram alert skipped: missing credentials.")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": str(TELEGRAM_CHAT_ID),
        "text": text,
        "parse_mode": "Markdown"
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, timeout=6.0)
            if resp.status_code != 200:
                print(f"WARNING:  Telegram API response ({resp.status_code}): {resp.text}")
    except Exception as e:
        print(f"ERROR:    Failed to dispatch Telegram message: {e}")

# ---------------------------------------------------------------------------
# Live Hydrological Telemetry Gathering (Open-Meteo)
# ---------------------------------------------------------------------------
def fetch_open_meteo(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}&daily=precipitation_sum&"
        f"hourly=soil_moisture_0_to_1cm&timezone=auto"
    )
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "AquaShield/2.3 (Disaster-Response-Telemetry)"}
        )
        with urllib.request.urlopen(req, timeout=4) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"WARNING:  Open-Meteo telemetry fetch failed: {e}")
        return None

# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------
@app.get("/", tags=["Health"])
def read_root():
    return {
        "status": "Online",
        "service": "AquaShield Early Warning Hydrological Engine",
        "database_backend": "Supabase PostgreSQL Active" if supabase_client else "In-Memory Fallback",
        "telegram_integration": "Enabled" if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID else "Disabled / Incomplete",
        "version": "2.3.0"
    }

@app.get("/api/v1/flood-risk", response_model=FloodRiskResponse, tags=["Telemetry"])
def get_flood_risk(lat: float = Query(27.18), lon: float = Query(78.02), background_tasks: BackgroundTasks = None):
    meteo_data = fetch_open_meteo(lat, lon)
    
    rain_72h = 12.0
    soil_saturation = 35.0
    forecast_discharge = [90.0, 85.0, 80.0, 75.0, 70.0, 65.0, 60.0]

    if meteo_data and "daily" in meteo_data:
        daily_precip = meteo_data.get("daily", {}).get("precipitation_sum", [])
        if len(daily_precip) >= 3:
            rain_72h = round(sum(float(x) for x in daily_precip[:3] if x is not None), 1)
        else:
            rain_72h = 15.0
        
        hourly_soil = meteo_data.get("hourly", {}).get("soil_moisture_0_to_1cm", [])
        if hourly_soil:
            recent_soil = [float(s) for s in hourly_soil[:24] if s is not None]
            if recent_soil:
                soil_saturation = round((sum(recent_soil) / len(recent_soil)) * 100.0, 1)

        forecast_discharge = [round(max(20.0, float(r if r is not None else 0.0) * 12.5 + 40.0), 1) for r in daily_precip[:7]]
        while len(forecast_discharge) < 7:
            forecast_discharge.append(50.0)

    composite_index = min(100, int((rain_72h * 0.7) + (soil_saturation * 0.4)))

    if composite_index >= 75:
        risk_level = "CATASTROPHIC"
        advisory = f"CRITICAL ALERT: Dangerous riverbank surge ({rain_72h} mm accumulation). Evacuation mandatory!"
        crest_hours = 4
        if background_tasks:
            msg = (
                f"🚨 *AQUASHIELD CATASTROPHIC FLOOD ALERT*\n\n"
                f"📍 *Coordinates:* `{lat}, {lon}`\n"
                f"📊 *Composite Risk Index:* `{composite_index}/100`\n"
                f"🌧 *72h Rain Accumulation:* `{rain_72h} mm`\n"
                f"🌊 *Crest Time Window:* `{crest_hours} Hours`\n\n"
                f"⚠️ *Advisory:* {advisory}"
            )
            background_tasks.add_task(send_telegram_notification, msg)
    elif composite_index >= 50:
        risk_level = "HIGH"
        advisory = f"HIGH ADVISORY: Significant precipitation ({rain_72h} mm) and elevated discharge. Prepare evacuation supplies."
        crest_hours = 12
    elif composite_index >= 30:
        risk_level = "MODERATE"
        advisory = f"MODERATE WATCH: Persistent accumulation ({rain_72h} mm). Low-lying crossings monitored."
        crest_hours = 22
    else:
        risk_level = "LOW"
        advisory = f"NORMAL: Stable river baseline ({rain_72h} mm rain). Channel capacity secure."
        crest_hours = 36

    peak_discharge = round(max(forecast_discharge), 1)

    return FloodRiskResponse(
        locationName="Monitored Region",
        latitude=lat,
        longitude=lon,
        riskLevel=risk_level,
        compositeRiskScore=composite_index,
        advisoryMessage=advisory,
        hydrology=HydrologyMetric(
            riverDischargeM3s=peak_discharge,
            crestTimeHours=crest_hours
        ),
        weather=WeatherMetric(
            projected72hRainfallMm=rain_72h,
            soilMoistureIndex=soil_saturation
        ),
        forecast7Days=[
            DailyForecast(day=f"Day {i+1}", dischargeM3s=d, rainfallMm=5.0)
            for i, d in enumerate(forecast_discharge)
        ]
    )

@app.get("/api/v1/inundation-zones", tags=["Mapping"])
def get_inundation_zones(
    lat: float = Query(27.18),
    lon: float = Query(78.02),
    discharge: float = Query(90.0)
):
    # Scale contour polygon buffer offsets proportionally to discharge rate (m³/s)
    scale_factor = max(0.006, min(0.045, (discharge / 1500.0) * 0.045))

    geojson = {
        "type": "FeatureCollection",
        "features": [
            # Zone 3: 100-year / Catastrophic Buffer (Red)
            {
                "type": "Feature",
                "properties": {
                    "zone": "EXTREME",
                    "label": "Catastrophic Inundation Contour (100-Yr Basin Spill)",
                    "depthEstimate": "> 2.5m",
                    "fillColor": "#ef4444",
                    "fillOpacity": 0.45,
                    "strokeColor": "#b91c1c"
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [lon - (scale_factor * 1.5), lat - (scale_factor * 0.9)],
                        [lon + (scale_factor * 0.4), lat - (scale_factor * 1.2)],
                        [lon + (scale_factor * 1.6), lat - (scale_factor * 0.3)],
                        [lon + (scale_factor * 1.2), lat + (scale_factor * 1.1)],
                        [lon - (scale_factor * 0.5), lat + (scale_factor * 1.4)],
                        [lon - (scale_factor * 1.6), lat + (scale_factor * 0.2)],
                        [lon - (scale_factor * 1.5), lat - (scale_factor * 0.9)]
                    ]]
                }
            },
            # Zone 2: 25-year / High Water Overflow (Orange)
            {
                "type": "Feature",
                "properties": {
                    "zone": "HIGH",
                    "label": "High Spillway Reach (25-Yr Embankment Spill)",
                    "depthEstimate": "1.2m - 2.5m",
                    "fillColor": "#f97316",
                    "fillOpacity": 0.55,
                    "strokeColor": "#c2410c"
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [lon - scale_factor, lat - (scale_factor * 0.6)],
                        [lon + (scale_factor * 0.3), lat - (scale_factor * 0.8)],
                        [lon + scale_factor, lat - (scale_factor * 0.2)],
                        [lon + (scale_factor * 0.8), lat + (scale_factor * 0.7)],
                        [lon - (scale_factor * 0.3), lat + (scale_factor * 0.9)],
                        [lon - scale_factor, lat - (scale_factor * 0.6)]
                    ]]
                }
            },
            # Zone 1: Active River Corridor Baseline (Blue)
            {
                "type": "Feature",
                "properties": {
                    "zone": "ACTIVE_FLOW",
                    "label": "Active Riverbed & Riparian Buffer",
                    "depthEstimate": "Primary Channel Runoff",
                    "fillColor": "#0284c7",
                    "fillOpacity": 0.65,
                    "strokeColor": "#0369a1"
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [lon - (scale_factor * 0.5), lat - (scale_factor * 0.3)],
                        [lon + (scale_factor * 0.2), lat - (scale_factor * 0.4)],
                        [lon + (scale_factor * 0.5), lat + (scale_factor * 0.1)],
                        [lon - (scale_factor * 0.1), lat + (scale_factor * 0.4)],
                        [lon - (scale_factor * 0.5), lat - (scale_factor * 0.3)]
                    ]]
                }
            }
        ]
    }
    return geojson

@app.post("/api/v1/trigger-sos", tags=["Alerts"])
async def trigger_sos(sos: SOSPayload, background_tasks: BackgroundTasks):
    sos_msg = (
        f"🚨🚨 *EMERGENCY SOS DISTRESS SIGNAL* 🚨🚨\n\n"
        f"📍 *Location:* {sos.regionName}\n"
        f"🌐 *Coordinates:* `{sos.lat}, {sos.lon}`\n"
        f"🆘 *Situation:* {sos.details}\n"
        f"⏱ *Status:* Urgent civilian rescue response requested."
    )
    background_tasks.add_task(send_telegram_notification, sos_msg)
    return {"status": "success", "message": "SOS broadcast sent to emergency channels"}

@app.get("/api/v1/hazard-reports", response_model=List[HazardReport], tags=["Crowdsource"])
def get_hazards():
    if supabase_client:
        try:
            res = supabase_client.table("hazards").select("*").order("id", desc=True).limit(50).execute()
            if res.data:
                return [
                    HazardReport(
                        id=row["id"],
                        type=row["type"],
                        description=row["description"],
                        timestamp=row.get("timestamp", "Recent"),
                        lat=row.get("lat"),
                        lon=row.get("lon")
                    )
                    for row in res.data
                ]
        except Exception as e:
            print(f"ERROR:    Supabase select query failed: {e}")
            
    return fallback_hazards

@app.post("/api/v1/hazard-reports", response_model=HazardReport, tags=["Crowdsource"])
def add_hazard(report: HazardReport, background_tasks: BackgroundTasks):
    inserted_id = None
    inserted_ts = "Just now"

    if supabase_client:
        try:
            payload = {
                "type": report.type,
                "description": report.description,
                "timestamp": "Just now",
                "lat": report.lat,
                "lon": report.lon
            }
            res = supabase_client.table("hazards").insert(payload).execute()
            if res.data and len(res.data) > 0:
                created = res.data[0]
                inserted_id = created.get("id")
                inserted_ts = created.get("timestamp", "Just now")
        except Exception as e:
            print(f"ERROR:    Supabase insert query failed: {e}")

    if not inserted_id:
        inserted_id = len(fallback_hazards) + 1
        report.id = inserted_id
        report.timestamp = inserted_ts
        fallback_hazards.insert(0, report)
    else:
        report.id = inserted_id
        report.timestamp = inserted_ts

    if "EVACUATION" in report.type.upper() or "SUBMERGED" in report.description.upper():
        hazard_alert = (
            f"⚠️ *COMMUNITY CRITICAL HAZARD NOTIFICATION*\n\n"
            f"🏷 *Category:* `{report.type}`\n"
            f"📝 *Description:* {report.description}\n"
            f"📍 *Coordinates:* `{report.lat}, {report.lon}`"
        )
        background_tasks.add_task(send_telegram_notification, hazard_alert)

    return report

@app.post("/api/v1/simulate-flood-scenario", tags=["Simulation"])
def simulate_flood(scenario: str = Query(..., description="Scenario type"), background_tasks: BackgroundTasks = None):
    scenario_clean = scenario.strip().lower()

    if scenario_clean == "cloudburst":
        res = {
            "riskLevel": "HIGH",
            "compositeRiskScore": 74,
            "advisoryMessage": "SIMULATION ACTIVE: Sudden +65mm cloudburst triggered. Runoff surge imminent.",
            "hydrology": {"riverDischargeM3s": 580.4, "crestTimeHours": 6},
            "weather": {"projected72hRainfallMm": 95.0, "soilMoistureIndex": 92.0},
            "forecast7Days": [{"dischargeM3s": v} for v in [210, 580, 490, 310, 180, 110, 75]]
        }
    elif scenario_clean == "dam_release":
        res = {
            "riskLevel": "CATASTROPHIC",
            "compositeRiskScore": 89,
            "advisoryMessage": "SIMULATION ACTIVE: Upstream Dam Release (500m³/s). Valley inundation advisory.",
            "hydrology": {"riverDischargeM3s": 890.2, "crestTimeHours": 3},
            "weather": {"projected72hRainfallMm": 45.0, "soilMoistureIndex": 88.0},
            "forecast7Days": [{"dischargeM3s": v} for v in [320, 890, 740, 480, 220, 140, 90]]
        }
    else:
        res = {
            "riskLevel": "CATASTROPHIC",
            "compositeRiskScore": 98,
            "advisoryMessage": "SIMULATION ACTIVE: CATASTROPHIC BASIN FLOOD. Immediate evacuation required!",
            "hydrology": {"riverDischargeM3s": 1420.0, "crestTimeHours": 1},
            "weather": {"projected72hRainfallMm": 160.0, "soilMoistureIndex": 99.0},
            "forecast7Days": [{"dischargeM3s": v} for v in [450, 1420, 1180, 790, 420, 210, 120]]
        }

    # Unconditional notification trigger across all 3 scenarios
    if background_tasks:
        sim_alert = (
            f"🧪 *AQUASHIELD STRESS TEST DISPATCH*\n\n"
            f"Scenario: `{scenario.upper()}`\n"
            f"Risk Level: `{res['riskLevel']}`\n"
            f"Peak River Discharge: `{res['hydrology']['riverDischargeM3s']} m³/s`\n"
            f"Advisory: {res['advisoryMessage']}"
        )
        background_tasks.add_task(send_telegram_notification, sim_alert)

    return res