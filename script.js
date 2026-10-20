const API = "https://api.torn.com/v2";
const $ = id => document.getElementById(id);
const charts = {};
let members = [];
let ownId = null;
let warsCache = [];
let activeWarReport = null;
let activeWarState = null;
const DEFAULT_PAYOUT = { faction: 20, contribution: 65, participation: 15, metric: "respect", pool: 0 };
let payoutSettings = { ...DEFAULT_PAYOUT };
try {
  payoutSettings = { ...DEFAULT_PAYOUT, ...JSON.parse(localStorage.getItem("warPayoutSettings") || "{}") };
  if (!["respect", "attacks"].includes(payoutSettings.metric)) payoutSettings.metric = DEFAULT_PAYOUT.metric;
} catch {}

/* ---------- API ---------- */
async function api(path, params = {}) {
  const key = $("key").value.trim();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}${path}${qs ? "?" + qs : ""}`, { headers: { Authorization: "ApiKey " + key } });
  const data = await res.json();
  if (data.error) throw new Error(`${data.error.error} (code ${data.error.code})`);
  return data;
}

/* ---------- Helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = ts => ts ? new Date(ts * 1000).toLocaleString() : "–";
const ago = ts => {
  const s = Date.now() / 1000 - ts;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
};
function table(el, head, rows) {
  el.innerHTML = "<thead><tr>" + head.map(h => `<th>${esc(h)}</th>`).join("") + "</tr></thead><tbody>" +
    rows.map(r => "<tr>" + r.map(c => `<td>${esc(c)}</td>`).join("") + "</tr>").join("") + "</tbody>";
}
function applyChartTheme() {
  const cs = getComputedStyle(document.documentElement);
  Chart.defaults.color = cs.getPropertyValue("--ink").trim();
  Chart.defaults.borderColor = cs.getPropertyValue("--line").trim();
}
function chart(id, config) {
  applyChartTheme();
  if (charts[id]) charts[id].destroy();
  config.options = Object.assign({ responsive: true, maintainAspectRatio: false }, config.options);
  charts[id] = new Chart($(id), config);
}
function show(text, err) { const m = $("msg"); m.textContent = text; m.className = "msg" + (err ? " err" : ""); m.hidden = !text; }

/* ---------- Renderers ---------- */
function renderOverview() {
  const levels = members.map(m => m.level);
  const avg = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;
  const day = Date.now() / 1000 - 86400;
  $("sMembers").textContent = members.length;
  $("sAvg").textContent = avg.toFixed(1);
  $("sOnline").textContent = members.filter(m => m.last_action?.timestamp > day).length;
}
const roleSort = {};
const roleCols = [
  ["Name", m => m.name.toLowerCase()],
  ["Level", m => m.level],
  ["Last action", m => m.last_action?.timestamp ?? 0],
  ["Status", m => m.status?.state ?? ""],
  ["Days in faction", m => m.days_in_faction ?? 0]
];
function drawRole(role, list, tbl) {
  const st = roleSort[role] || (roleSort[role] = { col: 1, dir: -1 });
  const get = roleCols[st.col][1];
  const sorted = [...list].sort((a, b) => {
    const x = get(a), y = get(b);
    return (x < y ? -1 : x > y ? 1 : 0) * st.dir;
  });
  tbl.innerHTML = "";
  const tr = document.createElement("tr");
  roleCols.forEach(([label], i) => {
    const th = document.createElement("th");
    th.textContent = label + (i === st.col ? (st.dir > 0 ? " ▲" : " ▼") : "");
    th.tabIndex = 0;
    if (i === st.col) th.setAttribute("aria-sort", st.dir > 0 ? "ascending" : "descending");
    const go = () => {
      if (st.col === i) st.dir = -st.dir; else { st.col = i; st.dir = i === 0 || i === 3 ? 1 : -1; }
      drawRole(role, list, tbl);
    };
    th.addEventListener("click", go);
    th.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    tr.append(th);
  });
  const head = document.createElement("thead"); head.append(tr);
  const body = document.createElement("tbody");
  sorted.forEach(m => {
    const row = document.createElement("tr");
    const cells = [m.name, m.level, null, m.status?.state ?? "–", m.days_in_faction ?? "–"];
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      if (i === 2) {
        const dot = document.createElement("span");
        dot.className = "dot " + (m.last_action?.status || "").toLowerCase();
        td.append(dot, m.last_action ? ago(m.last_action.timestamp) : "–");
      } else td.textContent = c;
      row.append(td);
    });
    body.append(row);
  });
  tbl.append(head, body);
}
function renderRoles() {
  const groups = {};
  members.forEach(m => (groups[m.position || "Member"] ||= []).push(m));
  const rank = p => p === "Leader" ? 0 : p === "Co-leader" ? 1 : 2;
  const keys = Object.keys(groups).sort((a, b) => rank(a) - rank(b) || groups[b].length - groups[a].length || a.localeCompare(b));
  const box = $("roles"); box.innerHTML = "";
  keys.forEach(k => {
    const d = document.createElement("div"); d.className = "panel";
    const h = document.createElement("h2");
    const t = document.createElement("span"); t.textContent = k;
    const c = document.createElement("span"); c.textContent = groups[k].length;
    h.append(t, c);
    const wrap = document.createElement("div"); wrap.className = "scroll sortable";
    const tbl = document.createElement("table");
    wrap.append(tbl); d.append(h, wrap); box.append(d);
    drawRole(k, groups[k], tbl);
  });
}
function statBox(label, value, small) {
  const d = document.createElement("div"); d.className = "stat";
  const b = document.createElement("b"); b.textContent = value; if (small) b.className = "sm";
  const sp = document.createElement("span"); sp.textContent = label;
  d.append(b, sp); return d;
}
async function lookup() {
  const id = $("fid").value.trim();
  if (!/^\d+$/.test(id)) return show("Enter a numeric faction ID.", true);
  if (!$("key").value.trim()) return show("Enter an API key first.", true);
  show("Searching…");
  $("fresult").innerHTML = ""; $("fmembers").hidden = true;
  try {
    const d = await api(`/faction/${id}/basic`);
    const f = d.basic || d;
    const add = (l, v, small) => { if (v !== undefined && v !== null && v !== "") $("fresult").append(statBox(l, typeof v === "number" ? v.toLocaleString() : v, small)); };
    add("Name", f.name, true); add("ID", f.id ?? id); add("Tag", f.tag); add("Respect", f.respect);
    add("Members", f.members); add("Best chain", f.best_chain); add("Rank", f.rank?.name, true);
  } catch (e) { return show(`Faction ${id}: ${e.message}`, true); }
  try {
    const d = await api(`/faction/${id}/members`, { striptags: "true" });
    const list = d.members || [];
    const avg = list.length ? list.reduce((a, m) => a + m.level, 0) / list.length : 0;
    const day = Date.now() / 1000 - 86400;
    const sum = $("fsummary"); sum.innerHTML = "";
    sum.append(statBox("Members", list.length), statBox("Average level", avg.toFixed(1)),
      statBox("Active in last 24h", list.filter(m => m.last_action?.timestamp > day).length));
    const sorted = [...list].sort((a, b) => b.level - a.level);
    table($("tFmembers"), ["Name", "Level", "Position", "Status", "Last action"],
      sorted.map(m => [m.name, m.level, m.position, m.status?.state ?? "–", m.last_action ? ago(m.last_action.timestamp) : "–"]));
    $("fmembers").hidden = false;
    show("");
  } catch (e) { show(`Basic info loaded, but members unavailable: ${e.message}`, true); }
}
function renderActivity() {
  const now = Date.now() / 1000;
  const buckets = [["< 1h", 3600], ["1–24h", 86400], ["1–7d", 604800], ["7–30d", 2592000], ["30d+", Infinity]];
  const counts = buckets.map(() => 0);
  members.forEach(m => {
    const age = now - (m.last_action?.timestamp ?? 0);
    counts[buckets.findIndex(b => age < b[1])]++;
  });
  chart("cAct", { type: "bar", data: { labels: buckets.map(b => b[0]), datasets: [{ label: "Members", data: counts, backgroundColor: "#85b200" }] }, options: { plugins: { legend: { display: false } } } });
  const sorted = [...members].sort((a, b) => (a.last_action?.timestamp ?? 0) - (b.last_action?.timestamp ?? 0)).slice(0, 15);
  table($("tInactive"), ["Name", "Level", "Last action", "Position"], sorted.map(m => [m.name, m.level, m.last_action ? ago(m.last_action.timestamp) : "–", m.position]));
}
function renderLevels() {
  const max = Math.max(100, ...members.map(m => m.level));
  const size = 10, labels = [], counts = [];
  for (let lo = 1; lo <= max; lo += size) { labels.push(`${lo}–${lo + size - 1}`); counts.push(0); }
  members.forEach(m => counts[Math.floor((m.level - 1) / size)]++);
  chart("cLvl", { type: "bar", data: { labels, datasets: [{ label: "Members", data: counts, backgroundColor: "#85b200" }] }, options: { plugins: { legend: { display: false } } } });
  const sorted = [...members].sort((a, b) => b.level - a.level);
  table($("tMembers"), ["Name", "Level", "Position", "Days in faction", "Last action"], sorted.map(m => [m.name, m.level, m.position, m.days_in_faction, m.last_action ? ago(m.last_action.timestamp) : "–"]));
}
function renderWars(list) {
  warsCache = [...list].sort((a, b) => (b.start || 0) - (a.start || 0));
  const split = w => {
    const fs = normalizeReportFactions(w.factions);
    return { fs, me: ownId ? fs.find(f => String(f.id) === String(ownId)) : null, them: ownId ? fs.find(f => String(f.id) !== String(ownId)) : null };
  };
  const tbl = $("tWars");
  tbl.innerHTML = "<thead><tr>" + ["Start", "End", "Target faction", "Score (us – them)", "Winner"].map(h => `<th>${esc(h)}</th>`).join("") + "</tr></thead>";
  const body = document.createElement("tbody");
  warsCache.forEach((w, i) => {
    const { fs, me, them } = split(w);
    const winner = fs.find(f => String(f.id) === String(w.winner));
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Open ranked war report: ${them?.name || fs.map(f => f.name).join(" versus ")}`);
    row.title = "Click to open war report and payout calculator";
    const cells = [fmtDate(w.start), w.end ? fmtDate(w.end) : "Ongoing",
      them ? `${them.name} [${them.id}]` : fs.map(f => f.name).join(" vs "),
      me && them ? `${Number(me.score || 0).toLocaleString()} – ${Number(them.score || 0).toLocaleString()}` : fs.map(f => Number(f.score || 0).toLocaleString()).join(" – "),
      w.end ? (winner?.name ?? "–") : "–"];
    cells.forEach(v => { const td = document.createElement("td"); td.textContent = v; row.append(td); });
    const open = () => openWarReport(w);
    row.addEventListener("click", open);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    body.append(row);
  });
  tbl.append(body);
  const last = warsCache[0];
  if (!last) { $("sTarget").textContent = "None"; return; }
  const { fs, them } = split(last);
  $("sTarget").textContent = (them ? them.name : fs.map(f => f.name).join(" vs ")) + (last.end ? " (ended)" : "");
}

