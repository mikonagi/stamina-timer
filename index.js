const GAS_API_URL = "https://script.google.com/macros/s/AKfycby-L_nAEWa0OtSLRkhFPWM0OEKHEzXjjwqxu3hppIz_FBiYmeN5YSFqxSDOdK7eTJIx/exec";

let timers = [];
let userToken = "";
let updateInterval;

// --- 1. DOM構造を初回だけ構築する ---
function buildInitialDOM() {
  const container = document.getElementById("timerContainer");
  container.innerHTML = ""; // コンテナをクリア

  timers.forEach((t, index) => {
    const card = document.createElement("div");
    card.className = "card";
    card.id = `card-${index}`;

    // 各カードの静的なHTML構造を一度だけ生成
    card.innerHTML = `
      <div class="card-row-1">
        <div class="game-title-container">
          <div class="game-title" id="game-title-${index}">${escapeHtml(t.name)}</div>
        </div>
        <div class="stamina-text" id="stamina-text-${index}"></div>
        <button class="edit-btn" onclick="openEditModal(${index})">✏️ 編集</button>
      </div>
      <div class="stamina-bar-container">
        <div class="stamina-bar-fill" id="bar-fill-${index}"></div>
      </div>
      <div class="time-info-box">
        <div class="time-target" id="time-target-${index}"></div>
      </div>
    `;
    container.appendChild(card);
  });

  // 初回描画後、すぐに動的要素を更新
  updateDynamicElements();
}

// --- 2. 1秒ごとに動的な要素だけを更新する ---
function updateDynamicElements() {
  const nowMs = Date.now();
  timers.forEach((t, index) => {
    const lastUpdatedMs = new Date(t.updated_at).getTime();
    const elapsedSecTotal = Math.max(0, Math.floor((nowMs - lastUpdatedMs) / 1000));
    const recoverSec = Math.round((Number(t.recover_minutes) || 5) * 60);

    const recoveredStamina = recoverSec > 0 ? Math.floor(elapsedSecTotal / recoverSec) : 0;
    const currentStamina = Math.min(Number(t.max_stamina), Number(t.current_stamina) + recoveredStamina);

    const maxVal = Number(t.max_stamina);
    const percent = maxVal > 0 ? Math.min(100, Math.floor((currentStamina / maxVal) * 100)) : 0;

    let barColor = "var(--color-green)";
    if (percent >= 99) barColor = "var(--color-red)";
    else if (percent >= 90) barColor = "var(--color-yellow)";
    
    const targetVal = t.target_stamina !== undefined ? Number(t.target_stamina) : maxVal;
    let targetText = "";

    if (currentStamina >= targetVal) {
      targetText = `<strong>${targetVal}</strong> に到達済み`;
    } else {
      const secUntilNext = recoverSec - (elapsedSecTotal % recoverSec);
      const remainSecTarget = (targetVal - currentStamina - 1) * recoverSec + secUntilNext;
      const targetDate = new Date(nowMs + remainSecTarget * 1000);
      targetText = `<strong>${targetVal}</strong> まで あと <strong>${formatDuration(remainSecTarget)}</strong> （到達時刻: <span class="time-detail"><strong>${formatClock(targetDate)}</strong></span>）`;
    }

    // IDを使って要素を直接取得し、中身だけを更新
    const staminaEl = document.getElementById(`stamina-text-${index}`);
    if (staminaEl) staminaEl.innerHTML = `${currentStamina} / ${maxVal}`;

    const barEl = document.getElementById(`bar-fill-${index}`);
    if (barEl) {
      barEl.style.width = `${percent}%`;
      barEl.style.backgroundColor = barColor;
    }

    const timeEl = document.getElementById(`time-target-${index}`);
    if (timeEl) timeEl.innerHTML = targetText;
  });
}

// --- 認証・データ取得・保存処理 ---
async function checkAuth() {
  const savedToken = localStorage.getItem("sg_timer_token");
  const cachedData = localStorage.getItem("sg_timer_cached_data");
  if (cachedData) {
    try {
      timers = JSON.parse(cachedData);
      buildInitialDOM(); 
    } catch (e) {}
  }

  if (savedToken) {
    userToken = savedToken;
    const success = await fetchTimers(true);
    if (success) {
      document.getElementById("loadingCover").style.display = "none";
      document.getElementById("appContainer").style.display = "block";
      document.getElementById("lockScreen").style.display = "none";
      document.getElementById("syncStatus").innerText = "同期完了";
    } else if (timers.length > 0) {
      document.getElementById("loadingCover").style.display = "none";
      document.getElementById("appContainer").style.display = "block";
      document.getElementById("lockScreen").style.display = "none";
      document.getElementById("syncStatus").innerText = "オフライン表示中";
    }
  } else {
    document.getElementById("loadingCover").style.display = "none";
    document.getElementById("lockScreen").style.display = "flex";
    document.getElementById("appContainer").style.display = "none";
  }
}

async function verifyAndLogin() {
  const entered = document.getElementById("passInput").value.trim();
  userToken = entered;
  document.getElementById("loadingCover").style.display = "flex";
  document.getElementById("lockScreen").style.display = "none";
  
  const success = await fetchTimers(true);
  document.getElementById("loadingCover").style.display = "none";
  
  if (success) {
    localStorage.setItem("sg_timer_token", entered);
    document.getElementById("lockError").style.display = "none";
    await checkAuth(); // 再認証・描画
  } else {
    document.getElementById("lockScreen").style.display = "flex";
    document.getElementById("lockError").style.display = "block";
  }
}

