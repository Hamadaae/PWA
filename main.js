// main.js (IndexedDB version using your idb.js)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('SW reg failed', err));
  });
}

let deferredPrompt;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'inline-block';
});
installBtn?.addEventListener('click', () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(() => {
      deferredPrompt = null;
      installBtn.style.display = 'none';
    });
  }
});

const taskForm = document.getElementById('taskForm');
const taskList = document.getElementById('taskList');

let dbPromise;
let tasks = [];
const DB_NAME = 'tasks-db';
const DB_VERSION = 1;
const STORE_NAME = 'tasks';

/* ---------- IndexedDB init ---------- */
async function initDB() {
  dbPromise = idb.open(DB_NAME, DB_VERSION, upgradeDB => {
    if (!upgradeDB.objectStoreNames.contains(STORE_NAME)) {
      const store = upgradeDB.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('dateTime', 'dateTime', { unique: false });
    }
  });
  try {
    await dbPromise;
  } catch (err) {
    console.error('Failed to open DB', err);
  }
}

function getObjectStore(mode = 'readonly') {
  return dbPromise.then(database => database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
}

async function addTaskToDB(task) {
  const store = await getObjectStore('readwrite');
  return store.put(task);
}
async function deleteTaskFromDB(id) {
  const store = await getObjectStore('readwrite');
  return store.delete(id);
}
async function getAllTasksFromDB() {
  const store = await getObjectStore('readonly');
  const all = await store.getAll();
  return all || [];
}
async function updateTaskInDB(task) {
  const store = await getObjectStore('readwrite');
  return store.put(task);
}

/* ---------- Utilities ---------- */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function makeId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.floor(Math.random()*1000000)}`;
}

/* ---------- Rendering ---------- */
function renderTasks() {
  taskList.innerHTML = "";
  if (!tasks || tasks.length === 0) {
    taskList.innerHTML = "<p>No tasks yet! Add one above.</p>";
    return;
  }

  tasks.forEach((task) => {
    const div = document.createElement('div');
    div.className = "task";
    const scheduledAt = new Date(task.dateTime);
    const dateStr = scheduledAt.toLocaleDateString();
    const timeStr = scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
      <div class="task-details">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-date">Due: ${dateStr} ${timeStr}</div>
      </div>
      <div class="task-actions">
        <button class="notify" title="Notify">🔔</button>
        <button class="remove" title="Remove">✖</button>
      </div>
    `;

    // Remove
    div.querySelector('.remove').onclick = async () => {
      try {
        await deleteTaskFromDB(task.id);
        tasks = tasks.filter(t => t.id !== task.id);
        renderTasks();
      } catch (err) {
        console.error('Failed to remove task', err);
      }
    };

    // Notify now / schedule
    div.querySelector('.notify').onclick = () => scheduleNotificationForTask(task, true);

    taskList.appendChild(div);
  });
}

/* ---------- Notification scheduling ---------- */
// Keep simple timers while page is open. Service worker cannot reliably run timers when page is closed.
const _timers = new Map();

function scheduleNotificationForTask(task, fromButton = false) {
  if (Notification.permission !== 'granted') {
    Notification.requestPermission().then(perm => {
      if (perm !== 'granted') {
        if (fromButton) alert('Please allow notifications to receive reminders.');
        return;
      }
      scheduleNotificationForTask(task, fromButton);
    });
    return;
  }

  // clear old timer if exists
  if (_timers.has(task.id)) {
    clearTimeout(_timers.get(task.id));
    _timers.delete(task.id);
  }

  navigator.serviceWorker.ready.then(reg => {
    try {
      const now = Date.now();
      const scheduled = task.dateTime;
      let delay = scheduled - now;
      if (delay < 0) delay = 1000; // fire soon if time already passed
      const t = setTimeout(async () => {
        try {
          await reg.showNotification('Task Reminder', {
            body: `${task.title} is scheduled now!`,
            icon: 'bell.png',
            tag: `task-${task.id}`,
            data: { id: task.id }
          });
          // mark notified in DB to avoid repeated notifications on reload if you want
          task.notified = true;
          await updateTaskInDB(task);
        } catch (err) {
          console.error('Error showing notification', err);
        }
      }, delay);
      _timers.set(task.id, t);
    } catch (err) {
      console.error('Error scheduling notification', err);
    }
  }).catch(err => console.error('serviceWorker.ready error', err));
}

function scheduleAllNotifications() {
  tasks.forEach(task => {
    if (!task.notified) scheduleNotificationForTask(task, false);
  });
}

/* ---------- Form submit ---------- */
taskForm.addEventListener('submit', async e => {
  e.preventDefault();
  const title = document.getElementById('taskInput').value.trim();
  const dateVal = document.getElementById('dateInput').value; // yyyy-mm-dd
  const timeVal = document.getElementById('timeInput').value; // hh:mm
  if (!title || !dateVal || !timeVal) return;

  // create a Date object in local time
  const dateTime = new Date(`${dateVal}T${timeVal}`);
  const newTask = {
    id: makeId(),
    title,
    dateTime: dateTime.getTime(),
    createdAt: Date.now(),
    notified: false
  };

  try {
    await addTaskToDB(newTask);
    tasks.push(newTask);
    // sort ascending
    tasks.sort((a,b) => a.dateTime - b.dateTime);
    renderTasks();
    scheduleNotificationForTask(newTask, true);
    taskForm.reset();
  } catch (err) {
    console.error('Failed to add task', err);
  }
});

/* ---------- Boot ---------- */
(async function boot() {
  await initDB();
  tasks = await getAllTasksFromDB();
  // If tasks were stored with separate date/time fields earlier (legacy), try to normalize:
  tasks = tasks.map(t => {
    if (t.date && t.time && !t.dateTime) {
      try {
        t.dateTime = new Date(`${t.date}T${t.time}`).getTime();
      } catch (e) { t.dateTime = t.dateTime || Date.now(); }
    }
    return t;
  });

  tasks.sort((a,b) => a.dateTime - b.dateTime);
  renderTasks();

  // Request notification permission early (optional)
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }

  scheduleAllNotifications();
})();
