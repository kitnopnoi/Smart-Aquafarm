const app = document.getElementById("app");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modalBody");

const rainForecast = [
  {day:"วันนี้", date:"25 มิ.ย.", icon:"🌧️", mm:42, liters:2775},
  {day:"พฤ.", date:"26 มิ.ย.", icon:"☁️", mm:18, liters:1044},
  {day:"ศ.", date:"27 มิ.ย.", icon:"☀️", mm:5, liters:245},
  {day:"ส.", date:"28 มิ.ย.", icon:"🌦️", mm:55, liters:3795},
  {day:"อา.", date:"29 มิ.ย.", icon:"🌧️", mm:30, liters:2010},
  {day:"จ.", date:"30 มิ.ย.", icon:"🌦️", mm:12, liters:672},
  {day:"อ.", date:"1 ก.ค.", icon:"☀️", mm:0, liters:0}
];

let currentPage = "home";
let profile = JSON.parse(localStorage.getItem("waterwiseProfile") || "null");

function showModal(title, html){
  modalBody.innerHTML = `<h2>${title}</h2>${html}`;
  modal.classList.remove("hidden");
}
document.getElementById("modalClose").onclick = ()=>modal.classList.add("hidden");
modal.onclick = (e)=>{ if(e.target===modal) modal.classList.add("hidden"); };

function nav(page){
  currentPage = page;
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active", b.dataset.page===page));
  render();
}
document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>nav(b.dataset.page));
document.getElementById("profileBtn").onclick = ()=>nav("profile");

function render(){
  if(currentPage==="home") renderHome();
  else if(currentPage==="water") renderWater();
  else if(currentPage==="risk") renderRisk();
  else renderProfile();
}

function renderHome(){
  const p = profile || {name:"ผู้ใช้", location:"ยังไม่ได้ตั้งค่าตำแหน่ง", water:5664, capacity:8000, usage:240};
  const days = Math.max(0, Math.floor(Number(p.water)/Math.max(1,Number(p.usage||240))));
  app.innerHTML = `
    <section class="hero">
      <div class="location">📍 ${p.location || "ตำแหน่งของคุณ"} • อัปเดต 6:00 น.</div>
      <div class="hero-title">น้ำของคุณวันนี้</div>
      <div class="water-main">
        <div class="water-icon">💧</div>
        <div>
          <div><span class="big-number">${Number(p.water).toLocaleString()}</span> <span class="unit">ลิตร</span></div>
          <div class="meta">${Math.round((Number(p.water)/Math.max(1,Number(p.capacity)))*100)}% ของความจุ ${Number(p.capacity).toLocaleString()} ล.</div>
        </div>
      </div>
      <div class="pills">
        <span class="pill">◷ ใช้ได้อีก ${days} วัน</span>
        <span class="pill good">● คุณภาพน้ำ: ปานกลาง 62%</span>
      </div>
    </section>

    <section class="card">
      <div class="section-head"><h2>พยากรณ์น้ำฝน 7 วันข้างหน้า</h2><button class="link-btn" id="allForecast">ดูทั้งหมด</button></div>
      <div class="forecast-scroll">
        ${rainForecast.slice(0,5).map((d,i)=>`
          <div class="forecast-day ${i===0?"selected":""}">
            <div class="dow">${d.day}</div>
            <div class="weather">${d.icon}</div>
            <div class="mm">${d.mm} มม.</div>
          </div>`).join("")}
      </div>
    </section>

    <section class="card">
      <div class="section-head"><h2>น้ำที่ใช้ได้จากฝนวันนี้</h2></div>
      <div class="water-total">2,775 <span class="unit">ลิตร</span></div>
      <div class="muted">จากฝนคาดการณ์ 3,264 ล.</div>
      <div class="progress-wrap">
        <div class="progress-bar"><span class="seg-use"></span><span class="seg-evap"></span><span class="seg-seep"></span><span class="seg-other"></span></div>
        <div class="legend">
          <div class="legend-row"><span class="legend-label"><i class="dot" style="background:#17b59e"></i>น้ำที่ใช้ได้จริง</span><b>85%</b></div>
          <div class="legend-row"><span class="legend-label"><i class="dot" style="background:#f5b940"></i>สูญเสียจากการระเหย</span><b>8%</b></div>
          <div class="legend-row"><span class="legend-label"><i class="dot" style="background:#f27d36"></i>สูญเสียจากการซึมลงดิน</span><b>5%</b></div>
          <div class="legend-row"><span class="legend-label"><i class="dot" style="background:#aab6bf"></i>กรองตะกอน/สิ่งสกปรก</span><b>2%</b></div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="section-head"><h2>สถานการณ์น้ำวันนี้</h2></div>
      <div class="warning-box">☀️ แนวโน้มภัยแล้งระดับปานกลาง — ควรติดตามปริมาณฝนและน้ำคงเหลือ</div>
    </section>
  `;
  document.getElementById("allForecast").onclick = ()=>nav("water");
}

