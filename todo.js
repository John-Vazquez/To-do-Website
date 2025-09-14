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
  other4:   "e88dc7fa-6815-4eb9-8d02-cd5c023d853f"
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
  other4: "otherList4"
};

// Title span ids for "Other Important Lists"
const TITLE_SPAN_IDS = {
  other1: "otherTitle1",
  other2: "otherTitle2",
  other3: "otherTitle3",
  other4: "otherTitle4"
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
// ---------- Load ----------
document.addEventListener("DOMContentLoaded", () => {
  loadAllData();

  // Toggle button logic
  const toggleBtn = document.getElementById("toggleViewBtn");
  toggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("expanded");

    if (document.body.classList.contains("expanded")) {
      toggleBtn.textContent = "📋 Compact View";
    } else {
      toggleBtn.textContent = "🔍 Expand View";
    }
  });
});

async function loadAllData() {
  const { data: lists } = await supabaseClient.from("lists").select("id,title");
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
      .order("created_at");

    if (error) { console.error(error); continue; }

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

      if (task.due_date) {
        const parsed = parseFlexibleDate(task.due_date);
        if (parsed) {
          let formatted;
          if (["discrete","calc","cyber","topics","other1","other2","other3","other4"].includes(key)) {
            // small cards
            formatted = formatShortDate(parsed);
            dueCol.textContent = formatted;

            // fallback to ultra short if overflow
            setTimeout(() => {
              if (dueCol.scrollWidth > dueCol.clientWidth) {
                dueCol.textContent = formatUltraShortDate(parsed);
              }
            }, 0);
          } else {
            // big cards
            formatted = formatLongNoYearWithOrdinal(parsed);
            dueCol.textContent = formatted;
          }

                  // color logic (expanded system)
            const today = new Date(); today.setHours(0,0,0,0);
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

      // Done button (red X)
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
  const rawDate = (dateEl?.value || "").trim(); // store mm/dd or blank

  if (!content) return;

  const ul = document.getElementById(ulId);
  if (maxItems && ul && ul.children.length >= maxItems) {
    alert("Max items reached!");
    return;
  }

  const { error } = await supabaseClient.from("tasks").insert([
    { list_id: listId, content, due_date: rawDate || null }
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