const num = v => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v.replace(/[,\s$]/g, "")); return Number.isFinite(n) ? n : 0; }
  return 0;
};
const money = v => "$" + Math.round(num(v)).toLocaleString("en-US");
function warFactionName(f) { return f?.name || (f?.id ? `Faction ${f.id}` : "Unknown faction"); }
function extractWarMembers(faction) {
  const candidates = faction?.members || faction?.participants || faction?.users || faction?.players || [];
  if (Array.isArray(candidates)) return candidates;
  if (candidates && typeof candidates === "object") return Object.entries(candidates).map(([id, m]) => ({ id, ...m }));
  return [];
}
function memberMetric(m, metric = payoutSettings.metric) {
  return metric === "attacks" ? memberAttacks(m) : memberRespect(m);
}
function memberAttacks(m) {
  return Math.max(0, num([m.attacks, m.total_attacks, m.war_attacks, m.hits, m.war_hits].find(v => v !== undefined && v !== null)));
}
function memberRespect(m) { return Math.max(0, num([m.respect, m.respect_earned, m.total_respect, m.score].find(v => v !== undefined && v !== null))); }
function reportMemberName(m) { return m.name || m.username || (m.id ? `Player ${m.id}` : "Unknown player"); }
function memberIdentityKeys(m) {
  const keys = [];
  for (const id of [m?.id, m?.user_id, m?.player_id]) if (id !== undefined && id !== null && String(id).trim()) keys.push(`id:${String(id)}`);
  for (const name of [m?.name, m?.username]) if (name) keys.push(`name:${String(name).trim().toLowerCase()}`);
  return [...new Set(keys)];
}
function memberIsExcluded(m, state) { return memberIdentityKeys(m).some(k => state.excludedKeys.has(k)); }
function excludeWarMember(index) {
  if (!activeWarState) return;
  const m = activeWarState.allReportMembers[index];
  if (!m) return;
  memberIdentityKeys(m).forEach(k => activeWarState.excludedKeys.add(k));
  refreshWarMemberViews(activeWarState);
}
function restoreWarMember(index) {
  if (!activeWarState) return;
  const m = activeWarState.allReportMembers[index];
  if (!m) return;
  memberIdentityKeys(m).forEach(k => activeWarState.excludedKeys.delete(k));
  refreshWarMemberViews(activeWarState);
}
function refreshWarMemberViews(state) {
  const visible = state.allReportMembers.filter(m => !memberIsExcluded(m, state));
  state.reportMembers = visible;
  const memberCount = document.querySelector(".war-summary .stat:nth-child(3) b");
  if (memberCount) memberCount.textContent = visible.length;
  const sorted = visible.map(m => ({ m, index: state.allReportMembers.indexOf(m) })).sort((a, b) => memberAttacks(b.m) - memberAttacks(a.m));
  const tbl = $("tWarMembers");
  tbl.innerHTML = "<thead><tr>" + ["Player", "Attacks / hits", "Respect / score", "Action"].map(h => `<th>${esc(h)}</th>`).join("") + "</tr></thead>";
  const body = document.createElement("tbody");
  sorted.forEach(({m, index}) => {
    const tr = document.createElement("tr");
    [reportMemberName(m), memberAttacks(m).toLocaleString(), memberRespect(m).toLocaleString()].forEach(v => { const td = document.createElement("td"); td.textContent = v; tr.append(td); });
    const td = document.createElement("td"); const btn = document.createElement("button"); btn.type = "button"; btn.className = "remove-member"; btn.textContent = "Remove"; btn.title = "Exclude this player from this report and all payout calculations"; btn.dataset.memberAction = "remove"; btn.dataset.memberIndex = index; td.append(btn); tr.append(td); body.append(tr);
  });
  tbl.append(body);
  const excluded = state.allReportMembers.map((m, index) => ({m,index})).filter(({m}) => memberIsExcluded(m,state));
  const box = $("excludedWarMembers");
  if (box) {
    if (!excluded.length) box.innerHTML = "";
    else box.innerHTML = `<div class="excluded-heading">Excluded from this report (${excluded.length}) <button type="button" class="ghost" data-member-action="restore-all">Restore all</button></div><div class="excluded-list">${excluded.map(({m,index}) => `<span>${esc(reportMemberName(m))} <button type="button" class="ghost restore-member" data-member-action="restore" data-member-index="${index}">Restore</button></span>`).join("")}</div>`;
  }
  renderPayoutTable(state);
}
function savePayoutSettings() {
  try { localStorage.setItem("warPayoutSettings", JSON.stringify(payoutSettings)); } catch {}
}
function reportWarObject(data) { return data?.rankedwarreport || data?.rankedwar || data?.report || data; }
function normalizeReportFactions(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.entries(value).map(([id, faction]) => ({ id, ...faction }));
  return [];
}
async function openWarReport(war) {
  const dialog = $("warDialog");
  $("warDialogTitle").textContent = "Ranked war report";
  const rowFactions = normalizeReportFactions(war.factions);
  $("warDialogSubtitle").textContent = `${rowFactions.map(warFactionName).join(" vs ") || "Ranked war"} · ${fmtDate(war.start)}`;
  $("warReportBody").innerHTML = '<p class="report-empty">Loading ranked war report…</p>';
  if (!dialog.open) dialog.showModal();
  try {
    const warId = war.id ?? war.war_id ?? war.ranked_war_id;
    if (!warId) throw new Error("This war row has no war ID, so its report cannot be requested.");
    const response = await api(`/faction/${encodeURIComponent(warId)}/rankedwarreport`);
    activeWarReport = reportWarObject(response);
    renderWarReport(activeWarReport, war, response);
  } catch (e) {
    $("warReportBody").innerHTML = `<p class="report-empty">Could not load this report: ${esc(e.message)}. Check that your API key can access ranked war reports and that this war has a report available.</p>`;
  }
}
function renderWarReport(report, fallbackWar, rawResponse) {
  const warDetails = report?.war || report;
  const factions = normalizeReportFactions(report?.factions || fallbackWar?.factions);
  const ourFaction = (ownId && factions.find(f => String(f.id) === String(ownId))) || factions[0] || {};
  const enemyFaction = factions.find(f => String(f.id) !== String(ourFaction.id)) || {};
  const reportMembers = extractWarMembers(ourFaction);
  const start = warDetails?.start || fallbackWar?.start;
  const end = warDetails?.end || fallbackWar?.end;
  const winnerId = warDetails?.winner ?? fallbackWar?.winner;
  const winner = factions.find(f => String(f.id) === String(winnerId));
  $("warDialogTitle").textContent = `${warFactionName(ourFaction)} vs ${warFactionName(enemyFaction)}`;
  $("warDialogSubtitle").textContent = `${fmtDate(start)} – ${end ? fmtDate(end) : "Ongoing"}${winner ? ` · Winner: ${warFactionName(winner)}` : ""} · War ID ${warDetails?.id ?? fallbackWar?.id ?? fallbackWar?.war_id ?? "–"}`;

  const summary = `<div class="war-summary">${[
    ["Our score", num(ourFaction.score).toLocaleString()], ["Opponent score", num(enemyFaction.score).toLocaleString()],
    ["Our reported members", reportMembers.length], ["War status", end ? "Completed" : "Ongoing"]
  ].map(([label, value]) => `<div class="stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join("")}</div>`;
  const settings = `<div class="panel"><h3>Payout calculator</h3>
    <div class="payout-controls">
      <label for="payoutPool">Total payout pool ($)<input id="payoutPool" type="number" min="0" step="1" value="${esc(payoutSettings.pool)}"></label>
      <label for="payoutFactionRatio">Faction share (%)<input id="payoutFactionRatio" type="number" min="0" max="100" step="1" value="${esc(payoutSettings.faction)}"></label>
      <label for="payoutContributionRatio">Contribution share (%)<input id="payoutContributionRatio" type="number" min="0" max="100" step="1" value="${esc(payoutSettings.contribution)}"></label>
      <label for="payoutParticipationRatio">Participation share (%)<input id="payoutParticipationRatio" type="number" min="0" max="100" step="1" value="${esc(payoutSettings.participation)}"></label>
      <label for="payoutMetric">Contribution measured by<select id="payoutMetric"><option value="respect" ${payoutSettings.metric === "respect" ? "selected" : ""}>Respect earned</option><option value="attacks" ${payoutSettings.metric === "attacks" ? "selected" : ""}>Attacks made</option></select></label>
    </div>
    <p id="payoutRatioStatus" class="ratio-status" aria-live="polite"></p>
    <div class="payout-actions"><button id="exportPayoutCsv" type="button">Export payout CSV</button><button id="copyPayoutReport" type="button" class="ghost">Copy payout report</button></div>
    <div class="scroll"><table id="tPayouts" class="payout-table"></table></div>
  </div>`;
  const memberSection = reportMembers.length
    ? `<div class="panel"><h3>Reported member performance</h3><p class="panel-note">Remove a player to exclude them from the report and every payout share. This only changes this browser report, not Torn data.</p><div class="scroll"><table id="tWarMembers"></table></div><div id="excludedWarMembers" class="excluded-members"></div></div>`
    : `<div class="panel"><h3>Member performance</h3><p class="report-empty">The response did not include a recognised member list for your faction. The report is shown below so the response shape can be checked; the payout table will be available once member-level data is returned.</p></div>`;
  const raw = `<details class="panel"><summary style="padding:10px;cursor:pointer;font-weight:bold">Raw API response (debug)</summary><pre class="api-json">${esc(JSON.stringify(rawResponse, null, 2))}</pre></details>`;
  $("warReportBody").innerHTML = summary + settings + memberSection + raw;
  if (reportMembers.length) {
    const sorted = [...reportMembers].sort((a, b) => memberAttacks(b) - memberAttacks(a));
    table($("tWarMembers"), ["Player", "Attacks / hits", "Respect / score"], sorted.map(m => [reportMemberName(m), memberAttacks(m).toLocaleString(), memberRespect(m).toLocaleString()]));
    const warState = { allReportMembers: [...reportMembers], reportMembers: [...reportMembers], excludedKeys: new Set(), rawResponse, fallbackWar, report };
    activeWarState = warState;
    $("tWarMembers").addEventListener("click", e => {
      const btn = e.target.closest("button[data-member-action]"); if (!btn) return;
      if (btn.dataset.memberAction === "remove") excludeWarMember(Number(btn.dataset.memberIndex));
    });
    $("excludedWarMembers").addEventListener("click", e => {
      const btn = e.target.closest("button[data-member-action]"); if (!btn) return;
      if (btn.dataset.memberAction === "restore") restoreWarMember(Number(btn.dataset.memberIndex));
      if (btn.dataset.memberAction === "restore-all") { warState.excludedKeys.clear(); refreshWarMemberViews(warState); }
    });
    ["payoutPool", "payoutFactionRatio", "payoutContributionRatio", "payoutParticipationRatio"].forEach(id => {
      $(id).addEventListener("input", () => {
        payoutSettings.pool = Math.max(0, num($("payoutPool").value));
        payoutSettings.faction = num($("payoutFactionRatio").value);
        payoutSettings.contribution = num($("payoutContributionRatio").value);
        payoutSettings.participation = num($("payoutParticipationRatio").value);
        savePayoutSettings();
        refreshWarMemberViews(warState);
      });
    });
    $("payoutMetric").addEventListener("change", () => {
      payoutSettings.metric = $("payoutMetric").value;
      savePayoutSettings();
      refreshWarMemberViews(warState);
    });
    $("exportPayoutCsv").addEventListener("click", () => exportPayoutCsv(warState));
    $("copyPayoutReport").addEventListener("click", () => copyPayoutReport(warState));
    refreshWarMemberViews(warState);
  } else {
    $("tPayouts").innerHTML = "";
  }
}
function calculatePayouts(state) {
  const { reportMembers } = state;
  const pool = Math.max(0, Math.floor(num(payoutSettings.pool)));
  const ratios = [num(payoutSettings.faction), num(payoutSettings.contribution), num(payoutSettings.participation)];
  const valid = ratios.every(v => Number.isFinite(v) && v >= 0 && v <= 100) && Math.abs(ratios.reduce((a, b) => a + b, 0) - 100) < 0.0001;
  if (!valid) return { valid: false, rows: [], pool, ratios };
  const keyOf = m => String(m.id ?? m.user_id ?? m.name ?? m.username ?? "unknown");
  const factionCents = Math.round(pool * ratios[0] / 100);
  const contributionCents = Math.round(pool * ratios[1] / 100);
  const participationCents = pool - factionCents - contributionCents;
  const allocate = (amount, people, weightFn) => {
    const weights = people.map(weightFn), total = weights.reduce((a, b) => a + b, 0);
    if (!people.length || total <= 0) return new Map();
    const result = new Map(); let assigned = 0;
    people.forEach((m, i) => { const share = Math.floor(amount * weights[i] / total); result.set(keyOf(m), share); assigned += share; });
    // Give rounding remainder to the largest-weight recipients, deterministically.
    const ranked = people.map((m, i) => ({ m, weight: weights[i] })).sort((a, b) => b.weight - a.weight);
    for (let i = 0; i < amount - assigned; i++) { const k = keyOf(ranked[i % ranked.length].m); result.set(k, (result.get(k) || 0) + 1); }
    return result;
  };
  const contributionShares = allocate(contributionCents, reportMembers, m => memberMetric(m));
  const participationShares = allocate(participationCents, reportMembers, () => 1);
  const rows = reportMembers.map(m => {
    const k = keyOf(m), contribution = contributionShares.get(k) || 0, participation = participationShares.get(k) || 0;
    return { member: m, name: reportMemberName(m), attacks: memberAttacks(m), respect: memberRespect(m), contribution, participation, total: contribution + participation };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const distributedToMembers = rows.reduce((sum, r) => sum + r.total, 0);
  return { valid: true, rows, pool, ratios, recipientCount: rows.length, factionCents, contributionCents, participationCents, unallocated: Math.max(0, pool - factionCents - distributedToMembers) };
}
function renderPayoutTable(state) {
  const result = calculatePayouts(state);
  const status = $("payoutRatioStatus");
  if (!result.valid) {
    status.textContent = `Ratios must add up to exactly 100%. Current total: ${result.ratios.reduce((a, b) => a + b, 0)}%.`;
    status.className = "ratio-status invalid"; $("tPayouts").innerHTML = ""; return;
  }
  status.className = "ratio-status";
  const contributionMetric = payoutSettings.metric === "attacks" ? "attacks made" : "respect/score earned";
  status.textContent = `Pool ${money(result.pool)} · Faction ${result.ratios[0]}% (${money(result.factionCents)} to the shared faction vault) · Contribution ${result.ratios[1]}% (${contributionMetric}) · Participation ${result.ratios[2]}%. Contribution share is weighted by ${contributionMetric}; participation share is split evenly across all included report members, regardless of attacks. ${result.recipientCount} report member(s) included.${result.unallocated ? ` ${money(result.unallocated)} remains unallocated because one or more player shares have no eligible recipients.` : ""}`;
  const rows = [
    ["Shared faction vault", "–", "–", money(result.factionCents), "–", "–", money(result.factionCents)],
    ...result.rows.map(r => [r.name, r.attacks.toLocaleString(), r.respect.toLocaleString(), "–", money(r.contribution), money(r.participation), money(r.total)]),
  ];
  table($("tPayouts"), ["Recipient", "Attacks", "Respect", "Faction share", `${payoutSettings.metric === "attacks" ? "Attack" : "Respect"}-weighted contribution`, "Participation share", "Total payout"], rows);
}
function exportPayoutCsv(state) {
  const result = calculatePayouts(state);
  if (!result.valid) return show("Payout ratios must add up to 100% before exporting.", true);
  const rows = [
    ["Recipient", "Player ID", "Attacks", "Respect", "Faction share", `${payoutSettings.metric === "attacks" ? "Attack" : "Respect"}-weighted contribution`, "Participation share", "Total payout"],
    ["Shared faction vault", "", "", "", result.factionCents, "", "", result.factionCents],
    ...result.rows.map(r => [r.name, r.member.id ?? "", r.attacks, r.respect, "", r.contribution, r.participation, r.total]),
  ];
  const csv = rows.map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `ranked-war-${state.report?.id || state.fallbackWar?.id || "payout"}-payout.csv`; a.click(); URL.revokeObjectURL(url);
}
async function copyPayoutReport(state) {
  const result = calculatePayouts(state);
  if (!result.valid) return show("Payout ratios must add up to 100% before copying.", true);
  const textReport = [
    "Ranked War Payout Report",
    `Pool: ${money(result.pool)}`,
    `Ratios: Faction ${result.ratios[0]}% / Contribution ${result.ratios[1]}% / Participation ${result.ratios[2]}%`,
    `Contribution weight: ${payoutSettings.metric === "attacks" ? "attacks made" : "respect/score earned"}`,
    "",
    `Faction cut: ${money(result.factionCents)}`,
    "",
    "Player | Attacks | Respect | Contribution | Participation | Total",
    ...result.rows.map(r => `${r.name} | ${r.attacks} | ${r.respect} | ${money(r.contribution)} | ${money(r.participation)} | ${money(r.total)}`),
  ].join("\n");
  try { await navigator.clipboard.writeText(textReport); show("Payout report copied to clipboard."); }
  catch { show("Clipboard access was blocked by the browser. Use Export payout CSV instead.", true); }
}
function renderOcs(crimes) {
  const byStatus = {};
  crimes.forEach(c => byStatus[c.status] = (byStatus[c.status] || 0) + 1);
  chart("cOc", { type: "bar", data: { labels: Object.keys(byStatus), datasets: [{ label: "Crimes", data: Object.values(byStatus), backgroundColor: "#e08a1e" }] }, options: { plugins: { legend: { display: false } } } });
  const recent = [...crimes].sort((a, b) => (b.executed_at ?? b.created_at ?? 0) - (a.executed_at ?? a.created_at ?? 0)).slice(0, 25);
  table($("tOcs"), ["Crime", "Difficulty", "Status", "Executed", "Money"], recent.map(c => [c.name, c.difficulty, c.status, fmtDate(c.executed_at), c.rewards?.money != null ? c.rewards.money.toLocaleString() : "–"]));
}

/* ---------- Load ---------- */
async function loadAll() {
  if (!$("key").value.trim()) return show("Enter an API key first.", true);
  localStorage.setItem("tornKey", $("key").value.trim());
  show("Loading…");
  const errors = [];
  const run = async (name, fn) => { try { await fn(); } catch (e) { errors.push(`${name}: ${e.message}`); } };

  await run("Faction", async () => {
    const d = await api("/faction/basic");
    ownId = (d.basic || d).id ?? null;
  });
  await run("Members", async () => {
    const d = await api("/faction/members", { striptags: "true" });
    members = d.members || [];
    renderOverview(); renderRoles(); renderActivity(); renderLevels();
  });
  await run("Wars", async () => {
    const d = await api("/faction/rankedwars");
    renderWars(d.rankedwars || d.wars || []);
  });
  await run("Crimes", async () => {
    const d = await api("/faction/crimes", { limit: 100, sort: "desc" });
    renderOcs(d.crimes || []);
  });
  show(errors.length ? errors.join(" | ") : "", errors.length > 0);
}

/* ---------- UI wiring ---------- */
(function () {
  let t; try { t = localStorage.getItem("theme"); } catch {}
  if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
})();
$("theme").addEventListener("click", () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("theme", t); } catch {}
  if (members.length) loadAll();
});
$("tabs").addEventListener("click", e => {
  const t = e.target.closest(".tab"); if (!t) return;
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b === t));
  document.querySelectorAll("[data-panel]").forEach(p => p.hidden = p.id !== t.dataset.tab);
});
$("save").addEventListener("click", loadAll);
$("closeWarDialog").addEventListener("click", () => $("warDialog").close());
$("warDialog").addEventListener("click", e => { if (e.target === $("warDialog")) $("warDialog").close(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("warDialog").open) $("warDialog").close(); });
$("fsearch").addEventListener("click", lookup);
$("fid").addEventListener("keydown", e => { if (e.key === "Enter") lookup(); });
$("forget").addEventListener("click", () => { localStorage.removeItem("tornKey"); $("key").value = ""; show("Key removed from this browser."); });
try { const k = localStorage.getItem("tornKey"); if (k) { $("key").value = k; loadAll(); } } catch {}
