import { WebSocketServer, WebSocket, RawData } from "ws";
import { IncomingMessage } from "http";
import { decode, decodeMulti, Decoder } from "@msgpack/msgpack";
import type { DeviceMessage } from "./types.js";
import {
  verifyDeviceKey,
  updateDeviceStatus,
  syncOnlineDevicesWithConnections,
} from "./services/device.js";

interface DeviceConnection {
  ws: WebSocket;
  deviceId: string;
  connectedAt: Date;
  lastSeen: Date;
  missedPings: number; // Track consecutive missed pings
}

// Ping interval for keep-alive (10 seconds for faster detection)
const PING_INTERVAL_MS = 10000;
// Disconnect after this many missed pings (10s * 2 = 20s max detection time)
const MAX_MISSED_PINGS = 2;
// Database sync interval - reconcile in-memory connection state with database
// This catches any missed disconnect events (crash, network issues, etc.)
const DB_SYNC_INTERVAL_MS = 60000; // 1 minute

/**
 * Device Relay
 *
 * Handles WebSocket connections from ESP32 devices.
 * Each device maintains a persistent connection to the cloud.
 */
export class DeviceRelay {
  private devices = new Map<string, DeviceConnection>();
  private messageHandlers = new Set<
    (deviceId: string, message: DeviceMessage) => void
  >();
  private pingInterval: NodeJS.Timeout | null = null;
  private dbSyncInterval: NodeJS.Timeout | null = null;

  constructor(wss: WebSocketServer) {
    wss.on("connection", (ws, req) => this.handleConnection(ws, req));

    // Start ping interval to keep connections alive
    this.pingInterval = setInterval(() => {
      this.pingAllDevices();
    }, PING_INTERVAL_MS);

    // Start periodic database sync to reconcile in-memory state
    // This catches any stale online states from missed disconnect events
    this.dbSyncInterval = setInterval(() => {
      this.syncDatabaseState();
    }, DB_SYNC_INTERVAL_MS);
  }

  /**
   * Sync in-memory connection state to database
   * Marks devices as offline in DB if they're not in our connection map
   * This handles edge cases like server restarts, crash recovery, etc.
   */
  private syncDatabaseState(): void {
    try {
      const connectedIds = new Set(this.devices.keys());
      const staleCount = syncOnlineDevicesWithConnections(connectedIds);

      if (staleCount > 0) {
        console.log(
          `[DeviceRelay] DB sync: marked ${staleCount} stale device(s) as offline`
        );
      }
    } catch (err) {
      console.error("[DeviceRelay] Failed to sync database state:", err);
    }
  }