function renderWater(){
  app.innerHTML = `
    <section class="hero">
      <div class="location">คาดการณ์จากสภาพอากาศ • อัปเดต 6:00 น.</div>
      <div class="hero-title">ปริมาณน้ำที่จะได้รับ</div>
    </section>
    <section class="card">
      <div class="segmented">
        <button class="active" data-range="7">ระยะสั้น · 7 วัน</button>
        <button data-range="30">ระยะยาว · 6 เดือน</button>
      </div>
      <div class="water-list">
        ${rainForecast.map(d=>`
          <div class="water-row">
            <div class="left"><div>💧</div><div><div class="date">${d.day}</div><div class="rain">${d.date} · ${d.mm} มม.</div></div></div>
            <div><div class="litres">${d.liters.toLocaleString()}</div><div class="muted">ลิตรที่ได้</div></div>
          </div>`).join("")}
      </div>
      <button class="secondary" id="waterCalcDetail">ดูวิธีคำนวณปริมาณน้ำ →</button>
    </section>
  `;
  document.querySelectorAll(".segmented button").forEach(b=>b.onclick=()=>{
    document.querySelectorAll(".segmented button").forEach(x=>x.classList.remove("active")); b.classList.add("active");
    showModal("แนวโน้มระยะยาว", `<p>ในเวอร์ชันต้นแบบ หน้านี้สลับมุมมองระยะสั้น 7 วันและระยะยาว 6 เดือนได้ ส่วนการคาดการณ์จริงจะเชื่อมข้อมูลสภาพอากาศและโมเดล AI ในขั้นพัฒนาถัดไป</p>`);
  });
  document.getElementById("waterCalcDetail").onclick=()=>showModal("สูตรคำนวณ", `<p>ต้นแบบใช้แนวคิด 1 มม. ของฝนบนพื้นที่ 1 ตร.ม. ≈ 1 ลิตร และคูณด้วยพื้นที่รับน้ำฝนและค่าสัมประสิทธิ์การไหลบ่า (Runoff Coefficient)</p>`);
}

function renderRisk(){
  app.innerHTML = `
    <section class="hero">
      <div class="location">จากการวิเคราะห์ข้อมูลและสภาพอากาศ</div>
      <div class="hero-title">คุณภาพน้ำและความเสี่ยง</div>
    </section>

    <section class="card">
      <div class="section-head"><h2>คุณภาพน้ำ ปัจจุบัน–7วัน</h2></div>
      <div class="risk-summary">
        <div class="donut"><div class="donut-inner"><b>10%</b><span>ปนเปื้อน</span></div></div>
        <div class="risk-labels">
          <div class="risk-line"><span class="risk-name"><i class="dot" style="background:#20ad76"></i>ดี</span><b>62%</b></div>
          <div class="risk-line"><span class="risk-name"><i class="dot" style="background:#f5ad34"></i>ปานกลาง</span><b>28%</b></div>
          <div class="risk-line"><span class="risk-name"><i class="dot" style="background:#ea5b3d"></i>ต้องระวังก่อนใช้</span><b>10%</b></div>
        </div>
      </div>
      <div class="reason-list">
        <div class="reason"><div class="icon">◉</div><div><b>ฝุ่นละอองจากการเผาในพื้นที่</b><p>พบจุดความร้อนใกล้เคียง 3 แห่งในรัศมี 20 กม.</p></div></div>
        <div class="reason"><div class="icon">⚠</div><div><b>คาดหมายความแรงและปริมาณฝนตก</b><p>อาจชะล้างพาตะกอนและมลพิษเข้าสู่แหล่งกักเก็บ</p></div></div>
        <div class="reason"><div class="icon">♢</div><div><b>ไม่พบโรงงานอุตสาหกรรมในรัศมี 20 กม.</b><p>ลดโอกาสปนเปื้อนสารเคมีบางประเภท</p></div></div>
      </div>
      <button class="secondary" id="qualityDays">ดูรายละเอียดคุณภาพน้ำรายวัน ↓</button>
    </section>

    <section class="card">
      <div class="section-head"><h2>แนวโน้มความเสี่ยงสถานการณ์น้ำ</h2></div>
      <div class="segmented">
        <button class="active" data-p="7">7 วัน</button>
        <button data-p="14">14 วัน</button>
        <button data-p="30">1 เดือน</button>
      </div>
      <div class="warning-box">☀️ เสี่ยงภัยแล้งปานกลาง</div>
      <div class="reason-list">
        <div class="reason"><div class="icon">☀️</div><div><b>ปริมาณฝนคาดการณ์ลดลง</b><p>ฝนคาดการณ์เฉลี่ยต่ำกว่าช่วงก่อนหน้า</p></div></div>
        <div class="reason"><div class="icon">💧</div><div><b>ปริมาณน้ำสำรองมีแนวโน้มลดลง</b><p>การใช้น้ำในพื้นที่ยังคงต่อเนื่อง</p></div></div>
        <div class="reason"><div class="icon">🌡️</div><div><b>อุณหภูมิมีแนวโน้มสูงขึ้น</b><p>เพิ่มโอกาสการสูญเสียน้ำจากการระเหย</p></div></div>
      </div>
      <button class="secondary" id="riskDays">ดูรายละเอียดรายวัน →</button>
    </section>
  `;
  document.querySelectorAll(".segmented button").forEach(b=>b.onclick=()=>{
    document.querySelectorAll(".segmented button").forEach(x=>x.classList.remove("active")); b.classList.add("active");
  });
  document.getElementById("qualityDays").onclick=()=>{
    showModal("คุณภาพน้ำรายวัน", rainForecast.map((d,i)=>`<div class="water-row"><div><b>${d.day}</b><div class="muted">${d.date}</div></div><b>${15+i*5}% ความเสี่ยง</b></div>`).join(""));
  };
  document.getElementById("riskDays").onclick=()=>{
    showModal("สถานการณ์น้ำรายวัน", rainForecast.map((d,i)=>`<div class="water-row"><div><b>${d.day}</b><div class="muted">ฝน ${d.mm} มม.</div></div><b>${d.mm>=40?"เฝ้าระวังน้ำท่วม":d.mm<=5?"เสี่ยงภัยแล้ง":"ปกติ"}</b></div>`).join(""));
  };
}

