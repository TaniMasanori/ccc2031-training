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
    return { version:1, log:{}, settings:{
      baseLongKm:20, weeklyTargetKm:0,
      raceDate:D.raceDate, raceName:D.raceName.jp,
      reminderTime:"06:30", lang:"both", podcast:{}
    }};
  }
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY)) || defaults(); }
  catch(e){ state = defaults(); }
  state.settings = Object.assign(defaults().settings, state.settings || {});
  const save = () => localStorage.setItem(KEY, JSON.stringify(state));
  const S = () => state.settings;
  const lang = () => S().lang;

  let selDate = dstr();        // currently viewed date on Today tab
  let tab = "today";

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

  /* ---------- small UI utils ---------- */
  let toastT;
  function toast(msg, dot=true){
    const t = $("#toast"); t.innerHTML = (dot?'<span class="tdot"></span>':'') + msg;
    t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(()=>t.classList.remove("show"), 1900);
  }
  const CHECK = '<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>';

  function ringSVG(pct, size=86){
    const r=(size-12)/2, c=2*Math.PI*r, off=c*(1-Math.max(0,Math.min(1,pct)));
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="var(--surface-3)" stroke-width="8" fill="none"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="var(--blaze)" stroke-width="8" fill="none"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        transform="rotate(-90 ${size/2} ${size/2})" style="transition:stroke-dashoffset .7s var(--ease)"/>
    </svg>`;
  }

  function barsSVG(weeks, target){
    const W=336,H=158,top=16,bot=26,L=6,R=6, n=weeks.length;
    const plotH=H-top-bot;
    const max=Math.max(target||0, ...weeks.map(w=>w.km), 1);
    const sc=plotH/(max*1.18);
    const slot=(W-L-R)/n, barW=Math.min(26, slot*0.56);
    let bars="";
    weeks.forEach((w,i)=>{
      const cx=L+slot*i+slot/2, h=Math.max(w.km*sc, w.km>0?3:0), y=top+plotH-h;
      const col=w.cur ? "var(--blaze)" : "rgba(255,106,43,.32)";
      bars += `<rect x="${(cx-barW/2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${col}"/>`;
      if(w.km>0) bars += `<text class="bar-val" x="${cx.toFixed(1)}" y="${(y-5).toFixed(1)}" text-anchor="middle">${w.km}</text>`;
      bars += `<text class="bar-lab" x="${cx.toFixed(1)}" y="${(H-9).toFixed(1)}" text-anchor="middle">${w.label}</text>`;
    });
    let tl="";
    if(target>0){
      const ty=top+plotH-target*sc;
      tl = `<line x1="${L}" y1="${ty.toFixed(1)}" x2="${W-R}" y2="${ty.toFixed(1)}" stroke="var(--teal)" stroke-width="1.2" stroke-dasharray="3 4" opacity=".8"/>`
         + `<text class="bar-val" x="${W-R}" y="${(ty-4).toFixed(1)}" text-anchor="end" fill="var(--teal)">目標 ${r1(target)}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${tl}${bars}</svg>`;
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
        inner += `<div class="ex ${on?'on':''}" data-ex="${id}">
          <div class="check">${CHECK}</div>
          <div class="body"><div class="name">${nm}</div><div class="cue">${cue}</div></div>
          <div class="dose mono">${ex.dose}</div></div>`;
      });
      inner += '</div>';
    } else if(p.kind==="run"){
      const val = l && l.distanceKm ? l.distanceKm : "";
      inner += `<div class="distrow"><div class="field">
          <input type="number" inputmode="decimal" step="0.1" min="0" id="distIn" placeholder="0.0" value="${val}">
          <span class="unit">km</span></div></div>`;
      if(p.isLong){
        inner += `<div class="target"><span class="tlabel">今日の目安（前回ロング +10%）<br><span class="label" style="display:inline">Long target · +10%</span></span><b class="mono">${nextLongTarget()} km</b></div>`;
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

    main().innerHTML = `<div class="view">${dayStrip()}${body}</div>`;
    bindToday();
  }
  function CHECK_DONE_LABEL(kind){ return '完了済み ✓ / Done — tap to undo'; }

  function bindToday(){
    main().querySelectorAll(".daystrip .d").forEach(el=>{
      el.onclick = () => { selDate = el.dataset.d; renderToday(); };
    });
    main().querySelectorAll(".ex").forEach(el=>{
      el.onclick = () => {
        const id = el.dataset.ex, l = ensureLog(selDate);
        l.items[id] = !l.items[id];
        el.classList.toggle("on", l.items[id]);
        // auto-complete when all checked
        const p = planFor(selDate);
        const all = p.exercises.every(x=>l.items[x]);
        if(all && !l.done){ l.done=true; toast("筋トレ完了！"); refreshActionBtn(); refreshStripDot(); }
        else if(!all && l.done){ l.done=false; refreshActionBtn(); refreshStripDot(); }
        save();
      };
    });
    const dist = $("#distIn");
    if(dist) dist.oninput = () => { const l=ensureLog(selDate); l.distanceKm = parseFloat(dist.value)||0; save(); };
    const cb = $("#completeBtn");
    if(cb) cb.onclick = () => {
      const l = ensureLog(selDate); l.done = !l.done;
      if(l.done){
        const p=planFor(selDate);
        if(p.kind==="run" && l.distanceKm>0) toast(`記録: ${l.distanceKm} km`);
        else toast("完了！");
      }
      save(); refreshActionBtn(); refreshStripDot();
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
    const sess = weekSessions(mon), km = weekDistance(mon);
    const pct = sess.planned ? sess.done/sess.planned : 0;

    // 8-week distance series
    const weeks=[];
    const curMonStart = mondayOf(new Date());
    for(let i=7;i>=0;i--){
      const m = addDays(curMonStart, -7*i);
      weeks.push({ label:`${m.getMonth()+1}/${m.getDate()}`, km: weekDistance(m), cur:i===0 });
    }
    // target line: explicit weekly target, else last nonzero week +10%
    let target = S().weeklyTargetKm;
    if(!target){
      for(let i=weeks.length-2;i>=0;i--){ if(weeks[i].km>0){ target=r1(weeks[i].km*1.10); break; } }
    }

    // countdown
    const days = Math.max(0, Math.ceil((pdate(S().raceDate)-new Date())/86400000));

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
        <div class="stat"><div class="v mono">${nextLongTarget()}<small> km</small></div><div class="k">次ロング target</div></div>
        <div class="stat"><div class="v mono">${days}</div><div class="k">${S().raceName} まで</div></div>
      </div>

      <div class="card">
        <div class="charttitle"><div class="label">週間距離 · last 8 weeks</div></div>
        <div class="chart">${barsSVG(weeks, target)}</div>
        <div class="legend">
          <span><i style="background:var(--blaze)"></i>今週</span>
          <span><i style="background:rgba(255,106,43,.32)"></i>過去</span>
          ${target?'<span><i style="background:var(--teal)"></i>目標 (+10%)</span>':''}
        </div>
      </div>

      <div class="card">
        <div class="label" style="margin-bottom:12px">今週の予定 · This week</div>
        ${weekPlanList(mon)}
      </div>
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
        if(l.note&&l.note.trim()) detail += (detail?" · ":"") + l.note.trim();
        const right = p.kind==="run"&&l.distanceKm ? `<span class="lr mono">${l.distanceKm} km</span>` : (l.done?`<span style="color:var(--teal)">${CHECK}</span>`:"");
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
      fields += `<div class="set"><label>距離 / Distance (km)</label>
        <input class="input mono" type="number" inputmode="decimal" step="0.1" id="eDist" value="${l.distanceKm||''}" placeholder="0.0"></div>`;
    }
    fields += `<div class="set"><label>メモ / Note</label><textarea class="input" id="eNote" placeholder="体調・コース・感想など">${l.note||''}</textarea></div>`;
    fields += `<div class="btn-row" style="margin-top:8px">
        <button class="btn ${l.done?'':'btn-primary'}" id="eToggle">${l.done?'未完了に戻す':'完了にする'}</button>
        <button class="btn btn-ghost" id="eDel" style="flex:.7;color:#ff6b6b">削除</button></div>`;
    $("#sheet").innerHTML = `<div class="grab"></div>
      <h3>${pad(d.getMonth()+1)}/${pad(d.getDate())} (${DOW[d.getDay()]}) · ${p.jp}</h3>${fields}`;
    showSheet(true);
    const eD=$("#eDist"); if(eD) eD.oninput=()=>{ l.distanceKm=parseFloat(eD.value)||0; save(); };
    $("#eNote").oninput=e=>{ l.note=e.target.value; save(); };
    $("#eToggle").onclick=()=>{ l.done=!l.done; save(); showSheet(false); renderLog(); toast(l.done?'完了にしました':'未完了に戻しました'); };
    $("#eDel").onclick=()=>{ delete state.log[ds]; save(); showSheet(false); renderLog(); toast('削除しました'); };
  }
  function showSheet(on){ $("#sheet").classList.toggle("show",on); $("#sheetBg").classList.toggle("show",on); }

  /* ---------------- SETTINGS ---------------- */
  function renderSettings(){
    const s=S();
    const pods = ["strengthA","strengthB","quality","long","recovery"];
    const podHtml = pods.map(t=>{
      const p = Object.values(D.plan).find(x=>x.type===t);
      return `<div class="podset"><div class="pt">${p.jp} / ${p.en}</div>
        <input class="input" data-pod="${t}" value="${(s.podcast[t]||'').replace(/"/g,'&quot;')}" placeholder="${(D.podcastDefaults[t].jp||'')}"></div>`;
    }).join("");

    main().innerHTML = `<div class="view">
      <div class="label" style="margin:2px 2px 12px">目標レース · Goal</div>
      <div class="set"><label>レース名 / Race</label><input class="input" id="sRaceName" value="${s.raceName.replace(/"/g,'&quot;')}"></div>
      <div class="set"><label>レース日 / Date</label><input class="input mono" type="date" id="sRaceDate" value="${s.raceDate}"></div>

      <div class="label">距離設定 · Distance</div>
      <div class="row2">
        <div class="set"><label>基準ロング距離 / Base long</label><input class="input mono" type="number" inputmode="decimal" step="0.5" id="sBase" value="${s.baseLongKm}"></div>
        <div class="set"><label>週間目標 km (0=自動)</label><input class="input mono" type="number" inputmode="decimal" step="1" id="sWeekly" value="${s.weeklyTargetKm}"></div>
      </div>
      <p class="note">次のロング走の目安 = <b>前回の +10%</b>。距離は「今日」タブまたは各記録で手入力します。</p>

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
    tab=t;
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

  // service worker
  if("serviceWorker" in navigator){
    window.addEventListener("load", ()=> navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  }
})();
