// ====================================================================
// WG Board - App Logic
// ====================================================================

const LS = {
  wgId: "wgb_wgId",
  wgCode: "wgb_wgCode",
  wgName: "wgb_wgName",
  memberId: "wgb_memberId",
};

let sb = null;
let state = {
  wg: null,
  members: [],
  tasks: [],
  completions: [],
  taskAssignments: [], // { task_id, week_start, member_id } - wer eine rotierende Aufgabe in welcher Woche macht
  teams: [], // { id, wg_id, name }
  teamMembers: [], // { team_id, member_id, quota_percent, points } - Mitgliedschaft + Soll-Anteil + Team-Punkte
  me: null,
  homeFilter: "all",
};

// ---------------- INIT ----------------

function initSupabase() {
  if (!window.SUPABASE_URL || window.SUPABASE_URL.includes("DEIN-PROJEKT")) {
    showToast("⚠️ Bitte zuerst config.js mit deinen Supabase-Daten ausfüllen.");
    return false;
  }
  sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  return true;
}

async function boot() {
  if (!initSupabase()) return;

  const wgId = localStorage.getItem(LS.wgId);
  if (!wgId) {
    showScreen("onboarding");
    return;
  }

  state.wg = {
    id: wgId,
    code: localStorage.getItem(LS.wgCode),
    name: localStorage.getItem(LS.wgName),
  };

  await loadData();

  const memberId = localStorage.getItem(LS.memberId);
  const meStillExists = state.members.find((m) => m.id === memberId);

  if (meStillExists) {
    state.me = meStillExists;
    enterApp();
  } else {
    renderProfilePicker();
    showScreen("pickProfile");
  }

  subscribeRealtime();
}

function showScreen(name) {
  document.getElementById("onboarding").classList.remove("show");
  document.getElementById("pickProfile").classList.remove("show");
  document.getElementById("app").classList.remove("show");
  if (name === "onboarding") document.getElementById("onboarding").classList.add("show");
  if (name === "pickProfile") document.getElementById("pickProfile").classList.add("show");
  if (name === "app") document.getElementById("app").classList.add("show");
}

function enterApp() {
  document.getElementById("wgNameLabel").textContent = state.wg.name || "WG";
  document.getElementById("meLabel").textContent = state.me ? "👤 " + state.me.name : "";
  document.getElementById("wgCodeBox").textContent = state.wg.code;
  showScreen("app");
  renderAll();
}

// ---------------- DATA LOADING ----------------

async function loadData() {
  const [membersRes, tasksRes, teamsRes] = await Promise.all([
    sb.from("members").select("*").eq("wg_id", state.wg.id).order("created_at"),
    sb.from("tasks").select("*").eq("wg_id", state.wg.id).order("created_at"),
    sb.from("teams").select("*").eq("wg_id", state.wg.id).order("created_at"),
  ]);
  state.members = membersRes.data || [];
  state.tasks = tasksRes.data || [];
  state.teams = teamsRes.data || [];

  // Verlauf (completions) und Wochen-Zuteilungen (task_assignments) haben
  // keine eigene wg_id-Spalte, daher über die Aufgaben-IDs dieser WG filtern.
  const taskIds = state.tasks.map((t) => t.id);
  if (taskIds.length > 0) {
    const [completionsRes, assignmentsRes] = await Promise.all([
      sb.from("completions").select("*").in("task_id", taskIds).order("completed_at", { ascending: false }),
      sb.from("task_assignments").select("*").in("task_id", taskIds),
    ]);
    state.completions = completionsRes.data || [];
    state.taskAssignments = assignmentsRes.data || [];
  } else {
    state.completions = [];
    state.taskAssignments = [];
  }

  const teamIds = state.teams.map((t) => t.id);
  if (teamIds.length > 0) {
    const tmRes = await sb.from("team_members").select("*").in("team_id", teamIds);
    state.teamMembers = tmRes.data || [];
  } else {
    state.teamMembers = [];
  }
}

function subscribeRealtime() {
  sb.channel("wg_" + state.wg.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: "wg_id=eq." + state.wg.id }, onRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: "wg_id=eq." + state.wg.id }, onRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "teams", filter: "wg_id=eq." + state.wg.id }, onRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, onRemoteChange)
    .subscribe();
}

async function onRemoteChange() {
  await loadData();
  const meRefresh = state.members.find((m) => m.id === (state.me && state.me.id));
  if (meRefresh) state.me = meRefresh;
  await renderAll();
}

// ---------------- ONBOARDING ----------------

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function createWg() {
  const name = document.getElementById("newWgName").value.trim();
  if (!name) return setOnboardError("Bitte einen WG-Namen eingeben.");
  const code = randomCode();

  const { data, error } = await sb.from("wgs").insert({ name, code }).select().single();
  if (error) return setOnboardError("Fehler beim Erstellen: " + error.message);

  persistWg(data);
  state.members = [];
  state.tasks = [];
  renderProfilePicker();
  showScreen("pickProfile");
}

async function joinWg() {
  const code = document.getElementById("joinCode").value.trim().toUpperCase();
  if (!code) return setOnboardError("Bitte einen Code eingeben.");

  const { data, error } = await sb.from("wgs").select("*").eq("code", code).maybeSingle();
  if (error || !data) return setOnboardError("Diese WG wurde nicht gefunden. Code prüfen.");

  persistWg(data);
  await loadData();
  renderProfilePicker();
  showScreen("pickProfile");
}

function persistWg(wgRow) {
  state.wg = wgRow;
  localStorage.setItem(LS.wgId, wgRow.id);
  localStorage.setItem(LS.wgCode, wgRow.code);
  localStorage.setItem(LS.wgName, wgRow.name);
  setOnboardError("");
}

function setOnboardError(msg) {
  document.getElementById("onboardError").textContent = msg;
}

// ---------------- PROFILE PICKER ----------------

function renderProfilePicker() {
  const list = document.getElementById("profileList");
  list.innerHTML = "";
  state.members.forEach((m) => {
    const el = document.createElement("div");
    el.className = "profile-pill";
    el.innerHTML = `<div class="profile-pill-left"><div class="avatar">${initials(m.name)}</div>${escapeHtml(m.name)}</div><span>›</span>`;
    el.onclick = () => selectProfile(m);
    list.appendChild(el);
  });
}

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function selectProfile(member) {
  state.me = member;
  localStorage.setItem(LS.memberId, member.id);
  enterApp();
}

