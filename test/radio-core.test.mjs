import test from "node:test";
import assert from "node:assert/strict";
import { TaskRadioCore } from "../radio-core.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("同槽串行、跨槽并行；只有明确完成事件才产生未听结果", async () => {
  const running = new Map();
  const calls = [];
  const core = new TaskRadioCore({ runner: (job) => {
    calls.push(job);
    const task = deferred();
    running.set(job.text, task);
    return task.promise;
  } });

  core.submit(1, "第一条");
  core.submit(1, "第二条");
  core.submit(2, "另一个槽");
  await tick();
  assert.deepEqual(calls.map((job) => job.text), ["第一条", "另一个槽"]);
  assert.equal(core.snapshot().slots[0].queue.length, 1);
  assert.equal(core.snapshot().d5, "waiting");

  running.get("第一条").resolve({ type: "task_complete", summary: "第一条完成" });
  await tick();
  assert.deepEqual(calls.map((job) => job.text), ["第一条", "另一个槽", "第二条"]);
  assert.equal(core.snapshot().slots[0].unread.length, 1);
  running.get("另一个槽").resolve({ type: "process_exit" });
  running.get("第二条").resolve({ type: "task_complete", summary: "第二条完成" });
  await tick();
  assert.equal(core.snapshot().slots[0].unread.length, 2);
  assert.equal(core.snapshot().slots[1].unread.length, 0);
  assert.match(core.snapshot().slots[1].lastError, /task_complete/);
});

test("点击播放与中断不能清除未听，完整播放回执才清除", async () => {
  const core = new TaskRadioCore({ runner: async () => ({ type: "task_complete", summary: "结果 A" }) });
  core.submit(1, "任务 A");
  await tick();
  const first = core.beginPlayback(1);
  assert.equal(core.snapshot().slots[0].unread.length, 1);
  core.interruptPlayback("PTT 抢占");
  assert.equal(core.completePlayback(first.token), false);
  assert.equal(core.snapshot().slots[0].unread.length, 1);
  const second = core.beginPlayback(1);
  assert.equal(core.completePlayback(second.token), true);
  assert.equal(core.snapshot().slots[0].unread.length, 0);
});

test("新指令抢占播放后保留旧结果，后续结果继续入队", async () => {
  const core = new TaskRadioCore({ runner: async (job) => ({ type: "task_complete", summary: job.text }) });
  core.submit(3, "旧结果");
  await tick();
  const playback = core.beginPlayback(3);
  core.submit(3, "新指令");
  assert.equal(core.completePlayback(playback.token), false);
  await tick();
  assert.deepEqual(core.snapshot().slots[2].unread.map((item) => item.summary), ["旧结果", "新指令"]);
});

test("D5 显示队列压力；离线优先显示连接异常并拒绝回执", async () => {
  const hold = deferred();
  const core = new TaskRadioCore({ runner: () => hold.promise });
  core.submit(1, "正在执行");
  core.submit(1, "等候一");
  core.submit(1, "等候二");
  assert.equal(core.snapshot().d5, "waiting");
  core.submit(1, "等候三");
  assert.equal(core.snapshot().d5, "high");
  core.setOnline(false);
  assert.equal(core.snapshot().d5, "offline");
  assert.throws(() => core.submit(2, "离线指令"), /离线/);
  hold.resolve({ type: "task_complete", summary: "执行结果" });
  await tick();
  assert.throws(() => core.beginPlayback(1), /离线/);
  core.setOnline(true);
  const playback = core.beginPlayback(1);
  core.setOnline(false);
  assert.equal(core.completePlayback(playback.token), false);
  assert.equal(core.snapshot().slots[0].unread[0].id, playback.resultId);
});
