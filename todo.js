// ===== todo.js (full) =====

// Supabase setup
const { createClient } = supabase;
const supabaseUrl = "https://walsvybskelqhgvpdagj.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhbHN2eWJza2VscWhndnBkYWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4MDQyMjUsImV4cCI6MjA3MzM4MDIyNX0.tDaLE2F2gOZnqU06Qt9XvgfeV3Qo9kdhmr-mZem7cV4";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// List IDs (from your Supabase rows)
const LIST_IDS = {
  doing:    "b093c6d8-9ed6-41ec-9667-2467066b84d3",
  must:     "df9db72b-b8ee-4178-bc1d-e5f55c9dcca7",
  discrete: "6226fc41-18d7-46af-95c3-4b320300b793",
  calc:     "401cf998-6e39-4581-a2b6-0bc9655870cf",
  cyber:    "3a396ff1-962b-4357-91ff-d19fefa4a3ac",
  topics:   "61d6d0f2-2112-4cb2-9ee8-17119b631756",
  other1:   "32dd9a59-8fa4-45f3-a20f-e801549179d1",
  other2:   "2ff32464-e2a3-43c5-adfc-cbe17439ad7d",
  other3:   "63d46c8e-16f1-4c88-b4e8-09fdfa9e93fe",
  other4:   "e88dc7fa-6815-4eb9-8d02-cd5c023d853f",
  other5:   "f55cf27c-0226-4440-874e-c47b7294cbf3",
  other6:   "6715ee6e-5d0f-429d-959d-3b1ea829ccf4",
  other7:   "3f716ddf-bec1-43c1-8044-410571761697",
  other8:   "ab443152-9534-4647-8f51-ab1ffd3867ca"
};

// UL ids in the HTML
const UL_IDS = {
  doing: "doingList",
  must: "mustList",
  discrete: "discreteList",
  calc: "calcList",
  cyber: "cyberList",
  topics: "topicsList",
  other1: "otherList1",
  other2: "otherList2",
  other3: "otherList3",
  other4: "otherList4",
  other5: "otherList5",
  other6: "otherList6",
  other7: "otherList7",
  other8: "otherList8"
};

// Title span ids for "Other Important Lists"
const TITLE_SPAN_IDS = {
  other1: "otherTitle1",
  other2: "otherTitle2",
  other3: "otherTitle3",
  other4: "otherTitle4",
  other5: "otherTitle5",
  other6: "otherTitle6",
  other7: "otherTitle7",
  other8: "otherTitle8"
};

// ---------- Utils ----------
function parseMMDD(mmdd) {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(mmdd || "");
  if (!m) return null;
  const month = +m[1], day = +m[2];
  const year = new Date().getFullYear();
  const d = new Date(year, month - 1, day);
  if (d.getMonth() + 1 !== month || d.getDate() !== day) return null;
  return d;
}

function parseFlexibleDate(s) {
  if (!s) return null;
  const d1 = parseMMDD(s);
  if (d1) return d1;
  const d2 = new Date(s);
  return isNaN(d2.getTime()) ? null : d2;
}

function parseUrgency(raw) {
  const s = (raw ?? "").toString().trim();
  if (!s) return null;
  if (/^[1-3]$/.test(s)) return Number(s);
  return null;
}

function getDueModeForInputId(inputId) {
  const modeEl = document.getElementById(`${inputId}Mode`);
  return (modeEl?.value || "date").toString();
}

// Keeps the "Date / Urgency" slot feeling like one control.
function syncDueMode(modeSelectId, inputId) {
  const modeEl = document.getElementById(modeSelectId);
  const inputEl = document.getElementById(inputId);
  if (!modeEl || !inputEl) return;

  const mode = modeEl.value;
  inputEl.value = "";
  inputEl.dataset.mode = mode;

  if (mode === "urgency") {
    inputEl.placeholder = "1-3";
    inputEl.inputMode = "numeric";
    inputEl.maxLength = 1;
  } else {
    inputEl.placeholder = "MM/DD";
    inputEl.removeAttribute("inputmode");
    inputEl.removeAttribute("maxlength");
  }
}