async function addMemberOnboard() {
  const name = document.getElementById("newMemberName").value.trim();
  if (!name) return;
  const { data, error } = await sb
    .from("members")
    .insert({ wg_id: state.wg.id, name, quota_percent: 100, points: 0 })
    .select()
    .single();
  if (error) return showToast("Fehler: " + error.message);
  state.members.push(data);
  document.getElementById("newMemberName").value = "";
  selectProfile(data);
}

// ---------------- RENDER: HOME ----------------

async function renderAll() {
  await planWeek(getWeekStart(new Date()));
  renderLeaderboard();
  renderTeamBoards();
  renderFilterRow();
  renderHomeTaskList();
  renderTasksView();
  renderHistory();
  renderSettingsMembers();
  renderTeamsSettings();
  document.getElementById("wgCodeBox").textContent = state.wg.code;
  document.getElementById("wgNameLabel").textContent = state.wg.name;
  document.getElementById("meLabel").textContent = state.me ? "👤 " + state.me.name : "";
}

// Kombinierter Soll-Anteil einer Person: einfacher Durchschnitt ihrer
// Quoten über alle Teams, in denen sie Mitglied ist. null = in keinem Team.
function combinedQuotaForMember(memberId) {
  const rows = state.teamMembers.filter((tm) => tm.member_id === memberId);
  if (rows.length === 0) return null;
  return rows.reduce((s, r) => s + Number(r.quota_percent), 0) / rows.length;
}

function renderLeaderboard() {
  const el = document.getElementById("leaderboard");
  el.innerHTML = "";
  if (state.members.length === 0) {
    el.innerHTML = '<p class="empty-state">Noch keine WG-Mitglieder. Füge sie in den Einstellungen hinzu.</p>';
    return;
  }

  const sorted = [...state.members].sort((a, b) => a.points - b.points);
  const maxPoints = Math.max(1, ...state.members.map((m) => m.points));
  const minPoints = Math.min(...state.members.map((m) => m.points));
  const totalPoints = state.members.reduce((s, m) => s + m.points, 0);

  sorted.forEach((m) => {
    const row = document.createElement("div");
    row.className = "member-row" + (m.points === minPoints ? " low-rank" : "");
    const pct = Math.round((m.points / maxPoints) * 100);
    const actualShare = totalPoints > 0 ? (m.points / totalPoints) * 100 : 0;
    const targetPct = combinedQuotaForMember(m.id); // kombiniert über alle Teams dieser Person, oder null

    row.innerHTML = `
      <div class="member-row-top">
        <div class="member-name">${escapeHtml(m.name)} ${m.points === minPoints ? '<span class="member-badge">hinten</span>' : ""}</div>
        <div class="member-points"><b>${m.points}</b> Punkte</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:0%" data-target="${pct}"></div></div>
      <div class="share-track">
        <div class="share-fill" style="width:0%" data-target="${actualShare}"></div>
        ${targetPct !== null ? `<div class="share-target-marker" style="left:${Math.min(99, targetPct)}%"></div>` : ""}
      </div>
      <div class="share-label"><span>Ist-Anteil: ${Math.round(actualShare)}%</span><span>Soll: ${targetPct !== null ? Math.round(targetPct) + "%" : "– (kein Team)"}</span></div>
    `;
    el.appendChild(row);
  });

  requestAnimationFrame(() => {
    el.querySelectorAll(".bar-fill").forEach((bar) => {
      bar.style.width = bar.dataset.target + "%";
    });
    el.querySelectorAll(".share-fill").forEach((bar) => {
      bar.style.width = bar.dataset.target + "%";
    });
  });
}

// Einfaches, zusätzliches Balkendiagramm pro Team (Punkte je Mitglied
// innerhalb dieses Teams) - nur Teams mit Mitgliedern werden angezeigt.
function renderTeamBoards() {
  const el = document.getElementById("teamBoards");
  if (!el) return;
  el.innerHTML = "";
  state.teams.forEach((team) => {
    const rows = state.teamMembers.filter((tm) => tm.team_id === team.id);
    if (rows.length === 0) return;
    const maxPts = Math.max(1, ...rows.map((r) => Number(r.points)));
    const card = document.createElement("div");
    card.className = "team-board-card";
    const rowsHtml = rows
      .map((r) => {
        const pct = Math.round((Number(r.points) / maxPts) * 100);
        return `
          <div class="team-board-row">
            <span class="team-board-name">${escapeHtml(memberName(r.member_id))}</span>
            <span class="team-board-pts">${r.points} P. <small>(Soll ${Math.round(Number(r.quota_percent))}%)</small></span>
          </div>
          <div class="bar-track small"><div class="bar-fill" style="width:${pct}%"></div></div>
        `;
      })
      .join("");
    card.innerHTML = `<div class="team-board-title">${escapeHtml(team.name)}</div>${rowsHtml}`;
    el.appendChild(card);
  });
}

function renderFilterRow() {
  const row = document.getElementById("filterRow");
  row.innerHTML = '<button class="chip' + (state.homeFilter === "all" ? " active" : "") + '" data-filter="all">Alle</button>';
  state.members.forEach((m) => {
    const b = document.createElement("button");
    b.className = "chip" + (state.homeFilter === m.id ? " active" : "");
    b.dataset.filter = m.id;
    b.textContent = m.name;
    row.appendChild(b);
  });
  row.querySelectorAll(".chip").forEach((chip) => {
    chip.onclick = () => {
      state.homeFilter = chip.dataset.filter;
      renderFilterRow();
      renderHomeTaskList();
    };
  });
}

function taskUrgency(task) {
  const lastDone = new Date(task.last_done_at).getTime();
  const cycleMs = task.cycle_days * 86400000;
  const dueAt = lastDone + cycleMs;
  const remainingMs = dueAt - Date.now();
  const remainingDays = remainingMs / 86400000;
  const fractionRemaining = Math.max(0, Math.min(1, remainingMs / cycleMs));
  return { remainingMs, remainingDays, fractionRemaining, cycleMs, dueDate: new Date(dueAt) };
}

function urgencyColor(remainingDays, overdue) {
  if (overdue) return "var(--danger)";
  const d = Math.round(remainingDays);
  if (d <= 1) return "var(--danger)"; // heute fällig oder noch 1 Tag
  if (d <= 2) return "var(--warn)"; // noch 2 Tage
  return "var(--ok)";
}

