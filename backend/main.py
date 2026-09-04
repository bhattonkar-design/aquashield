from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import urllib.request
import json
from datetime import datetime

app = FastAPI(title="AquaShield Telemetry API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class HazardReport(BaseModel):
    id: Optional[int] = None
    type: str
    description: str
    timestamp: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None

# In-memory storage for submitted hazard reports
hazard_reports: List[HazardReport] = [
    HazardReport(
        id=1,
        type="WATERLOGGED",
        description="Waist-deep water near bypass culvert. Impassable for light vehicles.",
        timestamp="10 mins ago",
        lat=27.18,
        lon=78.02
    ),
    HazardReport(
        id=2,
        type="ROAD BLOCKED",
        description="Riverbank sector breach. Detours routed via high ground.",
        timestamp="25 mins ago",
        lat=27.18,
        lon=78.02
    )
]

def fetch_open_meteo(lat: float, lon: float):
    """Fetches real-time precipitation and soil saturation from Open-Meteo."""
    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}&daily=precipitation_sum&"
        f"hourly=soil_moisture_0_to_1cm,precipitation&timezone=auto"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AquaShield/1.0"})
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.loads(response.read().decode())
    except Exception:
        return None

@app.get("/api/v1/flood-risk")
def get_flood_risk(
    lat: float = Query(27.18, description="Latitude"),
    lon: float = Query(78.02, description="Longitude")
):
    meteo_data = fetch_open_meteo(lat, lon)
    
    rain_72h = 12.0
    soil_saturation = 35.0
    forecast_discharge = [90, 85, 80, 75, 70, 65, 60]

    if meteo_data and "daily" in meteo_data:
        daily_precip = meteo_data.get("daily", {}).get("precipitation_sum", [])
        rain_72h = round(sum(daily_precip[:3]), 1) if len(daily_precip) >= 3 else 15.0
        
        hourly_soil = meteo_data.get("hourly", {}).get("soil_moisture_0_to_1cm", [])
        if hourly_soil:
            recent_soil = [s for s in hourly_soil[:24] if s is not None]
            if recent_soil:
                soil_saturation = round((sum(recent_soil) / len(recent_soil)) * 100, 1)

        forecast_discharge = [round(max(20.0, float(r) * 12.5 + 40.0), 1) for r in daily_precip[:7]]
        while len(forecast_discharge) < 7:
            forecast_discharge.append(50.0)

    # Dynamic composite risk index calculation (0 - 100)
    composite_index = min(100, int((rain_72h * 0.7) + (soil_saturation * 0.4)))

    if composite_index >= 75:
        risk_level = "CATASTROPHIC"
        advisory = f"EXTREME FLOOD THREAT: Severe precipitation accumulation ({rain_72h} mm) and saturated soil. Evacuation alert active."
        crest_hours = 6
    elif composite_index >= 50:
        risk_level = "HIGH"
        advisory = f"HIGH ADVISORY: Significant rainfall accumulation ({rain_72h} mm) with high runoff risk. Prepare emergency evacuation kits."
        crest_hours = 14
    elif composite_index >= 30:
        risk_level = "MODERATE"
        advisory = f"MODERATE WATCH: Persistent rainfall detected ({rain_72h} mm). Monitor riverbanks and drainage channels."
        crest_hours = 24
    else:
        risk_level = "LOW"
        advisory = f"NORMAL STATE: Minimal precipitation detected ({rain_72h} mm). River basin capacity is stable."
        crest_hours = 48

    peak_discharge = round(max(forecast_discharge), 1)

    return {
        "lat": lat,
        "lon": lon,
        "risk_level": risk_level,
        "composite_index": composite_index,
        "advisory": advisory,
        "metrics": {
            "peak_discharge": peak_discharge,
            "crest_surge_hours": crest_hours,
            "rain_accumulation_72h": rain_72h,
            "soil_moisture": soil_saturation
        },
        "forecast": forecast_discharge
    }

@app.post("/api/v1/simulate-flood-scenario")
def simulate_flood(scenario: str = Query(..., description="Scenario type")):
    if scenario == "cloudburst":
        return {
            "risk_level": "HIGH",
            "composite_index": 72,
            "advisory": "SIMULATION: Sudden +65mm cloudburst triggered. Runoff surge imminent.",
            "metrics": {
                "peak_discharge": 340.5,
                "crest_surge_hours": 8,
                "rain_accumulation_72h": 95.0,
                "soil_moisture": 92.0
            },
            "forecast": [150, 340, 290, 180, 110, 80, 60]
        }
    elif scenario == "dam_release":
        return {
            "risk_level": "CATASTROPHIC",
            "composite_index": 88,
            "advisory": "SIMULATION: Controlled upstream dam release (500m³/s). High elevation evacuation recommended.",
            "metrics": {
                "peak_discharge": 520.0,
                "crest_surge_hours": 4,
                "rain_accumulation_72h": 40.0,
                "soil_moisture": 85.0
            },
            "forecast": [210, 520, 480, 310, 160, 95, 75]
        }
    else:  # Catastrophic
        return {
            "risk_level": "CATASTROPHIC",
            "composite_index": 98,
            "advisory": "SIMULATION: Catastrophic basin inundation. Immediate evacuation orders issued.",
            "metrics": {
                "peak_discharge": 680.0,
                "crest_surge_hours": 2,
                "rain_accumulation_72h": 140.0,
                "soil_moisture": 99.0
            },
            "forecast": [310, 680, 620, 410, 240, 150, 100]
        }

@app.get("/api/v1/hazard-reports", response_model=List[HazardReport])
def get_hazards():
    return hazard_reports

@app.post("/api/v1/hazard-reports", response_model=HazardReport)
def add_hazard(report: HazardReport):
    report.id = len(hazard_reports) + 1
    report.timestamp = "Just now"
    hazard_reports.insert(0, report)
    return report