function ordinal(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return n + "th";
  switch (n % 10) {
    case 1: return n + "st";
    case 2: return n + "nd";
    case 3: return n + "rd";
    default: return n + "th";
  }
}

function formatLongNoYearWithOrdinal(date) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "long" });
  const day = ordinal(date.getDate());
  return `${weekday} ${month} ${day}`;
}

// New short formatters
function formatShortDate(date) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" }); // Mon
  const day = date.getDate();
  return `${weekday} ${day}`;
}

function formatUltraShortDate(date) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "narrow" }); // M
  const day = date.getDate();
  return `${weekday} ${day}`;
}

// ---------- Load ----------
document.addEventListener("DOMContentLoaded", () => {
  loadAllData();

  // Toggle button logic
  const toggleBtn = document.getElementById("toggleViewBtn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      document.body.classList.toggle("expanded");

      if (document.body.classList.contains("expanded")) {
        toggleBtn.textContent = "📋 Compact View";
      } else {
        toggleBtn.textContent = "🔍 Expand View";
      }
    });
  }
});

async function loadAllData() {
  const { data: lists, error } = await supabaseClient
    .from("lists")
    .select("id,title");

  if (error) console.error(error);

  if (lists) {
    for (let l of lists) {
      const key = Object.keys(LIST_IDS).find(k => LIST_IDS[k] === l.id);
      if (key && TITLE_SPAN_IDS[key]) {
        const el = document.getElementById(TITLE_SPAN_IDS[key]);
        if (el) el.textContent = l.title;
      }
    }
  }

  loadAllTasks();
}