function urgencyLabel(u) {
  if (u.remainingMs < 0) {
    const daysOver = Math.round(-u.remainingDays);
    return `Überfällig seit ${daysOver} Tag${daysOver === 1 ? "" : "en"}`;
  }
  const d = Math.round(u.remainingDays);
  if (d === 0) return "Heute fällig";
  // Innerhalb der laufenden Kalenderwoche: nur der Wochentag.
  // Weiter weg: Datum + Wochentag.
  const weekEnd = getWeekEnd(getWeekStart(new Date()));
  if (u.dueDate < weekEnd) {
    return "Fällig: " + u.dueDate.toLocaleDateString("de-DE", { weekday: "long" });
  }
  return "Fällig: " + u.dueDate.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "short" });
}

// ---------------- WOCHENPLAN / ROTATION ----------------

const DAY_MS = 86400000;

// Montag 00:00 der Woche, in der "date" liegt.
function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sonntag ... 6 = Samstag
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 7);
  return d;
}

function getMonthStart(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function pointsEarnedInRange(memberId, start, end) {
  return state.completions
    .filter((c) => c.member_id === memberId && new Date(c.completed_at) >= start && new Date(c.completed_at) < end)
    .reduce((s, c) => s + c.points, 0);
}

// Letzter Zeitpunkt, an dem "memberId" genau diese Aufgabe erledigt hat (oder -Infinity, falls nie).
function lastCompletedTaskAt(taskId, memberId) {
  let last = -Infinity;
  state.completions.forEach((c) => {
    if (c.task_id === taskId && c.member_id === memberId) {
      const t = new Date(c.completed_at).getTime();
      if (t > last) last = t;
    }
  });
  return last;
}

// Wer diese Aufgabe in einem gegebenen Wochenfenster [start, end) erledigt hat
// (die zuletzt erledigende Person in diesem Fenster, falls mehrere).
function memberWhoCompletedInRange(taskId, start, end) {
  const matches = state.completions
    .filter((c) => c.task_id === taskId && new Date(c.completed_at) >= start && new Date(c.completed_at) < end)
    .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
  return matches.length ? matches[0].member_id : null;
}

// Falls dieselbe Person diese Aufgabe die letzten 2 Kalenderwochen in Folge
// erledigt hat, muss diese Woche zwingend jemand anderes ran.
function mustRotateAwayFrom(taskId, thisWeekStart) {
  const week1Start = new Date(thisWeekStart);
  week1Start.setDate(week1Start.getDate() - 7);
  const week2Start = new Date(week1Start);
  week2Start.setDate(week2Start.getDate() - 7);

  const lastWeekMember = memberWhoCompletedInRange(taskId, week1Start, thisWeekStart);
  const weekBeforeMember = memberWhoCompletedInRange(taskId, week2Start, week1Start);
  if (lastWeekMember && lastWeekMember === weekBeforeMember) {
    return lastWeekMember;
  }
  return null;
}

// Datum als "YYYY-MM-DD" in LOKALER Zeit (nicht toISOString(), das würde bei
// Zeitzonen wie UTC+1 auf den falschen Kalendertag verschieben).
function isoDateOnly(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Zuteilung für eine bestimmte Kalenderwoche nachschlagen.
function assignmentFor(taskId, weekStartStr) {
  const row = state.taskAssignments.find((a) => a.task_id === taskId && a.week_start === weekStartStr);
  return row ? row.member_id : null;
}

// Ein "Fairness-Kontext" ist entweder ein bestimmtes Team (oder eine feste
// Kombination mehrerer Teams), oder - wenn eine Aufgabe auf kein Team
// eingeschränkt ist - "__all__" (teamübergreifend, alle Mitglieder).
function scopeKeyForTask(task) {
  if (task.team_ids && task.team_ids.length) {
    return [...task.team_ids].sort().join(",");
  }
  return "__all__";
}

// Alle Mitglieder, die zu diesem Fairness-Kontext gehören.
function poolForScope(scopeKey) {
  if (scopeKey === "__all__") return state.members.map((m) => m.id);
  const teamIds = scopeKey.split(",");
  return [...new Set(state.teamMembers.filter((tm) => teamIds.includes(tm.team_id)).map((tm) => tm.member_id))];
}

// Soll-Anteil (Durchschnitt über die beteiligten Teams) und bereits verdiente
// Team-Punkte (Summe über die beteiligten Teams) einer Person in diesem
// Kontext. null = die Person ist in keinem der beteiligten Teams Mitglied.
function quotaAndEarnedForScope(memberId, scopeKey) {
  const teamIds = scopeKey === "__all__" ? state.teams.map((t) => t.id) : scopeKey.split(",");
  const rows = state.teamMembers.filter((tm) => tm.member_id === memberId && teamIds.includes(tm.team_id));
  if (rows.length === 0) return null;
  const quota = rows.reduce((s, r) => s + Number(r.quota_percent), 0) / rows.length;
  const earned = rows.reduce((s, r) => s + Number(r.points), 0);
  return { quota, earned };
}

// Plant eine bestimmte Kalenderwoche (weekStart = Montag dieser Woche) für alle
// rotierenden Aufgaben, die in dieser Woche auch tatsächlich fällig/überfällig
// sind - und nur für die, die für diese Woche noch keine Zuteilung haben.
// Einmal gesetzte Zuteilungen werden nie wieder überschrieben (stabil, egal
// wie viel in der Zwischenzeit erledigt wird). Eine Aufgabe, die gerade erst
// erledigt wurde und erst in 2 Wochen wieder fällig ist, wird dementsprechend
// NICHT für die kommende Woche eingeplant - sie taucht erst wieder auf, wenn
// ihre Fälligkeit tatsächlich in eine Woche fällt.
//
// Jedes Team (bzw. jede Team-Kombination/die teamübergreifende "Alle"-Gruppe)
// ist dabei eine eigene, unabhängige Fairness-Blase: eine Aufgabe für Team A
// beeinflusst nie, wer in Team B dran ist.
async function planWeek(weekStart) {
  if (state.members.length === 0) return;

  const weekStartStr = isoDateOnly(weekStart);
  const weekEnd = getWeekEnd(weekStart);

  const needsPlanning = state.tasks.filter((t) => {
    if (!t.rotation_enabled) return false;
    if (assignmentFor(t.id, weekStartStr)) return false; // für diese Woche schon geplant
    return taskUrgency(t).dueDate < weekEnd; // nur einplanen, wenn in dieser Woche wirklich fällig
  });
  if (needsPlanning.length === 0) return;

  // Nach Fairness-Kontext gruppieren - jeder Kontext wird unabhängig geplant.
  const groups = {};
  needsPlanning.forEach((t) => {
    const key = scopeKeyForTask(t);
    (groups[key] = groups[key] || []).push(t);
  });

  const inserts = [];

  Object.keys(groups).forEach((scopeKey) => {
    const fullPool = poolForScope(scopeKey);
    if (fullPool.length === 0) return;

    // Virtueller, hochgerechneter Punktestand je Mitglied in diesem Kontext -
    // wird beim Verteilen laufend angepasst. Basis sind die (rücksetzbaren)
    // Team-Punkte bzw. bei "__all__" der kombinierte Wert über alle Teams
    // dieser Person. Ist eine Person in keinem relevanten Team, greift ein
    // einfacher Gleichverteilungs-Fallback (Soll = 1/Poolgröße, Ist = ihr
    // globaler Punktestand), damit sie trotzdem fair mitrotiert.
    const quotaFallback = 100 / fullPool.length;
    const virtualEarned = {};
    fullPool.forEach((id) => {
      const qe = quotaAndEarnedForScope(id, scopeKey);
      virtualEarned[id] = qe ? qe.earned : Number(state.members.find((m) => m.id === id)?.points) || 0;
    });
    let virtualTotal = Object.values(virtualEarned).reduce((a, b) => a + b, 0);

    // Größte Punktwerte zuerst verteilen - die haben den größten Einfluss auf die Fairness.
    const tasksInScope = [...groups[scopeKey]].sort((a, b) => b.points - a.points);

    tasksInScope.forEach((t) => {
      const taskPool = t.assigned_member_ids && t.assigned_member_ids.length
        ? t.assigned_member_ids.filter((id) => fullPool.includes(id))
        : fullPool;
      if (taskPool.length === 0) return;

      // Harte Regel: höchstens 2 Wochen in Folge dieselbe Person - außer es gibt
      // schlicht niemand anderen im Pool.
      const forbidden = mustRotateAwayFrom(t.id, weekStart);
      const pool = taskPool.length > 1 && forbidden ? taskPool.filter((id) => id !== forbidden) : taskPool;

      let best = null;
      let bestDeficit = -Infinity;
      let bestLastDone = Infinity;

      pool.forEach((id) => {
        const qe = quotaAndEarnedForScope(id, scopeKey);
        const quota = qe ? qe.quota : quotaFallback;
        const idealShare = (quota / 100) * virtualTotal;
        const deficit = idealShare - (virtualEarned[id] || 0);
        const lastDone = lastCompletedTaskAt(t.id, id);
        const better =
          deficit > bestDeficit + 0.001 ||
          (Math.abs(deficit - bestDeficit) <= 0.001 && lastDone < bestLastDone);
        if (better) {
          best = id;
          bestDeficit = deficit;
          bestLastDone = lastDone;
        }
      });

      if (best) {
        virtualEarned[best] = (virtualEarned[best] || 0) + t.points;
        virtualTotal += t.points;
        const row = { task_id: t.id, week_start: weekStartStr, member_id: best };
        // Direkt im State ergänzen, damit die Anzeige sofort passt, ohne auf
        // einen erneuten loadData()-Roundtrip warten zu müssen.
        state.taskAssignments.push(row);
        inserts.push(row);
      }
    });
  });

  if (inserts.length > 0) {
    await sb.from("task_assignments").upsert(inserts, { onConflict: "task_id,week_start" });
  }
}

// Anzeige-Text für die Zuständigkeit einer Aufgabe (Karte + Detailansicht).
function assigneeLine(task) {
  if (task.rotation_enabled) {
    const assignedId = assignmentFor(task.id, isoDateOnly(getWeekStart(new Date())));
    return assignedId ? "🔁 Diese Woche: " + memberName(assignedId) : "🔁 Rotierend";
  }
  const assignedNames = task.assigned_member_ids && task.assigned_member_ids.length
    ? task.assigned_member_ids.map((id) => memberName(id)).join(", ")
    : "Alle";
  return "👥 " + assignedNames;
}

function buildTaskCard(task) {
  const u = taskUrgency(task);
  const overdue = u.remainingMs < 0;
  const widthPct = Math.round(u.fractionRemaining * 100);

  const card = document.createElement("div");
  card.className = "task-card";
  card.innerHTML = `
    <div class="task-top">
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-points">${task.points} P.</div>
    </div>
    <div class="task-assignees">${escapeHtml(assigneeLine(task))}</div>
    <div class="urgency-track"><div class="urgency-fill" style="width:${overdue ? 100 : widthPct}%; background:${urgencyColor(u.remainingDays, overdue)}"></div></div>
    <div class="urgency-label" style="color:${urgencyColor(u.remainingDays, overdue)}">${urgencyLabel(u)}</div>
  `;
  card.onclick = () => openDetailModal(task);
  return card;
}

function sortByUrgency(tasks) {
  return [...tasks].sort((a, b) => taskUrgency(a).remainingMs - taskUrgency(b).remainingMs);
}

function renderHomeTaskList() {
  const el = document.getElementById("taskList");
  el.innerHTML = "";
  let tasks = state.tasks;

  if (state.homeFilter !== "all") {
    const weekEnd = getWeekEnd(getWeekStart(new Date()));
    const currentWeekStartStr = isoDateOnly(getWeekStart(new Date()));
    tasks = tasks.filter((t) => {
      if (t.rotation_enabled) {
        // Zeigt diese Woche UND bereits vorab geplante künftige Wochen (über
        // den "Nächste Woche planen"-Button) - aber NUR, solange die Aufgabe
        // laut aktuellem Fälligkeitsdatum auch wirklich in genau das
        // Wochenfenster dieser Zuteilung fällt. Das gilt für JEDE Zuteilung,
        // nicht nur die laufende Woche - sonst bleibt z.B. eine bereits für
        // nächste Woche vorgeplante Aufgabe sichtbar, obwohl sie durch
        // wiederholtes Erledigen längst wieder weiter nach hinten gerutscht
        // ist. Eine überfällige Aufgabe (dueDate in der Vergangenheit) zählt
        // dabei immer als "noch offen", egal für welche Woche.
        return state.taskAssignments.some((a) => {
          if (a.task_id !== t.id || a.member_id !== state.homeFilter || a.week_start < currentWeekStartStr) return false;
          const assignmentWeekEnd = getWeekEnd(new Date(a.week_start + "T00:00:00"));
          return taskUrgency(t).dueDate < assignmentWeekEnd;
        });
      }
      const isMine = !t.assigned_member_ids || t.assigned_member_ids.length === 0 || t.assigned_member_ids.includes(state.homeFilter);
      if (!isMine) return false;
      // Persönliche Ansicht zeigt nur, was diese Woche dran bzw. überfällig ist -
      // damit man sieht, wenn man für diese Woche fertig ist.
      return taskUrgency(t).dueDate < weekEnd;
    });
  }

  tasks = sortByUrgency(tasks);
  if (tasks.length === 0) {
    el.innerHTML = state.homeFilter === "all"
      ? '<p class="empty-state">Keine Aufgaben. Füge welche unter „Aktivitäten“ hinzu.</p>'
      : '<p class="empty-state">🎉 Alle Aufgaben für diese Woche erledigt!</p>';
    return;
  }
  tasks.forEach((t) => el.appendChild(buildTaskCard(t)));
}

function renderTasksView() {
  const el = document.getElementById("allTaskList");
  el.innerHTML = "";
  const tasks = sortByUrgency(state.tasks);
  if (tasks.length === 0) {
    el.innerHTML = '<p class="empty-state">Noch keine Aufgaben erstellt.</p>';
    return;
  }
  tasks.forEach((t) => el.appendChild(buildTaskCard(t)));
}

function memberName(id) {
  const m = state.members.find((x) => x.id === id);
  return m ? m.name : "Ehemaliges Mitglied";
}

function taskTitleById(id) {
  const t = state.tasks.find((x) => x.id === id);
  return t ? t.title : "(gelöschte Aufgabe)";
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderHistory() {
  const el = document.getElementById("historyList");
  if (!el) return;
  el.innerHTML = "";
  if (state.completions.length === 0) {
    el.innerHTML = '<p class="empty-state">Noch keine erledigten Aufgaben.</p>';
    return;
  }
  state.completions.forEach((c) => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `
      <div class="history-top">
        <span class="history-task">${escapeHtml(taskTitleById(c.task_id))}</span>
        <span class="history-points">+${c.points} P.</span>
      </div>
      <div class="history-meta">${escapeHtml(memberName(c.member_id))} · ${formatDateTime(c.completed_at)}</div>
    `;
    el.appendChild(item);
  });
}

// ---------------- NAV ----------------

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.add("active");
  };
});

