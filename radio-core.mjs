const SLOT_COUNT = 4;

function slotIndex(value) {
  const index = Number(value) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) {
    throw new RangeError("槽位只能是 1–4");
  }
  return index;
}

export class TaskRadioCore {
  #runner;
  #now;
  #listeners = new Set();
  #nextId = 1;
  #slots = Array.from({ length: SLOT_COUNT }, (_, index) => ({
    id: index + 1,
    queue: [],
    running: null,
    unread: [],
    lastError: null,
  }));
  #online = true;
  #playback = null;
  #events = [];

  constructor({ runner, now = () => Date.now() }) {
    if (typeof runner !== "function") throw new TypeError("需要任务执行器 runner");
    this.#runner = runner;
    this.#now = now;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  snapshot() {
    const queuedCount = this.#slots.reduce((sum, slot) => sum + slot.queue.length, 0);
    return {
      online: this.#online,
      queuedCount,
      d5: !this.#online ? "offline" : queuedCount >= 3 ? "high" : queuedCount > 0 ? "waiting" : "clear",
      playback: this.#playback ? { ...this.#playback } : null,
      slots: this.#slots.map((slot) => ({
        id: slot.id,
        queue: slot.queue.map((job) => ({ ...job })),
        running: slot.running ? { ...slot.running } : null,
        unread: slot.unread.map((result) => ({ ...result })),
        lastError: slot.lastError,
      })),
      events: this.#events.map((event) => ({ ...event })),
    };
  }

  submit(slotId, text) {
    const slot = this.#slots[slotIndex(slotId)];
    if (!this.#online) throw new Error("设备离线，不能发送指令");
    const command = String(text ?? "").trim();
    if (!command) throw new Error("请先输入模拟的 ASR 文本");
    if (this.#playback) this.interruptPlayback("新指令抢占播放");

    const job = { id: this.#nextId++, slotId: slot.id, text: command, queuedAt: this.#now() };
    slot.queue.push(job);
    this.#record("queued", slot.id, `指令 #${job.id} 已进入槽位队列`);
    this.#pump(slot);
    return job.id;
  }

  setOnline(online) {
    const next = Boolean(online);
    if (next === this.#online) return;
    this.#online = next;
    if (!next && this.#playback) this.interruptPlayback("连接中断，保留未听结果");
    this.#record(next ? "online" : "offline", null, next ? "设备已连接" : "设备连接中断");
  }

  beginPlayback(slotId) {
    const slot = this.#slots[slotIndex(slotId)];
    if (!this.#online) throw new Error("设备离线，不能请求播放");
    if (this.#playback) throw new Error("已有提醒正在播放，请先停止");
    const result = slot.unread[0];
    if (!result) throw new Error("这个槽位没有未听结果");
    const playback = {
      token: this.#nextId++,
      slotId: slot.id,
      resultId: result.id,
      summary: result.summary,
    };
    this.#playback = playback;
    this.#record("play_start", slot.id, `开始播放结果 #${result.id}；此时仍未读`);
    return { ...playback };
  }

  completePlayback(token) {
    const playback = this.#playback;
    if (!playback || playback.token !== token || !this.#online) return false;
    const slot = this.#slots[slotIndex(playback.slotId)];
    if (slot.unread[0]?.id !== playback.resultId) return false;
    slot.unread.shift();
    this.#playback = null;
    this.#record("play_receipt", slot.id, `完整播放回执已确认，结果 #${playback.resultId} 标记为已听`);
    return true;
  }

  interruptPlayback(reason = "播放被中断") {
    if (!this.#playback) return false;
    const { slotId, resultId } = this.#playback;
    this.#playback = null;
    this.#record("play_interrupted", slotId, `${reason}；结果 #${resultId} 仍未读`);
    return true;
  }

  #pump(slot) {
    if (slot.running || slot.queue.length === 0) return;
    const job = slot.queue.shift();
    slot.running = job;
    slot.lastError = null;
    this.#record("started", slot.id, `指令 #${job.id} 开始执行`);

    Promise.resolve()
      .then(() => this.#runner({ ...job }))
      .then((event) => {
        if (event?.type !== "task_complete") {
          throw new Error("执行器没有给出 task_complete 事件");
        }
        const result = {
          id: this.#nextId++,
          jobId: job.id,
          summary: String(event.summary ?? `模拟任务 #${job.id} 已完成。`),
          completedAt: this.#now(),
        };
        slot.unread.push(result);
        this.#record("task_complete", slot.id, `指令 #${job.id} 完成；结果 #${result.id} 已缓存并点亮信箱灯`);
      })
      .catch((error) => {
        slot.lastError = error instanceof Error ? error.message : String(error);
        this.#record("task_failed", slot.id, `指令 #${job.id} 未获完成事件：${slot.lastError}`);
      })
      .finally(() => {
        slot.running = null;
        this.#notify();
        this.#pump(slot);
      });
  }

  #record(type, slotId, message) {
    this.#events.unshift({ id: this.#nextId++, type, slotId, message, at: this.#now() });
    this.#events.length = Math.min(this.#events.length, 36);
    this.#notify();
  }

  #notify() {
    const state = this.snapshot();
    for (const listener of this.#listeners) listener(state);
  }
}

export function createDemoRunner({ delayMs = (job) => 1100 + job.slotId * 350 } = {}) {
  return (job) => new Promise((resolve) => {
    setTimeout(() => resolve({
      type: "task_complete",
      summary: `本地模拟任务 #${job.id} 已完成：${job.text}`,
    }), delayMs(job));
  });
}