async function fetchTimers(isTest = false) {
  const statusEl = document.getElementById("syncStatus");
  if (!isTest) statusEl.innerText = "同期中...";
  try {
    const res = await fetch(`${GAS_API_URL}?token=${encodeURIComponent(userToken)}`);
    if (res.status === 401) return false;
    
    timers = await res.json();
    localStorage.setItem("sg_timer_cached_data", JSON.stringify(timers));

    buildInitialDOM(); // データ取得後にDOMを再構築
    if (!isTest) statusEl.innerText = "同期完了";
    return true;
  } catch (err) {
    if (!isTest) statusEl.innerText = "同期失敗";
    console.error(err);
    return false;
  }
}

async function saveTimersToGAS() {
  const statusEl = document.getElementById("syncStatus");
  statusEl.innerText = "保存中...";
  try {
    await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify({ token: userToken, items: timers })
    });
    localStorage.setItem("sg_timer_cached_data", JSON.stringify(timers));
    statusEl.innerText = "同期完了";
  } catch (err) {
    statusEl.innerText = "保存失敗";
    console.error(err);
  }
}

function formatDuration(totalSec) {
  if (totalSec <= 0) return "0:00:00";
  const h = Math.floor(totalSec / 3600);
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatClock(date) {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function openAddModal() {
  document.getElementById("modalTitle").innerText = "タイマー追加";
  document.getElementById("editIndex").value = "-1";
  document.getElementById("inputName").value = "";
  document.getElementById("inputCurrent").value = "";
  document.getElementById("inputMax").value = "";
  document.getElementById("inputTarget").value = "";
  document.getElementById("inputIntervalMin").value = "5";
  document.getElementById("inputIntervalSec").value = "0";
  document.getElementById("btnDelete").style.display = "none";
  document.getElementById("modalOverlay").classList.add("active");
}

function openEditModal(index) {
  const t = timers[index];
  const nowMs = Date.now();
  const elapsedSec = Math.max(0, Math.floor((nowMs - new Date(t.updated_at).getTime()) / 1000));
  const recoverSec = Math.round(Number(t.recover_minutes) * 60);
  const current = Math.min(Number(t.max_stamina), Number(t.current_stamina) + Math.floor(elapsedSec / recoverSec));
  const totalSeconds = Math.round(Number(t.recover_minutes) * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const maxVal = Number(t.max_stamina);
  const targetVal = t.target_stamina !== undefined ? Number(t.target_stamina) : maxVal;

  document.getElementById("modalTitle").innerText = "タイマー編集";
  document.getElementById("editIndex").value = index;
  document.getElementById("inputName").value = t.name;
  document.getElementById("inputCurrent").value = current;
  document.getElementById("inputMax").value = t.max_stamina;
  document.getElementById("inputTarget").value = targetVal;
  document.getElementById("inputIntervalMin").value = m;
  document.getElementById("inputIntervalSec").value = s;
  document.getElementById("btnDelete").style.display = "block";
  document.getElementById("modalOverlay").classList.add("active");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("active");
}

function saveModalData() {
  const name = document.getElementById("inputName").value.trim();
  const current = Number(document.getElementById("inputCurrent").value) || 0;
  const max = Number(document.getElementById("inputMax").value);
  const targetInput = document.getElementById("inputTarget").value.trim();
  const targetVal = targetInput !== "" ? Number(targetInput) : max;
  const minInput = Number(document.getElementById("inputIntervalMin").value) || 0;
  const secInput = Number(document.getElementById("inputIntervalSec").value) || 0;
  const totalSeconds = (minInput * 60) + secInput;
  const intervalDecimal = totalSeconds / 60;
  const editIndex = Number(document.getElementById("editIndex").value);

  if (!name || !max) return alert("ゲームタイトルと最大スタミナは必須です");
  if (totalSeconds <= 0) return alert("回復ペースは1秒以上に設定してください");

  const newItem = {
    name: name,
    current_stamina: current,
    max_stamina: max,
    target_stamina: targetVal,
    recover_minutes: intervalDecimal,
    updated_at: new Date().toISOString() // ISO文字列で保存
  };

  if (editIndex === -1) {
    newItem.id = "game-" + Date.now();
    timers.push(newItem);
  } else {
    newItem.id = timers[editIndex].id; // idを引き継ぐ
    timers[editIndex] = newItem;
  }

  closeModal();
  buildInitialDOM(); // DOMを再構築
  saveTimersToGAS();
}

function deleteCurrentTimer() {
  const editIndex = Number(document.getElementById("editIndex").value);
  if (editIndex >= 0 && confirm("このタイマーを削除しますか？")) {
    timers.splice(editIndex, 1);
    closeModal();
    buildInitialDOM(); // DOMを再構築
    saveTimersToGAS();
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
}

// --- 初期化処理 ---
(async () => {
  await checkAuth(); // 最初に認証とデータ取得
  // 1秒ごとに動的要素のみを更新
  if (updateInterval) clearInterval(updateInterval); // 念のため既存のインターバルをクリア
  updateInterval = setInterval(updateDynamicElements, 1000);
})();
