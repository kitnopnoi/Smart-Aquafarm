from pathlib import Path
from flask import Flask, request, jsonify
import joblib
import pandas as pd

BASE = Path(__file__).resolve().parent
MODEL = joblib.load(BASE / "waterwise_drought_rf.joblib")
app = Flask(__name__)

@app.post("/predict")
def predict():
    d = request.get_json(force=True)
    row = pd.DataFrame([{
        "province": d.get("province", ""),
        "river_basin": d.get("river_basin", ""),
        "station_id": d.get("station_id", "APP"),
        "month": int(d.get("month", 1)),
        "temperature_c": float(d.get("temperature_c", 30)),
        "rainfall_mm": float(d.get("rainfall_mm", 0)),
        "consecutive_dry_days": int(d.get("consecutive_dry_days", 0)),
        "soil_moisture_index": float(d.get("soil_moisture_index", 0.5))
    }])
    pred = MODEL.predict(row)[0]
    probs = dict(zip(MODEL.classes_, MODEL.predict_proba(row)[0]))
    return jsonify({"risk": str(pred),
                    "probabilities": {str(k): float(v) for k, v in probs.items()}})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
