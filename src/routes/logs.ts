/**
 * Logs Routes
 *
 * Proxies device log API endpoints via WebSocket.
 * These endpoints are device-specific and require the device to be online.
 */

import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { sessionAuthMiddleware } from "../middleware/auth.js";
import { userOwnsDevice } from "../services/device.js";
import type { DeviceRelay } from "../device-relay.js";
import type { DeviceMessage } from "../types.js";

const router = Router();

// Rate limiter for log endpoints
const logsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: { error: "Too many requests, please try again later" },
});

// Apply rate limiting and auth to all routes
router.use(logsLimiter);
router.use(sessionAuthMiddleware);

/**
 * Helper to send HTTP request to device via WebSocket and wait for response
 */
async function sendDeviceRequest(
  deviceRelay: DeviceRelay,
  deviceId: string,
  message: DeviceMessage,
  timeout = 10000
): Promise<DeviceMessage> {
  return new Promise((resolve, reject) => {
    // Generate unique request ID
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const requestType = message.type;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      unsubscribe();
      reject(new Error("Request timeout"));
    }, timeout);

    // Set up one-time message handler
    const handler = (receivedDeviceId: string, response: DeviceMessage) => {
      // Check if this is a response to our request
      // Match by device ID, request ID, and response type
      if (
        receivedDeviceId === deviceId &&
        response.requestId === requestId &&
        (response.type === requestType + "_response" || response.type === "error")
      ) {
        clearTimeout(timeoutId);
        unsubscribe();
        if (response.type === "error") {
          reject(new Error(response.message || "Device error"));
        } else {
          resolve(response);
        }
      }
    };

    // Subscribe to device messages
    const unsubscribe = deviceRelay.onDeviceMessage(handler);

    // Add request ID to message
    const messageWithId: DeviceMessage = {
      ...message,
      requestId,
    };

    // Send request
    const sent = deviceRelay.sendToDevice(deviceId, messageWithId);
    if (!sent) {
      clearTimeout(timeoutId);
      unsubscribe();
      reject(new Error("Device not connected"));
    }
  });
}

/**
 * GET /api/logs/info
 * Get log buffer information from device
 */
router.get("/info", async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.device as string;
    const userId = req.user!.id;

    if (!deviceId) {
      return res.status(400).json({ error: "Missing device parameter" });
    }

    // Verify user owns device
    if (!userOwnsDevice(userId, deviceId)) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Get device relay from request context
    const deviceRelay = (req as Request & { deviceRelay?: DeviceRelay }).deviceRelay;
    if (!deviceRelay) {
      return res.status(500).json({ error: "Device relay not available" });
    }

    // Check if device is connected
    if (!deviceRelay.isDeviceConnected(deviceId)) {
      return res.status(503).json({ error: "Device not connected" });
    }

    // Send request to device
    const response = await sendDeviceRequest(
      deviceRelay,
      deviceId,
      {
        type: "get_log_info",
        timestamp: Date.now(),
      }
    );

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get log info";
    if (message.includes("timeout")) {
      res.status(504).json({ error: "Device request timeout" });
    } else if (message.includes("not connected")) {
      res.status(503).json({ error: message });
    } else {
      console.error("[Logs] Failed to get log info:", error);
      res.status(500).json({ error: message });
    }
  }
});

/**
 * POST /api/logs/enable
 * Enable or disable log buffer on device
 */
router.post("/enable", async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.device as string;
    const userId = req.user!.id;

    if (!deviceId) {
      return res.status(400).json({ error: "Missing device parameter" });
    }

    // Verify user owns device
    if (!userOwnsDevice(userId, deviceId)) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Parse form data
    const enabled = req.body.enabled === "true" || req.body.enabled === true;

    // Get device relay from request context
    const deviceRelay = (req as Request & { deviceRelay?: DeviceRelay }).deviceRelay;
    if (!deviceRelay) {
      return res.status(500).json({ error: "Device relay not available" });
    }

    // Check if device is connected
    if (!deviceRelay.isDeviceConnected(deviceId)) {
      return res.status(503).json({ error: "Device not connected" });
    }

    // Send request to device
    const response = await sendDeviceRequest(
      deviceRelay,
      deviceId,
      {
        type: "set_log_enabled",
        enabled,
        timestamp: Date.now(),
      }
    );

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to enable/disable logs";
    if (message.includes("timeout")) {
      res.status(504).json({ error: "Device request timeout" });
    } else if (message.includes("not connected")) {
      res.status(503).json({ error: message });
    } else {
      console.error("[Logs] Failed to enable/disable logs:", error);
      res.status(500).json({ error: message });
    }
  }
});

