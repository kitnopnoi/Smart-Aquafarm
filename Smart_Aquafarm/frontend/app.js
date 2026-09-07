const app = document.getElementById("app");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modalBody");

const RISK_COLOR = { "ต่ำ": "#20ad76", "ปานกลาง": "#f5ad34", "สูง": "#f27d36", "รุนแรง": "#ea5b3d" };
const RISK_ORDER = ["ต่ำ", "ปานกลาง", "สูง", "รุนแรง"];
const QUALITY_COLOR = { "ดี": "#20ad76", "ปานกลาง": "#f5ad34", "ต้องกรองก่อนใช้": "#ea5b3d" };
const FLOOD_COLOR = { "ปกติ": "#20ad76", "เฝ้าระวัง": "#f5ad34", "เสี่ยงสูง": "#f27d36", "วิกฤต": "#ea5b3d" };
const DEFAULT_COORDS = { lat: 13.7563, lon: 100.5018, label: "กรุงเทพมหานคร (ค่าเริ่มต้น)" };

// Fallback data used only if the backend/network is unreachable (e.g. opened as a
// static file without running `python app.py`), so the UI still demos something.
const DEMO_FORECAST = [
  { date: "", dow: "วันนี้", date_label: "25 มิ.ย.", icon: "🌧️", mm: 42, liters: 2775, risk: "ปานกลาง", probabilities: null, consecutive_dry_days: null, soil_moisture_index: null, temp_c: 31, quality: null, flood_risk: null },
  { date: "", dow: "พฤ.", date_label: "26 มิ.ย.", icon: "☁️", mm: 18, liters: 1044, risk: "ปานกลาง", probabilities: null, consecutive_dry_days: null, soil_moisture_index: null, temp_c: 31, quality: null, flood_risk: null },
  { date: "", dow: "ศ.", date_label: "27 มิ.ย.", icon: "☀️", mm: 5, liters: 245, risk: "สูง", probabilities: null, consecutive_dry_days: null, soil_moisture_index: null, temp_c: 33, quality: null, flood_risk: null },
  { date: "", dow: "ส.", date_label: "28 มิ.ย.", icon: "🌦️", mm: 55, liters: 3795, risk: "ต่ำ", probabilities: null, consecutive_dry_days: null, soil_moisture_index: null, temp_c: 30, quality: null, flood_risk: null },
  { date: "", dow: "อา.", date_label: "29 มิ.ย.", icon: "🌧️", mm: 30, liters: 2010, risk: "ต่ำ", probabilities: null, consecutive_dry_days: null, soil_moisture_index: null, temp_c: 30, quality: null, flood_risk: null },
  { date: "", dow: "จ.", date_label: "30 มิ.ย.", icon: "🌦️", mm: 12, liters: 672, risk: "ปานกลาง", probabilities: null, consecutive_dry_days: null, soil_moisture_index: null, temp_c: 32, quality: null, flood_risk: null },
  { date: "", dow: "อ.", date_label: "1 ก.ค.", icon: "☀️", mm: 0, liters: 0, risk: "สูง", probabilities: null, consecutive_dry_days: null, soil_moisture_index: null, temp_c: 34, quality: null, flood_risk: null },
];

let currentPage = "home";
let profile = JSON.parse(localStorage.getItem("waterwiseProfile") || "null");

// Live-data state
let analysis = null;        // response from /api/analyze, or a demo-shaped object
let locationState = "pending"; // pending | ok | denied | error | offline_demo
let locationLabel = "";
let waterRange = 7;         // 7 or 16 (real horizon) for the "water" page
let riskRange = 7;          // 7, 14 or 30 for the "risk" trend page
let historyLogs; // undefined = not yet loaded, null = fetch failed, array = loaded

function showModal(title, html) {
  modalBody.innerHTML = `<h2>${title}</h2>${html}`;
  modal.classList.remove("hidden");
}
document.getElementById("modalClose").onclick = () => modal.classList.add("hidden");
modal.onclick = (e) => { if (e.target === modal) modal.classList.add("hidden"); };

function nav(page) {
  currentPage = page;
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  render();
}
document.querySelectorAll(".nav-item").forEach(b => b.onclick = () => nav(b.dataset.page));
document.getElementById("profileBtn").onclick = () => nav("profile");

function render() {
  if (currentPage === "home") renderHome();
  else if (currentPage === "water") renderWater();
  else if (currentPage === "risk") renderRisk();
  else if (currentPage === "history") renderHistory();
  else renderProfile();
}

