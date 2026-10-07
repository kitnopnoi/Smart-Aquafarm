"""
WaterWise AI - Backend Server
=============================
Serves the frontend (WaterWise UI) and exposes /api/analyze, which:
  1. Takes the user's GPS coordinates (and optional catchment/runoff settings)
  2. Reverse-geocodes the location (Nominatim / OpenStreetMap)
  3. Pulls a real weather forecast + recent rainfall history (Open-Meteo, free, no API key)
  4. Derives the model's input features (rainfall, temperature, consecutive dry days,
     soil moisture, province/river basin/station) from that real data
  5. Runs the trained RandomForest model (waterwise_drought_rf.joblib) to get a
     drought-risk prediction for today and a short-term trend

Run:
    pip install -r requirements.txt
    python app.py
Then open http://localhost:5000 in a browser (needs internet access for weather/geocoding).
"""
from __future__ import annotations

import math
import sqlite3
from datetime import date, timedelta
from pathlib import Path

import joblib
import pandas as pd
import requests
from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

MODEL_PATH = BASE_DIR / "waterwise_drought_rf.joblib"
MODEL = joblib.load(MODEL_PATH)
DB_PATH = BASE_DIR / "waterwise.db"

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")

REQUEST_TIMEOUT = 8  # seconds, for outbound HTTP calls
DRY_DAY_THRESHOLD_MM = 1.0  # a day counts as "dry" if rainfall is below this
FORECAST_DAYS = 16  # max useful horizon from Open-Meteo's free forecast endpoint

# ---------------------------------------------------------------------------
# Known categories the model was trained on. The archive only ships the
# trained model + a feature list, not the original station/geo lookup table,
# so we approximate province/river-basin/station from real GPS coordinates
# using each province's capital as a reference point. The model tolerates
# unknown categories fine (OneHotEncoder(handle_unknown="ignore")), and the
# numeric weather features (rainfall, dry days, soil moisture, temperature)
# carry ~81% of the model's total feature importance, so this approximation
# only affects a minority of the signal.
# ---------------------------------------------------------------------------
PROVINCES = [
    # name,                 lat,     lon,      river_basin
    ("กรุงเทพมหานคร", 13.7563, 100.5018, "เจ้าพระยา"),
    ("นนทบุรี", 13.8622, 100.5134, "เจ้าพระยา"),
    ("ปทุมธานี", 14.0208, 100.5250, "เจ้าพระยา"),
    ("อยุธยา", 14.3532, 100.5680, "เจ้าพระยา"),
    ("นครสวรรค์", 15.7047, 100.1372, "เจ้าพระยา"),
    ("นครปฐม", 13.8199, 100.0621, "ท่าจีน"),
    ("สุพรรณบุรี", 14.4744, 100.1177, "ท่าจีน"),
    ("กาญจนบุรี", 14.0227, 99.5328, "แม่กลอง"),
    ("ราชบุรี", 13.5369, 99.8172, "แม่กลอง"),
    ("เชียงใหม่", 18.7883, 98.9853, "ปิง"),
    ("เชียงราย", 19.9105, 99.8406, "กก"),
    ("ขอนแก่น", 16.4419, 102.8360, "ชี"),
    ("นครราชสีมา", 14.9799, 102.0977, "มูล"),
    ("อุบลราชธานี", 15.2448, 104.8473, "มูล"),
    ("สงขลา", 7.1897, 100.5951, "ทะเลสาบสงขลา"),
]
STATION_IDS = [f"WQ-{i:04d}" for i in range(1, 46)]
# Deterministic 1:1-ish assignment so results are stable across requests/restarts.
PROVINCE_TO_STATION = {p[0]: STATION_IDS[i % len(STATION_IDS)] for i, p in enumerate(PROVINCES)}

WEATHERCODE_ICON = {
    0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️",
    45: "🌫️", 48: "🌫️",
    51: "🌦️", 53: "🌦️", 55: "🌦️",
    56: "🌧️", 57: "🌧️",
    61: "🌧️", 63: "🌧️", 65: "🌧️",
    66: "🌧️", 67: "🌧️",
    71: "🌨️", 73: "🌨️", 75: "🌨️", 77: "🌨️",
    80: "🌦️", 81: "🌧️", 82: "⛈️",
    85: "🌨️", 86: "🌨️",
    95: "⛈️", 96: "⛈️", 99: "⛈️",
}
THAI_DOW = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."]
THAI_MONTH_ABBR = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
]


def thai_date_label(d: date) -> str:
    return f"{d.day} {THAI_MONTH_ABBR[d.month - 1]}"


