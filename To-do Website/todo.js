// Complete, working script for Doing Right Now (single item with optional due date)
(function () {
  // Ensure script runs after DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    const form = document.getElementById("doing-form");
    const input = document.getElementById("doing-input");
    const dueInput = document.getElementById("due-input");
    const list = document.getElementById("doing-list");

    if (!form || !input || !dueInput || !list) {
      console.error("Required elements not found in DOM.");
      return;
    }

    // --- Load saved item safely ---
    let savedDoing = null;
    try {
      const raw =
        localStorage.getItem("doing_item") || localStorage.getItem("doing");
      if (raw) {
        savedDoing = JSON.parse(raw);
      }
    } catch (err) {
      console.warn("Corrupted old localStorage value cleared.");
      localStorage.removeItem("doing");
    }

    if (savedDoing && savedDoing.task) {
      renderItem(savedDoing.task, savedDoing.due);
    }

    // --- Handle form submit ---
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const task = (input.value || "").trim();
      const due = (dueInput.value || "").trim();

      if (!task) return;

      if (list.children.length > 0) {
        alert("Only one item allowed in 'Doing Right Now'. Mark it done first.");
        return;
      }

      save({ task, due });
      renderItem(task, due);
      input.value = "";
      dueInput.value = "";
    });

    // --- Render item into the box ---
    function renderItem(task, due) {
      list.innerHTML = ""; // enforce single item

      const li = document.createElement("li");
      li.className = "doing-item";

      const taskLine = document.createElement("div");
      taskLine.className = "task-line";
      taskLine.textContent = task;

      li.appendChild(taskLine);

      if (due) {
        const dueLine = document.createElement("div");
        dueLine.className = "due-line";
        dueLine.textContent = due;
        li.appendChild(dueLine);
      }

      const btnRow = document.createElement("div");
      btnRow.className = "btn-row";

      const doneBtn = document.createElement("button");
      doneBtn.className = "btn btn-danger";
      doneBtn.textContent = "Done";
      doneBtn.addEventListener("click", function () {
        list.innerHTML = "";
        localStorage.removeItem("doing_item");
      });

      btnRow.appendChild(doneBtn);
      li.appendChild(btnRow);

      list.appendChild(li);
    }

    // --- Save item to localStorage ---
    function save(obj) {
      localStorage.setItem("doing_item", JSON.stringify(obj));
    }
  }
})();