function renderProfile(){
  const p = profile || {};
  app.innerHTML = `
    <section class="hero">
      <div class="hero-title">ข้อมูลผู้ใช้งาน</div>
      <div class="location">ข้อมูลเหล่านี้ใช้เป็นข้อมูลตั้งต้นสำหรับการคำนวณและวิเคราะห์</div>
    </section>
    <section class="card">
      <div class="form-grid">
        <label>ชื่อผู้ใช้<input id="name" value="${p.name||""}" placeholder="กรอกชื่อของคุณ"></label>
        <label>ตำแหน่งพื้นที่<input id="location" value="${p.location||""}" placeholder="เช่น เชียงใหม่, อ.เมือง"></label>
        <label>พื้นที่เกษตร (ไร่)<input id="farmArea" type="number" value="${p.farmArea||""}" placeholder="กรอกพื้นที่เกษตรของคุณ"></label>
        <label>ประเภทการเพาะปลูก<select id="crop"><option ${p.crop==="นาข้าว"?"selected":""}>นาข้าว</option><option ${p.crop==="สวนผลไม้"?"selected":""}>สวนผลไม้</option><option ${p.crop==="พืชไร่"?"selected":""}>พืชไร่</option><option>อื่น ๆ</option></select></label>
        <label>ความจุแหล่งเก็บน้ำ (ลิตร)<input id="capacity" type="number" value="${p.capacity||""}" placeholder="เช่น 8000"></label>
        <label>น้ำที่มีอยู่ในปัจจุบัน (ลิตร)<input id="water" type="number" value="${p.water||""}" placeholder="เช่น 5664"></label>
        <label>อัตราการใช้น้ำต่อวัน (ลิตร)<input id="usage" type="number" value="${p.usage||""}" placeholder="เช่น 240"></label>
        <label>พื้นที่รับน้ำฝน (m²)<input id="catchment" type="number" value="${p.catchment||""}" placeholder="เช่น 100"></label>
      </div>
      <div class="help">ตำแหน่งสามารถใช้เป็นจุดเริ่มต้นในการดึงข้อมูลสภาพอากาศ/ภูมิศาสตร์ในเวอร์ชันต่อไป</div>
      <button class="primary" id="saveProfile">บันทึกข้อมูลและดำเนินการต่อ</button>
    </section>
  `;
  document.getElementById("saveProfile").onclick = ()=>{
    profile = {
      name: document.getElementById("name").value.trim() || "ผู้ใช้",
      location: document.getElementById("location").value.trim() || "ยังไม่ได้ตั้งค่าตำแหน่ง",
      farmArea: Number(document.getElementById("farmArea").value)||0,
      crop: document.getElementById("crop").value,
      capacity: Number(document.getElementById("capacity").value)||8000,
      water: Number(document.getElementById("water").value)||0,
      usage: Number(document.getElementById("usage").value)||1,
      catchment: Number(document.getElementById("catchment").value)||100
    };
    localStorage.setItem("waterwiseProfile", JSON.stringify(profile));
    nav("home");
  };
}

function showFirstTime(){
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
        <button class="primary" id="firstSave">บันทึกและเริ่มใช้งาน</button>
      </div>
    </section>
  `;
  document.getElementById("firstSave").onclick=()=>{
    profile = {
      name: document.getElementById("ftName").value.trim() || "ผู้ใช้",
      location: document.getElementById("ftLocation").value.trim() || "ยังไม่ได้ตั้งค่าตำแหน่ง",
      farmArea: Number(document.getElementById("ftFarmArea").value)||0,
      crop: document.getElementById("ftCrop").value,
      capacity: Number(document.getElementById("ftCapacity").value)||8000,
      water: Number(document.getElementById("ftWater").value)||0,
      usage: Number(document.getElementById("ftUsage").value)||1,
      catchment: Number(document.getElementById("ftCatchment").value)||100
    };
    localStorage.setItem("waterwiseProfile", JSON.stringify(profile));
    nav("home");
  };
}

if(!profile){
  showFirstTime();
}else{
  render();
}
