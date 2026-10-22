/**
 * Email -> Tomorrow Planner
 *
 * Runs inside one Gmail account (install it once in each account you use).
 * Every 15 minutes it takes the emails you have STARRED, or labelled "Planner",
 * and adds each one as a task in the planner, with a link back to the email.
 * The planner picks the tasks up from its sync gist the next time it syncs.
 *
 * Setup (once per account):
 *   1. script.google.com > New project, paste this file, save.
 *   2. Project Settings > Script properties, add:
 *        GITHUB_TOKEN  a GitHub token with only "gist" ticked (the same kind the app uses)
 *        GIST_ID       the id of the "Tomorrow Planner sync" gist
 *        ACCOUNT_TAG   a short name shown on the task, e.g. UNIMA, Gmail, Personal
 *   3. Run setup() once and allow the permissions it asks for.
 *
 * A synced email gets the Gmail label "planner-synced" so it is never added twice.
 * Deleting the task in the planner does not bring it back. Unstar the email when done.
 */

const GIST_FILE = "tomorrow-planner.json";
const SYNCED = "planner-synced";
const QUERY = "(is:starred OR label:planner) -label:" + SYNCED + " newer_than:30d";
const TZ = "Africa/Blantyre";

function setup() {
  // When installed from the command line, a temporary Config.gs carries the settings; copy them into Script properties.
  if (typeof PLANNER_CONFIG !== "undefined") PropertiesService.getScriptProperties().setProperties(PLANNER_CONFIG);
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncEmailToPlanner").timeBased().everyMinutes(15).create();
  if (!GmailApp.getUserLabelByName(SYNCED)) GmailApp.createLabel(SYNCED);
  if (!GmailApp.getUserLabelByName("Planner")) GmailApp.createLabel("Planner");
  syncEmailToPlanner();
}

function syncEmailToPlanner() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("GITHUB_TOKEN"), gistId = props.getProperty("GIST_ID");
  const me = Session.getActiveUser().getEmail();
  const tag = props.getProperty("ACCOUNT_TAG") || me.split("@")[0];
  if (!token || !gistId) throw new Error("Add GITHUB_TOKEN and GIST_ID under Project Settings > Script properties.");

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const threads = GmailApp.search(QUERY, 0, 25);
    if (!threads.length) return;
    const now = Date.now(), day = targetDay(new Date());
    const tasks = threads.map(t => {
      const m = t.getMessages()[0];
      const subject = (t.getFirstMessageSubject() || "(no subject)").replace(/^(re|fwd?):\s*/i, "").trim();
      const from = m.getFrom().replace(/<.*>/, "").replace(/"/g, "").trim() || m.getFrom();
      return {
        id: "e" + t.getId(), text: clip(subject, 90) + " (" + clip(from, 30) + ")", block: "any",
        stream: guessStream(subject + " " + m.getPlainBody().slice(0, 600)), top: false, done: false, carried: false,
        at: now, mod: now, url: "https://mail.google.com/mail/?authuser=" + encodeURIComponent(me) + "#all/" + t.getId(), src: tag,
      };
    });

    // Read, add, write, then read back: if another device or account wrote at the same moment, try again.
    for (let attempt = 0; attempt < 4; attempt++) {
      const data = readGist(token, gistId);
      const seen = new Set();
      Object.values(data.days || {}).forEach(d => {
        (d.tasks || []).forEach(x => seen.add(x.id));
        Object.keys(d.deleted || {}).forEach(id => seen.add(id));
      });
      const fresh = tasks.filter(x => !seen.has(x.id));
      if (!fresh.length) break;
      data.days = data.days || {};
      const d = data.days[day] || { tasks: [], deleted: {}, intention: "", intentionAt: 0, examen: "", examenAt: 0, updatedAt: "", date: day };
      d.tasks = (d.tasks || []).concat(fresh);
      d.updatedAt = new Date().toISOString();
      d.date = day;
      data.days[day] = d;
      data.syncedAt = new Date().toISOString();
      writeGist(token, gistId, data);
      Utilities.sleep(1500);
      const check = readGist(token, gistId);
      const ok = fresh.every(x => ((check.days || {})[day] || { tasks: [] }).tasks.some(y => y.id === x.id));
      if (ok) break;
    }
    const label = GmailApp.getUserLabelByName(SYNCED) || GmailApp.createLabel(SYNCED);
    threads.forEach(t => t.addLabel(label));
  } finally {
    lock.releaseLock();
  }
}

// Today if it is a weekday before 15:00, otherwise the next weekday.
function targetDay(d) {
  const hour = Number(Utilities.formatDate(d, TZ, "H"));
  let x = new Date(d.getTime());
  const dow = () => Number(Utilities.formatDate(x, TZ, "u")); // 1 = Monday ... 7 = Sunday
  if (dow() >= 6 || hour >= 15) {
    do { x = new Date(x.getTime() + 86400000); } while (dow() >= 6);
  }
  return Utilities.formatDate(x, TZ, "yyyy-MM-dd");
}

function guessStream(text) {
  const t = text.toLowerCase();
  if (/\b(phd|apply|applications?|scholarships?|vacanc\w*|positions?|studentships?|admissions?|interviews?|fellowships?|jobs?|doctoral|doctorate|degrees?|postdoc\w*|call for)\b/.test(t)) return "opp";
  if (/\b(manuscript|journal|paper|reviewer|revision|submission|preprint|article)\b/.test(t)) return "paper";
  if (/\b(class|lecture|students?|exam|test|marks?|course|eco ?\d{3}|tutorial|semester)\b/.test(t)) return "teach";
  return "cons";
}

function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function gh(token, path, opts) {
  const res = UrlFetchApp.fetch("https://api.github.com" + path, Object.assign({
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" },
    contentType: "application/json", muteHttpExceptions: true }, opts || {}));
  const code = res.getResponseCode();
  if (code >= 300) throw new Error("GitHub " + code + ": " + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function readGist(token, id) {
  const g = gh(token, "/gists/" + id);
  const f = g.files && g.files[GIST_FILE];
  if (!f) return { days: {} };
  const text = f.truncated ? UrlFetchApp.fetch(f.raw_url).getContentText() : f.content;
  try { return JSON.parse(text || "{}"); } catch (e) { return { days: {} }; }
}

function writeGist(token, id, data) {
  gh(token, "/gists/" + id, { method: "patch", payload: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(data) } } }) });
}
