import assert from "node:assert/strict";
import test from "node:test";
import { WebSocketServer } from "ws";
import { RevitBridgeClient } from "./bridge-client.js";

test("bridge client serializes concurrent Revit commands", async () => {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("Expected a TCP address.");
  let active = 0;
  let maximumActive = 0;
  server.on("connection", (socket) => {
    socket.on("message", (payload) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const request = JSON.parse(payload.toString()) as { RequestId: string; CommandName: string };
      setTimeout(() => {
        active -= 1;
        socket.send(JSON.stringify({ Success: true, Data: request.CommandName, RequestId: request.RequestId }));
      }, 20);
    });
  });
  const client = new RevitBridgeClient("127.0.0.1", address.port);
  try {
    const [first, second] = await Promise.all([
      client.sendCommand("first"),
      client.sendCommand("second"),
    ]);
    assert.equal(first.data, "first");
    assert.equal(second.data, "second");
    assert.equal(maximumActive, 1);
  } finally {
    await client.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("bridge client forwards progress events and waits for the final response", async () => {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("Expected a TCP address.");
  server.on("connection", (socket) => {
    socket.on("message", (payload) => {
      const request = JSON.parse(payload.toString()) as { RequestId: string; TaskId?: string; GatewayRequestId?: string };
      socket.send(JSON.stringify({
        MessageType: "event",
        RequestId: request.RequestId,
        TaskId: request.TaskId,
        GatewayRequestId: request.GatewayRequestId,
        Phase: "executing",
        EventType: "bridge.executing",
      }));
      socket.send(JSON.stringify({ MessageType: "response", Success: true, Data: { ok: true }, RequestId: request.RequestId }));
    });
  });
  const progress: string[] = [];
  const client = new RevitBridgeClient("127.0.0.1", address.port, (event) => {
    progress.push(`${event.taskId}:${event.phase}`);
  });
  try {
    const response = await client.sendCommand("test", {}, 30_000, { taskId: "task-001", gatewayRequestId: "request-001" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(response.success, true);
    assert.deepEqual(progress, ["task-001:executing"]);
  } finally {
    await client.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