  /**
   * Ping all connected devices to keep connections alive
   */
  private pingAllDevices(): void {
    this.devices.forEach((connection, deviceId) => {
      // Increment missed pings counter (reset on pong)
      connection.missedPings++;

      if (connection.missedPings > MAX_MISSED_PINGS) {
        // Device missed too many pings - disconnect
        console.log(
          `[Device] ${deviceId} ping timeout (${connection.missedPings} missed) - disconnecting`
        );
        connection.ws.terminate();
        return;
      }

      // Send ping
      connection.ws.ping();
    });
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const deviceId = url.searchParams.get("id");
    const deviceKey = url.searchParams.get("key");

    // Validate required parameters
    if (!deviceId || !deviceKey) {
      console.warn(`[Device] Connection rejected: missing ID or key`);
      ws.close(4001, "Missing device ID or key");
      return;
    }

    // Validate device ID format (BRW-XXXXXXXX)
    if (!/^BRW-[A-F0-9]{8}$/i.test(deviceId)) {
      console.warn(
        `[Device] Connection rejected: invalid ID format: ${deviceId}`
      );
      ws.close(4001, "Invalid device ID format");
      return;
    }

    // Validate device key (base64url, 32 bytes = ~43 chars)
    if (deviceKey.length < 32 || deviceKey.length > 64) {
      console.warn(
        `[Device] Connection rejected: invalid key length for ${deviceId}`
      );
      ws.close(4003, "Invalid device key format");
      return;
    }

    // Verify device key against database
    if (!verifyDeviceKey(deviceId, deviceKey)) {
      console.warn(`[Device] Connection rejected: invalid key for ${deviceId}`);
      ws.close(4003, "Invalid device credentials");
      return;
    }

    // Close existing connection for this device (if any)
    const existing = this.devices.get(deviceId);
    if (existing) {
      console.log(`[Device] Replacing connection for ${deviceId}`);
      existing.ws.close(4002, "Replaced by new connection");
    }

    const connection: DeviceConnection = {
      ws,
      deviceId,
      connectedAt: new Date(),
      lastSeen: new Date(),
      missedPings: 0,
    };

    this.devices.set(deviceId, connection);
    console.log(`[Device] Connected: ${deviceId} (authenticated)`);

    // Handle pong responses for keep-alive
    ws.on("pong", () => {
      connection.missedPings = 0; // Reset missed pings counter
      connection.lastSeen = new Date();
    });

    // Update device online status in database
    try {
      updateDeviceStatus(deviceId, true);
    } catch (err) {
      console.error(`[Device] Failed to update status for ${deviceId}:`, err);
    }

    // Handle messages from device
    ws.on("message", async (data: RawData) => {
      connection.lastSeen = new Date();
      connection.missedPings = 0; // Any message means device is alive
      try {
        let message: DeviceMessage | null = null;

        // Check if message is binary (MessagePack) or text (legacy JSON)
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
          // Binary MessagePack format
          // Device may send multiple messages in one frame, so try decodeMulti first
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          const uint8Array = new Uint8Array(buffer);

          // Try to decode multiple messages first (device may send multiple in one frame)
          // decodeMulti works for both single and multiple messages
          let decodeMultiSucceeded = false;
          try {
            const messages = Array.from(decodeMulti(uint8Array));

            if (messages.length > 0) {
              // Process each message
              for (const msg of messages) {
                this.handleDeviceMessage(deviceId, msg as DeviceMessage);
              }
              decodeMultiSucceeded = true;
              return; // Successfully processed all messages
            }
            // If decodeMulti returned empty array, fall through to single decode
          } catch (multiError) {
            // decodeMulti failed - try Decoder instance as alternative
            try {
              const decoder = new Decoder();
              const messages: DeviceMessage[] = [];
              for (const msg of decoder.decodeMulti(uint8Array)) {
                messages.push(msg as DeviceMessage);
              }

              if (messages.length > 0) {
                // Process each message
                for (const msg of messages) {
                  this.handleDeviceMessage(deviceId, msg);
                }
                decodeMultiSucceeded = true;
                return; // Successfully processed all messages
              }
            } catch (decoderError) {
              // Both decodeMulti and Decoder failed - log for debugging
              const errorMsg =
                multiError instanceof Error
                  ? multiError.message
                  : String(multiError);
              const decoderErrorMsg =
                decoderError instanceof Error
                  ? decoderError.message
                  : String(decoderError);
              // Only log if it's not the expected "extra bytes" error
              if (
                !errorMsg.includes("Extra") &&
                !errorMsg.includes("extra") &&
                !decoderErrorMsg.includes("Extra") &&
                !decoderErrorMsg.includes("extra")
              ) {
                console.warn(
                  `[Device] Both decodeMulti methods failed for ${deviceId}, trying single decode:`,
                  `decodeMulti: ${errorMsg}, Decoder: ${decoderErrorMsg}`
                );
              }
            }
          }

          // Fallback: try single decode (for single messages or if decodeMulti failed)
          // Only try if decodeMulti didn't succeed
          if (!decodeMultiSucceeded) {
            try {
              message = decode(uint8Array) as DeviceMessage;
            } catch (singleDecodeError) {
              const errorMsg =
                singleDecodeError instanceof Error
                  ? singleDecodeError.message
                  : String(singleDecodeError);

              // If single decode also fails with "Extra bytes", it means there are multiple messages
              // but decodeMulti didn't handle them - this shouldn't happen but log it
              if (errorMsg.includes("Extra") || errorMsg.includes("extra")) {
                console.error(
                  `[Device] MessagePack decode failed for ${deviceId}: Multiple messages detected but decodeMulti failed.`,
                  `Buffer length: ${buffer.length}, Error: ${errorMsg}`
                );
              } else {
                console.error(
                  `[Device] MessagePack decode failed for ${deviceId}:`,
                  errorMsg,
                  `Buffer length: ${buffer.length}`
                );
              }
              return; // Don't process invalid messages
            }
          }
        } else {
          // Legacy text/JSON format
          try {
            const text = data.toString();
            message = JSON.parse(text) as DeviceMessage;
          } catch (parseError) {
            console.error(
              `[Device] JSON parse failed for ${deviceId}:`,
              parseError,
              `Data: ${data.toString().substring(0, 100)}`
            );
            return;
          }
        }

        if (message) {
          this.handleDeviceMessage(deviceId, message);
        }
      } catch (err) {
        console.error(`[Device] Invalid message from ${deviceId}:`, err);
      }
    });

