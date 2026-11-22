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
  me: null,
  homeFilter: "all",
};
let quotaInteracting = false; // true solange ein Soll-Anteil-Regler aktiv bedient wird

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
  const [membersRes, tasksRes] = await Promise.all([
    sb.from("members").select("*").eq("wg_id", state.wg.id).order("created_at"),
    sb.from("tasks").select("*").eq("wg_id", state.wg.id).order("created_at"),
  ]);
  state.members = membersRes.data || [];
  state.tasks = tasksRes.data || [];

  // Verlauf (completions) hat keine eigene wg_id-Spalte, daher über die
  // Aufgaben-IDs dieser WG filtern.
  const taskIds = state.tasks.map((t) => t.id);
  if (taskIds.length > 0) {
    const { data: completionsData } = await sb
      .from("completions")
      .select("*")
      .in("task_id", taskIds)
      .order("completed_at", { ascending: false });
    state.completions = completionsData || [];
  } else {
    state.completions = [];
  }
}

function subscribeRealtime() {
  sb.channel("wg_" + state.wg.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: "wg_id=eq." + state.wg.id }, onRemoteChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: "wg_id=eq." + state.wg.id }, onRemoteChange)
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
  await ensureWeekPlan();
  renderLeaderboard();
  renderFilterRow();
  renderHomeTaskList();
  renderTasksView();
  renderHistory();
  renderSettingsMembers();
  document.getElementById("wgCodeBox").textContent = state.wg.code;
  document.getElementById("wgNameLabel").textContent = state.wg.name;
  document.getElementById("meLabel").textContent = state.me ? "👤 " + state.me.name : "";
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
    const targetPct = Number(m.quota_percent);

    row.innerHTML = `
      <div class="member-row-top">
        <div class="member-name">${escapeHtml(m.name)} ${m.points === minPoints ? '<span class="member-badge">hinten</span>' : ""}</div>
        <div class="member-points"><b>${m.points}</b> Punkte</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:0%" data-target="${pct}"></div></div>
      <div class="share-track">
        <div class="share-fill" style="width:0%" data-target="${actualShare}"></div>
        <div class="share-target-marker" style="left:${Math.min(99, targetPct)}%"></div>
      </div>
      <div class="share-label"><span>Ist-Anteil: ${Math.round(actualShare)}%</span><span>Soll: ${Math.round(targetPct)}%</span></div>
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

// Legt fest, wer für jede rotierende Aufgabe diese Kalenderwoche zuständig ist -
// und zwar NUR EINMAL pro Woche. Das Ergebnis wird direkt an der Aufgabe
// gespeichert (rotation_assignee_id/rotation_week_start) und bleibt für den
// Rest der Woche unverändert, egal wie viele Aufgaben zwischendurch erledigt
// werden. Ohne diese Sperre würde jede Erledigung die Fairness-Rechnung neu
// mischen und Aufgaben mitten in der Woche von einer Person zur anderen
// "springen" lassen - genau das soll das hier verhindern.
async function ensureWeekPlan() {
  if (state.members.length === 0) return;

  const now = new Date();
  const weekStart = getWeekStart(now);
  const weekStartStr = isoDateOnly(weekStart);
  const monthStart = getMonthStart(now);

  const rotatingTasks = state.tasks.filter((t) => t.rotation_enabled);
  const needsPlanning = rotatingTasks.filter((t) => {
    if (t.rotation_week_start !== weekStartStr) return true; // neue Woche
    if (!t.rotation_assignee_id) return true;
    if (!state.members.some((m) => m.id === t.rotation_assignee_id)) return true; // Mitglied existiert nicht mehr
    return false;
  });
  if (needsPlanning.length === 0) return;

  // Virtueller, hochgerechneter Punktestand je Mitglied in diesem Monat (auf
  // Basis tatsächlich erzielter Punkte) - wird beim Verteilen laufend angepasst.
  const virtualEarned = {};
  state.members.forEach((m) => {
    virtualEarned[m.id] = pointsEarnedInRange(m.id, monthStart, now);
  });
  let virtualTotal = Object.values(virtualEarned).reduce((a, b) => a + b, 0);

  // Größte Punktwerte zuerst verteilen - die haben den größten Einfluss auf die Fairness.
  needsPlanning.sort((a, b) => b.points - a.points);

  const updates = [];
  needsPlanning.forEach((t) => {
    const fullPool = t.assigned_member_ids && t.assigned_member_ids.length
      ? t.assigned_member_ids.filter((id) => state.members.some((m) => m.id === id))
      : state.members.map((m) => m.id);
    if (fullPool.length === 0) return;

    // Harte Regel: höchstens 2 Wochen in Folge dieselbe Person - außer es gibt
    // schlicht niemand anderen im Pool.
    const forbidden = mustRotateAwayFrom(t.id, weekStart);
    const pool = fullPool.length > 1 && forbidden ? fullPool.filter((id) => id !== forbidden) : fullPool;

    let best = null;
    let bestDeficit = -Infinity;
    let bestLastDone = Infinity;

    pool.forEach((id) => {
      const member = state.members.find((m) => m.id === id);
      const idealShare = (Number(member.quota_percent) / 100) * virtualTotal;
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
      // Direkt am Task-Objekt im State mutieren, damit die Anzeige sofort passt,
      // ohne auf einen erneuten loadData()-Roundtrip warten zu müssen.
      t.rotation_assignee_id = best;
      t.rotation_week_start = weekStartStr;
      updates.push(
        sb.from("tasks").update({ rotation_assignee_id: best, rotation_week_start: weekStartStr }).eq("id", t.id)
      );
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
  }
}

// Anzeige-Text für die Zuständigkeit einer Aufgabe (Karte + Detailansicht).
function assigneeLine(task) {
  if (task.rotation_enabled) {
    const assignedId = task.rotation_assignee_id;
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
    tasks = tasks.filter((t) => {
      const isMine = t.rotation_enabled
        ? t.rotation_assignee_id === state.homeFilter
        : (!t.assigned_member_ids || t.assigned_member_ids.length === 0 || t.assigned_member_ids.includes(state.homeFilter));
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

  assignMode = task && task.rotation_enabled ? "rotating" : "fixed";
  updateAssignModeUI();

  document.getElementById("btnDeleteTask").classList.toggle("hidden", !task);
  document.getElementById("taskModal").classList.add("show");
}

function updateAssignModeUI() {
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === assignMode);
  });
  // Bei "Rotierend" rotieren immer alle WG-Mitglieder - keine Personen-Auswahl nötig.
  document.getElementById("fixedAssigneeSection").classList.toggle("hidden", assignMode === "rotating");
  document.getElementById("rotatingHint").classList.toggle("hidden", assignMode !== "rotating");
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
    // Rotierend = immer alle Mitglieder, keine Pool-Einschränkung mehr möglich.
    assigned_member_ids: assignMode === "rotating" ? [] : Array.from(selectedAssignees),
    rotation_enabled: assignMode === "rotating",
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

  document.getElementById("detailModal").classList.remove("show");
  await loadData();
  if (state.me) state.me = state.members.find((m) => m.id === state.me.id) || state.me;
  await renderAll();
  playCelebration();
  showToast(`✓ Erledigt! +${task.points} Punkte für ${memberName(detailDoneBy)}`);
};

// ---------------- SETTINGS ----------------

function quotaSum() {
  return state.members.reduce((s, m) => s + Number(m.quota_percent), 0);
}

function renderQuotaSumBox() {
  const box = document.getElementById("quotaSumBox");
  if (!box) return;
  if (state.members.length === 0) {
    box.textContent = "Noch keine Mitglieder";
    box.className = "quota-sum-box invalid";
    return;
  }
  const sum = Math.round(quotaSum() * 10) / 10;
  const sumDisplay = Math.round(sum);
  // Gültigkeit anhand der gerundeten, angezeigten Zahl prüfen (nicht der
  // exakten Nachkommazahl) - sonst kann die Box z.B. "100%" anzeigen und
  // trotzdem rot sein, weil im Hintergrund 100,1 o.ä. steckt.
  const valid = sumDisplay >= 98 && sumDisplay <= 100;
  box.textContent = valid
    ? `Summe der Soll-Anteile: ${sumDisplay}% ✓`
    : `Summe der Soll-Anteile: ${sumDisplay}% (muss zwischen 98% und 100% liegen)`;
  box.className = "quota-sum-box " + (valid ? "valid" : "invalid");
}

function renderSettingsMembers() {
  // Während jemand gerade einen Regler bewegt, nicht neu aufbauen -
  // sonst reißt ein zeitgleiches Live-Sync-Update die Bedienung ab.
  // Zwei unabhängige Prüfungen, falls ein Event-Typ im Browser mal nicht feuert.
  const focusedInSlider =
    document.activeElement && document.activeElement.closest(".quota-slider-wrap");
  if (quotaInteracting || focusedInSlider) return;

  renderQuotaSumBox();
  const list = document.getElementById("memberSettingsList");
  list.innerHTML = "";
  state.members.forEach((m) => {
    const row = document.createElement("div");
    row.className = "member-settings-row";
    const displayVal = Math.round(Number(m.quota_percent));
    row.innerHTML = `
      <div class="member-settings-name">${escapeHtml(m.name)}</div>
      <div class="quota-slider-wrap">
        <input type="range" min="0" max="100" step="1" value="${displayVal}" class="slider" data-id="${m.id}">
        <span class="quota-value">${displayVal}%</span>
      </div>
      <button class="remove-member-btn" data-id="${m.id}">✕</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('input[type="range"]').forEach((slider) => {
    const markActive = () => {
      quotaInteracting = true;
    };
    // Mehrere Event-Typen, da je nach Browser/Eingabeart (Maus, Touch,
    // Safari-Responsive-Modus) nicht immer dieselben Events zuverlässig feuern.
    slider.addEventListener("pointerdown", markActive);
    slider.addEventListener("mousedown", markActive);
    slider.addEventListener("touchstart", markActive, { passive: true });
    slider.addEventListener("focus", markActive);
    slider.addEventListener("blur", () => {
      quotaInteracting = false;
    });
    slider.oninput = (e) => {
      e.target.closest(".member-settings-row").querySelector(".quota-value").textContent =
        e.target.value + "%";
    };
    slider.onchange = async (e) => {
      // Beim manuellen Ziehen immer ganze Prozent speichern, damit Anzeige
      // und gespeicherter Wert exakt übereinstimmen (keine Nachkomma-Drift,
      // die die Summenanzeige auf z.B. 101% springen lässt). Nachkommastellen
      // gibt es nur, wenn "Gleichmäßig verteilen" das für eine ungerade
      // Mitgliederzahl braucht.
      const newVal = Math.round(parseFloat(e.target.value));
      quotaInteracting = false;
      e.target.blur(); // Fokus abgeben, damit der anstehende Re-Render nicht blockiert wird
      const { error } = await sb
        .from("members")
        .update({ quota_percent: newVal })
        .eq("id", e.target.dataset.id);
      if (error) {
        // Speichern ist fehlgeschlagen (z.B. weil die Datenbank-Spalte noch
        // keine Nachkommastellen zulässt) - Nutzer informieren statt stillschweigend
        // auf den alten Wert zurückzuspringen.
        showToast("⚠️ Speichern fehlgeschlagen: " + error.message);
      }
      await loadData();
      await renderAll();
    };
  });

  list.querySelectorAll(".remove-member-btn").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Dieses Mitglied wirklich entfernen?")) return;
      await sb.from("members").delete().eq("id", btn.dataset.id);
      await loadData();
      await renderAll();
    };
  });
}

