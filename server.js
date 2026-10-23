/**
 * ChirpStack v4 LoRaWAN uplink subscriber
 * Subscribes to: application/<appId>/device/+/event/up
 */
require("dotenv").config();
const mqtt = require("mqtt");
const fs = require("fs");
const path = require("path");

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
    if (data.object) {
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
  client.end(false, {}, () => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
