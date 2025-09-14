// Supabase setup
const { createClient } = supabase
const supabaseUrl = "https://walsvybskelqhgvpdagj.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhbHN2eWJza2VscWhndnBkYWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4MDQyMjUsImV4cCI6MjA3MzM4MDIyNX0.tDaLE2F2gOZnqU06Qt9XvgfeV3Qo9kdhmr-mZem7cV4"
const supabaseClient = createClient(supabaseUrl, supabaseKey)

// Your Supabase list IDs
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
}

// Load data on startup
document.addEventListener("DOMContentLoaded", loadAllData)

async function loadAllData() {
  // Load titles
  const { data: lists } = await supabaseClient.from("lists").select("id,title")
  if (lists) {
    for (let l of lists) {
      const key = Object.keys(LIST_IDS).find(k => LIST_IDS[k] === l.id)
      if (key && document.getElementById(key.replace("other","otherTitle"))) {
        document.getElementById(key.replace("other","otherTitle")).textContent = l.title
      }
    }
  }
  loadAllTasks()
}

async function loadAllTasks() {
  for (const [key, listId] of Object.entries(LIST_IDS)) {
    const { data: tasks, error } = await supabaseClient
      .from("tasks")
      .select("*")
      .eq("list_id", listId)
      .order("created_at")

    if (error) { console.error(error); continue }

    const ul = document.getElementById(key + "List")
    if (!ul) continue
    ul.innerHTML = ""

    tasks.forEach(task => {
      const li = document.createElement("li")
      li.textContent = task.content + (task.due_date ? " @ " + task.due_date : "")

      const btn = document.createElement("button")
      btn.textContent = "Done"
      btn.classList.add("done")
      btn.onclick = async function() {
        await supabaseClient.from("tasks").delete().eq("id", task.id)
        li.remove()
      }

      li.appendChild(btn)
      ul.appendChild(li)
    })
  }
}

async function addTask(listId, inputId, dateId, ulId, maxItems) {
  const input = document.getElementById(inputId).value.trim()
  const date = document.getElementById(dateId).value.trim()
  if (input === "") return

  const ul = document.getElementById(ulId)
  if (maxItems && ul.children.length >= maxItems) {
    alert("Max items reached!")
    return
  }

  const { error } = await supabaseClient.from("tasks").insert([
    { list_id: listId, content: input, due_date: date || null }
  ])

  if (!error) {
    document.getElementById(inputId).value = ""
    document.getElementById(dateId).value = ""
    loadAllTasks()
  } else {
    console.error(error)
  }
}

async function editTitle(spanId, listId) {
  let span = document.getElementById(spanId)
  let current = span.textContent
  let newTitle = prompt("Enter new title:", current)

  if (newTitle !== null && newTitle.trim() !== "") {
    span.textContent = newTitle.trim()
    const { error } = await supabaseClient
      .from("lists")
      .update({ title: newTitle.trim() })
      .eq("id", listId)
    if (error) {
      console.error("Error updating title:", error)
      alert("Could not save title to Supabase!")
    }
  }
}
