/**
 * ChirpStack v4 LoRaWAN uplink subscriber
 * Subscribes to: application/<appId>/device/+/event/up
 */
require("dotenv").config();
const mqtt = require("mqtt");
const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// ─── Validate env ────────────────────────────────────────
const {
  MQTT_HOST,
  MQTT_USERNAME,
  MQTT_PASSWORD,
  MQTT_CA_CERT,
  APPLICATION_ID,
} = process.env;

if (!MQTT_HOST) {
  console.error("❌ MQTT_HOST is missing in .env");
  process.exit(1);
}
if (!APPLICATION_ID) {
  console.error("❌ APPLICATION_ID is missing in .env");
  process.exit(1);
}

// ─── Build connection options ────────────────────────────
const connectOptions = {
  clientId: `chirpstack-sub-${Math.random().toString(16).slice(2, 10)}`,
  username: MQTT_USERNAME?.trim() || undefined,
  password: MQTT_PASSWORD?.trim() || undefined,
  reconnectPeriod: 5000,
  connectTimeout: 10_000,
  clean: true,
  keepalive: 60,
};

// Attach CA if using TLS
if (MQTT_HOST.startsWith("mqtts://")) {
  const caPath = MQTT_CA_CERT || "./certs/ca.pem";
  try {
    connectOptions.ca = fs.readFileSync(path.resolve(caPath));
    connectOptions.rejectUnauthorized = true;
    console.log(`🔐 Loaded CA from ${caPath}`);
  } catch (err) {
    console.error(`❌ Cannot read CA file at ${caPath}:`, err.message);
    process.exit(1);
  }
}

// ─── Device name map ─────────────────────────────────────
const deviceNames = {
  "50c6c10d19c40cce": "mohan",
  "82eb41899b9c98d1": "lucky",
};

// ─── RAK5146 / WisBlock FPort-2 decoder ──────────────────
function decodeRak5146(fPort, b64) {
  const buf = Buffer.from(b64, "base64");

  if (fPort !== 2) {
    return { error: `Unhandled FPort ${fPort}`, hex: buf.toString("hex") };
  }
  if (buf.length < 8) {
    return { error: "Payload too short", hex: buf.toString("hex") };
  }

  const version = buf[0];
  const type = buf[1];
  const reserved = buf[2];
  const count = buf[3];
  const duration = buf.readUInt16BE(4);
  const batteryRaw = buf.readUInt16BE(6);

  const samples = [];
  for (let i = 8; i + 1 < buf.length; i += 2) {
    samples.push(buf.readUInt16BE(i));
  }

  // Filter out outlier values (likely transmission errors)
  // Remove values > 10000 which are clearly spurious (normal ADC samples are < 5000)
  const filteredSamples = samples.filter(s => s < 10000);

  // Additional filtering: use interquartile range (IQR) method for robust outlier detection
  if (filteredSamples.length > 20) {
    const sorted = [...filteredSamples].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const iqrFiltered = filteredSamples.filter(s => s >= lowerBound && s <= upperBound);
    if (iqrFiltered.length > filteredSamples.length * 0.6) {
      console.log(`⚠️  IQR filtering: removed ${filteredSamples.length - iqrFiltered.length} samples (Q1=${q1}, Q3=${q3}, IQR=${iqr})`);
      filteredSamples.length = 0;
      filteredSamples.push(...iqrFiltered);
    }
  }

  // If we filtered out some outliers, use the filtered array
  if (filteredSamples.length > 0 && filteredSamples.length < samples.length) {
    console.log(`⚠️  Total filtered: ${samples.length - filteredSamples.length} outlier samples`);
    // Replace samples array with filtered version
    samples.length = 0;
    samples.push(...filteredSamples);
  }

  const min = samples.length ? Math.min(...samples) : null;
  const max = samples.length ? Math.max(...samples) : null;
  const avg = samples.length
    ? Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2))
    : null;

  return {
    version,
    type,
    reserved,
    count,
    duration,
    batteryRaw,
    batteryV: (batteryRaw / 100).toFixed(2),
    sampleCount: samples.length,
    min,
    max,
    avg,
    samples,
    samplesPreview: samples.slice(0, 16),
    hex: buf.toString("hex"),
  };
}

// ─── Express & WebSocket server ─────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

