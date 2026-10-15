import { TaskRadioCore, createDemoRunner } from "./radio-core.mjs";

const core = new TaskRadioCore({ runner: createDemoRunner() });
const grid = document.querySelector("#slot-grid");
const audio = document.querySelector("#reminder-audio");
const status = document.querySelector("#playback-status");
const stopButton = document.querySelector("#stop-button");
const networkButton = document.querySelector("#network-button");
const exportButton = document.querySelector("#export-button");
const eventList = document.querySelector("#event-list");
let playingToken = null;
let notice = "尚未播放提醒音。点击某个槽位的“听回来”开始播放。";

function stopAudio() {
  audio.pause();
  audio.currentTime = 0;
  playingToken = null;
}

function showError(error) {
  notice = error instanceof Error ? error.message : String(error);
  status.textContent = notice;
}

for (let id = 1; id <= 4; id++) {
  const card = document.createElement("article");
  card.className = "slot";
  card.dataset.slot = String(id);
  card.innerHTML = `
    <div class="slot-top">
      <div class="slot-title"><span class="lamp" aria-hidden="true"></span><div><h3>槽位 ${id}</h3><span class="slot-subtitle">D${id} · 未听信箱灯</span></div></div>
      <span class="pill state">空闲</span>
    </div>
    <div class="slot-meta"><span class="pill queue">排队 0</span><span class="pill unread">未听 0</span></div>
    <form class="command-form">
      <label for="command-${id}">模拟 ASR 文本 · S${id}</label>
      <input id="command-${id}" maxlength="120" autocomplete="off" placeholder="例如：整理今天的调试记录">
      <div class="slot-actions"><button class="send-button" type="submit">说进去</button><button class="play-button" type="button">听回来 · S${id + 4}</button></div>
    </form>
    <div class="summary">暂无未听结果</div>`;
  grid.append(card);

  card.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = card.querySelector("input");
    try {
      core.submit(id, input.value);
      stopAudio();
      input.value = "";
      notice = `槽位 ${id} 的指令已交给本地模拟执行器。`;
    } catch (error) {
      showError(error);
    }
    status.textContent = notice;
  });

  card.querySelector(".play-button").addEventListener("click", async () => {
    try {
      if (playingToken !== null) {
        stopAudio();
        core.interruptPlayback("切换播放槽位");
      }
      const playback = core.beginPlayback(id);
      playingToken = playback.token;
      audio.currentTime = 0;
      notice = `正在播放槽位 ${id} 的固定提醒音。文字结果：${playback.summary}`;
      status.textContent = notice;
      await audio.play();
    } catch (error) {
      stopAudio();
      core.interruptPlayback("浏览器播放失败");
      showError(error);
    }
  });
}

let lastControl = null;

function handleControl(keyId, source) {
  if (!Number.isInteger(keyId) || keyId < 1 || keyId > 8) return;
  const now = performance.now();
  if (lastControl?.keyId === keyId && now - lastControl.at < 150) return;
  lastControl = { keyId, at: now };
  const slotId = keyId <= 4 ? keyId : keyId - 4;
  const card = grid.querySelector(`[data-slot="${slotId}"]`);
  const label = source === "usb" ? "实体" : "快捷键";

  if (keyId <= 4) {
    if (playingToken !== null) {
      stopAudio();
      core.interruptPlayback("实体 PTT 按键抢占播放");
    }
    const input = card.querySelector("input");
    if (input.value.trim()) {
      card.querySelector("form").requestSubmit();
      if (source === "usb") {
        notice = `实体 S${keyId} 已触发：槽位 ${slotId} 的文字指令已入队。`;
        status.textContent = notice;
      }
    } else {
      input.focus();
      notice = `已收到${label} S${keyId}；请先输入模拟 ASR 文字，再按一次该键。`;
      status.textContent = notice;
    }
  } else {
    const button = card.querySelector(".play-button");
    if (button.disabled) {
      notice = `已收到${label} S${keyId}；槽位 ${slotId} 当前没有可播放的未听结果。`;
      status.textContent = notice;
    } else {
      button.click();
    }
  }
}

document.addEventListener("keydown", (event) => {
  if (!event.ctrlKey || !event.shiftKey || !event.altKey || event.repeat) return;
  const match = /^Digit([1-8])$/.exec(event.code);
  if (!match) return;
  event.preventDefault();
  handleControl(Number(match[1]), "keyboard");
});

const hardwareStream = new EventSource("/hardware/events");
hardwareStream.addEventListener("key", (event) => {
  try {
    handleControl(JSON.parse(event.data).keyId, "usb");
  } catch (error) {
    showError(error);
  }
});

audio.addEventListener("ended", () => {
  const token = playingToken;
  playingToken = null;
  if (token !== null && core.completePlayback(token)) {
    notice = "提醒音完整播放，Host 收到有效回执，结果已标记为已听。";
  } else {
    notice = "播放未形成有效回执，结果仍未读。";
  }
  status.textContent = notice;
});

stopButton.addEventListener("click", () => {
  stopAudio();
  core.interruptPlayback("手动中断播放");
  notice = "播放已中断，未听结果保留。";
  status.textContent = notice;
});

networkButton.addEventListener("click", () => {
  const online = core.snapshot().online;
  if (online) stopAudio();
  core.setOnline(!online);
  notice = online ? "已模拟断网：新指令与播放请求被阻止，未听结果保留。" : "已模拟恢复连接。";
  status.textContent = notice;
});

