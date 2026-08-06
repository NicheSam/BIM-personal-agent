import WebSocket from "ws";
import { AgentError } from "./errors.js";
import type { BridgeClient, BridgeCommandContext, BridgeProgressEvent, BridgeResponse, JsonObject } from "./types.js";

const DEFAULT_PORT = 9686;

export class RevitBridgeClient implements BridgeClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private queueTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly host = "localhost",
    private readonly port = parsePort(process.env.BIM_PERSONAL_AGENT_PORT || process.env.REVIT_MCP_PORT),
    private readonly onProgress?: (event: BridgeProgressEvent) => void | Promise<void>,
  ) {}

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async sendCommand(
    commandName: string,
    parameters: JsonObject = {},
    timeoutMs = 30_000,
    context: BridgeCommandContext = {},
  ): Promise<BridgeResponse> {
    if (!commandName || commandName.length > 120) {
      throw new AgentError("VALIDATION_ERROR", "commandName is required and must be at most 120 characters.");
    }
    return this.enqueue(async () => {
      await this.connect();
      return this.sendSingle(commandName, parameters, timeoutMs, context);
    });
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
        socket.close(1000, "Gateway shutdown");
        setTimeout(resolve, 1_000);
      });
    } else {
      socket?.terminate();
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queueTail.then(operation, operation);
    this.queueTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://${this.host}:${this.port}`);
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new AgentError("REVIT_CONNECTION_TIMEOUT", "Timed out connecting to the Revit Bridge.", true));
      }, 10_000);
      socket.once("open", () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(new AgentError("REVIT_CONNECTION_FAILED", error.message, true));
      });
      socket.once("close", () => {
        if (this.socket === socket) {
          this.socket = null;
        }
      });
    }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private sendSingle(
    commandName: string,
    parameters: JsonObject,
    timeoutMs: number,
    context: BridgeCommandContext,
  ): Promise<BridgeResponse> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new AgentError("REVIT_NOT_CONNECTED", "Revit Bridge is not connected.", true);
    }
    const requestId = `bpa_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return new Promise<BridgeResponse>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("message", onMessage);
        socket.off("close", onClose);
        socket.off("error", onError);
      };
      const onMessage = (payload: WebSocket.RawData) => {
        try {
          const raw = JSON.parse(payload.toString()) as Record<string, unknown>;
          const responseId = String(raw.RequestId ?? raw.requestId ?? "");
          if (responseId !== requestId) {
            return;
          }
          const messageType = String(raw.MessageType ?? raw.messageType ?? "response").toLowerCase();
          if (messageType === "event") {
            const event: BridgeProgressEvent = {
              requestId,
              taskId: readOptionalString(raw.TaskId ?? raw.taskId) ?? context.taskId,
              gatewayRequestId: readOptionalString(raw.GatewayRequestId ?? raw.gatewayRequestId) ?? context.gatewayRequestId,
              sequence: readOptionalNumber(raw.Sequence ?? raw.sequence),
              phase: String(raw.Phase ?? raw.phase ?? "unknown"),
              eventType: readOptionalString(raw.EventType ?? raw.eventType),
              timestampUtc: readOptionalString(raw.TimestampUtc ?? raw.timestampUtc),
              message: readOptionalString(raw.Message ?? raw.message),
              data: toJsonObject(raw.Data ?? raw.data),
            };
            void Promise.resolve(this.onProgress?.(event)).catch(() => undefined);
            return;
          }
          cleanup();
          const response: BridgeResponse = {
            success: Boolean(raw.Success ?? raw.success),
            data: raw.Data ?? raw.data,
            error: typeof (raw.Error ?? raw.error) === "string" ? String(raw.Error ?? raw.error) : undefined,
            errorCode: typeof (raw.ErrorCode ?? raw.errorCode) === "string" ? String(raw.ErrorCode ?? raw.errorCode) : undefined,
            requestId,
          };
          if (response.success) {
            resolve(response);
          } else {
            reject(new AgentError(response.errorCode || "REVIT_COMMAND_FAILED", response.error || "Revit command failed."));
          }
        } catch {
          cleanup();
          reject(new AgentError("INVALID_BRIDGE_RESPONSE", "Revit Bridge returned invalid JSON."));
        }
      };
      const onClose = () => {
        cleanup();
        reject(new AgentError("REVIT_CONNECTION_CLOSED", "Revit Bridge disconnected while a command was running.", true));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(new AgentError("REVIT_CONNECTION_ERROR", error.message, true));
      };
      const timer = setTimeout(() => {
        cleanup();
        socket.terminate();
        this.socket = null;
        reject(new AgentError(
          "REVIT_COMMAND_TIMEOUT_UNCERTAIN",
          "The command timed out. Revit may still have completed it; inspect the model before retrying.",
          false,
        ));
      }, Math.max(1_000, Math.min(timeoutMs, 120_000)));
      socket.on("message", onMessage);
      socket.once("close", onClose);
      socket.once("error", onError);
      socket.send(JSON.stringify({
        CommandName: commandName,
        Parameters: parameters,
        RequestId: requestId,
        TaskId: context.taskId,
        GatewayRequestId: context.gatewayRequestId,
      }));
    });
  }
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toJsonObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value || String(DEFAULT_PORT), 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT;
}