document.getElementById("btnSwitchProfile").onclick = () => {
  localStorage.removeItem(LS.memberId);
  state.me = null;
  renderProfilePicker();
  showScreen("pickProfile");
};

// ---------------- TASK MODAL (create/edit) ----------------

let editingTaskId = null;
let selectedAssignees = new Set();
let selectedTaskTeams = new Set();
let assignMode = "fixed"; // "fixed" | "rotating"

document.getElementById("cycleDaysSlider").oninput = (e) => {
  document.getElementById("cycleDaysLabel").textContent = e.target.value + " Tage";
};
document.getElementById("pointsSlider").oninput = (e) => {
  document.getElementById("pointsLabel").textContent = e.target.value;
};

function openTaskModal(task) {
  editingTaskId = task ? task.id : null;
  document.getElementById("taskModalTitle").textContent = task ? "Aufgabe bearbeiten" : "Neue Aufgabe";
  document.getElementById("taskTitle").value = task ? task.title : "";
  document.getElementById("taskDetails").value = task ? task.details || "" : "";
  const cycle = task ? task.cycle_days : 7;
  const points = task ? task.points : 20;
  document.getElementById("cycleDaysSlider").value = cycle;
  document.getElementById("cycleDaysLabel").textContent = cycle + " Tage";
  document.getElementById("pointsSlider").value = points;
  document.getElementById("pointsLabel").textContent = points;

  selectedAssignees = new Set(task && task.assigned_member_ids ? task.assigned_member_ids : []);
  renderAssigneeChips();

  selectedTaskTeams = new Set(task && task.team_ids ? task.team_ids : []);
  renderTaskTeamChips();

  assignMode = task && task.rotation_enabled ? "rotating" : "fixed";
  updateAssignModeUI();

  document.getElementById("btnDeleteTask").classList.toggle("hidden", !task);
  document.getElementById("taskModal").classList.add("show");
}