/**
 * GET /api/logs
 * Download logs from device
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.device as string;
    const userId = req.user!.id;

    if (!deviceId) {
      return res.status(400).json({ error: "Missing device parameter" });
    }

    // Verify user owns device
    if (!userOwnsDevice(userId, deviceId)) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Get device relay from request context
    const deviceRelay = (req as Request & { deviceRelay?: DeviceRelay }).deviceRelay;
    if (!deviceRelay) {
      return res.status(500).json({ error: "Device relay not available" });
    }

    // Check if device is connected
    if (!deviceRelay.isDeviceConnected(deviceId)) {
      return res.status(503).json({ error: "Device not connected" });
    }

    // Send request to device
    const response = await sendDeviceRequest(
      deviceRelay,
      deviceId,
      {
        type: "get_logs",
        timestamp: Date.now(),
      }
    );

    // If response contains logs as text, send as text/plain
    if (response.logs && typeof response.logs === "string") {
      res.setHeader("Content-Type", "text/plain");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="brewos_logs_${new Date().toISOString().slice(0, 10)}.txt"`
      );
      res.send(response.logs);
    } else {
      res.json(response);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get logs";
    if (message.includes("timeout")) {
      res.status(504).json({ error: "Device request timeout" });
    } else if (message.includes("not connected")) {
      res.status(503).json({ error: message });
    } else {
      console.error("[Logs] Failed to get logs:", error);
      res.status(500).json({ error: message });
    }
  }
});

/**
 * DELETE /api/logs
 * Clear logs on device
 */
router.delete("/", async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.device as string;
    const userId = req.user!.id;

    if (!deviceId) {
      return res.status(400).json({ error: "Missing device parameter" });
    }

    // Verify user owns device
    if (!userOwnsDevice(userId, deviceId)) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Get device relay from request context
    const deviceRelay = (req as Request & { deviceRelay?: DeviceRelay }).deviceRelay;
    if (!deviceRelay) {
      return res.status(500).json({ error: "Device relay not available" });
    }

    // Check if device is connected
    if (!deviceRelay.isDeviceConnected(deviceId)) {
      return res.status(503).json({ error: "Device not connected" });
    }

    // Send request to device
    const response = await sendDeviceRequest(
      deviceRelay,
      deviceId,
      {
        type: "clear_logs",
        timestamp: Date.now(),
      }
    );

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear logs";
    if (message.includes("timeout")) {
      res.status(504).json({ error: "Device request timeout" });
    } else if (message.includes("not connected")) {
      res.status(503).json({ error: message });
    } else {
      console.error("[Logs] Failed to clear logs:", error);
      res.status(500).json({ error: message });
    }
  }
});

/**
 * POST /api/logs/pico
 * Enable or disable Pico log forwarding
 */
router.post("/pico", async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.device as string;
    const userId = req.user!.id;

    if (!deviceId) {
      return res.status(400).json({ error: "Missing device parameter" });
    }

    // Verify user owns device
    if (!userOwnsDevice(userId, deviceId)) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Parse form data
    const enabled = req.body.enabled === "true" || req.body.enabled === true;

    // Get device relay from request context
    const deviceRelay = (req as Request & { deviceRelay?: DeviceRelay }).deviceRelay;
    if (!deviceRelay) {
      return res.status(500).json({ error: "Device relay not available" });
    }

    // Check if device is connected
    if (!deviceRelay.isDeviceConnected(deviceId)) {
      return res.status(503).json({ error: "Device not connected" });
    }

    // Send request to device
    const response = await sendDeviceRequest(
      deviceRelay,
      deviceId,
      {
        type: "set_pico_log_forwarding",
        enabled,
        timestamp: Date.now(),
      }
    );

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to toggle Pico log forwarding";
    if (message.includes("timeout")) {
      res.status(504).json({ error: "Device request timeout" });
    } else if (message.includes("not connected")) {
      res.status(503).json({ error: message });
    } else {
      console.error("[Logs] Failed to toggle Pico log forwarding:", error);
      res.status(500).json({ error: message });
    }
  }
});

/**
 * POST /api/logs/debug
 * Enable or disable DEBUG level logs
 */
router.post("/debug", async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.device as string;
    const userId = req.user!.id;

    if (!deviceId) {
      return res.status(400).json({ error: "Missing device parameter" });
    }

    // Verify user owns device
    if (!userOwnsDevice(userId, deviceId)) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Parse form data
    const enabled = req.body.enabled === "true" || req.body.enabled === true;

    // Get device relay from request context
    const deviceRelay = (req as Request & { deviceRelay?: DeviceRelay }).deviceRelay;
    if (!deviceRelay) {
      return res.status(500).json({ error: "Device relay not available" });
    }

    // Check if device is connected
    if (!deviceRelay.isDeviceConnected(deviceId)) {
      return res.status(503).json({ error: "Device not connected" });
    }

    // Send request to device
    const response = await sendDeviceRequest(
      deviceRelay,
      deviceId,
      {
        type: "set_debug_logs_enabled",
        enabled,
        timestamp: Date.now(),
      }
    );

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to toggle debug logs";
    if (message.includes("timeout")) {
      res.status(504).json({ error: "Device request timeout" });
    } else if (message.includes("not connected")) {
      res.status(503).json({ error: message });
    } else {
      console.error("[Logs] Failed to toggle debug logs:", error);
      res.status(500).json({ error: message });
    }
  }
});

export default router;