# ---------------------------------------------------------------------------
# Persistent logging (SQLite). Every time the app analyzes a location it
# records that day's numbers, so "history" is a real, queryable time series
# instead of a single snapshot in the browser's localStorage.
# ---------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS logs (
                log_date TEXT PRIMARY KEY,
                lat REAL, lon REAL, province TEXT,
                water_liters REAL, usage_liters REAL, capacity_liters REAL,
                catchment_m2 REAL, rainfall_mm REAL, harvested_liters REAL,
                temperature_c REAL,
                drought_risk TEXT, drought_top_prob REAL,
                quality_score INTEGER, quality_level TEXT,
                flood_risk TEXT,
                updated_at TEXT
            )
        """)


def upsert_log(log_date: str, **fields):
    if not fields:
        return
    fields = {k: v for k, v in fields.items() if v is not None}
    fields["updated_at"] = date.today().isoformat()
    cols = ["log_date"] + list(fields.keys())
    placeholders = ",".join(["?"] * len(cols))
    updates = ",".join(f"{c}=excluded.{c}" for c in fields.keys())
    values = [log_date] + list(fields.values())
    with get_db() as conn:
        conn.execute(
            f"INSERT INTO logs ({','.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT(log_date) DO UPDATE SET {updates}",
            values,
        )


def fetch_history(limit: int = 30) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM logs ORDER BY log_date DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


init_db()


# ---------------------------------------------------------------------------
# Water quality & flood risk: the trained model only covers drought risk, so
# these two are transparent, rule-based estimates from real weather inputs
# (documented here, not a trained ML model) — clearly labeled as such in the
# UI so they are never confused with the RandomForest drought prediction.
# ---------------------------------------------------------------------------
def estimate_water_quality(rain_mm: float, consecutive_dry_days: int, temperature_c: float) -> dict:
    score = 100.0
    reasons = []
    if rain_mm > 40:
        score -= min(40, (rain_mm - 40) * 0.8)
        reasons.append({"type": "alert", "text": f"ฝนตกหนัก {rain_mm} มม. น้ำไหลบ่าอาจพัดพาตะกอน/สิ่งสกปรกลงแหล่งน้ำ"})
    elif rain_mm > 20:
        score -= (rain_mm - 20) * 0.5
        reasons.append({"type": "warn", "text": f"ฝนปานกลาง {rain_mm} มม. อาจมีตะกอนปนลงแหล่งน้ำเล็กน้อย"})
    if consecutive_dry_days > 10:
        score -= min(40, (consecutive_dry_days - 10) * 2.5)
        reasons.append({"type": "warn", "text": f"ไม่มีฝนต่อเนื่อง {consecutive_dry_days} วัน น้ำนิ่งเสี่ยงสาหร่าย/แบคทีเรียสะสมมากขึ้น"})
    if temperature_c > 32:
        score -= min(20, (temperature_c - 32) * 4)
        reasons.append({"type": "info", "text": f"อากาศร้อน {temperature_c}°C เร่งการเติบโตของสาหร่ายในแหล่งน้ำเปิด"})
    score = max(0, min(100, round(score)))
    level = "ดี" if score >= 70 else ("ปานกลาง" if score >= 40 else "ต้องกรองก่อนใช้")
    if not reasons:
        reasons.append({"type": "info", "text": "ไม่พบปัจจัยเสี่ยงเด่นชัดในการประเมินเบื้องต้นนี้ สภาพอากาศเอื้อต่อคุณภาพน้ำที่ดี"})
    return {"score": score, "level": level, "reasons": reasons}


def estimate_flood_risk(rain_today: float, next3_cumulative: float) -> str:
    if rain_today >= 90 or next3_cumulative >= 200:
        return "วิกฤต"
    if rain_today >= 35 or next3_cumulative >= 150:
        return "เสี่ยงสูง"
    if rain_today >= 10 or next3_cumulative >= 60:
        return "เฝ้าระวัง"
    return "ปกติ"


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_location_info(lat: float, lon: float) -> dict:
    best = min(PROVINCES, key=lambda p: haversine_km(lat, lon, p[1], p[2]))
    name, plat, plon, basin = best
    return {
        "province": name,
        "river_basin": basin,
        "station_id": PROVINCE_TO_STATION[name],
        "distance_km": round(haversine_km(lat, lon, plat, plon), 1),
    }


def reverse_geocode(lat: float, lon: float) -> str | None:
    """Best-effort human-readable place name via OpenStreetMap Nominatim."""
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "jsonv2", "accept-language": "th"},
            headers={"User-Agent": "WaterWiseAI-Prototype/1.0"},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        addr = data.get("address", {})
        parts = [
            addr.get("suburb") or addr.get("village") or addr.get("town") or addr.get("city_district"),
            addr.get("city") or addr.get("county") or addr.get("state"),
        ]
        parts = [p for p in parts if p]
        return ", ".join(parts) if parts else data.get("display_name")
    except Exception:
        return None


def fetch_forecast(lat: float, lon: float) -> dict:
    """Real 16-day forecast (rainfall, temperature, weather code, soil moisture) from Open-Meteo."""
    resp = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "daily": "precipitation_sum,temperature_2m_mean,weathercode",
            "hourly": "soil_moisture_0_to_7cm",
            "forecast_days": FORECAST_DAYS,
            "timezone": "auto",
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_recent_dry_days(lat: float, lon: float) -> int:
    """
    Counts consecutive dry days up to ~2 days ago using Open-Meteo's historical
    archive (final reanalysis data lags a couple of days behind real time).
    Capped at 30 days back.
    """
    end = date.today() - timedelta(days=2)
    start = end - timedelta(days=29)
    try:
        resp = requests.get(
            "https://archive-api.open-meteo.com/v1/archive",
            params={
                "latitude": lat,
                "longitude": lon,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "daily": "precipitation_sum",
                "timezone": "auto",
            },
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        rains = resp.json().get("daily", {}).get("precipitation_sum", [])
        streak = 0
        for mm in reversed(rains):
            if mm is None or mm < DRY_DAY_THRESHOLD_MM:
                streak += 1
            else:
                break
        return streak
    except Exception:
        return 0


def predict_risk(province: str, river_basin: str, station_id: str, month: int,
                  temperature_c: float, rainfall_mm: float,
                  consecutive_dry_days: int, soil_moisture_index: float) -> dict:
    row = pd.DataFrame([{
        "province": province,
        "river_basin": river_basin,
        "station_id": station_id,
        "month": int(month),
        "temperature_c": float(temperature_c),
        "rainfall_mm": float(rainfall_mm),
        "consecutive_dry_days": int(consecutive_dry_days),
        "soil_moisture_index": float(soil_moisture_index),
    }])
    pred = MODEL.predict(row)[0]
    probs = dict(zip(MODEL.classes_, MODEL.predict_proba(row)[0]))
    return {
        "risk": str(pred),
        "probabilities": {str(k): round(float(v), 4) for k, v in probs.items()},
    }


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/api/analyze")
def analyze():
    body = request.get_json(force=True, silent=True) or {}
    try:
        lat = float(body["lat"])
        lon = float(body["lon"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "ต้องระบุพิกัด lat และ lon"}), 400

    catchment_m2 = float(body.get("catchment_m2") or 100)
    runoff_coefficient = float(body.get("runoff_coefficient") or 0.85)
    runoff_coefficient = min(max(runoff_coefficient, 0.0), 1.0)

    loc = nearest_location_info(lat, lon)
    place_name = reverse_geocode(lat, lon)

    try:
        weather = fetch_forecast(lat, lon)
    except Exception as exc:
        return jsonify({"error": f"ดึงข้อมูลพยากรณ์อากาศไม่สำเร็จ: {exc}"}), 502

    base_dry_days = fetch_recent_dry_days(lat, lon)

    daily = weather.get("daily", {})
    dates = daily.get("time", [])
    precs = daily.get("precipitation_sum", [])
    temps = daily.get("temperature_2m_mean", [])
    codes = daily.get("weathercode", [])

    hourly = weather.get("hourly", {})
    soil_series = [v for v in hourly.get("soil_moisture_0_to_7cm", []) if v is not None]
    soil_today = sum(soil_series[:24]) / len(soil_series[:24]) if soil_series else 0.30

    # Roll a simple day-by-day simulation forward: consecutive dry days keep
    # climbing on forecast days with < 1mm rain and reset after real rain;
    # soil moisture nudges up with rain and decays slowly when dry. This is a
    # transparent approximation to turn a single soil-moisture reading and a
    # historical dry streak into a week-by-week trend, not a second model.
    running_dry_days = base_dry_days
    running_soil = soil_today
    forecast_days = []
    rain_list = [float(p) if p is not None else 0.0 for p in precs]
    for i, iso_date in enumerate(dates):
        d = date.fromisoformat(iso_date)
        mm = float(precs[i]) if i < len(precs) and precs[i] is not None else 0.0
        temp_c = float(temps[i]) if i < len(temps) and temps[i] is not None else 30.0
        code = int(codes[i]) if i < len(codes) and codes[i] is not None else 0

        if mm < DRY_DAY_THRESHOLD_MM:
            running_dry_days += 1
            running_soil = max(0.05, running_soil - 0.01)
        else:
            running_dry_days = 0
            running_soil = min(0.5, running_soil + mm * 0.004)

        result = predict_risk(
            loc["province"], loc["river_basin"], loc["station_id"], d.month,
            temp_c, mm, running_dry_days, running_soil,
        )
        quality = estimate_water_quality(mm, running_dry_days, temp_c)
        next3_cumulative = sum(rain_list[i:i + 3])
        flood_risk = estimate_flood_risk(mm, next3_cumulative)

        liters = round(mm * catchment_m2 * runoff_coefficient, 1)
        forecast_days.append({
            "date": iso_date,
            "dow": THAI_DOW[d.weekday()] if i > 0 else "วันนี้",
            "date_label": thai_date_label(d),
            "mm": round(mm, 1),
            "temp_c": round(temp_c, 1),
            "icon": WEATHERCODE_ICON.get(code, "🌥️"),
            "liters": liters,
            "consecutive_dry_days": running_dry_days,
            "soil_moisture_index": round(running_soil, 3),
            "risk": result["risk"],
            "probabilities": result["probabilities"],
            "quality": quality,
            "flood_risk": flood_risk,
        })

    risk_today = forecast_days[0] if forecast_days else None

    if risk_today:
        upsert_log(
            forecast_days[0]["date"],
            lat=lat, lon=lon, province=loc["province"],
            water_liters=body.get("water_liters"),
            usage_liters=body.get("usage_liters"),
            capacity_liters=body.get("capacity_liters"),
            catchment_m2=catchment_m2,
            rainfall_mm=risk_today["mm"],
            harvested_liters=risk_today["liters"],
            temperature_c=risk_today["temp_c"],
            drought_risk=risk_today["risk"],
            drought_top_prob=max(risk_today["probabilities"].values()) if risk_today["probabilities"] else None,
            quality_score=risk_today["quality"]["score"],
            quality_level=risk_today["quality"]["level"],
            flood_risk=risk_today["flood_risk"],
        )

    return jsonify({
        "location": {
            "lat": lat,
            "lon": lon,
            "display_name": place_name,
            "matched_province": loc["province"],
            "river_basin": loc["river_basin"],
            "station_id": loc["station_id"],
            "matched_distance_km": loc["distance_km"],
        },
        "settings": {
            "catchment_m2": catchment_m2,
            "runoff_coefficient": runoff_coefficient,
        },
        "risk_today": risk_today,
        "forecast": forecast_days,
        "model_note": (
            "โมเดลนี้เป็นต้นแบบ (RandomForest) ความแม่นยำสูงมากบนชุดข้อมูลทดสอบส่วนหนึ่ง"
            "เกิดจากลักษณะของ label ในชุดข้อมูลฝึก จึงควรใช้เป็นแนวทางเบื้องต้นเท่านั้น "
            "และควรตรวจสอบกับข้อมูลภาคสนามจริงก่อนใช้ตัดสินใจ"
        ),
        "quality_note": "คุณภาพน้ำประเมินจากกฎเกณฑ์ทางอุทกวิทยาทั่วไป (ฝน/วันแล้งต่อเนื่อง/อุณหภูมิ) ไม่ใช่ค่าที่วัดจากเซนเซอร์จริงหรือโมเดล AI",
        "flood_note": "ความเสี่ยงน้ำท่วมประเมินจากเกณฑ์ปริมาณฝนสะสม (rule-based) ไม่ใช่โมเดล AI",
    })


@app.get("/api/history")
def history():
    limit = request.args.get("limit", default=30, type=int)
    return jsonify({"logs": fetch_history(limit)})


@app.post("/api/log")
def manual_log():
    body = request.get_json(force=True, silent=True) or {}
    log_date = body.get("date") or date.today().isoformat()
    upsert_log(
        log_date,
        water_liters=body.get("water_liters"),
        usage_liters=body.get("usage_liters"),
        capacity_liters=body.get("capacity_liters"),
    )
    return jsonify({"ok": True, "date": log_date})


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(app.static_folder, path)


if __name__ == "__main__":
    # Render (and most hosts) inject the port to bind via the PORT env var;
    # 5000 stays the default for running locally. debug stays off unless
    # FLASK_DEBUG=1 is set, since Flask's debugger must never be exposed
    # on a public deployment.
    import os
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
