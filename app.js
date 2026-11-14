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
  const [membersRes, tasksRes] = await Promise.all([
    sb.from("members").select("*").eq("wg_id", state.wg.id).order("created_at"),
    sb.from("tasks").select("*").eq("wg_id", state.wg.id).order("created_at"),
  ]);
  state.members = membersRes.data || [];
  state.tasks = tasksRes.data || [];
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
  renderAll();
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

function renderAll() {
  renderLeaderboard();
  renderFilterRow();
  renderHomeTaskList();
  renderTasksView();
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
    const actualShare = totalPoints > 0 ? Math.round((m.points / totalPoints) * 100) : 0;

    row.innerHTML = `
      <div class="member-row-top">
        <div class="member-name">${escapeHtml(m.name)} ${m.points === minPoints ? '<span class="member-badge">hinten</span>' : ""}</div>
        <div class="member-points"><b>${m.points}</b> Punkte</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:0%" data-target="${pct}"></div></div>
      <div class="quota-note">Soll-Anteil: ${m.quota_percent}% · Aktueller Anteil erledigter Punkte: ${actualShare}%</div>
    `;
    el.appendChild(row);
  });

  requestAnimationFrame(() => {
    el.querySelectorAll(".bar-fill").forEach((bar) => {
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
  return { remainingMs, remainingDays, fractionRemaining, cycleMs };
}

function urgencyColor(fraction, overdue) {
  if (overdue) return "var(--danger)";
  if (fraction < 0.2) return "var(--danger)";
  if (fraction < 0.5) return "var(--warn)";
  return "var(--ok)";
}

function urgencyLabel(u) {
  if (u.remainingMs < 0) {
    const daysOver = Math.round(-u.remainingDays);
    return `Überfällig seit ${daysOver} Tag${daysOver === 1 ? "" : "en"}`;
  }
  const d = Math.round(u.remainingDays);
  if (d === 0) return "Heute fällig";
  return `Noch ${d} Tag${d === 1 ? "" : "e"}`;
}

function buildTaskCard(task) {
  const u = taskUrgency(task);
  const overdue = u.remainingMs < 0;
  const widthPct = Math.round(u.fractionRemaining * 100);
  const assignedNames = task.assigned_member_ids && task.assigned_member_ids.length
    ? task.assigned_member_ids.map((id) => memberName(id)).join(", ")
    : "Alle";

  const card = document.createElement("div");
  card.className = "task-card";
  card.innerHTML = `
    <div class="task-top">
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-points">${task.points} P.</div>
    </div>
    <div class="task-assignees">👥 ${escapeHtml(assignedNames)}</div>
    <div class="urgency-track"><div class="urgency-fill" style="width:${overdue ? 100 : widthPct}%; background:${urgencyColor(u.fractionRemaining, overdue)}"></div></div>
    <div class="urgency-label" style="color:${urgencyColor(u.fractionRemaining, overdue)}">${urgencyLabel(u)}</div>
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
    tasks = tasks.filter(
      (t) => !t.assigned_member_ids || t.assigned_member_ids.length === 0 || t.assigned_member_ids.includes(state.homeFilter)
    );
  }
  tasks = sortByUrgency(tasks);
  if (tasks.length === 0) {
    el.innerHTML = '<p class="empty-state">Keine Aufgaben. Füge welche unter „Aktivitäten“ hinzu.</p>';
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
  return m ? m.name : "?";
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

  document.getElementById("btnDeleteTask").classList.toggle("hidden", !task);
  document.getElementById("taskModal").classList.add("show");
}

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
    assigned_member_ids: Array.from(selectedAssignees),
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
  renderAll();
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
  renderAll();
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
  statusEl.style.color = urgencyColor(u.fractionRemaining, overdue);

  const assignedNames = task.assigned_member_ids && task.assigned_member_ids.length
    ? task.assigned_member_ids.map((id) => memberName(id)).join(", ")
    : "Alle";
  document.getElementById("detailMeta").textContent =
    `Zuständig: ${assignedNames} · Wert: ${task.points} Punkte · Zyklus: alle ${task.cycle_days} Tage`;

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
  renderAll();
  showToast(`✓ Erledigt! +${task.points} Punkte für ${memberName(detailDoneBy)}`);
};

// ---------------- SETTINGS ----------------

function renderSettingsMembers() {
  const list = document.getElementById("memberSettingsList");
  list.innerHTML = "";
  state.members.forEach((m) => {
    const row = document.createElement("div");
    row.className = "member-settings-row";
    row.innerHTML = `
      <div class="member-settings-name">${escapeHtml(m.name)}</div>
      <div class="quota-slider-wrap">
        <input type="range" min="0" max="100" step="5" value="${m.quota_percent}" class="slider" data-id="${m.id}">
        <span class="quota-value">${m.quota_percent}%</span>
      </div>
      <button class="remove-member-btn" data-id="${m.id}">✕</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('input[type="range"]').forEach((slider) => {
    slider.oninput = (e) => {
      e.target.closest(".member-settings-row").querySelector(".quota-value").textContent = e.target.value + "%";
    };
    slider.onchange = async (e) => {
      await sb.from("members").update({ quota_percent: parseInt(e.target.value, 10) }).eq("id", e.target.dataset.id);
      await loadData();
      renderAll();
    };
  });

  list.querySelectorAll(".remove-member-btn").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Dieses Mitglied wirklich entfernen?")) return;
      await sb.from("members").delete().eq("id", btn.dataset.id);
      await loadData();
      renderAll();
    };
  });
}

document.getElementById("btnSettingsAddMember").onclick = async () => {
  const input = document.getElementById("settingsNewMemberName");
  const name = input.value.trim();
  if (!name) return;
  const { error } = await sb.from("members").insert({ wg_id: state.wg.id, name, quota_percent: 100, points: 0 });
  if (error) return showToast("Fehler: " + error.message);
  input.value = "";
  await loadData();
  renderAll();
};

document.getElementById("btnResetPoints").onclick = async () => {
  if (!confirm("Wirklich alle Punktestände auf 0 setzen?")) return;
  await sb.from("members").update({ points: 0 }).eq("wg_id", state.wg.id);
  await loadData();
  renderAll();
};

// ---------------- ONBOARDING EVENTS ----------------

document.getElementById("btnCreateWg").onclick = createWg;
document.getElementById("btnJoinWg").onclick = joinWg;
document.getElementById("btnAddMemberOnboard").onclick = addMemberOnboard;

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
setInterval(() => {
  if (document.getElementById("app").classList.contains("show")) {
    renderHomeTaskList();
    renderTasksView();
  }
}, 60000);

boot();