async function evenlySplitQuotas() {
  const n = state.members.length;
  if (n === 0) return;
  const base = Math.floor(1000 / n) / 10; // eine Nachkommastelle, abgerundet
  const values = new Array(n).fill(base);
  let remainder = Math.round((100 - base * n) * 10) / 10;
  let i = 0;
  while (remainder > 0.05) {
    values[i % n] = Math.round((values[i % n] + 0.1) * 10) / 10;
    remainder = Math.round((remainder - 0.1) * 10) / 10;
    i++;
  }
  const updates = state.members.map((m, idx) =>
    sb.from("members").update({ quota_percent: values[idx] }).eq("id", m.id)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) {
    showToast("⚠️ Speichern fehlgeschlagen: " + failed.error.message);
  } else {
    showToast("Gleichmäßig verteilt ✓");
  }
  await loadData();
  await renderAll();
}

document.getElementById("btnEvenSplit").onclick = evenlySplitQuotas;

document.getElementById("btnLeaveWg").onclick = () => {
  if (!confirm("WG wirklich verlassen? Du kannst jederzeit mit dem Beitrittscode wieder beitreten.")) return;
  if (sb && sb.removeAllChannels) sb.removeAllChannels();
  localStorage.removeItem(LS.wgId);
  localStorage.removeItem(LS.wgCode);
  localStorage.removeItem(LS.wgName);
  localStorage.removeItem(LS.memberId);
  state = { wg: null, members: [], tasks: [], completions: [], me: null, homeFilter: "all" };
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

document.getElementById("btnResetPoints").onclick = async () => {
  if (!confirm("Wirklich alle Punktestände auf 0 setzen?")) return;
  await sb.from("members").update({ points: 0 }).eq("wg_id", state.wg.id);
  await loadData();
  await renderAll();
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
    await ensureWeekPlan(); // No-op außer genau am Wochenwechsel, falls der Tab offen bleibt
    renderHomeTaskList();
    renderTasksView();
  }
}, 60000);

boot();