exportButton.addEventListener("click", () => {
  const state = core.snapshot();
  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = 930;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#f2f5f1";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#183e30";
  context.fillRect(0, 0, canvas.width, 180);
  context.fillStyle = "#a5dfb9";
  context.font = "bold 20px Segoe UI, Microsoft YaHei, sans-serif";
  context.fillText("LESSON 07 · WINDOWS LOCAL PROTOTYPE", 65, 55);
  context.fillStyle = "#ffffff";
  context.font = "bold 56px Segoe UI, Microsoft YaHei, sans-serif";
  context.fillText("四槽任务电台 · 状态快照", 65, 125);
  context.font = "20px Segoe UI, Microsoft YaHei, sans-serif";
  context.fillText(new Date().toLocaleString("zh-CN", { hour12: false }), 1040, 125);

  const d5Colors = { clear: "#a8c5ad", waiting: "#f3bf55", high: "#ec6b55", offline: "#71a7e9" };
  const d5Names = { clear: "无排队", waiting: "有指令等待", high: "排队压力高", offline: "连接异常" };
  context.fillStyle = "#ffffff";
  context.fillRect(65, 210, 1270, 120);
  context.fillStyle = d5Colors[state.d5];
  context.beginPath();
  context.arc(113, 270, 24, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#244b35";
  context.font = "bold 32px Segoe UI, Microsoft YaHei, sans-serif";
  context.fillText(`D5 · ${d5Names[state.d5]}`, 160, 262);
  context.font = "23px Segoe UI, Microsoft YaHei, sans-serif";
  context.fillText(`Host 等待队列 ${state.queuedCount} 条；设备${state.online ? "在线" : "离线"}`, 160, 300);

  for (const slot of state.slots) {
    const x = 65 + ((slot.id - 1) % 2) * 650;
    const y = 365 + Math.floor((slot.id - 1) / 2) * 180;
    context.fillStyle = "#ffffff";
    context.fillRect(x, y, 620, 152);
    context.fillStyle = slot.unread.length ? "#f3ad5f" : "#a8c5ad";
    context.beginPath();
    context.arc(x + 42, y + 46, 17, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#203a32";
    context.font = "bold 28px Segoe UI, Microsoft YaHei, sans-serif";
    context.fillText(`槽位 ${slot.id} · D${slot.id}`, x + 75, y + 56);
    context.font = "21px Segoe UI, Microsoft YaHei, sans-serif";
    context.fillText(`执行 ${slot.running ? "1" : "0"}  /  排队 ${slot.queue.length}  /  未听 ${slot.unread.length}`, x + 28, y + 105);
    context.fillStyle = "#637b6a";
    const summary = slot.unread[0]?.summary ?? "暂无未听结果";
    context.font = "17px Segoe UI, Microsoft YaHei, sans-serif";
    context.fillText(summary.slice(0, 31), x + 28, y + 136);
  }

  context.fillStyle = "#385544";
  context.font = "bold 24px Segoe UI, Microsoft YaHei, sans-serif";
  context.fillText("最近事件", 65, 773);
  context.font = "18px Segoe UI, Microsoft YaHei, sans-serif";
  for (const [index, event] of state.events.slice(0, 3).entries()) {
    context.fillText(`• ${event.message.slice(0, 90)}`, 65, 808 + index * 28);
  }
  context.fillStyle = "#73877a";
  context.font = "16px Segoe UI, Microsoft YaHei, sans-serif";
  context.fillText("本地图只记录浏览器模拟状态，不证明真机、Codex、ASR/TTS 或板载扬声器已验收。", 65, 900);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "第七课-四槽任务电台-状态快照.png";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
});

core.subscribe((state) => {
  const d5 = document.querySelector("#d5-lamp");
  d5.className = `lamp lamp-${state.d5}`;
  const d5Labels = {
    clear: "D5 · 无排队",
    waiting: "D5 · 有指令等待",
    high: "D5 · 排队压力高",
    offline: "D5 · 连接异常",
  };
  document.querySelector("#d5-title").textContent = d5Labels[state.d5];
  document.querySelector("#d5-detail").textContent = `等待中的指令 ${state.queuedCount} 条`;
  networkButton.textContent = state.online ? "模拟断网" : "恢复连接";
  networkButton.classList.toggle("offline", !state.online);
  networkButton.setAttribute("aria-pressed", String(state.online));
  stopButton.disabled = !state.playback;

  for (const slot of state.slots) {
    const card = grid.querySelector(`[data-slot="${slot.id}"]`);
    card.querySelector(".lamp").className = `lamp ${slot.unread.length ? "lamp-unread" : "lamp-clear"}`;
    const stateBadge = card.querySelector(".state");
    stateBadge.textContent = slot.lastError ? "执行失败" : slot.running ? "执行中" : "空闲";
    stateBadge.className = `pill state ${slot.lastError ? "error" : slot.running ? "running" : ""}`;
    card.querySelector(".queue").textContent = `排队 ${slot.queue.length}`;
    card.querySelector(".unread").textContent = `未听 ${slot.unread.length}`;
    card.querySelector(".play-button").disabled = !state.online || slot.unread.length === 0;
    card.querySelector(".send-button").disabled = !state.online;
    const summary = card.querySelector(".summary");
    summary.textContent = slot.unread.length ? `待听结果：${slot.unread[0].summary}` : slot.lastError ? `最近错误：${slot.lastError}` : "暂无未听结果";
  }

  eventList.replaceChildren(...state.events.slice(0, 12).map((event) => {
    const item = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false });
    item.append(time, document.createTextNode(event.message));
    return item;
  }));
});