async function loadAllTasks() {
  for (const [key, listId] of Object.entries(LIST_IDS)) {
    const { data: tasks, error } = await supabaseClient
      .from("tasks")
      .select("*")
      .eq("list_id", listId)
      // Urgent items first, then dates.
      .order("urgency", { ascending: false, nullsFirst: false })
      .order("due_date", { ascending: true, nullsFirst: false });

    if (error) {
      console.error(error);
      continue;
    }

    const ul = document.getElementById(UL_IDS[key]);
    if (!ul) continue;

    ul.innerHTML = "";

    tasks.forEach(task => {
      // Row container (grid: 75% task | 25% due | auto button)
      const li = document.createElement("li");
      li.classList.add("task-item");

      // Task column
      const taskCol = document.createElement("div");
      taskCol.classList.add("task-col");
      taskCol.textContent = task.content;
      li.appendChild(taskCol);

      // Due column with color logic
      const dueCol = document.createElement("div");
      dueCol.classList.add("due-col");

      // Prefer urgency display if present; otherwise show date.
      if (task.urgency) {
        dueCol.textContent = `U${task.urgency}`;
        if (task.urgency === 3) dueCol.style.color = "red";
        else if (task.urgency === 2) dueCol.style.color = "orange";
        else dueCol.style.color = "grey";
      } else if (task.due_date) {
        const parsed = parseFlexibleDate(task.due_date);

        if (parsed) {
          // small cards keys
          const smallKeys = [
            "discrete", "calc", "cyber", "topics",
            "other1", "other2", "other3", "other4",
            "other5", "other6", "other7", "other8"
          ];

          if (smallKeys.includes(key)) {
            dueCol.textContent = formatShortDate(parsed);

            // fallback to ultra short if overflow
            setTimeout(() => {
              if (dueCol.scrollWidth > dueCol.clientWidth) {
                dueCol.textContent = formatUltraShortDate(parsed);
              }
            }, 0);
          } else {
            dueCol.textContent = formatLongNoYearWithOrdinal(parsed);
          }

          // color logic (expanded system)
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const in3Days = new Date(today); in3Days.setDate(today.getDate() + 3);
          const in1Week = new Date(today); in1Week.setDate(today.getDate() + 7);
          const in2Weeks = new Date(today); in2Weeks.setDate(today.getDate() + 14);

          if (parsed < today) {
            dueCol.style.color = "red";        // overdue
          } else if (+parsed === +today) {
            dueCol.style.color = "red";        // due today
          } else if (parsed <= in3Days) {
            dueCol.style.color = "orange";     // within 3 days
          } else if (parsed <= in1Week) {
            dueCol.style.color = "gold";       // within 1 week
          } else if (parsed <= in2Weeks) {
            dueCol.style.color = "blue";       // within 2 weeks
          } else {
            dueCol.style.color = "grey";       // later
          }
        }
      }

      li.appendChild(dueCol);

      // Edit button
      const editBtn = document.createElement("button");
      editBtn.textContent = "✎";
      editBtn.classList.add("edit");
      editBtn.onclick = async function () {
        const newContent = prompt("Edit task:", task.content ?? "");
        if (newContent === null) return; // user cancelled

        const existing = task.urgency ? String(task.urgency) : (task.due_date ?? "");
        const newDueOrUrgency = prompt(
          "Edit due date (MM/DD) OR urgency (1-3) OR blank:",
          existing
        );
        if (newDueOrUrgency === null) return; // user cancelled

        const u = parseUrgency(newDueOrUrgency);
        const newDue = (u ? null : (newDueOrUrgency || "").trim() || null);

        const { error } = await supabaseClient
          .from("tasks")
          .update({
            content: newContent.trim(),
            due_date: newDue,
            urgency: u
          })
          .eq("id", task.id);

        if (error) {
          console.error("Error updating task:", error);
          alert("Could not save task edits to Supabase!");
          return;
        }

        loadAllTasks(); // refresh UI
      };
      li.appendChild(editBtn);

      // Delete button (red X)
      const btn = document.createElement("button");
      btn.textContent = "✖";
      btn.classList.add("done");
      btn.onclick = async function () {
        await supabaseClient.from("tasks").delete().eq("id", task.id);
        li.remove();
      };
      li.appendChild(btn);

      ul.appendChild(li);
    });
  }
}

// ---------- Actions ----------
async function addTask(listId, inputId, dateId, ulId, maxItems) {
  const inputEl = document.getElementById(inputId);
  const dateEl  = document.getElementById(dateId);

  const content = (inputEl?.value || "").trim();
  const raw = (dateEl?.value || "").trim(); // date text or urgency number
  const mode = getDueModeForInputId(dateId);

  if (!content) return;

  const ul = document.getElementById(ulId);
  if (maxItems && ul && ul.children.length >= maxItems) {
    alert("Max items reached!");
    return;
  }

  let due_date = null;
  let urgency = null;

  if (mode === "urgency") {
    urgency = parseUrgency(raw);
    if (raw && urgency === null) {
      alert("Urgency must be 1, 2, or 3.");
      return;
    }
  } else {
    due_date = raw || null;
  }

  const { error } = await supabaseClient.from("tasks").insert([
    { list_id: listId, content, due_date, urgency }
  ]);

  if (!error) {
    if (inputEl) inputEl.value = "";
    if (dateEl)  dateEl.value  = "";
    loadAllTasks();
  } else {
    console.error(error);
  }
}

async function editTitle(spanId, listId) {
  const span = document.getElementById(spanId);
  if (!span) return;

  const current = span.textContent;
  const newTitle = prompt("Enter new title:", current);

  if (newTitle !== null && newTitle.trim() !== "") {
    span.textContent = newTitle.trim();

    const { error } = await supabaseClient
      .from("lists")
      .update({ title: newTitle.trim() })
      .eq("id", listId);

    if (error) {
      console.error("Error updating title:", error);
      alert("Could not save title to Supabase!");
    }
  }
}
