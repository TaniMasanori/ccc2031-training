/* ===========================================================
   CCC 2031 — default training data (bilingual JP / EN)
   Editable in-app; this file only seeds first-run defaults.
   =========================================================== */
window.CCC_DATA = {
  /* Goal race — counts down on the Week tab. Editable in Settings. */
  raceName: { jp: "UTMB CCC", en: "UTMB CCC" },
  raceDate: "2031-08-29",

  /* Milestone races on the way to CCC — seeds settings.races (editable in Settings).
     The Week tab shows the next upcoming one + a training-phase tag. */
  races: [
    { name: "Boulder Rez Marathon", date: "2026-08-15", note: "controlled effort" },
    { name: "Black Squirrel Half",  date: "2026-09-12", note: "dress rehearsal" },
    { name: "Bear Chase 50K",       date: "2026-10-03", note: "A-race" }
  ],

  /* Exercise library, keyed by id. dose = sets×reps/hold. */
  exercises: {
    // --- Strength A : knee + eccentric focus ---
    ea1: { jp: "ゴブレットスクワット", en: "Goblet Squat", dose: "3 × 10",
           cue: { jp: "3秒かけて下ろす（伸張性）", en: "Lower over 3s (eccentric)" } },
    ea2: { jp: "リバースランジ", en: "Reverse Lunge", dose: "3 × 8 / 側",
           cue: { jp: "膝はつま先方向、前に出しすぎない", en: "Knee tracks over toes" } },
    ea3: { jp: "ステップアップ（ゆっくり下降）", en: "Step-up (slow eccentric)", dose: "3 × 8 / 側",
           cue: { jp: "下りを3秒で制御", en: "Control the descent over 3s" } },
    ea4: { jp: "スパニッシュスクワット", en: "Spanish Squat", dose: "3 × 30–45s",
           cue: { jp: "等尺性キープ・腱に効かせる", en: "Isometric hold, loads the tendon" } },
    ea5: { jp: "片足カーフレイズ", en: "Single-leg Calf Raise", dose: "3 × 12 / 側",
           cue: { jp: "可動域いっぱいまで", en: "Full range of motion" } },
    ea6: { jp: "偏心ヒールドロップ", en: "Eccentric Heel Drop", dose: "3 × 15 / 側",
           cue: { jp: "段差で踵をゆっくり下げる", en: "Slow heel drop off a step" } },
    // --- Strength B : posterior chain + hips + core ---
    eb1: { jp: "ルーマニアンデッドリフト", en: "Romanian Deadlift", dose: "3 × 10",
           cue: { jp: "ヒンジ動作・背中はまっすぐ", en: "Hip hinge, keep a flat back" } },
    eb2: { jp: "グルートブリッジ", en: "Glute Bridge", dose: "3 × 12",
           cue: { jp: "上で1秒静止", en: "1s squeeze at the top" } },
    eb3: { jp: "クラムシェル / サイドバンドウォーク", en: "Clamshell / Side Band Walk", dose: "3 × 15",
           cue: { jp: "中臀筋を意識", en: "Target the glute medius" } },
    eb4: { jp: "サイドプランク", en: "Side Plank", dose: "3 × 30s / 側",
           cue: { jp: "腰を落とさない", en: "Keep hips high" } },
    eb5: { jp: "バードドッグ", en: "Bird Dog", dose: "3 × 10 / 側",
           cue: { jp: "体幹をぶらさない", en: "No trunk rotation" } },
    eb6: { jp: "コペンハーゲンプランク", en: "Copenhagen Plank", dose: "3 × 20s / 側",
           cue: { jp: "内転筋・無理なくスケール", en: "Adductors — scale as needed" } }
  },

  /* Weekly template, indexed by JS getDay() : 0=Sun … 6=Sat.
     kind: strength | run | rest.  type = stable key used in the log. */
  plan: {
    0: { type: "recovery",  kind: "run",      jp: "リカバリージョグ", en: "Recovery Jog",
         theme: { jp: "回復",         en: "Recovery" } },
    1: { type: "strengthA", kind: "strength", jp: "筋トレ A",        en: "Strength A",
         theme: { jp: "膝・伸張性",   en: "Knee · Eccentric" }, exercises: ["ea1","ea2","ea3","ea4","ea5","ea6"] },
    2: { type: "rest",      kind: "rest",     jp: "休息・モビリティ", en: "Rest · Mobility",
         theme: { jp: "オフ",         en: "Off" } },
    3: { type: "quality",   kind: "run",      jp: "質・坂セッション", en: "Quality · Hills",
         theme: { jp: "強度",         en: "Intensity" } },
    4: { type: "strengthB", kind: "strength", jp: "筋トレ B",        en: "Strength B",
         theme: { jp: "後鎖・股関節・体幹", en: "Posterior · Hips · Core" }, exercises: ["eb1","eb2","eb3","eb4","eb5","eb6"] },
    5: { type: "long",      kind: "run",      jp: "ロング走",        en: "Long Run",
         theme: { jp: "持久・距離",   en: "Endurance · Distance" }, isLong: true },
    6: { type: "rest",      kind: "rest",     jp: "家族・休息",      en: "Family · Rest",
         theme: { jp: "オフ",         en: "Off" } }
  },

  /* Daily-brief integration (ブリーフ tab).
     baseUrl hosts this repo's brief/ pipeline output on GitHub Pages: the
     encrypted podcast audio + brief.enc, an AES-256-GCM-encrypted newsletter
     bundle. The decryption key is entered once in Settings (never committed
     here). vapidPublicKey pairs with the VAPID_PRIVATE_KEY secret in this
     repo, whose daily-brief workflow sends the morning Web Push. */
  brief: {
    baseUrl: "https://tanimasanori.github.io/ccc2031-training/brief/docs",
    vapidPublicKey: "BNhfmMJZjGIZ7HjhjOpCUtOLEF0rS4LlAYGxhmXvi-hUwGPHM2vTTeWeHR1wp9e0bh7hTBDcRFJJYI4ZzGEyz28"
  },

  /* Default podcast hint per session type (editable in Settings). */
  podcastDefaults: {
    strengthA: { jp: "短め・情報系の回（聴き流しに）", en: "A short, info-style episode" },
    strengthB: { jp: "短め・情報系の回（聴き流しに）", en: "A short, info-style episode" },
    quality:   { jp: "テンポ高めの回", en: "An upbeat episode to match the effort" },
    long:      { jp: "長尺の対談・ストーリー系", en: "A long-form interview or story" },
    recovery:  { jp: "軽いトーク回", en: "A light, easy talk episode" },
    rest:      { jp: "", en: "" }
  }
};
