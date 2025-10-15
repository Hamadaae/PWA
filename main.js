// main.js

// ========== Service Worker Registration ==========
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .then(() => console.log("✅ Service Worker registered"))
    .catch((err) => console.error("❌ SW registration failed:", err));
}

// ========== Request Notification Permission ==========
async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    alert("This browser does not support notifications.");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    alert("Notifications are disabled. Enable them to receive reminders.");
  }
}
requestNotificationPermission();

// ========== IndexedDB Setup ==========
let db;
const request = indexedDB.open("TaskDB", 1);

request.onupgradeneeded = (e) => {
  db = e.target.result;
  const store = db.createObjectStore("tasks", { keyPath: "id", autoIncrement: true });
  store.createIndex("dateTime", "dateTime", { unique: false });
};

request.onsuccess = (e) => {
  db = e.target.result;
  displayTasks();
};

request.onerror = (e) => console.error("IndexedDB Error:", e.target.errorCode);

// ========== Add Task ==========
document.getElementById("taskForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("taskInput").value.trim();
  const date = document.getElementById("dateInput").value;
  const time = document.getElementById("timeInput").value;

  if (!name || !date || !time) return alert("Please fill all fields.");

  const dateTime = new Date(`${date}T${time}`);

  const transaction = db.transaction("tasks", "readwrite");
  const store = transaction.objectStore("tasks");
  const task = { name, dateTime: dateTime.toISOString(), notified: false };
  store.add(task);

  transaction.oncomplete = () => {
    document.getElementById("taskForm").reset();
    displayTasks();
    scheduleNotification(task);
  };
});

// ========== Display Tasks ==========
function displayTasks() {
  const taskList = document.getElementById("taskList");
  taskList.innerHTML = "";

  const transaction = db.transaction("tasks", "readonly");
  const store = transaction.objectStore("tasks");

  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      const task = cursor.value;
      const div = document.createElement("div");
      div.className = "bg-white p-4 rounded-md shadow-sm border border-gray-200";
      div.innerHTML = `
        <div class="flex justify-between items-center">
          <div>
            <h2 class="text-lg font-semibold">${task.name}</h2>
            <p class="text-gray-600">${new Date(task.dateTime).toLocaleString()}</p>
          </div>
          <button class="text-red-500 hover:text-red-700 font-medium" data-id="${task.id}">Delete</button>
        </div>
      `;
      taskList.appendChild(div);

      div.querySelector("button").addEventListener("click", () => deleteTask(task.id));
      cursor.continue();
    }
  };
}

// ========== Delete Task ==========
function deleteTask(id) {
  const transaction = db.transaction("tasks", "readwrite");
  const store = transaction.objectStore("tasks");
  store.delete(id);
  transaction.oncomplete = () => displayTasks();
}

// ========== Schedule Notification ==========
function scheduleNotification(task) {
  const now = Date.now();
  const taskTime = new Date(task.dateTime).getTime();
  const delay = taskTime - now;

  if (delay <= 0) return; // already passed

  console.log(`⏰ Notification scheduled for ${task.name} in ${Math.round(delay / 1000)}s`);

  setTimeout(() => {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "SHOW_NOTIFICATION",
        title: "⏰ Task Reminder",
        options: {
          body: `${task.name} is due now!`,
          icon: "bell.png",
          badge: "bell.png",
          vibrate: [200, 100, 200],
        },
      });
    } else {
      console.warn("No active service worker controller found.");
    }

    // mark task as notified
    const tx = db.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");
    store.get(task.id).onsuccess = (e) => {
      const t = e.target.result;
      if (t) {
        t.notified = true;
        store.put(t);
      }
    };
  }, delay);
}