function updateAssignModeUI() {
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === assignMode);
  });
  // Bei "Rotierend" rotieren immer alle Mitglieder des/der gewählten Teams
  // (bzw. teamübergreifend alle) - keine einzelne Personen-Auswahl nötig.
  document.getElementById("fixedAssigneeSection").classList.toggle("hidden", assignMode === "rotating");
  document.getElementById("rotatingSection").classList.toggle("hidden", assignMode !== "rotating");
}

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.onclick = () => {
    assignMode = btn.dataset.mode;
    updateAssignModeUI();
  };
});

function renderAssigneeChips() {
  const wrap = document.getElementById("assigneeChips");
  wrap.innerHTML = "";
  state.members.forEach((m) => {
    const chip = document.createElement("div");
    chip.className = "assignee-chip" + (selectedAssignees.has(m.id) ? " selected" : "");
    chip.textContent = m.name;
    chip.onclick = () => {
      if (selectedAssignees.has(m.id)) selectedAssignees.delete(m.id);
      else selectedAssignees.add(m.id);
      renderAssigneeChips();
    };
    wrap.appendChild(chip);
  });
}

function renderTaskTeamChips() {
  const wrap = document.getElementById("taskTeamChips");
  wrap.innerHTML = "";
  if (state.teams.length === 0) {
    wrap.innerHTML = '<p class="hint">Noch keine Teams angelegt (Einstellungen → Teams).</p>';
    return;
  }
  state.teams.forEach((team) => {
    const chip = document.createElement("div");
    chip.className = "assignee-chip" + (selectedTaskTeams.has(team.id) ? " selected" : "");
    chip.textContent = team.name;
    chip.onclick = () => {
      if (selectedTaskTeams.has(team.id)) selectedTaskTeams.delete(team.id);
      else selectedTaskTeams.add(team.id);
      renderTaskTeamChips();
    };
    wrap.appendChild(chip);
  });
}

function closeTaskModal() {
  document.getElementById("taskModal").classList.remove("show");
  editingTaskId = null;
}

document.getElementById("btnAddTask").onclick = () => openTaskModal(null);
document.getElementById("btnCancelTask").onclick = closeTaskModal;