// ---------------------------------------------------------------------------
// Live data loading: real GPS -> real backend (weather + AI model)
// ---------------------------------------------------------------------------
async function callBackend(lat, lon) {
  const p = profile || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat, lon,
        catchment_m2: Number(p.catchment) || 100,
        runoff_coefficient: 0.85,
        water_liters: Number(p.water) || null,
        usage_liters: Number(p.usage) || null,
        capacity_liters: Number(p.capacity) || null,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error("backend error " + res.status);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchHistory(limit = 30) {
  try {
    const res = await fetch(`/api/history?limit=${limit}`);
    if (!res.ok) throw new Error("history error " + res.status);
    const data = await res.json();
    return data.logs || [];
  } catch (err) {
    return null; // caller decides how to show "no history yet / offline"
  }
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) { reject(new Error("no geolocation")); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

async function loadAnalysis() {
  locationState = "pending";
  render();
  let coords;
  try {
    coords = await getPosition();
    locationState = "ok";
  } catch (err) {
    coords = { lat: DEFAULT_COORDS.lat, lon: DEFAULT_COORDS.lon };
    locationState = (err && err.code === 1) ? "denied" : "error";
  }
  try {
    analysis = await callBackend(coords.lat, coords.lon);
    locationLabel = analysis.location.display_name || analysis.location.matched_province;
  } catch (err) {
    // Backend not running / no network reachable from the server: fall back to demo data.
    locationState = "offline_demo";
    analysis = {
      location: { display_name: null, matched_province: "ตัวอย่าง" },
      forecast: DEMO_FORECAST,
      risk_today: DEMO_FORECAST[0],
      model_note: "โหมดสาธิต: ไม่พบเซิร์ฟเวอร์ backend หรือไม่มีอินเทอร์เน็ต กำลังแสดงข้อมูลตัวอย่างแทนข้อมูลจริง",
    };
    locationLabel = "ข้อมูลตัวอย่าง (ออฟไลน์)";
  }
  render();
}

function locationBanner() {
  if (locationState === "ok" || locationState === "pending") return "";
  if (locationState === "offline_demo") {
    return `<div class="banner warn">⚠️ ${analysis.model_note}
      <button class="retry" id="retryLocation">ลองใหม่</button></div>`;
  }
  const msg = locationState === "denied"
    ? "ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง กำลังใช้ตำแหน่งเริ่มต้น (กรุงเทพฯ) แทน"
    : "ไม่สามารถอ่านตำแหน่งได้ กำลังใช้ตำแหน่งเริ่มต้น (กรุงเทพฯ) แทน";
  return `<div class="banner info">📍 ${msg}
    <button class="retry" id="retryLocation">ใช้ตำแหน่งฉัน</button></div>`;
}
function bindRetry() {
  const btn = document.getElementById("retryLocation");
  if (btn) btn.onclick = loadAnalysis;
}

function riskBadge(risk) {
  if (!risk) return "";
  const color = RISK_COLOR[risk] || "#8aa0b3";
  return `<span class="risk-badge" style="background:${color}22;color:${color}">${risk}</span>`;
}
function coloredBadge(label, colorMap) {
  if (!label) return "";
  const color = colorMap[label] || "#8aa0b3";
  return `<span class="risk-badge" style="background:${color}22;color:${color}">${label}</span>`;
}

function loadingView(label) {
  app.innerHTML = `<div class="loading-wrap"><div class="spinner"></div>${label}</div>`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
function renderHome() {
  if (!analysis) { loadingView("กำลังขอตำแหน่งและดึงข้อมูลพยากรณ์อากาศจริง..."); return; }
  const p = profile || { name: "ผู้ใช้", location: "ยังไม่ได้ตั้งค่าตำแหน่ง", water: 5664, capacity: 8000, usage: 240 };
  const days = Math.max(0, Math.floor(Number(p.water) / Math.max(1, Number(p.usage || 240))));
  const forecast = analysis.forecast || DEMO_FORECAST;
  const today = analysis.risk_today || forecast[0];
  const locText = locationState === "ok" ? (locationLabel || p.location) : (p.location || locationLabel);

  const runoff = (analysis.settings && analysis.settings.runoff_coefficient) || 0.85;
  const usePct = Math.round(runoff * 100);
  const remainder = 100 - usePct;
  const evapPct = Math.round(remainder * 0.53);
  const seepPct = Math.round(remainder * 0.33);
  const otherPct = Math.max(0, remainder - evapPct - seepPct);
  const todayLiters = forecast[0] ? forecast[0].liters : 0;
  const todayMm = forecast[0] ? forecast[0].mm : 0;

  app.innerHTML = `
    ${locationBanner()}
    <section class="hero">
      <div class="location">📍 ${locText || "ตำแหน่งของคุณ"} • อัปเดตล่าสุด</div>
      <div class="hero-title">น้ำของคุณวันนี้</div>
      <div class="water-main">
        <div class="water-icon">💧</div>
        <div>
          <div><span class="big-number">${Number(p.water).toLocaleString()}</span> <span class="unit">ลิตร</span></div>
          <div class="meta">${Math.round((Number(p.water) / Math.max(1, Number(p.capacity))) * 100)}% ของความจุ ${Number(p.capacity).toLocaleString()} ล.</div>
        </div>
      </div>
      <div class="pills">
        <span class="pill">◷ ใช้ได้อีก ${days} วัน</span>
        <span class="pill good"><i class="dot" style="background:${today && today.risk ? RISK_COLOR[today.risk] : "#8be9d3"}"></i>ความเสี่ยงภัยแล้ง: ${today && today.risk ? today.risk : "กำลังประเมิน"}</span>
      </div>
    </section>

    <section class="card">
      <div class="section-head"><h2>พยากรณ์น้ำฝน 7 วันข้างหน้า</h2><button class="link-btn" id="allForecast">ดูทั้งหมด</button></div>
      <div class="forecast-scroll">
        ${forecast.slice(0, 7).map((d, i) => `
          <div class="forecast-day ${i === 0 ? "selected" : ""}">
            <div class="dow">${d.dow}</div>
            <div class="weather">${d.icon}</div>
            <div class="mm">${d.mm} มม.</div>
          </div>`).join("")}
      </div>
    </section>

    <section class="card">
      <div class="section-head"><h2>น้ำที่ใช้ได้จากฝนวันนี้</h2></div>
      <div class="water-total">${Number(todayLiters).toLocaleString()} <span class="unit">ลิตร</span></div>
      <div class="muted">จากฝนคาดการณ์ ${todayMm} มม. (พื้นที่รับน้ำฝน ${Number(p.catchment || 100).toLocaleString()} ตร.ม.)</div>
      <div class="progress-wrap">
        <div class="progress-bar">
          <span class="seg-use" style="width:${usePct}%"></span>
          <span class="seg-evap" style="width:${evapPct}%"></span>
          <span class="seg-seep" style="width:${seepPct}%"></span>
          <span class="seg-other" style="width:${otherPct}%"></span>
        </div>
        <div class="legend">
          <div class="legend-row"><span class="legend-label"><i class="dot" style="background:#17b59e"></i>น้ำที่ใช้ได้จริง</span><b>${usePct}%</b></div>
          <div class="legend-row"><span class="legend-label"><i class="dot" style="background:#f5b940"></i>สูญเสียจากการระเหย</span><b>${evapPct}%</b></div>
          <div class="legend-row"><span class="legend-label"><i class="dot" style="background:#f27d36"></i>สูญเสียจากการซึมลงดิน</span><b>${seepPct}%</b></div>
          <div class="legend-row"><span class="legend-label"><i class="dot" style="background:#aab6bf"></i>กรองตะกอน/สิ่งสกปรก</span><b>${otherPct}%</b></div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="section-head"><h2>สถานการณ์น้ำวันนี้</h2></div>
      <div class="warning-box">${todayWarningText(today)}</div>
    </section>
  `;
  document.getElementById("allForecast").onclick = () => nav("water");
  bindRetry();
}

function todayWarningText(today) {
  if (!today || !today.risk) return "☀️ กำลังประเมินสถานการณ์น้ำ...";
  const icons = { "ต่ำ": "🟢", "ปานกลาง": "☀️", "สูง": "🟠", "รุนแรง": "🔴" };
  return `${icons[today.risk] || "☀️"} แนวโน้มภัยแล้งระดับ${today.risk} — ควรติดตามปริมาณฝนและน้ำคงเหลือ`;
}

function renderWater() {
  if (!analysis) { loadingView("กำลังโหลดพยากรณ์อากาศ..."); return; }
  const forecast = analysis.forecast || DEMO_FORECAST;
  const maxDays = forecast.length; // 16 for real data, 7 for demo
  const list = forecast.slice(0, Math.min(waterRange, maxDays));

  app.innerHTML = `
    ${locationBanner()}
    <section class="hero">
      <div class="location">คาดการณ์จากสภาพอากาศจริง (Open-Meteo) • ${locationLabel || ""}</div>
      <div class="hero-title">ปริมาณน้ำที่จะได้รับ</div>
    </section>
    <section class="card">
      <div class="segmented">
        <button class="${waterRange === 7 ? "active" : ""}" data-range="7">ระยะสั้น · 7 วัน</button>
        <button class="${waterRange === 16 ? "active" : ""}" data-range="16">ระยะยาว · ${Math.min(16, maxDays)} วัน</button>
      </div>
      <div class="water-list">
        ${list.map(d => `
          <div class="water-row">
            <div class="left"><div>${d.icon}</div><div><div class="date">${d.dow}</div><div class="rain">${d.date_label} · ${d.mm} มม.</div></div></div>
            <div><div class="litres">${Number(d.liters).toLocaleString()}</div><div class="muted">ลิตรที่ได้</div></div>
          </div>`).join("")}
      </div>
      <button class="secondary" id="waterCalcDetail">ดูวิธีคำนวณปริมาณน้ำ →</button>
    </section>
  `;
  document.querySelectorAll(".segmented button").forEach(b => b.onclick = () => {
    waterRange = Number(b.dataset.range);
    renderWater();
  });
  document.getElementById("waterCalcDetail").onclick = () => showModal("สูตรคำนวณ", `<p>ปริมาณฝนจริงจาก Open-Meteo (มม.) คูณด้วยพื้นที่รับน้ำฝนที่คุณตั้งค่าไว้ (ตร.ม.) และค่าสัมประสิทธิ์การไหลบ่า (Runoff Coefficient ≈ 0.85 สำหรับหลังคา/พื้นผิวแข็งทั่วไป) โดย 1 มม. ของฝนบนพื้นที่ 1 ตร.ม. ≈ 1 ลิตร</p><p>พยากรณ์ระยะยาวเกิน ${Math.min(16, forecast.length)} วันยังไม่รองรับข้อมูลพยากรณ์จริงในเวอร์ชันนี้ เนื่องจากแหล่งข้อมูลพยากรณ์ฟรีให้ข้อมูลล่วงหน้าได้ไม่เกิน 16 วัน</p>`);
  bindRetry();
}

function riskDonutGradient(probabilities) {
  if (!probabilities) return "conic-gradient(#c9d4db 0 100%)";
  let acc = 0;
  const stops = RISK_ORDER.filter(k => probabilities[k] !== undefined).map(k => {
    const start = acc;
    acc += (probabilities[k] || 0) * 100;
    return `${RISK_COLOR[k]} ${start}% ${acc}%`;
  });
  return `conic-gradient(${stops.join(",")})`;
}

function renderRisk() {
  if (!analysis) { loadingView("กำลังประเมินความเสี่ยงจากโมเดล AI..."); return; }
  const forecast = analysis.forecast || DEMO_FORECAST;
  const today = analysis.risk_today || forecast[0];
  const probs = today && today.probabilities;
  const topRisk = probs ? RISK_ORDER.reduce((a, b) => (probs[b] || 0) > (probs[a] || 0) ? b : a) : (today ? today.risk : "ไม่ทราบ");

  const rangeMax = analysis.forecast ? analysis.forecast.length : forecast.length;
  const trendDays = riskRange === 30
    ? []
    : forecast.slice(0, Math.min(riskRange, rangeMax));

  app.innerHTML = `
    ${locationBanner()}
    <section class="hero">
      <div class="location">จากโมเดล AI (RandomForest) + สภาพอากาศจริง</div>
      <div class="hero-title">ความเสี่ยงภัยแล้ง</div>
    </section>

    <section class="card">
      <div class="section-head"><h2>ผลพยากรณ์วันนี้</h2></div>
      <div class="risk-summary">
        <div class="donut" style="background:${riskDonutGradient(probs)}"><div class="donut-inner"><b>${topRisk}</b><span>ระดับความเสี่ยง</span></div></div>
        <div class="risk-labels">
          ${RISK_ORDER.map(k => `<div class="risk-line"><span class="risk-name"><i class="dot" style="background:${RISK_COLOR[k]}"></i>${k}</span><b>${probs ? Math.round((probs[k] || 0) * 100) : "-"}%</b></div>`).join("")}
        </div>
      </div>
      <div class="reason-list">
        ${riskReasons(today)}
      </div>
      <button class="detail-link" id="qualityDays">ดูรายละเอียดความน่าจะเป็นรายวัน ⌄</button>
      ${locationState !== "offline_demo" && analysis.model_note ? `<div class="model-note">${analysis.model_note}</div>` : ""}
    </section>

    <section class="card">
      <div class="section-head"><h2>คุณภาพน้ำ (ประเมินเบื้องต้น)</h2></div>
      ${qualitySection(today, analysis.quality_note)}
    </section>

    <section class="card">
      <div class="section-head"><h2>ความเสี่ยงน้ำท่วม (ประเมินเบื้องต้น)</h2></div>
      ${floodSection(today, forecast, analysis.flood_note)}
    </section>

    <section class="card">
      <div class="section-head"><h2>แนวโน้มความเสี่ยงสถานการณ์น้ำ</h2></div>
      <div class="segmented">
        <button class="${riskRange === 7 ? "active" : ""}" data-p="7">7 วัน</button>
        <button class="${riskRange === 14 ? "active" : ""}" data-p="14">14 วัน</button>
        <button class="${riskRange === 30 ? "active" : ""}" data-p="30">1 เดือน</button>
      </div>
      ${riskRange === 30
        ? `<div class="warning-box">ℹ️ ข้อมูลพยากรณ์อากาศฟรีที่ใช้ในระบบนี้ให้ความแม่นยำได้ไม่เกิน ~16 วันล่วงหน้า จึงยังไม่แสดงแนวโน้มแบบรายวันสำหรับ 1 เดือนเพื่อไม่ให้ดูน่าเชื่อถือเกินจริง</div>`
        : `<div class="warning-box">${todayWarningText(today)}</div>
           <div class="reason-list">
             ${trendDays.map(d => `<div class="reason"><div class="icon">${d.icon}</div><div><b>${d.dow} (${d.date_label})</b><p>ฝน ${d.mm} มม. • อุณหภูมิเฉลี่ย ${d.temp_c ?? "-"}°C ${riskBadge(d.risk)}</p></div></div>`).join("")}
           </div>`
      }
      <button class="detail-link" id="riskDays">ดูรายละเอียดรายวัน ⌄</button>
    </section>
  `;
  document.querySelectorAll('.segmented button[data-p]').forEach(b => b.onclick = () => {
    riskRange = Number(b.dataset.p);
    renderRisk();
  });
  document.getElementById("qualityDays").onclick = () => {
    showModal("ความน่าจะเป็นแต่ละระดับ รายวัน", forecast.slice(0, Math.min(7, forecast.length)).map(d => `
      <div class="water-row"><div><b>${d.dow}</b><div class="muted">${d.date_label}</div></div>${riskBadge(d.risk)}</div>
      ${d.probabilities ? `<div class="prob-bars">${RISK_ORDER.map(k => `
        <div class="prob-row"><span>${k}</span><div class="prob-track"><div class="prob-fill" style="width:${Math.round((d.probabilities[k]||0)*100)}%;background:${RISK_COLOR[k]}"></div></div><span>${Math.round((d.probabilities[k]||0)*100)}%</span></div>`).join("")}</div>` : ""}
    `).join("<hr style='border:none;border-top:1px solid var(--line);margin:10px 0'>"));
  };
  document.getElementById("riskDays").onclick = () => {
    showModal("สถานการณ์น้ำรายวัน", forecast.slice(0, Math.min(7, forecast.length)).map(d => `<div class="water-row"><div><b>${d.dow}</b><div class="muted">ฝน ${d.mm} มม.</div></div><b>${d.mm >= 40 ? "เฝ้าระวังน้ำท่วม" : riskBadge(d.risk)}</b></div>`).join(""));
  };
  bindRetry();
}

function riskReasons(today) {
  if (!today || today.consecutive_dry_days === null || today.consecutive_dry_days === undefined) {
    return `<div class="reason"><div class="icon">ℹ️</div><div><b>ข้อมูลตัวอย่าง</b><p>ยังไม่ได้เชื่อมข้อมูลจริง โปรดเปิดผ่านเซิร์ฟเวอร์ backend เพื่อดูผลการวิเคราะห์จริง</p></div></div>`;
  }
  const dry = today.consecutive_dry_days;
  const soil = today.soil_moisture_index;
  return `
    <div class="reason"><div class="icon warn">☀️</div><div><b>วันฝนไม่ตกติดต่อกัน ${dry} วัน</b><p>ปัจจัยนี้มีน้ำหนักสูงสุดในโมเดล (~44%) ยิ่งมากยิ่งเสี่ยงภัยแล้งสูงขึ้น</p></div></div>
    <div class="reason"><div class="icon alert">🌱</div><div><b>ดัชนีความชื้นในดิน ${soil}</b><p>ค่าน้อยหมายถึงดินแห้ง เป็นปัจจัยรองที่มีน้ำหนักสูง (~29%)</p></div></div>
    <div class="reason"><div class="icon info">🌧️</div><div><b>ฝนคาดการณ์วันนี้ ${today.mm} มม. ที่ ${today.temp_c ?? "-"}°C</b><p>ใช้ร่วมกับปัจจัยข้างต้นในการประเมินระดับความเสี่ยง</p></div></div>
  `;
}

function qualitySection(today, note) {
  if (!today || !today.quality) {
    return `<div class="reason"><div class="icon">ℹ️</div><div><b>ข้อมูลตัวอย่าง</b><p>ยังไม่ได้เชื่อมข้อมูลจริง โปรดเปิดผ่านเซิร์ฟเวอร์ backend เพื่อดูผลการประเมินจริง</p></div></div>`;
  }
  const q = today.quality;
  const color = QUALITY_COLOR[q.level] || "#8aa0b3";
  return `
    <div class="risk-summary">
      <div class="donut" style="background:conic-gradient(${color} 0 ${q.score}%, #e7edf1 ${q.score}% 100%)">
        <div class="donut-inner"><b>${q.level}</b><span>${q.score}/100</span></div>
      </div>
      <div class="risk-labels">
        ${q.reasons.map(r => `<div class="reason" style="border-top:0;padding-top:0"><div class="icon ${r.type}">${r.type === "alert" ? "⚠️" : r.type === "warn" ? "🔶" : "ℹ️"}</div><div><p style="margin:0">${r.text}</p></div></div>`).join("")}
      </div>
    </div>
    ${note ? `<div class="model-note">${note}</div>` : ""}
  `;
}

function floodSection(today, forecast, note) {
  if (!today || !today.flood_risk) {
    return `<div class="reason"><div class="icon">ℹ️</div><div><b>ข้อมูลตัวอย่าง</b><p>ยังไม่ได้เชื่อมข้อมูลจริง โปรดเปิดผ่านเซิร์ฟเวอร์ backend เพื่อดูผลการประเมินจริง</p></div></div>`;
  }
  const upcoming = forecast.slice(0, 5);
  return `
    <div class="warning-box" style="background:${FLOOD_COLOR[today.flood_risk]}22;color:${FLOOD_COLOR[today.flood_risk]}">
      ${today.flood_risk === "ปกติ" ? "🟢" : today.flood_risk === "เฝ้าระวัง" ? "🟡" : today.flood_risk === "เสี่ยงสูง" ? "🟠" : "🔴"}
      วันนี้: ระดับ${today.flood_risk} (จากฝน ${today.mm} มม.)
    </div>
    <div class="flood-strip">
      ${upcoming.map(d => `<div class="flood-chip"><div class="muted" style="font-size:9.5px">${d.dow}</div>${coloredBadge(d.flood_risk, FLOOD_COLOR)}</div>`).join("")}
    </div>
    ${note ? `<div class="model-note">${note}</div>` : ""}
  `;
}

function historyBarChart(logs) {
  const maxLiters = Math.max(1, ...logs.map(l => l.harvested_liters || 0));
  return `<div class="history-chart">
    ${logs.map(l => {
      const h = Math.max(3, Math.round(((l.harvested_liters || 0) / maxLiters) * 100));
      return `<div class="hist-bar-col">
        <div class="hist-bar-val">${Math.round(l.harvested_liters || 0).toLocaleString()}</div>
        <div class="hist-bar-track"><div class="hist-bar" style="height:${h}%"></div></div>
        <div class="hist-bar-label">${l.log_date.slice(5)}</div>
      </div>`;
    }).join("")}
  </div>
  <div class="muted" style="text-align:center;margin-top:4px">ลิตรน้ำฝนที่เก็บได้ต่อวัน (ย้อนหลัง ${logs.length} วัน)</div>`;
}

function renderHistory() {
  if (historyLogs === undefined) {
    loadingView("กำลังโหลดประวัติข้อมูลย้อนหลัง...");
    fetchHistory(30).then(logs => { historyLogs = logs; render(); });
    return;
  }
  if (historyLogs === null) {
    app.innerHTML = `
      <div class="banner warn">⚠️ ไม่พบเซิร์ฟเวอร์ backend จึงยังไม่มีประวัติให้แสดง (ประวัติจะถูกบันทึกอัตโนมัติทุกครั้งที่เปิดแอปผ่าน backend)
      <button class="retry" id="retryHistory">ลองใหม่</button></div>`;
    document.getElementById("retryHistory").onclick = () => { historyLogs = undefined; render(); };
    return;
  }

  app.innerHTML = `
    <section class="hero">
      <div class="location">บันทึกอัตโนมัติทุกครั้งที่เปิดแอป • เก็บจริงในฐานข้อมูล</div>
      <div class="hero-title">ประวัติปริมาณน้ำ</div>
    </section>
    <section class="card">
      ${historyLogs.length === 0
        ? `<div class="warning-box">ℹ️ ยังไม่มีประวัติ เปิดแอปหน้าหลักอีกครั้ง (ให้เชื่อมอินเทอร์เน็ต/ตำแหน่ง) เพื่อเริ่มบันทึกข้อมูลรายวันอัตโนมัติ</div>`
        : historyBarChart(historyLogs)}
      <button class="detail-link" id="manualLog">＋ บันทึกปริมาณน้ำวันนี้ด้วยตนเอง</button>
    </section>
    ${historyLogs.length > 0 ? `
    <section class="card">
      <div class="section-head"><h2>รายการย้อนหลัง</h2></div>
      <div class="water-list">
        ${historyLogs.slice().reverse().map(l => `
          <div class="water-row">
            <div class="left"><div>📅</div><div><div class="date">${l.log_date}</div><div class="rain">ฝน ${l.rainfall_mm ?? "-"} มม. • เก็บได้ ${l.harvested_liters ?? "-"} ล.</div></div></div>
            <div style="text-align:right;display:grid;gap:4px">
              ${riskBadge(l.drought_risk)}${coloredBadge(l.quality_level, QUALITY_COLOR)}${coloredBadge(l.flood_risk, FLOOD_COLOR)}
            </div>
          </div>`).join("")}
      </div>
    </section>` : ""}
  `;

  document.getElementById("manualLog").onclick = () => {
    const p = profile || {};
    showModal("บันทึกปริมาณน้ำวันนี้", `
      <div class="form-grid">
        <label>น้ำที่มีอยู่ในปัจจุบัน (ลิตร)<input id="logWater" type="number" value="${p.water || ""}"></label>
        <label>อัตราการใช้น้ำวันนี้ (ลิตร)<input id="logUsage" type="number" value="${p.usage || ""}"></label>
      </div>
      <button class="primary" id="submitLog" style="margin-top:12px">บันทึก</button>
    `);
    document.getElementById("submitLog").onclick = async () => {
      const water_liters = Number(document.getElementById("logWater").value) || null;
      const usage_liters = Number(document.getElementById("logUsage").value) || null;
      try {
        await fetch("/api/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ water_liters, usage_liters }),
        });
        if (water_liters) { profile = { ...(profile || {}), water: water_liters }; localStorage.setItem("waterwiseProfile", JSON.stringify(profile)); }
        modal.classList.add("hidden");
        historyLogs = undefined;
        render();
      } catch (err) {
        showModal("บันทึกไม่สำเร็จ", `<p>ไม่สามารถเชื่อมต่อ backend ได้ ลองใหม่อีกครั้งเมื่อรันเซิร์ฟเวอร์แล้ว</p>`);
      }
    };
  };
}

function renderProfile() {
  const p = profile || {};
  app.innerHTML = `
    <section class="hero">
      <div class="hero-title">ข้อมูลผู้ใช้งาน</div>
      <div class="location">ข้อมูลเหล่านี้ใช้เป็นข้อมูลตั้งต้นสำหรับการคำนวณและวิเคราะห์</div>
    </section>
    <section class="card">
      <div class="form-grid">
        <label>ชื่อผู้ใช้<input id="name" value="${p.name || ""}" placeholder="กรอกชื่อของคุณ"></label>
        <label>ตำแหน่งพื้นที่ (ใช้เป็นชื่อแสดงผล ตำแหน่งจริงอ่านจาก GPS)<input id="location" value="${p.location || ""}" placeholder="เช่น เชียงใหม่, อ.เมือง"></label>
        <label>พื้นที่เกษตร (ไร่)<input id="farmArea" type="number" value="${p.farmArea || ""}" placeholder="กรอกพื้นที่เกษตรของคุณ"></label>
        <label>ประเภทการเพาะปลูก<select id="crop"><option ${p.crop === "นาข้าว" ? "selected" : ""}>นาข้าว</option><option ${p.crop === "สวนผลไม้" ? "selected" : ""}>สวนผลไม้</option><option ${p.crop === "พืชไร่" ? "selected" : ""}>พืชไร่</option><option>อื่น ๆ</option></select></label>
        <label>ความจุแหล่งเก็บน้ำ (ลิตร)<input id="capacity" type="number" value="${p.capacity || ""}" placeholder="เช่น 8000"></label>
        <label>น้ำที่มีอยู่ในปัจจุบัน (ลิตร)<input id="water" type="number" value="${p.water || ""}" placeholder="เช่น 5664"></label>
        <label>อัตราการใช้น้ำต่อวัน (ลิตร)<input id="usage" type="number" value="${p.usage || ""}" placeholder="เช่น 240"></label>
        <label>พื้นที่รับน้ำฝน (m²)<input id="catchment" type="number" value="${p.catchment || ""}" placeholder="เช่น 100"></label>
      </div>
      <div class="help">ระบบขอสิทธิ์ตำแหน่ง (GPS) จากเบราว์เซอร์เพื่อดึงพยากรณ์อากาศจริงและประเมินความเสี่ยงตามพิกัดของคุณ</div>
      <button class="primary" id="saveProfile">บันทึกข้อมูลและดำเนินการต่อ</button>
      ${locationState !== "pending" ? `<button class="secondary" id="refreshLoc" style="margin-top:10px">รีเฟรชตำแหน่งและข้อมูลพยากรณ์</button>` : ""}
    </section>
  `;
  document.getElementById("saveProfile").onclick = () => {
    const catchmentBefore = Number((profile || {}).catchment) || 0;
    profile = {
      name: document.getElementById("name").value.trim() || "ผู้ใช้",
      location: document.getElementById("location").value.trim() || "ยังไม่ได้ตั้งค่าตำแหน่ง",
      farmArea: Number(document.getElementById("farmArea").value) || 0,
      crop: document.getElementById("crop").value,
      capacity: Number(document.getElementById("capacity").value) || 8000,
      water: Number(document.getElementById("water").value) || 0,
      usage: Number(document.getElementById("usage").value) || 1,
      catchment: Number(document.getElementById("catchment").value) || 100,
    };
    localStorage.setItem("waterwiseProfile", JSON.stringify(profile));
    nav("home");
    if (Number(profile.catchment) !== catchmentBefore) loadAnalysis();
  };
  const refreshBtn = document.getElementById("refreshLoc");
  if (refreshBtn) refreshBtn.onclick = loadAnalysis;
}

function showFirstTime() {
  app.innerHTML = `
    <section class="hero" style="min-height:calc(100vh - 120px);display:flex;flex-direction:column;justify-content:center;border-radius:0;margin:-14px">
      <div class="location">ยินดีต้อนรับสู่</div>
      <div class="hero-title" style="font-size:30px;color:#58e4d0">WATERWISE AI</div>
      <p style="font-size:13px;line-height:1.8;opacity:.9">กรุณากรอกข้อมูลของคุณเพื่อเริ่มใช้งาน ข้อมูลจะช่วยให้เราประเมินสถานการณ์น้ำได้แม่นยำยิ่งขึ้น</p>
      <div class="card" style="color:var(--text);margin-top:10px">
        <div class="section-head"><h2>ข้อมูลพื้นฐาน</h2></div>
        <div class="form-grid">
          <label>ชื่อของคุณ<input id="ftName" placeholder="กรอกชื่อของคุณ"></label>
          <label>ตำแหน่งของคุณ<input id="ftLocation" placeholder="เช่น เชียงใหม่, อ.เมือง"></label>
          <label>พื้นที่เกษตร (ไร่)<input id="ftFarmArea" type="number" placeholder="กรอกพื้นที่เกษตรของคุณ"></label>
          <label>ประเภทการเพาะปลูก<select id="ftCrop"><option>นาข้าว</option><option>สวนผลไม้</option><option>พืชไร่</option><option>อื่น ๆ</option></select></label>
        </div>
        <div class="section-head" style="margin-top:16px"><h2>ข้อมูลแหล่งน้ำ</h2></div>
        <div class="form-grid">
          <label>ความจุแหล่งเก็บน้ำ (ลิตร)<input id="ftCapacity" type="number" placeholder="เช่น 8000"></label>
          <label>น้ำที่มีอยู่ในปัจจุบัน (ลิตร)<input id="ftWater" type="number" placeholder="เช่น 5664"></label>
          <label>อัตราการใช้น้ำต่อวัน (ลิตร)<input id="ftUsage" type="number" placeholder="เช่น 240"></label>
          <label>พื้นที่รับน้ำฝน (m²)<input id="ftCatchment" type="number" placeholder="เช่น 100"></label>
        </div>
        <div class="help">ถัดไปเบราว์เซอร์จะขอสิทธิ์เข้าถึงตำแหน่ง (GPS) เพื่อดึงพยากรณ์อากาศจริงและประเมินความเสี่ยงภัยแล้งด้วย AI</div>
        <button class="primary" id="firstSave">บันทึกและเริ่มใช้งาน</button>
      </div>
    </section>
  `;
  document.getElementById("firstSave").onclick = () => {
    profile = {
      name: document.getElementById("ftName").value.trim() || "ผู้ใช้",
      location: document.getElementById("ftLocation").value.trim() || "ยังไม่ได้ตั้งค่าตำแหน่ง",
      farmArea: Number(document.getElementById("ftFarmArea").value) || 0,
      crop: document.getElementById("ftCrop").value,
      capacity: Number(document.getElementById("ftCapacity").value) || 8000,
      water: Number(document.getElementById("ftWater").value) || 0,
      usage: Number(document.getElementById("ftUsage").value) || 1,
      catchment: Number(document.getElementById("ftCatchment").value) || 100,
    };
    localStorage.setItem("waterwiseProfile", JSON.stringify(profile));
    nav("home");
    loadAnalysis();
  };
}

if (!profile) {
  showFirstTime();
} else {
  render();
  loadAnalysis();
}
