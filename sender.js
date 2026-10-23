/**
 * ChirpStack v4 LoRaWAN uplink subscriber
 * + RAK5146 / WisBlock FPort-2 payload decoder
 *
 * Subscribes to: application/<appId>/device/+/event/up
 *
 * Notes:
 *   - ChirpStack already decrypts the LoRaWAN FRMPayload before publishing.
 *     `data.data` is base64 of the *plaintext* application bytes.
 *   - No AppKey / AppSKey is needed in this app.
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

// ─── MQTT connection options ─────────────────────────────
const connectOptions = {
  clientId: `chirpstack-sub-${Math.random().toString(16).slice(2, 10)}`,
  username: MQTT_USERNAME?.trim() || undefined,
  password: MQTT_PASSWORD?.trim() || undefined,
  reconnectPeriod: 5000,
  connectTimeout: 10_000,
  clean: true,
  keepalive: 60,
};

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
/**
 * Wire format observed from `rak5146` profile on FPort 2:
 *
 *   offset  len   field
 *   ------  ---   -----------------------------
 *   0       1     version     (0x01)
 *   1       1     type        (0x10 = 16)
 *   2       1     reserved    (0x00)
 *   3       1     count       (channel / group count)
 *   4       2     duration    (BE uint16, milliseconds or sample interval)
 *   6       2     batteryRaw  (BE uint16, value / 100 = volts)
 *   8       n*2   samples     (BE uint16 array)
 */
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

// ─── MQTT client ─────────────────────────────────────────
const client = mqtt.connect(MQTT_HOST, connectOptions);
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

    // ← DECODED (plaintext already provided by ChirpStack)
    if (data.data && data.fPort != null) {
      const decoded = decodeRak5146(data.fPort, data.data);
      if (decoded.error) {
        console.log(`Decode error  : ${decoded.error}`);
      } else {
        console.log(`Version       : ${decoded.version}`);
        console.log(
          `Type          : 0x${decoded.type.toString(16).padStart(2, "0")}`,
        );
        console.log(`Count         : ${decoded.count}`);
        console.log(`Duration      : ${decoded.duration}`);
        console.log(
          `Battery       : ${decoded.batteryV} V (raw ${decoded.batteryRaw})`,
        );
        console.log(`Samples       : ${decoded.sampleCount}`);
        console.log(
          `Stats         : min=${decoded.min} max=${decoded.max} avg=${decoded.avg}`,
        );
        console.log(
          `Preview       : ${JSON.stringify(decoded.samplesPreview)}`,
        );
        // full sample array (uncomment if you want everything)
        // console.log(`All samples :`, decoded.samples);
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