document.getElementById("btnSaveTask").onclick = async () => {
  const title = document.getElementById("taskTitle").value.trim();
  if (!title) return showToast("Bitte einen Titel eingeben.");
  const payload = {
    title,
    details: document.getElementById("taskDetails").value.trim(),
    cycle_days: parseInt(document.getElementById("cycleDaysSlider").value, 10),
    points: parseInt(document.getElementById("pointsSlider").value, 10),
    // Rotierend = immer das/die gewählte(n) Team(s) bzw. alle, keine einzelne
    // Personen-Auswahl mehr möglich.
    assigned_member_ids: assignMode === "rotating" ? [] : Array.from(selectedAssignees),
    rotation_enabled: assignMode === "rotating",
    team_ids: assignMode === "rotating" ? Array.from(selectedTaskTeams) : [],
  };

  if (editingTaskId) {
    const { error } = await sb.from("tasks").update(payload).eq("id", editingTaskId);
    if (error) return showToast("Fehler: " + error.message);
  } else {
    payload.wg_id = state.wg.id;
    payload.last_done_at = new Date().toISOString();
    const { error } = await sb.from("tasks").insert(payload);
    if (error) return showToast("Fehler: " + error.message);
  }
  closeTaskModal();
  await loadData();
  await renderAll();
  showToast("Gespeichert ✓");
};

document.getElementById("btnDeleteTask").onclick = async () => {
  if (!editingTaskId) return;
  if (!confirm("Diese Aufgabe wirklich löschen?")) return;
  const { error } = await sb.from("tasks").delete().eq("id", editingTaskId);
  if (error) return showToast("Fehler: " + error.message);
  closeTaskModal();
  document.getElementById("detailModal").classList.remove("show");
  await loadData();
  await renderAll();
};

// ---------------- DETAIL MODAL ----------------

let detailTaskId = null;
let detailDoneBy = null;