// Broadcast sensor data to all connected WebSocket clients
function broadcastSensorData(data) {
  const clientCount = wss.clients.size;
  console.log(`📡 Broadcasting to ${clientCount} WebSocket clients:`, JSON.stringify(data));
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

console.log("🌐 WebSocket server initialized");

// ─── MQTT client ─────────────────────────────────────────
const client = mqtt.connect(MQTT_HOST, connectOptions);

// ChirpStack v4 topic
const topic = `application/${APPLICATION_ID}/device/+/event/up`;

client.on("connect", () => {
  console.log(`✅ Connected to MQTT: ${MQTT_HOST}`);
  client.subscribe(topic, { qos: 1 }, (err, granted) => {
    if (err) {
      console.error("❌ Subscribe failed:", err.message);
      return;
    }
    console.log(`📡 Subscribed to: ${topic}`);
    console.log("   Granted QoS:", JSON.stringify(granted));
    console.log("⏳ Waiting for device uplinks...\n");
  });
});

client.on("message", (receivedTopic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const devEui = (data.deviceInfo?.devEui || "").toLowerCase();
    const deviceName = deviceNames[devEui] || "Unknown";
    const appIdFromTopic = receivedTopic.split("/")[1];
    const rx =
      Array.isArray(data.rxInfo) && data.rxInfo.length ? data.rxInfo[0] : null;

    console.log("──────────────────────────────────────────");
    console.log(`Topic         : ${receivedTopic}`);
    console.log(`App ID        : ${appIdFromTopic}`);
    console.log(`Device        : ${deviceName}`);
    console.log(`DevEUI        : ${devEui}`);
    console.log(
      `Profile       : ${data.deviceInfo?.deviceProfileName || "N/A"}`,
    );
    console.log(`Received at   : ${data.time || "N/A"}`);
    console.log(`FCnt          : ${data.fCnt ?? "N/A"}`);
    console.log(`FPort         : ${data.fPort ?? "N/A"}`);
    console.log(`Raw payload   : ${data.data || "N/A"}`);

    // Decode payload if FPort 2
    let decodedPayload = null;
    if (data.data && data.fPort != null) {
      decodedPayload = decodeRak5146(data.fPort, data.data);
      if (decodedPayload.error) {
        console.log(`Decode error  : ${decodedPayload.error}`);
      } else {
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`📊 PAYLOAD DECODED - ${deviceName} (${devEui})`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Version       : ${decodedPayload.version}`);
        console.log(`Type          : 0x${decodedPayload.type.toString(16).padStart(2, "0")}`);
        console.log(`Count         : ${decodedPayload.count}`);
        console.log(`Duration      : ${decodedPayload.duration} ms`);
        console.log(`Battery       : ${decodedPayload.batteryV} V (raw ${decodedPayload.batteryRaw})`);
        console.log(`Samples       : ${decodedPayload.sampleCount}`);
        console.log(`Stats         : min=${decodedPayload.min} | max=${decodedPayload.max} | avg=${decodedPayload.avg}`);
        console.log(`All Samples   : [${decodedPayload.samples.join(', ')}]`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      }
    } else if (data.object) {
      console.log(`Decoded object: ${JSON.stringify(data.object)}`);
    }
    if (rx) {
      console.log(`RSSI          : ${rx.rssi} dBm`);
      console.log(`SNR           : ${rx.snr} dB`);
      console.log(`Gateway       : ${rx.gatewayId || "N/A"}`);
      console.log(
        `Frequency     : ${
          rx.frequency ? (rx.frequency / 1e6).toFixed(3) + " MHz" : "N/A"
        }`,
      );
      console.log(`DataRate      : ${rx.dataRate?.modulation || "N/A"}`);
    }
    console.log("──────────────────────────────────────────\n");

    // Broadcast to WebSocket clients
    broadcastSensorData({
      deviceName,
      devEui,
      timestamp: data.time || new Date().toISOString(),
      rssi: rx?.rssi,
      snr: rx?.snr,
      fPort: data.fPort,
      data: data.data,
      decodedPayload: decodedPayload,
    });
  } catch (err) {
    console.error("❌ Message parsing error:", err.message);
  }
});

client.on("error", (err) => console.error("❌ MQTT error:", err.message));
client.on("reconnect", () => console.log("🔄 Reconnecting to MQTT..."));
client.on("offline", () => console.log("⚠️  MQTT offline"));
client.on("close", () => console.log("🔌 MQTT connection closed"));

// ─── Graceful shutdown ───────────────────────────────────
const shutdown = () => {
  console.log("\n🛑 Shutting down...");
  client.end(false, {}, () => {
    server.close(() => process.exit(0));
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ─── Start HTTP server ───────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
