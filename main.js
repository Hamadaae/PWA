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

// helper: send message to active service worker (robust)
function postMessageToSW(message) {
  // navigator.serviceWorker.controller might be null if page isn't controlled yet,
  // so use navigator.serviceWorker.ready which resolves when there's an active SW controlling this scope.
  if (!("serviceWorker" in navigator)) return Promise.reject("No serviceWorker support");

  return navigator.serviceWorker.ready.then((reg) => {
    const sw = navigator.serviceWorker.controller || reg.active;
    if (sw) {
      sw.postMessage(message);
      return Promise.resolve();
    } else {
      console.warn("No active service worker to receive message.");
      return Promise.reject("no-active-sw");
    }
  });
}

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

  const tx = db.transaction("tasks", "readwrite");
  const store = tx.objectStore("tasks");
  const task = { name, dateTime: dateTime.toISOString(), notified: false };

  // capture the add request's result (the generated key)
  const addReq = store.add(task);
  addReq.onsuccess = (evt) => {
    const id = evt.target.result; // auto-incremented key
    task.id = id; // attach id to task

    // After the transaction completes, update UI and schedule
    tx.oncomplete = () => {
      document.getElementById("taskForm").reset();
      displayTasks();
      scheduleNotification(task); // pass task that includes .id
    };
  };
  addReq.onerror = (err) => {
    console.error("Failed to add task:", err);
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

      // If task not yet notified and scheduled in future, schedule it (reschedule after reload)
      try {
        if (!task.notified && new Date(task.dateTime).getTime() > Date.now()) {
          scheduleNotification(task);
        }
      } catch (err) {
        console.error("Error scheduling from displayTasks:", err);
      }

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
  // require task.id to be defined for later marking as notified
  if (typeof task.id === "undefined") {
    console.warn("scheduleNotification called for task without id, skipping.", task);
    return;
  }

  const now = Date.now();
  const taskTime = new Date(task.dateTime).getTime();
  const delay = taskTime - now;

  if (delay <= 0) return; // already passed

  console.log(`⏰ Notification scheduled for ${task.name} in ${Math.round(delay / 1000)}s`);

  // schedule in-page timeout (works while page is open). This plus reschedule on load covers common cases.
  setTimeout(() => {
    // post message to the service worker so it shows the notification even if page is in background
    postMessageToSW({
      type: "SHOW_NOTIFICATION",
      title: "⏰ Task Reminder",
      options: {
        body: `${task.name} is due now!`,
        icon: "bell.png",
        badge: "bell.png",
        vibrate: [200, 100, 200],
        data: { taskId: task.id }
      }
    }).catch((err) => {
      // fallback: if we can't reach SW, try the Notification API directly (if allowed)
      if (Notification.permission === "granted") {
        new Notification("⏰ Task Reminder", {
          body: `${task.name} is due now!`,
          icon: "bell.png",
          badge: "bell.png",
        });
      } else {
        console.warn("Couldn't postMessage to SW and notifications permission not granted.");
      }
    });

    // mark task as notified (only if we have a proper id)
    const tx = db.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");
    const getReq = store.get(task.id);
    getReq.onsuccess = (e) => {
      const t = e.target.result;
      if (t) {
        t.notified = true;
        store.put(t);
      }
    };
    getReq.onerror = (err) => {
      console.warn("Failed to mark task as notified:", err);
    };
  }, delay);
}
