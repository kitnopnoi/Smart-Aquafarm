from pathlib import Path
from flask import Flask, request, jsonify
import joblib
import pandas as pd

BASE = Path(__file__).resolve().parent
BUNDLE = joblib.load(BASE / "smart_aquafarm_drought_model.joblib")
MODEL = BUNDLE["model"] if isinstance(BUNDLE, dict) else BUNDLE
FEATURES = BUNDLE.get("features", ["month", "temperature_c", "rainfall_mm", "consecutive_dry_days", "soil_moisture_index"]) if isinstance(BUNDLE, dict) else ["month", "temperature_c", "rainfall_mm", "consecutive_dry_days", "soil_moisture_index"]
app = Flask(__name__)

@app.post("/predict")
def predict():
    d = request.get_json(force=True)
    row = pd.DataFrame([{
        "month": int(d.get("month", 1)),
        "temperature_c": float(d.get("temperature_c", 30)),
        "rainfall_mm": float(d.get("rainfall_mm", 0)),
        "consecutive_dry_days": int(d.get("consecutive_dry_days", 0)),
        "soil_moisture_index": float(d.get("soil_moisture_index", 0.3)),
    }], columns=FEATURES)
    pred = str(MODEL.predict(row)[0])
    probs = dict(zip(MODEL.classes_, MODEL.predict_proba(row)[0]))
    labels = {"low": "ต่ำ", "medium": "ปานกลาง", "high": "สูง", "severe": "รุนแรง"}
    return jsonify({
        "risk": labels.get(pred, pred),
        "probabilities": {labels.get(str(k), str(k)): float(v) for k, v in probs.items()}
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
