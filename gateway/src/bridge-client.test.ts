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
