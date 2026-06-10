/* ============================================================
   CCC 2031 — app logic (vanilla JS, fully offline)
   ============================================================ */
(() => {
  const D = window.CCC_DATA;
  const KEY = "ccc2031.v1";
  const DOW = ["日","月","火","水","木","金","土"];
  const DOW_EN = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const $ = (s, r = document) => r.querySelector(s);

  /* ---------- date helpers (local time) ---------- */
  const pad = n => String(n).padStart(2, "0");
  const dstr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const pdate = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
  const mondayOf = d => { const x = new Date(d); const w = (x.getDay()+6)%7; x.setDate(x.getDate()-w); x.setHours(0,0,0,0); return x; };
  function isoWeek(d){
    const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = (x.getUTCDay()+6)%7; x.setUTCDate(x.getUTCDate()-day+3);
    const first = new Date(Date.UTC(x.getUTCFullYear(),0,4));
    const wk = 1 + Math.round(((x - first)/86400000 - 3 + ((first.getUTCDay()+6)%7))/7);
    return `${x.getUTCFullYear()}-W${pad(wk)}`;
  }
  const r1 = n => Math.round(n*10)/10;

  /* ---------- state ---------- */
  const clone = o => JSON.parse(JSON.stringify(o));
  function defaults(){
    return { version:2, log:{}, settings:{
      baseLongKm:20, weeklyTargetKm:0,
      raceDate:D.raceDate, raceName:D.raceName.jp,
      reminderTime:"06:30", lang:"both", podcast:{},
      // v2 — training-load guardrails, milestone races, maintenance
      cycleStartDate: dstr(mondayOf(new Date())),  // recovery-cycle anchor (Mon)
      cycleEnabled: true,                          // 3-up / 1-down recovery cycle
      acwrEnabled: true,                           // ACWR advisory chip
      races: clone(D.races),                       // milestone races
      lastExportAt: null,                          // backup reminder
      exportSnoozedUntil: null
    }};
  }
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY)) || defaults(); }
  catch(e){ state = defaults(); }
  state.settings = Object.assign(defaults().settings, state.settings || {});
  const save = () => localStorage.setItem(KEY, JSON.stringify(state));

  /* In-place migration to state v2. Adds new fields with safe defaults and
     bumps the version; existing log entries are never touched. The localStorage
     KEY ("ccc2031.v1") deliberately stays unchanged. */
  function migrate(){
    if(!(state.version >= 2)){
      const s = state.settings;
      if(s.cycleStartDate == null) s.cycleStartDate = dstr(mondayOf(new Date()));
      if(s.cycleEnabled == null)   s.cycleEnabled = true;
      if(s.acwrEnabled == null)    s.acwrEnabled = true;
      if(!Array.isArray(s.races) || !s.races.length) s.races = clone(D.races);
      if(s.lastExportAt === undefined)      s.lastExportAt = null;
      if(s.exportSnoozedUntil === undefined) s.exportSnoozedUntil = null;
      state.version = 2;
      save();
    }
  }
  migrate();
  const S = () => state.settings;
  const lang = () => S().lang;

  let selDate = dstr();        // currently viewed date on Today tab
  let tab = "today";
  let kneePending = null;      // date string awaiting a knee check-in, or null

  /* ---------- domain helpers ---------- */
  const planFor = ds => D.plan[pdate(ds).getDay()];
  const logFor  = ds => state.log[ds] || null;
  function ensureLog(ds){
    const p = planFor(ds);
    if(!state.log[ds]) state.log[ds] = { type:p.type, done:false, items:{}, note:"",
      distanceKm: p.kind==="run" ? 0 : undefined };
    return state.log[ds];
  }
  function lastLongKm(){
    const dates = Object.keys(state.log).filter(d => state.log[d].type==="long" && state.log[d].distanceKm>0).sort();
    if(dates.length) return state.log[dates[dates.length-1]].distanceKm;
    return S().baseLongKm;
  }
  const nextLongTarget = () => r1(lastLongKm()*1.10);
  function podcastFor(type){
    const u = S().podcast[type];
    if(u && u.trim()) return u.trim();
    const d = D.podcastDefaults[type];
    if(!d) return "";
    return lang()==="en" ? (d.en||d.jp) : d.jp;
  }
  function weekDistance(monday){
    let km = 0;
    for(let i=0;i<7;i++){ const l = logFor(dstr(addDays(monday,i))); if(l && l.distanceKm) km += l.distanceKm; }
    return r1(km);
  }
  function weekSessions(monday){
    let planned=0, done=0;
    for(let i=0;i<7;i++){
      const ds = dstr(addDays(monday,i)); const p = planFor(ds);
      if(p.kind==="rest") continue;
      planned++; const l = logFor(ds); if(l && l.done) done++;
    }
    return { planned, done };
  }
  function weekElev(monday){               // weekly D+ (elevation gain, m)
    let m = 0;
    for(let i=0;i<7;i++){ const l = logFor(dstr(addDays(monday,i))); if(l && l.elevM) m += l.elevM; }
    return Math.round(m);
  }

  /* ---------- training-load guardrails (ACWR) ---------- */
  function rolling7Km(today=dstr()){       // acute load: trailing 7 days incl. today
    let km = 0; const t = pdate(today);
    for(let i=0;i<7;i++){ const l = logFor(dstr(addDays(t,-i))); if(l && l.distanceKm) km += l.distanceKm; }
    return r1(km);
  }
  function chronicWeeklyKm(today=dstr()){   // avg weekly km of prev 4 ISO weeks w/ any km
    const curMon = mondayOf(pdate(today)); const vals=[];
    for(let i=1;i<=4;i++){ const km = weekDistance(addDays(curMon,-7*i)); if(km>0) vals.push(km); }
    if(vals.length<2) return null;
    return r1(vals.reduce((a,b)=>a+b,0)/vals.length);
  }
  function acwr(today=dstr()){
    const chronic = chronicWeeklyKm(today);
    if(chronic==null || chronic===0) return { insufficient:true };
    const acute = rolling7Km(today);
    return { acute, chronic, ratio: Math.round(acute/chronic*10)/10 };
  }
  function acwrStatus(ratio){
    if(ratio < 0.8)  return { cls:"chip-muted", jp:"維持",   en:"detraining range",
      njp:"負荷が低め。少しずつ戻そう。", nen:"Load is low — build back gradually." };
    if(ratio <= 1.3) return { cls:"chip-teal",  jp:"適正",   en:"sweet spot",
      njp:"負荷と回復のバランス良好。", nen:"Load and recovery are balanced." };
    if(ratio <= 1.5) return { cls:"chip-amber", jp:"注意",   en:"caution",
      njp:"増やしすぎ気味。様子を見て。", nen:"Ramping a bit fast — watch how you feel." };
    return                  { cls:"chip-red",   jp:"上げすぎ", en:"high risk",
      njp:"急増。今週は抑えめに。", nen:"Sharp spike — hold back this week." };
  }

  /* ---------- recovery-week cycle (3 up / 1 down) ---------- */
  function recoveryWeekIndex(date){         // 0..3 within the cycle; 3 = recovery week
    const start = mondayOf(pdate(S().cycleStartDate));
    const cur   = mondayOf(typeof date==="string" ? pdate(date) : new Date(date));
    const weeks = Math.round((cur - start)/(7*86400000));
    return ((weeks % 4) + 4) % 4;
  }
  function isRecoveryWeek(date=dstr()){
    return !!S().cycleEnabled && recoveryWeekIndex(date)===3;
  }

  /* ---------- milestone races + training phase ---------- */
  function nextRace(today=dstr()){
    const list = (S().races||[]).filter(r => r && r.date && r.date >= today)
      .sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    return list.length ? list[0] : null;
  }
  function phaseFor(today=dstr()){
    const r = nextRace(today);
    if(!r) return { key:"base", jp:"ベース期", en:"Base", race:null };
    const w = Math.round((mondayOf(pdate(r.date)) - mondayOf(pdate(today)))/(7*86400000));
    let key, jp, en;
    if(w <= 0){ key="race";  jp="レース週";   en="Race week"; }
    else if(w <= 2){ key="taper"; jp="テーパー期"; en="Taper"; }
    else if(w <= 8){ key="build"; jp="ビルド期";  en="Build"; }
    else { key="base"; jp="ベース期"; en="Base"; }
    return { key, jp, en, race:r };
  }

  /* Unified long-run target — single source of truth so Today + Week agree.
     Precedence: taper/race week (suppress) > recovery week (×0.7) > normal (+10%). */
  function longTargetFor(date=dstr()){
    const ph = phaseFor(date);
    if(ph.key==="taper" || ph.key==="race"){
      return { mode:"taper", km:null, jp:"テーパー中 — 距離より鮮度", en:"Taper — freshness over volume" };
    }
    if(isRecoveryWeek(date)){
      return { mode:"recovery", km:r1(lastLongKm()*0.7), jp:"リカバリーペース（前回ロング ×0.7）", en:"Recovery pace · last long ×0.7" };
    }
    return { mode:"normal", km:nextLongTarget(), jp:"前回ロング +10%", en:"Long target · +10%" };
  }

  /* ---------- small UI utils ---------- */
  let toastT;
  function toast(msg, dot=true){
    const t = $("#toast"); t.innerHTML = (dot?'<span class="tdot"></span>':'') + msg;
    t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(()=>t.classList.remove("show"), 1900);
  }
  const CHECK = '<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>';
  const esc = s => String(s==null?"":s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  function ringSVG(pct, size=86){
    const r=(size-12)/2, c=2*Math.PI*r, off=c*(1-Math.max(0,Math.min(1,pct)));
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="var(--surface-3)" stroke-width="8" fill="none"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="var(--blaze)" stroke-width="8" fill="none"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        transform="rotate(-90 ${size/2} ${size/2})" style="transition:stroke-dashoffset .7s var(--ease)"/>
    </svg>`;
  }

  /* Dual-series: distance bars (orange, left scale) + thin D+ bars (teal, own
     independent right scale). The two scales let both stay legible at 336px. */
  function barsSVG(weeks, target){
    const W=336,H=168,top=18,bot=26,L=6,R=6, n=weeks.length;
    const plotH=H-top-bot, base=top+plotH;
    const maxKm=Math.max(target||0, ...weeks.map(w=>w.km), 1);
    const maxEv=Math.max(...weeks.map(w=>w.elev||0), 1);
    const scK=plotH/(maxKm*1.18), scE=plotH/(maxEv*1.18);
    const slot=(W-L-R)/n, dW=Math.min(16, slot*0.34), eW=Math.min(7, slot*0.16);
    let bars="";
    weeks.forEach((w,i)=>{
      const cx=L+slot*i+slot/2, dcx=cx-slot*0.15, ecx=cx+slot*0.19;
      // distance bar
      const dh=Math.max(w.km*scK, w.km>0?3:0), dy=base-dh;
      const col=w.cur ? "var(--blaze)" : "rgba(255,106,43,.32)";
      bars += `<rect x="${(dcx-dW/2).toFixed(1)}" y="${dy.toFixed(1)}" width="${dW.toFixed(1)}" height="${dh.toFixed(1)}" rx="3" fill="${col}"/>`;
      if(w.km>0) bars += `<text class="bar-val" x="${dcx.toFixed(1)}" y="${(dy-4).toFixed(1)}" text-anchor="middle">${w.km}</text>`;
      // elevation bar (second scale)
      if(w.elev>0){
        const eh=Math.max(w.elev*scE,3), ey=base-eh;
        bars += `<rect x="${(ecx-eW/2).toFixed(1)}" y="${ey.toFixed(1)}" width="${eW.toFixed(1)}" height="${eh.toFixed(1)}" rx="2" fill="var(--teal)" opacity="${w.cur?'.95':'.55'}"/>`;
        bars += `<text class="bar-ev" x="${ecx.toFixed(1)}" y="${(ey-3).toFixed(1)}" text-anchor="middle">${w.elev}</text>`;
      }
      bars += `<text class="bar-lab" x="${cx.toFixed(1)}" y="${(H-9).toFixed(1)}" text-anchor="middle">${w.label}</text>`;
    });
    let tl="";
    if(target>0){
      const ty=base-target*scK;
      tl = `<line x1="${L}" y1="${ty.toFixed(1)}" x2="${W-R}" y2="${ty.toFixed(1)}" stroke="var(--blaze-2)" stroke-width="1.2" stroke-dasharray="3 4" opacity=".7"/>`
         + `<text class="bar-val" x="${W-R}" y="${(ty-4).toFixed(1)}" text-anchor="end" fill="var(--blaze-2)">目標 ${r1(target)}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${tl}${bars}</svg>`;
  }

  /* Knee trend mini line chart — last 28 days of entries with a numeric knee
     score (0–10). Teal line; amber dots ≥4, red dots ≥7. */
  function kneeSVG(points){
    const W=336,H=120,top=12,bot=20,L=22,R=8;
    const plotH=H-top-bot, plotW=W-L-R, base=top+plotH;
    const y = v => base - (Math.max(0,Math.min(10,v))/10)*plotH;
    let grid="";
    [0,5,10].forEach(g=>{ const gy=y(g);
      grid += `<line x1="${L}" y1="${gy.toFixed(1)}" x2="${W-R}" y2="${gy.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`
            + `<text class="bar-lab" x="${(L-5)}" y="${(gy+3).toFixed(1)}" text-anchor="end">${g}</text>`;
    });
    const n=points.length;
    const xAt = i => n<=1 ? L+plotW/2 : L + (plotW*i)/(n-1);
    let line="", dots="";
    points.forEach((p,i)=>{
      const px=xAt(i), py=y(p.knee);
      if(i>0){ const qx=xAt(i-1), qy=y(points[i-1].knee);
        line += `<line x1="${qx.toFixed(1)}" y1="${qy.toFixed(1)}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="var(--teal)" stroke-width="1.8"/>`; }
      const col = p.knee>=7 ? "#ff6b6b" : p.knee>=4 ? "var(--amber)" : "var(--teal)";
      dots += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${p.knee>=4?3.2:2.6}" fill="${col}"/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${line}${dots}</svg>`;
  }

  /* ============================================================
     VIEWS
     ============================================================ */
  const main = () => $("#main");

  function dayStrip(){
    const mon = mondayOf(pdate(selDate)), today = dstr();
    let html = '<div class="daystrip">';
    for(let i=0;i<7;i++){
      const d = addDays(mon,i), ds = dstr(d), p = planFor(ds), l = logFor(ds);
      const cls = [ "d",
        ds===today?"today":"",
        ds===selDate?"sel":"",
        (l&&l.done)?"done":(p.kind!=="rest"?"planned":"") ].join(" ");
      html += `<div class="${cls}" data-d="${ds}">
        <div class="dow">${DOW[d.getDay()]}</div>
        <div class="dn">${d.getDate()}</div>
        <div class="dot"></div></div>`;
    }
    return html + "</div>";
  }

  function renderToday(){
    const ds = selDate, p = planFor(ds), d = pdate(ds), l = logFor(ds);
    const isToday = ds===dstr();
    const dateLine = `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} (${DOW[d.getDay()]})`;

    let body = "";
    const tagClass = p.kind==="strength"?"strength":p.kind==="run"?"run":"rest";
    const tagTxt = lang()==="en" ? p.theme.en : p.theme.jp;
    const ttl = lang()==="en" ? p.en : p.jp;
    const sub = lang()==="both" ? `<div class="en">${p.en}</div>` : "";

    let inner = `<div class="sessionhead">
        <div><div class="ttl">${ttl}</div>${sub}</div>
        <span class="tag ${tagClass}">${tagTxt}</span>
      </div>
      <div class="datebig"><span class="dnum mono">${dateLine}</span>${isToday?'<span class="label" style="color:var(--blaze)">TODAY</span>':''}</div>`;

    if(p.kind==="strength"){
      inner += '<div class="exlist">';
      p.exercises.forEach(id=>{
        const ex=D.exercises[id], on=l&&l.items&&l.items[id];
        const nm = lang()==="en"?ex.en:ex.jp;
        const cue = lang()==="en"?(ex.cue.en||ex.cue.jp):ex.cue.jp;
        const vid = "https://www.youtube.com/results?search_query="+encodeURIComponent(ex.en+" exercise form");
        inner += `<div class="ex ${on?'on':''}" data-ex="${id}">
          <a class="ex-thumb" href="${vid}" target="_blank" rel="noopener noreferrer" data-vid aria-label="${nm} の動画 / watch video">
            <img src="img/${id}.jpg" alt="${nm}" loading="lazy"><span class="play" aria-hidden="true"></span></a>
          <div class="check">${CHECK}</div>
          <div class="body"><div class="name">${nm}</div><div class="cue">${cue}</div></div>
          <div class="dose mono">${ex.dose}</div></div>`;
      });
      inner += '</div>';
    } else if(p.kind==="run"){
      const val = l && l.distanceKm ? l.distanceKm : "";
      const ev  = l && l.elevM ? l.elevM : "";
      inner += `<div class="distrow">
          <div class="field"><input type="number" inputmode="decimal" step="0.1" min="0" id="distIn" placeholder="0.0" value="${val}"><span class="unit">km</span></div>
          <div class="field"><input type="number" inputmode="numeric" step="10" min="0" id="elevIn" placeholder="0" value="${ev}"><span class="unit">m D+</span></div>
        </div>`;
      if(p.isLong){
        const lt = longTargetFor(ds);
        if(lt.km!=null){
          const labJp = lt.mode==="recovery" ? "今日の目安（リカバリー：前回ロング ×0.7）" : "今日の目安（前回ロング +10%）";
          inner += `<div class="target ${lt.mode==='recovery'?'target-rec':''}"><span class="tlabel">${labJp}<br><span class="label" style="display:inline">${lt.en}</span></span><b class="mono">${lt.km} km</b></div>`;
        } else {
          inner += `<div class="target target-taper"><span class="tlabel">${lt.jp}<br><span class="label" style="display:inline">${lt.en}</span></span></div>`;
        }
      }
    } else {
      inner += `<p class="note" style="margin-top:6px">休息日。回復もトレーニングの一部。<br><span style="color:var(--faint)">Rest day — recovery is part of the plan.</span></p>`;
    }

    // podcast hint
    const pod = podcastFor(p.type);
    if(pod) inner += `<div class="note" style="margin-top:16px;display:flex;gap:9px;align-items:flex-start">
        <span style="color:var(--blaze-2)">♪</span><span><b>今日の一本</b> — ${pod}</span></div>`;

    // action button
    if(p.kind!=="rest"){
      const done = l && l.done;
      inner += `<button class="btn btn-primary ${done?'done':''}" id="completeBtn">
        ${done ? CHECK_DONE_LABEL(p.kind) : '完了にする / Mark complete'}</button>`;
    } else {
      const done = l && l.done;
      inner += `<button class="btn ${done?'btn-ghost':''}" id="restBtn">${done?'記録済み（取り消す）':'軽く動いた記録をつける'}</button>`;
    }

    body = `<div class="card glow">${inner}</div>`;

    const knee = (kneePending===ds) ? kneeCardHTML() : "";
    main().innerHTML = `<div class="view">${dayStrip()}${body}${knee}</div>`;
    bindToday();
  }
  function CHECK_DONE_LABEL(kind){ return '完了済み ✓ / Done — tap to undo'; }

  /* Knee check-in (0–10) — compact inline prompt shown the moment a session is
     completed. One tap saves; never blocks the completion itself. */
  function kneeCardHTML(){
    let scale="";
    for(let i=0;i<=10;i++) scale += `<button class="kbtn" data-knee="${i}">${i}</button>`;
    return `<div class="card kneecard">
      <div class="kq">膝の調子は？ / How do the knees feel?</div>
      <div class="ksub">0 = 絶好調 no issues ・ 10 = 強い痛み severe pain</div>
      <div class="kneescale">${scale}</div>
      <a class="kskip" data-knee-skip>スキップ / skip</a>
    </div>`;
  }
  function kneeEditField(l){
    const cur = typeof l.knee==="number" ? l.knee : "";
    let opts = `<option value="">—</option>`;
    for(let i=0;i<=10;i++) opts += `<option value="${i}"${cur===i?' selected':''}>${i}</option>`;
    return `<div class="set"><label>膝の調子 / Knee (0–10)</label>
      <select class="input mono" id="eKnee">${opts}</select></div>`;
  }
  function promptKnee(ds){                 // returns true if a prompt should show
    const l = logFor(ds);
    if(l && typeof l.knee==="number") return false;   // already answered → ask once
    kneePending = ds; return true;
  }

  function bindToday(){
    main().querySelectorAll(".daystrip .d").forEach(el=>{
      el.onclick = () => { kneePending=null; selDate = el.dataset.d; renderToday(); };
    });
    main().querySelectorAll(".ex-thumb").forEach(a=>{
      a.addEventListener("click", e=> e.stopPropagation());   // open video without toggling done
      const img = a.querySelector("img");
      if(img){ const miss=()=>a.classList.add("noimg");
        img.addEventListener("error", miss);
        if(img.complete && img.naturalWidth===0) miss(); }   // catch already-failed loads
    });
    main().querySelectorAll(".ex").forEach(el=>{
      el.onclick = () => {
        const id = el.dataset.ex, l = ensureLog(selDate);
        l.items[id] = !l.items[id];
        el.classList.toggle("on", l.items[id]);
        // auto-complete when all checked
        const p = planFor(selDate);
        const all = p.exercises.every(x=>l.items[x]);
        if(all && !l.done){
          l.done=true; save(); toast("筋トレ完了！");
          if(promptKnee(selDate)){ renderToday(); return; }
          refreshActionBtn(); refreshStripDot();
        } else if(!all && l.done){
          l.done=false; save(); refreshActionBtn(); refreshStripDot();
        } else { save(); }
      };
    });
    main().querySelectorAll(".kneescale .kbtn").forEach(b=>{
      b.onclick = () => { const l=ensureLog(selDate); l.knee=parseInt(b.dataset.knee,10); save();
        kneePending=null; toast(`膝 ${l.knee}/10 を記録`); renderToday(); };
    });
    const ksk = main().querySelector("[data-knee-skip]");
    if(ksk) ksk.onclick = () => { kneePending=null; renderToday(); };
    const dist = $("#distIn");
    if(dist) dist.oninput = () => { const l=ensureLog(selDate); l.distanceKm = parseFloat(dist.value)||0; save(); };
    const elev = $("#elevIn");
    if(elev) elev.oninput = () => { const l=ensureLog(selDate); l.elevM = parseInt(elev.value,10)||0; save(); };
    const cb = $("#completeBtn");
    if(cb) cb.onclick = () => {
      const l = ensureLog(selDate); l.done = !l.done; save();
      if(l.done){
        const p=planFor(selDate);
        if(p.kind==="run" && l.distanceKm>0) toast(`記録: ${l.distanceKm} km`);
        else toast("完了！");
        if(promptKnee(selDate)){ renderToday(); return; }
      }
      refreshActionBtn(); refreshStripDot();
    };
    const rb = $("#restBtn");
    if(rb) rb.onclick = () => { const l=ensureLog(selDate); l.done=!l.done; save(); renderToday(); };
  }
  function refreshActionBtn(){
    const l=logFor(selDate), p=planFor(selDate), cb=$("#completeBtn");
    if(!cb) return;
    const done = l && l.done;
    cb.classList.toggle("done", !!done);
    cb.innerHTML = done ? CHECK_DONE_LABEL(p.kind) : '完了にする / Mark complete';
  }
  function refreshStripDot(){
    const el = main().querySelector(`.daystrip .d[data-d="${selDate}"]`);
    if(!el) return; const l=logFor(selDate), p=planFor(selDate);
    el.classList.toggle("done", !!(l&&l.done));
    el.classList.toggle("planned", !(l&&l.done) && p.kind!=="rest");
  }

  /* ---------------- WEEK ---------------- */
  function renderWeek(){
    const mon = mondayOf(new Date());
    const today = dstr();
    const sess = weekSessions(mon), km = weekDistance(mon), elev = weekElev(mon);
    const pct = sess.planned ? sess.done/sess.planned : 0;

    // 8-week distance + D+ series
    const weeks=[];
    for(let i=7;i>=0;i--){
      const m = addDays(mon, -7*i);
      weeks.push({ label:`${m.getMonth()+1}/${m.getDate()}`, km: weekDistance(m), elev: weekElev(m), cur:i===0 });
    }
    // target line: explicit weekly target, else last nonzero week +10%
    let target = S().weeklyTargetKm;
    if(!target){
      for(let i=weeks.length-2;i>=0;i--){ if(weeks[i].km>0){ target=r1(weeks[i].km*1.10); break; } }
    }

    const lt = longTargetFor(today);
    const longStat = lt.km!=null ? `${lt.km}<small> km</small>` : `<span style="font-size:19px;color:var(--muted)">—</span>`;

    main().innerHTML = `<div class="view">
      <div class="card">
        <div class="ringwrap">
          <div class="ring">${ringSVG(pct)}</div>
          <div class="ringtxt">
            <div class="big mono">${sess.done}<small style="color:var(--faint)"> / ${sess.planned}</small></div>
            <div class="sub">今週のセッション達成 · This week</div>
          </div>
        </div>
      </div>

      <div class="statgrid">
        <div class="stat accent"><div class="v mono">${km}<small> km</small></div><div class="k">今週 distance</div></div>
        <div class="stat"><div class="v mono">${elev}<small> m</small></div><div class="k">今週 D+</div></div>
        <div class="stat"><div class="v mono">${longStat}</div><div class="k">次ロング target</div></div>
      </div>

      ${recoveryBannerHTML(today)}
      ${acwrCardHTML(today)}
      ${raceCardHTML(today)}

      <div class="card">
        <div class="charttitle"><div class="label">週間距離・獲得標高 · last 8 weeks</div></div>
        <div class="chart">${barsSVG(weeks, target)}</div>
        <div class="legend">
          <span><i style="background:var(--blaze)"></i>距離 km</span>
          <span><i style="background:var(--teal)"></i>獲得標高 m</span>
          ${target?'<span><i style="background:var(--blaze-2)"></i>目標 (+10%)</span>':''}
        </div>
      </div>

      ${kneeTrendHTML()}

      <div class="card">
        <div class="label" style="margin-bottom:12px">今週の予定 · This week</div>
        ${weekPlanList(mon)}
      </div>
    </div>`;
  }

  function recoveryBannerHTML(today){
    if(!isRecoveryWeek(today)) return "";
    return `<div class="hint banner-rec">
      <div class="ht">🌙 リカバリー週 / Recovery week</div>
      <p>距離を約30%落とす週です。<span style="color:var(--faint)">Cut volume ~30% this week — let the training absorb.</span></p>
    </div>`;
  }

  function acwrCardHTML(today){
    if(!S().acwrEnabled) return "";
    const a = acwr(today);
    if(a.insufficient){
      return `<div class="card acwr-card">
        <div class="acwr-row"><div class="label">急性:慢性 負荷比 · ACWR</div>
          <span class="tag chip-muted">データ不足 / not enough data</span></div>
        <p class="note" style="margin-top:8px">過去4週で距離の記録が2週分そろうと表示されます。<br><span style="color:var(--faint)">Log distance for ≥2 of the last 4 weeks to see your ratio.</span></p>
      </div>`;
    }
    const st = acwrStatus(a.ratio);
    return `<div class="card acwr-card">
      <div class="acwr-row">
        <div><div class="label">急性:慢性 負荷比 · ACWR</div>
          <div class="acwr-num mono">${a.ratio.toFixed(1)}<small> ×</small></div></div>
        <span class="tag ${st.cls}">${st.jp} / ${st.en}</span>
      </div>
      <p class="note" style="margin-top:8px">${st.njp}<br><span style="color:var(--faint)">${st.nen}</span></p>
    </div>`;
  }

  function raceCardHTML(today){
    const ph = phaseFor(today);
    const cccDays = Math.max(0, Math.ceil((pdate(S().raceDate)-pdate(today))/86400000));
    let raceLine;
    if(ph.race){
      const rd = Math.max(0, Math.ceil((pdate(ph.race.date)-pdate(today))/86400000));
      raceLine = `<div class="rrow"><div><div class="rname">${esc(ph.race.name)} <span class="rdate mono">${ph.race.date}</span></div>
        ${ph.race.note?`<div class="rnote">${esc(ph.race.note)}</div>`:''}</div>
        <div class="rdays mono">${rd}<small> days</small></div></div>`;
    } else {
      raceLine = `<div class="rrow"><div class="rname" style="color:var(--muted)">予定レースなし / No upcoming race</div></div>`;
    }
    return `<div class="card race-card">
      <div class="race-head"><div class="label">次のレース · Next race</div>
        <span class="tag phase-${ph.key}">${ph.jp} / ${ph.en}</span></div>
      ${raceLine}
      <div class="ccc-line">CCC 2031 まで <b class="mono">${cccDays}</b> days</div>
    </div>`;
  }

  function kneeData(){      // entries with a numeric knee in the last 28 days, chronological
    const t = pdate(dstr()); const out=[];
    for(let i=27;i>=0;i--){ const ds=dstr(addDays(t,-i)); const l=logFor(ds);
      if(l && typeof l.knee==="number") out.push({ ds, knee:l.knee }); }
    return out;
  }
  function kneeTrendHTML(){
    const pts = kneeData();
    if(!pts.length) return "";
    let adv="";
    const all = pts.map(p=>p.knee);
    const recent = all.slice(-7);
    const prior  = all.slice(Math.max(0, all.length-7-21), all.length-7);
    if(recent.length>=3 && prior.length){
      const avg = arr => arr.reduce((a,b)=>a+b,0)/arr.length;
      if(avg(recent) - avg(prior) >= 2){
        adv = `<div class="hint banner-knee" style="margin:12px 0 0"><p>膝の違和感が増加傾向 — 負荷を見直そう。<br><span style="color:var(--faint)">Knee discomfort trending up — consider easing load.</span></p></div>`;
      }
    }
    return `<div class="card">
      <div class="charttitle"><div class="label">膝トレンド · Knee trend (28d)</div></div>
      <div class="chart">${kneeSVG(pts)}</div>
      ${adv}
    </div>`;
  }
  function weekPlanList(mon){
    let h="";
    for(let i=0;i<7;i++){
      const ds=dstr(addDays(mon,i)), p=planFor(ds), l=logFor(ds), d=addDays(mon,i);
      const col = p.kind==="strength"?"var(--blaze)":p.kind==="run"?"#7fb3ff":"var(--faint)";
      const done = l&&l.done;
      const right = p.kind==="run" && l && l.distanceKm ? `<span class="lr mono">${l.distanceKm} km</span>`
                   : done ? `<span style="color:var(--teal)">${CHECK}</span>` : "";
      h += `<div class="logitem" data-goto="${ds}" style="margin-bottom:6px;${ds===dstr()?'border-color:var(--blaze)':''}">
        <span class="dot" style="background:${col}"></span>
        <div class="lbody"><div class="lt">${DOW[d.getDay()]} · ${lang()==='en'?p.en:p.jp}</div>
        <div class="ld">${lang()==='en'?p.theme.en:p.theme.jp}</div></div>${right}</div>`;
    }
    return h;
  }

  /* ---------------- LOG ---------------- */
  function renderLog(){
    const dates = Object.keys(state.log).filter(d=>{ const l=state.log[d]; return l.done || (l.distanceKm>0) || (l.items&&Object.values(l.items).some(Boolean)) || (l.note&&l.note.trim()); }).sort().reverse();
    if(!dates.length){
      main().innerHTML = `<div class="view"><div class="empty"><div class="big">⛰</div>まだ記録がありません。<br>「今日」タブから完了をつけよう。<br><span style="color:var(--faint)">No entries yet — log a session from the Today tab.</span></div></div>`;
      return;
    }
    // group by iso week
    const groups={};
    dates.forEach(ds=>{ const k=isoWeek(pdate(ds)); (groups[k]=groups[k]||[]).push(ds); });
    let html='<div class="view">';
    Object.keys(groups).sort().reverse().forEach(wk=>{
      const list=groups[wk];
      const mon=mondayOf(pdate(list[0]));
      const km=weekDistance(mon);
      html += `<div class="weekgroup"><div class="wh"><span class="wk">${wk.replace('-W',' · 第')}週</span><span class="wkm mono">${km} km</span></div>`;
      list.forEach(ds=>{
        const l=state.log[ds], p=planFor(ds), d=pdate(ds);
        const col = p.kind==="strength"?"var(--blaze)":p.kind==="run"?"#7fb3ff":"var(--faint)";
        let detail="";
        if(p.kind==="strength" && l.items){ const c=Object.values(l.items).filter(Boolean).length; detail=`${c}/${p.exercises.length} 種目`; }
        if(typeof l.knee==="number") detail += (detail?" · ":"") + `膝 ${l.knee}/10`;
        if(l.note&&l.note.trim()) detail += (detail?" · ":"") + l.note.trim();
        const runSummary = l.distanceKm ? (l.elevM>0 ? `${l.distanceKm} km · ${Math.round(l.elevM)} mD+` : `${l.distanceKm} km`) : "";
        const right = p.kind==="run"&&runSummary ? `<span class="lr mono">${runSummary}</span>` : (l.done?`<span style="color:var(--teal)">${CHECK}</span>`:"");
        html += `<div class="logitem" data-edit="${ds}">
          <span class="dot" style="background:${col}"></span>
          <div class="lbody"><div class="lt">${pad(d.getMonth()+1)}/${pad(d.getDate())} (${DOW[d.getDay()]}) · ${lang()==='en'?p.en:p.jp}</div>
          <div class="ld">${detail||(l.done?'完了':'')}</div></div>${right}</div>`;
      });
      html+='</div>';
    });
    html+='</div>';
    main().innerHTML=html;
    main().querySelectorAll("[data-edit]").forEach(el=> el.onclick=()=>openEdit(el.dataset.edit));
  }

  /* ---------------- EDIT SHEET ---------------- */
  function openEdit(ds){
    const l=ensureLog(ds), p=planFor(ds), d=pdate(ds);
    let fields="";
    if(p.kind==="run"){
      fields += `<div class="row2">
        <div class="set"><label>距離 / Distance (km)</label>
          <input class="input mono" type="number" inputmode="decimal" step="0.1" id="eDist" value="${l.distanceKm||''}" placeholder="0.0"></div>
        <div class="set"><label>獲得標高 / D+ (m)</label>
          <input class="input mono" type="number" inputmode="numeric" step="10" id="eElev" value="${l.elevM||''}" placeholder="0"></div>
      </div>`;
    }
    fields += kneeEditField(l);
    fields += `<div class="set"><label>メモ / Note</label><textarea class="input" id="eNote" placeholder="体調・コース・感想など">${l.note||''}</textarea></div>`;
    fields += `<div class="btn-row" style="margin-top:8px">
        <button class="btn ${l.done?'':'btn-primary'}" id="eToggle">${l.done?'未完了に戻す':'完了にする'}</button>
        <button class="btn btn-ghost" id="eDel" style="flex:.7;color:#ff6b6b">削除</button></div>`;
    $("#sheet").innerHTML = `<div class="grab"></div>
      <h3>${pad(d.getMonth()+1)}/${pad(d.getDate())} (${DOW[d.getDay()]}) · ${p.jp}</h3>${fields}`;
    showSheet(true);
    const eD=$("#eDist"); if(eD) eD.oninput=()=>{ l.distanceKm=parseFloat(eD.value)||0; save(); };
    const eE=$("#eElev"); if(eE) eE.oninput=()=>{ l.elevM=parseInt(eE.value,10)||0; save(); };
    const eK=$("#eKnee"); if(eK) eK.onchange=()=>{ const v=eK.value; if(v==="") delete l.knee; else l.knee=parseInt(v,10); save(); };
    $("#eNote").oninput=e=>{ l.note=e.target.value; save(); };
    $("#eToggle").onclick=()=>{ l.done=!l.done; save(); showSheet(false); renderLog(); toast(l.done?'完了にしました':'未完了に戻しました'); };
    $("#eDel").onclick=()=>{ delete state.log[ds]; save(); showSheet(false); renderLog(); toast('削除しました'); };
  }
  function showSheet(on){ $("#sheet").classList.toggle("show",on); $("#sheetBg").classList.toggle("show",on); }

  /* ---------------- SETTINGS ---------------- */
  const SEG_ON = "background:var(--blaze);border-color:var(--blaze);color:#16100b";

  function raceRowsHTML(){
    const races = S().races || [];
    let rows = races.map((r,i)=>`
      <div class="racerow-edit" data-ri="${i}">
        <input class="input rname-in" data-rf="name" value="${esc(r.name)}" placeholder="レース名 / name">
        <div class="racerow-sub">
          <input class="input mono" type="date" data-rf="date" value="${r.date||''}">
          <input class="input" data-rf="note" value="${esc(r.note)}" placeholder="メモ / note">
          <button class="btn btn-sm rrm" aria-label="削除 / remove">×</button>
        </div>
      </div>`).join("");
    if(!races.length) rows = `<p class="note" style="margin:0 0 9px">レース未登録。<span style="color:var(--faint)">No races yet.</span></p>`;
    return rows + `<button class="btn btn-sm" id="raceAdd" style="width:100%;margin-top:2px">＋ レースを追加 / Add race</button>`;
  }

  function backupReminderHTML(){
    const s = S();
    if(Object.keys(state.log).length < 10) return "";
    const today = dstr();
    if(s.exportSnoozedUntil && s.exportSnoozedUntil > today) return "";
    const stale = !s.lastExportAt || (pdate(today)-pdate(s.lastExportAt))/86400000 > 30;
    if(!stale) return "";
    const jp = s.lastExportAt ? "前回の書き出しから30日以上経過しています。" : "まだ一度も書き出していません。";
    const en = s.lastExportAt ? "It’s been over 30 days since your last export." : "You haven’t exported a backup yet.";
    return `<div class="hint banner-backup">
      <div class="ht">💾 バックアップのすすめ / Backup reminder</div>
      <p>${jp}データをJSONで保存しておくと安心です。<br><span style="color:var(--faint)">${en} Export a JSON backup to be safe.</span></p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-sm" id="bkExport" style="flex:1">今すぐ書き出し / Export now</button>
        <button class="btn btn-sm btn-ghost" id="bkSnooze" style="flex:1">後で / Later</button>
      </div>
    </div>`;
  }

  function renderSettings(){
    const s=S();
    const pods = ["strengthA","strengthB","quality","long","recovery"];
    const podHtml = pods.map(t=>{
      const p = Object.values(D.plan).find(x=>x.type===t);
      return `<div class="podset"><div class="pt">${p.jp} / ${p.en}</div>
        <input class="input" data-pod="${t}" value="${(s.podcast[t]||'').replace(/"/g,'&quot;')}" placeholder="${(D.podcastDefaults[t].jp||'')}"></div>`;
    }).join("");

    main().innerHTML = `<div class="view">
      ${backupReminderHTML()}
      <div class="label" style="margin:2px 2px 12px">目標レース · Goal</div>
      <div class="set"><label>レース名 / Race</label><input class="input" id="sRaceName" value="${s.raceName.replace(/"/g,'&quot;')}"></div>
      <div class="set"><label>レース日 / Date</label><input class="input mono" type="date" id="sRaceDate" value="${s.raceDate}"></div>

      <div class="label">マイルストーンレース · Milestone races</div>
      <p class="note" style="margin:0 0 11px">CCCまでの中間レース。直近の1本が「週」タブにフェーズ表示されます。<br><span style="color:var(--faint)">Intermediate races — the next one drives the phase tag on the Week tab.</span></p>
      ${raceRowsHTML()}

      <div class="label">距離設定 · Distance</div>
      <div class="row2">
        <div class="set"><label>基準ロング距離 / Base long</label><input class="input mono" type="number" inputmode="decimal" step="0.5" id="sBase" value="${s.baseLongKm}"></div>
        <div class="set"><label>週間目標 km (0=自動)</label><input class="input mono" type="number" inputmode="decimal" step="1" id="sWeekly" value="${s.weeklyTargetKm}"></div>
      </div>
      <p class="note">次のロング走の目安 = <b>前回の +10%</b>。距離は「今日」タブまたは各記録で手入力します。</p>

      <div class="label">トレーニング負荷 · Load guardrails</div>
      <div class="set"><label>ACWR アドバイザリー / ACWR advisory</label>
        <div class="btn-row">
          <button class="btn btn-sm" data-acwr="1" style="flex:1;${s.acwrEnabled?SEG_ON:''}">ON</button>
          <button class="btn btn-sm" data-acwr="0" style="flex:1;${!s.acwrEnabled?SEG_ON:''}">OFF</button>
        </div></div>
      <div class="set"><label>リカバリー週サイクル（3週上げ → 1週下げ） / Recovery-week cycle</label>
        <div class="btn-row">
          <button class="btn btn-sm" data-cyc="1" style="flex:1;${s.cycleEnabled?SEG_ON:''}">ON</button>
          <button class="btn btn-sm" data-cyc="0" style="flex:1;${!s.cycleEnabled?SEG_ON:''}">OFF</button>
        </div></div>
      <div class="set"><label>サイクル開始日（月曜起点） / Cycle start (Mon)</label>
        <input class="input mono" type="date" id="sCycle" value="${s.cycleStartDate}"></div>
      <p class="note">これらは助言のみで、入力をブロックしません。<span style="color:var(--faint)">Advisory only — never blocks logging.</span></p>

      <div class="label">リマインダー · Reminder</div>
      <div class="set"><label>通知したい時刻 / Time</label><input class="input mono" type="time" id="sTime" value="${s.reminderTime}"></div>
      <button class="btn btn-sm" id="sNotif" style="width:100%;margin-top:0">通知を有効化 / Enable notifications</button>
      <div class="hint" style="margin-top:10px">
        <div class="ht">⏰ 定時通知について</div>
        <p>iOSのホーム画面アプリは「毎朝◯時」のような<b>予約通知をアプリ単体では送れません</b>。確実に毎朝鳴らすには、iPhoneの<b>ショートカット</b>アプリで「オートメーション → 時刻 → ${s.reminderTime} → このアプリを開く / 通知」を設定するのが一番安定します。練習予定の通知は、今お使いの<b>Googleカレンダー</b>のイベント通知でもカバーできます。</p>
      </div>

      <div class="label">表示言語 · Language</div>
      <div class="btn-row" id="langSeg">
        ${["jp","en","both"].map(v=>`<button class="btn btn-sm" data-lang="${v}" style="flex:1;${lang()===v?'background:var(--blaze);border-color:var(--blaze);color:#16100b':''}">${v==='jp'?'日本語':v==='en'?'English':'両方'}</button>`).join("")}
      </div>

      <div class="label">Podcast の一本 · per session</div>
      <p class="note" style="margin:0 0 12px">セッション種別ごとに「これを聴く」をメモできます。<br><span style="color:var(--faint)">RSSからの自動取得はGitHub Pages単体だとCORSで不安定なため、まずは手動メモ方式。フィードURLを使った自動レコメンドを足したい場合は声かけて。</span></p>
      ${podHtml}

      <div class="label">データ · Data</div>
      <div class="btn-row">
        <button class="btn btn-sm" id="sExport" style="flex:1">書き出し</button>
        <button class="btn btn-sm" id="sImport" style="flex:1">読み込み</button>
        <button class="btn btn-sm" id="sReset" style="flex:1;color:#ff6b6b">リセット</button>
      </div>
      <input type="file" id="sFile" accept="application/json" style="display:none">
      <p class="note" style="text-align:center;margin-top:18px;color:var(--faint)">CCC 2031 · ${s.raceDate} まで一歩ずつ ⛰</p>
    </div>`;

    $("#sRaceName").onchange=e=>{ s.raceName=e.target.value||"CCC"; save(); };
    $("#sRaceDate").onchange=e=>{ if(e.target.value){ s.raceDate=e.target.value; save(); } };
    $("#sBase").oninput=e=>{ s.baseLongKm=parseFloat(e.target.value)||0; save(); };
    $("#sWeekly").oninput=e=>{ s.weeklyTargetKm=parseFloat(e.target.value)||0; save(); };
    // milestone races (add / edit / remove)
    main().querySelectorAll(".racerow-edit").forEach(row=>{
      const i = parseInt(row.dataset.ri,10);
      row.querySelectorAll("[data-rf]").forEach(inp=>{
        ["input","change"].forEach(ev=> inp.addEventListener(ev, ()=>{ if(s.races[i]){ s.races[i][inp.dataset.rf]=inp.value; save(); } }));
      });
      const rm = row.querySelector(".rrm");
      if(rm) rm.onclick = ()=>{ s.races.splice(i,1); save(); renderSettings(); };
    });
    const radd=$("#raceAdd"); if(radd) radd.onclick=()=>{ s.races.push({name:"",date:"",note:""}); save(); renderSettings(); };
    // load guardrails
    main().querySelectorAll("[data-acwr]").forEach(b=> b.onclick=()=>{ s.acwrEnabled=b.dataset.acwr==="1"; save(); renderSettings(); });
    main().querySelectorAll("[data-cyc]").forEach(b=> b.onclick=()=>{ s.cycleEnabled=b.dataset.cyc==="1"; save(); renderSettings(); });
    const sCyc=$("#sCycle"); if(sCyc) sCyc.onchange=e=>{ if(e.target.value){ s.cycleStartDate=e.target.value; save(); } };
    // backup reminder banner
    const bx=$("#bkExport"); if(bx) bx.onclick=()=>{ exportData(); renderSettings(); };
    const bs=$("#bkSnooze"); if(bs) bs.onclick=()=>{ s.exportSnoozedUntil=dstr(addDays(pdate(dstr()),7)); save(); renderSettings(); };
    $("#sTime").onchange=e=>{ s.reminderTime=e.target.value; save(); };
    $("#sNotif").onclick=enableNotif;
    main().querySelectorAll("[data-lang]").forEach(b=> b.onclick=()=>{ s.lang=b.dataset.lang; save(); renderSettings(); });
    main().querySelectorAll("[data-pod]").forEach(inp=> inp.oninput=()=>{ s.podcast[inp.dataset.pod]=inp.value; save(); });
    $("#sExport").onclick=exportData;
    $("#sImport").onclick=()=>$("#sFile").click();
    $("#sFile").onchange=importData;
    $("#sReset").onclick=()=>{ if(confirm("すべての記録と設定を消去します。よろしいですか？")){ state=defaults(); save(); selDate=dstr(); toast("リセットしました"); go("today"); } };
  }

  async function enableNotif(){
    if(!("Notification" in window)){ toast("この環境は通知に未対応", false); return; }
    try{
      const p = await Notification.requestPermission();
      if(p==="granted"){ toast("通知を許可しました"); try{ new Notification("CCC 2031", {body:"通知の準備ができました ⛰", icon:"icon-192.png"}); }catch(e){} }
      else toast("通知は許可されませんでした", false);
    }catch(e){ toast("通知の有効化に失敗", false); }
  }
  function exportData(){
    S().lastExportAt = dstr(); save();   // record for the backup-reminder banner
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download=`ccc2031-${dstr()}.json`; a.click(); URL.revokeObjectURL(a.href); toast("書き出しました");
  }
  function importData(e){
    const f=e.target.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{ try{ const o=JSON.parse(rd.result); if(!o.log) throw 0;
      state=o; state.settings=Object.assign(defaults().settings, state.settings||{}); save(); toast("読み込みました"); go("today");
    }catch(err){ toast("ファイルを読めませんでした", false); } };
    rd.readAsText(f);
  }

  /* ============================================================
     ROUTER + INIT
     ============================================================ */
  function go(t){
    tab=t; kneePending=null;
    document.querySelectorAll("nav.tabbar .tab").forEach(el=>el.classList.toggle("active", el.dataset.tab===t));
    if(t==="today"){ selDate=dstr(); renderToday(); }
    else if(t==="week") renderWeek();
    else if(t==="log") renderLog();
    else if(t==="settings") renderSettings();
    main().scrollTop=0; window.scrollTo(0,0);
  }
  // header countdown
  function paintHeader(){
    const days=Math.max(0, Math.ceil((pdate(S().raceDate)-new Date())/86400000));
    $("#cdN").textContent=days; $("#cdU").textContent=`days → ${S().raceName}`;
  }

  document.querySelectorAll("nav.tabbar .tab").forEach(el=> el.onclick=()=>go(el.dataset.tab));
  $("#sheetBg").onclick=()=>showSheet(false);
  // delegated goto from week plan list
  document.addEventListener("click", e=>{
    const g=e.target.closest("[data-goto]"); if(g){ selDate=g.dataset.goto; go("today"); }
  });

  paintHeader();
  go("today");

  /* Test hook — pure helpers + a few accessors for the jsdom smoke tests.
     Side-effect-free and harmless in the browser. */
  window.CCC_TEST = {
    migrate, acwr, chronicWeeklyKm, rolling7Km, weekElev,
    recoveryWeekIndex, isRecoveryWeek, nextRace, phaseFor, longTargetFor,
    ensureLog, go, renderToday, renderWeek, renderLog, renderSettings,
    dstr, pdate, addDays, mondayOf, KEY,
    getState: () => state,
    selDate: ds => { if(ds!==undefined) selDate = ds; return selDate; }
  };

  // service worker + update toast
  if("serviceWorker" in navigator){
    let updating = false;   // only reload when the user opts in (no reload loops)
    navigator.serviceWorker.addEventListener("controllerchange", ()=>{
      if(!updating) return; updating=false; window.location.reload();
    });
    const showUpdate = worker => {
      if(!worker) return;
      const t=$("#toast"); clearTimeout(toastT);
      t.innerHTML='<span class="tdot"></span>新しいバージョン — タップで更新 / Update available — tap to reload';
      t.classList.add("show","tappable");
      t.onclick=()=>{ updating=true; t.classList.remove("show","tappable"); t.onclick=null; worker.postMessage({type:"SKIP_WAITING"}); };
    };
    window.addEventListener("load", ()=>{
      navigator.serviceWorker.register("./sw.js").then(reg=>{
        if(reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
        reg.addEventListener("updatefound", ()=>{
          const nw=reg.installing; if(!nw) return;
          nw.addEventListener("statechange", ()=>{
            if(nw.state==="installed" && navigator.serviceWorker.controller) showUpdate(reg.waiting||nw);
          });
        });
      }).catch(()=>{});
    });
  }
})();