    // Handle disconnect
    ws.on("close", (code: number, reason: Buffer) => {
      this.devices.delete(deviceId);
      const reasonStr = reason ? reason.toString() : "no reason";
      console.log(
        `[Device] Disconnected: ${deviceId} (code: ${code}, reason: ${reasonStr})`
      );

      // Update device offline status in database
      try {
        updateDeviceStatus(deviceId, false);
      } catch (err) {
        console.error(`[Device] Failed to update status for ${deviceId}:`, err);
      }

      // Notify handlers of disconnect
      this.notifyHandlers(deviceId, { type: "device_offline" });
    });

    ws.on("error", (err) => {
      console.error(`[Device] Error from ${deviceId}:`, err);
    });

    // Send welcome
    this.sendToDevice(deviceId, { type: "connected", timestamp: Date.now() });

    // Request device to send full state immediately after connection
    // This ensures any already-connected browser clients get the state
    this.sendToDevice(deviceId, {
      type: "request_state",
      timestamp: Date.now(),
    });

    // Notify handlers of connection
    this.notifyHandlers(deviceId, { type: "device_online" });
  }

  private handleDeviceMessage(deviceId: string, message: DeviceMessage): void {
    // Add device ID to message
    message.deviceId = deviceId;
    message.timestamp = message.timestamp || Date.now();

    // Log important message types for debugging
    if (message.type === "status" || message.type === "device_info") {
      console.log(
        `[Device] Received ${message.type} from ${deviceId}, forwarding to ${this.messageHandlers.size} handler(s)`
      );
    }

    // Forward to all handlers (client proxy will receive these)
    this.notifyHandlers(deviceId, message);
  }

  private notifyHandlers(deviceId: string, message: DeviceMessage): void {
    this.messageHandlers.forEach((handler) => handler(deviceId, message));
  }

  /**
   * Subscribe to messages from devices
   */
  onDeviceMessage(
    handler: (deviceId: string, message: DeviceMessage) => void
  ): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Send message to a specific device
   */
  sendToDevice(deviceId: string, message: DeviceMessage): boolean {
    const connection = this.devices.get(deviceId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    connection.ws.send(JSON.stringify(message));
    return true;
  }

  /**
   * Check if device is connected
   */
  isDeviceConnected(deviceId: string): boolean {
    const connection = this.devices.get(deviceId);
    return connection?.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get connected device count
   */
  getConnectedDeviceCount(): number {
    return this.devices.size;
  }

  /**
   * Get list of connected devices
   */
  getConnectedDevices(): Array<{
    id: string;
    connectedAt: Date;
    lastSeen: Date;
  }> {
    return Array.from(this.devices.entries()).map(([id, conn]) => ({
      id,
      connectedAt: conn.connectedAt,
      lastSeen: conn.lastSeen,
    }));
  }

  /**
   * Get last seen time for a device (even if disconnected)
   * Returns null if device was never connected
   */
  getDeviceLastSeen(deviceId: string): Date | null {
    const connection = this.devices.get(deviceId);
    return connection?.lastSeen || null;
  }

  /**
   * Force disconnect a device (admin action)
   * Returns true if device was connected and disconnected, false if not connected
   */
  disconnectDevice(deviceId: string): boolean {
    const connection = this.devices.get(deviceId);
    if (!connection) {
      return false;
    }

    console.log(
      `[Device] Force disconnecting device ${deviceId} (admin action)`
    );
    connection.ws.close(4000, "Disconnected by admin");
    return true;
  }

  /**
   * Get detailed stats for health endpoint
   */
  getStats(): {
    connectedDevices: number;
    devices: Array<{
      id: string;
      connectedAt: string;
      lastSeen: string;
      connectionAge: number;
    }>;
  } {
    const devices = Array.from(this.devices.entries()).map(([id, conn]) => ({
      id,
      connectedAt: conn.connectedAt.toISOString(),
      lastSeen: conn.lastSeen.toISOString(),
      connectionAge: Date.now() - conn.connectedAt.getTime(),
    }));

    return {
      connectedDevices: this.devices.size,
      devices,
    };
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.dbSyncInterval) {
      clearInterval(this.dbSyncInterval);
      this.dbSyncInterval = null;
    }
    console.log("[DeviceRelay] Shutdown complete");
  }
}