function openDetailModal(task) {
  detailTaskId = task.id;
  detailDoneBy = state.me ? state.me.id : null;

  document.getElementById("detailTitle").textContent = task.title;
  document.getElementById("detailDetails").textContent = task.details || "";

  const u = taskUrgency(task);
  const overdue = u.remainingMs < 0;
  const statusEl = document.getElementById("detailStatus");
  statusEl.textContent = urgencyLabel(u);
  statusEl.style.color = urgencyColor(u.remainingDays, overdue);

  document.getElementById("detailMeta").textContent =
    `Zuständig: ${assigneeLine(task)} · Wert: ${task.points} Punkte · Zyklus: alle ${task.cycle_days} Tage`;

  const doneBySelect = document.getElementById("detailDoneBySelect");
  doneBySelect.innerHTML = "";
  state.members.forEach((m) => {
    const chip = document.createElement("div");
    chip.className = "assignee-chip" + (detailDoneBy === m.id ? " selected" : "");
    chip.textContent = m.name;
    chip.onclick = () => {
      detailDoneBy = m.id;
      doneBySelect.querySelectorAll(".assignee-chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
    };
    doneBySelect.appendChild(chip);
  });

  document.getElementById("detailModal").classList.add("show");
}

document.getElementById("btnCloseDetail").onclick = () => {
  document.getElementById("detailModal").classList.remove("show");
};

document.getElementById("btnEditTask").onclick = () => {
  const task = state.tasks.find((t) => t.id === detailTaskId);
  document.getElementById("detailModal").classList.remove("show");
  if (task) openTaskModal(task);
};

document.getElementById("btnCompleteTask").onclick = async () => {
  if (!detailDoneBy) return showToast("Bitte auswählen, wer erledigt hat.");
  const task = state.tasks.find((t) => t.id === detailTaskId);
  if (!task) return;

  const nowIso = new Date().toISOString();

  const { error: taskErr } = await sb.from("tasks").update({ last_done_at: nowIso }).eq("id", task.id);
  if (taskErr) return showToast("Fehler: " + taskErr.message);

  const member = state.members.find((m) => m.id === detailDoneBy);
  const { error: memberErr } = await sb
    .from("members")
    .update({ points: member.points + task.points })
    .eq("id", detailDoneBy);
  if (memberErr) return showToast("Fehler: " + memberErr.message);

  await sb.from("completions").insert({ task_id: task.id, member_id: detailDoneBy, points: task.points });

  // Team-Punkte erhöhen, falls die Aufgabe (bei "Rotierend") einem oder
  // mehreren Teams zugeordnet ist - universelle Aufgaben ohne Teamwahl
  // zählen nur in den globalen Punktestand, nicht in einzelne Team-Ledger.
  if (task.team_ids && task.team_ids.length) {
    for (const teamId of task.team_ids) {
      const tm = state.teamMembers.find((x) => x.team_id === teamId && x.member_id === detailDoneBy);
      if (tm) {
        await sb
          .from("team_members")
          .update({ points: Number(tm.points) + task.points })
          .eq("team_id", teamId)
          .eq("member_id", detailDoneBy);
      }
    }
  }

  document.getElementById("detailModal").classList.remove("show");
  await loadData();
  if (state.me) state.me = state.members.find((m) => m.id === state.me.id) || state.me;
  await renderAll();
  playCelebration();
  showToast(`✓ Erledigt! +${task.points} Punkte für ${memberName(detailDoneBy)}`);
};

// ---------------- SETTINGS: MITGLIEDER ----------------

function renderSettingsMembers() {
  const list = document.getElementById("memberSettingsList");
  if (!list) return;
  list.innerHTML = "";
  if (state.members.length === 0) {
    list.innerHTML = '<p class="empty-state">Noch keine Mitglieder.</p>';
    return;
  }
  state.members.forEach((m) => {
    const row = document.createElement("div");
    row.className = "member-settings-row";
    row.innerHTML = `
      <div class="member-settings-name">${escapeHtml(m.name)}</div>
      <button class="remove-member-btn" data-id="${m.id}">✕</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll(".remove-member-btn").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Dieses Mitglied wirklich entfernen? Es wird dadurch auch aus allen Teams entfernt.")) return;
      await sb.from("members").delete().eq("id", btn.dataset.id);
      await loadData();
      await renderAll();
    };
  });
}

// ---------------- SETTINGS: TEAMS ----------------

let editingTeamId = null;
let teamSelectedMembers = new Set();
let teamQuotaValues = {}; // memberId -> Zahl (Soll-Anteil in %), während das Team-Modal offen ist

function renderTeamsSettings() {
  const list = document.getElementById("teamsList");
  if (!list) return;
  list.innerHTML = "";
  if (state.teams.length === 0) {
    list.innerHTML = '<p class="empty-state">Noch keine Teams. Lege eines an, um Soll-Anteile festzulegen.</p>';
  }
  state.teams.forEach((team) => {
    const rows = state.teamMembers.filter((tm) => tm.team_id === team.id);
    const sum = Math.round(rows.reduce((s, r) => s + Number(r.quota_percent), 0));
    const valid = rows.length > 0 && sum >= 98 && sum <= 100;
    const card = document.createElement("div");
    card.className = "team-card";
    card.innerHTML = `
      <div class="team-card-top">
        <div class="team-card-name">${escapeHtml(team.name)}</div>
        <span class="team-card-badge ${valid ? "valid" : "invalid"}">${sum}%</span>
      </div>
      <div class="team-card-members">${
        rows.length
          ? rows.map((r) => `${escapeHtml(memberName(r.member_id))} ${Math.round(Number(r.quota_percent))}%`).join(" · ")
          : "Keine Mitglieder"
      }</div>
      <button class="btn-secondary small team-edit-btn" data-id="${team.id}" style="margin-top:8px;">Bearbeiten</button>
    `;
    list.appendChild(card);
  });
  list.querySelectorAll(".team-edit-btn").forEach((btn) => {
    btn.onclick = () => {
      const team = state.teams.find((t) => t.id === btn.dataset.id);
      if (team) openTeamModal(team);
    };
  });
  document.getElementById("btnAddTeam").classList.toggle("hidden", state.teams.length >= 5);
}

function openTeamModal(team) {
  editingTeamId = team ? team.id : null;
  document.getElementById("teamModalTitle").textContent = team ? "Team bearbeiten" : "Neues Team";
  document.getElementById("teamName").value = team ? team.name : "";

  teamSelectedMembers = new Set(
    team ? state.teamMembers.filter((tm) => tm.team_id === team.id).map((tm) => tm.member_id) : []
  );
  teamQuotaValues = {};
  if (team) {
    state.teamMembers
      .filter((tm) => tm.team_id === team.id)
      .forEach((tm) => {
        teamQuotaValues[tm.member_id] = Number(tm.quota_percent);
      });
  }

  renderTeamMemberChips();
  renderTeamQuotaRows();
  document.getElementById("btnDeleteTeam").classList.toggle("hidden", !team);
  document.getElementById("teamModal").classList.add("show");
}

function closeTeamModal() {
  document.getElementById("teamModal").classList.remove("show");
  editingTeamId = null;
}

function renderTeamMemberChips() {
  const wrap = document.getElementById("teamMemberChips");
  wrap.innerHTML = "";
  if (state.members.length === 0) {
    wrap.innerHTML = '<p class="hint">Noch keine Mitglieder in der WG.</p>';
    return;
  }
  state.members.forEach((m) => {
    const chip = document.createElement("div");
    chip.className = "assignee-chip" + (teamSelectedMembers.has(m.id) ? " selected" : "");
    chip.textContent = m.name;
    chip.onclick = () => {
      if (teamSelectedMembers.has(m.id)) {
        teamSelectedMembers.delete(m.id);
        delete teamQuotaValues[m.id];
      } else {
        teamSelectedMembers.add(m.id);
        if (teamQuotaValues[m.id] === undefined) teamQuotaValues[m.id] = 0;
      }
      renderTeamMemberChips();
      renderTeamQuotaRows();
    };
    wrap.appendChild(chip);
  });
}

function renderTeamQuotaRows() {
  const wrap = document.getElementById("teamQuotaRows");
  wrap.innerHTML = "";
  state.members
    .filter((m) => teamSelectedMembers.has(m.id))
    .forEach((m) => {
      const row = document.createElement("div");
      row.className = "team-quota-row";
      row.innerHTML = `
        <div class="team-quota-name">${escapeHtml(m.name)}</div>
        <input type="number" min="0" max="100" step="1" class="quota-number-input" data-id="${m.id}" value="${teamQuotaValues[m.id] ?? 0}">
        <span class="quota-percent-sign">%</span>
      `;
      wrap.appendChild(row);
    });
  wrap.querySelectorAll(".quota-number-input").forEach((inp) => {
    inp.oninput = (e) => {
      teamQuotaValues[e.target.dataset.id] = Number(e.target.value) || 0;
      renderTeamQuotaSumBox();
    };
  });
  renderTeamQuotaSumBox();
}

function renderTeamQuotaSumBox() {
  const box = document.getElementById("teamQuotaSumBox");
  if (!box) return;
  if (teamSelectedMembers.size === 0) {
    box.textContent = "Noch keine Mitglieder im Team";
    box.className = "quota-sum-box invalid";
    return;
  }
  const sum = Math.round(Object.values(teamQuotaValues).reduce((a, b) => a + Number(b || 0), 0));
  const valid = sum >= 98 && sum <= 100;
  box.textContent = valid ? `Summe: ${sum}% ✓` : `Summe: ${sum}% (muss zwischen 98% und 100% liegen)`;
  box.className = "quota-sum-box " + (valid ? "valid" : "invalid");
}

document.getElementById("btnTeamEvenSplit").onclick = () => {
  const ids = Array.from(teamSelectedMembers);
  const n = ids.length;
  if (n === 0) return;
  const base = Math.floor(100 / n);
  const remainder = 100 - base * n;
  ids.forEach((id, idx) => {
    teamQuotaValues[id] = base + (idx < remainder ? 1 : 0);
  });
  renderTeamQuotaRows();
};

document.getElementById("btnAddTeam").onclick = () => {
  if (state.teams.length >= 5) return showToast("Maximal 5 Teams möglich.");
  openTeamModal(null);
};
document.getElementById("btnCancelTeam").onclick = closeTeamModal;

document.getElementById("btnSaveTeam").onclick = async () => {
  const name = document.getElementById("teamName").value.trim();
  if (!name) return showToast("Bitte einen Teamnamen eingeben.");
  if (teamSelectedMembers.size === 0) return showToast("Bitte mindestens ein Mitglied auswählen.");
  const sum = Math.round(Object.values(teamQuotaValues).reduce((a, b) => a + Number(b || 0), 0));
  if (sum < 98 || sum > 100) return showToast("Die Soll-Anteile müssen zusammen zwischen 98% und 100% ergeben.");

  let teamId = editingTeamId;
  if (teamId) {
    const { error } = await sb.from("teams").update({ name }).eq("id", teamId);
    if (error) return showToast("Fehler: " + error.message);
  } else {
    const { data, error } = await sb.from("teams").insert({ wg_id: state.wg.id, name }).select().single();
    if (error) return showToast("Fehler: " + error.message);
    teamId = data.id;
  }

  // Team-Mitgliedschaften abgleichen: abgewählte Personen entfernen, Rest upserten.
  const existingRows = state.teamMembers.filter((tm) => tm.team_id === teamId);
  for (const tm of existingRows) {
    if (!teamSelectedMembers.has(tm.member_id)) {
      await sb.from("team_members").delete().eq("team_id", teamId).eq("member_id", tm.member_id);
    }
  }
  const upserts = Array.from(teamSelectedMembers).map((memberId) => {
    const existing = existingRows.find((tm) => tm.member_id === memberId);
    return {
      team_id: teamId,
      member_id: memberId,
      quota_percent: Number(teamQuotaValues[memberId]) || 0,
      points: existing ? existing.points : 0,
    };
  });
  if (upserts.length) {
    const { error } = await sb.from("team_members").upsert(upserts, { onConflict: "team_id,member_id" });
    if (error) return showToast("Fehler: " + error.message);
  }

  closeTeamModal();
  await loadData();
  await renderAll();
  showToast("Team gespeichert ✓");
};

document.getElementById("btnDeleteTeam").onclick = async () => {
  if (!editingTeamId) return;
  if (!confirm("Dieses Team wirklich löschen?")) return;
  // Aufgaben, die (auch) dieses Team nutzen, von der Teamzuordnung befreien,
  // damit sie nicht "verwaist" auf ein gelöschtes Team zeigen.
  const affectedTasks = state.tasks.filter((t) => t.team_ids && t.team_ids.includes(editingTeamId));
  for (const t of affectedTasks) {
    const newTeamIds = t.team_ids.filter((id) => id !== editingTeamId);
    await sb.from("tasks").update({ team_ids: newTeamIds }).eq("id", t.id);
  }
  await sb.from("teams").delete().eq("id", editingTeamId);
  closeTeamModal();
  await loadData();
  await renderAll();
  showToast("Team gelöscht ✓");
};

document.getElementById("btnPlanNextWeek").onclick = async () => {
  const nextWeekStart = getWeekEnd(getWeekStart(new Date())); // = Montag der kommenden Woche
  await planWeek(nextWeekStart);
  await loadData();
  await renderAll();
  showToast("Nächste Woche eingeplant ✓");
};

document.getElementById("btnLeaveWg").onclick = () => {
  if (!confirm("WG wirklich verlassen? Du kannst jederzeit mit dem Beitrittscode wieder beitreten.")) return;
  if (sb && sb.removeAllChannels) sb.removeAllChannels();
  localStorage.removeItem(LS.wgId);
  localStorage.removeItem(LS.wgCode);
  localStorage.removeItem(LS.wgName);
  localStorage.removeItem(LS.memberId);
  state = {
    wg: null,
    members: [],
    tasks: [],
    completions: [],
    taskAssignments: [],
    teams: [],
    teamMembers: [],
    me: null,
    homeFilter: "all",
  };
  document.getElementById("newWgName").value = "";
  document.getElementById("joinCode").value = "";
  showScreen("onboarding");
};

document.getElementById("btnSettingsAddMember").onclick = async () => {
  const input = document.getElementById("settingsNewMemberName");
  const name = input.value.trim();
  if (!name) return;
  const { error } = await sb.from("members").insert({ wg_id: state.wg.id, name, quota_percent: 100, points: 0 });
  if (error) return showToast("Fehler: " + error.message);
  input.value = "";
  await loadData();
  await renderAll();
};

document.getElementById("btnResetAll").onclick = async () => {
  if (
    !confirm(
      "Wirklich ALLES zurücksetzen? Das setzt alle Punktestände auf 0, löscht den kompletten Verlauf und die aktuelle/vorgeplante Wochenzuteilung unwiderruflich."
    )
  )
    return;

  const taskIds = state.tasks.map((t) => t.id);

  await sb.from("members").update({ points: 0 }).eq("wg_id", state.wg.id);

  const teamIds = state.teams.map((t) => t.id);
  if (teamIds.length > 0) {
    await sb.from("team_members").update({ points: 0 }).in("team_id", teamIds);
  }

  if (taskIds.length > 0) {
    // Verlauf und Wochenzuteilungen komplett löschen, damit die Planung
    // wirklich bei null anfängt (sonst "erinnert" sich die Fairness-Logik
    // bzw. die 2-Wochen-Rotationsregel noch an Längst-Zurückgesetztes).
    await sb.from("completions").delete().in("task_id", taskIds);
    await sb.from("task_assignments").delete().in("task_id", taskIds);

    // last_done_at je Aufgabe so weit zurückdatieren, dass sie sofort wieder
    // fällig ist - sonst bliebe jede Aufgabe trotz gelöschter Planung noch
    // tagelang "nicht fällig" (weil last_done_at z.B. erst von vor 5 Minuten
    // stammt) und "Nächste Woche planen" würde weiterhin ins Leere laufen.
    const now = Date.now();
    const updates = state.tasks.map((t) => {
      const freshDueDate = new Date(now - t.cycle_days * 86400000 - 60000).toISOString();
      return sb.from("tasks").update({ last_done_at: freshDueDate }).eq("id", t.id);
    });
    await Promise.all(updates);
  }

  await loadData();
  await renderAll();
  showToast("Alles zurückgesetzt ✓");
};

// ---------------- ONBOARDING EVENTS ----------------

document.getElementById("btnCreateWg").onclick = createWg;
document.getElementById("btnJoinWg").onclick = joinWg;
document.getElementById("btnAddMemberOnboard").onclick = addMemberOnboard;

// ---------------- HAPTIK & FEIER ----------------

function haptic(pattern = 10) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      /* ignore */
    }
  }
}

document.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button, .chip, .assignee-chip, .task-card, .profile-pill, .nav-btn")) {
    haptic(10);
  }
});

function playFanfare() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const startTime = ctx.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.2, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.35);
    });
    setTimeout(() => ctx.close(), 900);
  } catch (e) {
    /* Web Audio nicht verfügbar - ignorieren */
  }
}

function playCelebration() {
  const overlay = document.getElementById("celebrationOverlay");
  overlay.classList.remove("show");
  void overlay.offsetWidth; // Animation neu starten
  overlay.classList.add("show");
  haptic([15, 40, 15, 40, 60]);
  playFanfare();
  clearTimeout(overlay._timer);
  overlay._timer = setTimeout(() => overlay.classList.remove("show"), 1400);
}

// ---------------- UTIL ----------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2800);
}

// refresh urgency bars periodically without full reload
setInterval(async () => {
  if (document.getElementById("app").classList.contains("show")) {
    await planWeek(getWeekStart(new Date())); // No-op außer genau am Wochenwechsel, falls der Tab offen bleibt
    renderHomeTaskList();
    renderTasksView();
  }
}, 60000);

boot();
