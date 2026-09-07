
import joblib
import pandas as pd

MODEL_PATH = "waterwise_drought_rf.joblib"
model = joblib.load(MODEL_PATH)

sample = pd.DataFrame([{
    "province": "เชียงใหม่",
    "river_basin": "ปิง",
    "station_id": "DEMO",
    "month": 4,
    "temperature_c": 33.0,
    "rainfall_mm": 1.0,
    "consecutive_dry_days": 18,
    "soil_moisture_index": 0.35
}])

prediction = model.predict(sample)[0]
probabilities = dict(zip(model.classes_, model.predict_proba(sample)[0]))

print("Predicted risk:", prediction)
print("Probabilities:", probabilities)
