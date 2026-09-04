// Bhoomitra ESP32 field controller
//
// Wiring (per LM2596 5V rail + ESP32):
//   Servo   signal -> GPIO25   (power from LM2596 5V OUT+, GND common)
//   Relay   IN     -> GPIO26   (power from LM2596 5V OUT+, GND common)
//   DHT11   DATA   -> GPIO27   (power from ESP32 3.3V)
//   Soil #1 AO     -> GPIO34   (power from ESP32 3.3V)
//   Soil #2 AO     -> GPIO35   (not wired yet -- left disabled below)
//
// Libraries needed (Tools > Manage Libraries):
//   "ESP32Servo" by Kevin Harrington / madhephaestus
//   "DHT sensor library" by Adafruit   (pulls in "Adafruit Unified Sensor")
//
// Serial protocol (matches hardware_bridge.py, 115200 baud):
//   ESP32 -> PC   : {"zone1":<0-100>,"temperature":<C>,"humidity":<%>,"nozzleStatus":"..."}
//   PC -> ESP32   : "<WATER|SPRAY|STOP>:<A1|A2|A3|A4>\n"

#include <ESP32Servo.h>
#include <DHT.h>

// ---- Pins ----
#define SERVO_PIN   25
#define RELAY_PIN   26
#define DHT_PIN     27
#define SOIL1_PIN   34
#define SOIL2_PIN   35   // reserved; soil sensor #2 not connected yet

// ---- Relay polarity ----
// Most cheap single-channel 5V relay boards are ACTIVE-LOW (LOW = energized).
// If your relay clicks backwards (on when it should be off), flip this to false.
#define RELAY_ACTIVE_LOW true

// ---- Soil moisture calibration ----
// Raw ESP32 ADC (0-4095). Resistive/capacitive AO sensors read HIGH when dry,
// LOW when wet. These are placeholder values -- calibrate on your sensor:
//   1) Read raw value in dry air      -> set SOIL_DRY
//   2) Read raw value in a wet sponge -> set SOIL_WET
int SOIL_DRY = 3000;
int SOIL_WET = 1200;

// ---- Servo angle per zone ----
// One physical nozzle rig is aimed at a zone by rotating the servo.
struct ZoneAngle { const char* zone; int angle; };
ZoneAngle zoneAngles[] = {
  { "A1", 0 },
  { "A2", 45 },
  { "A3", 90 },
  { "A4", 135 },
};
const int NUM_ZONES = sizeof(zoneAngles) / sizeof(zoneAngles[0]);

// ---- Pulse timing ----
const unsigned long PULSE_DURATION_MS = 3000; // one "water"/"spray" command = one 3s pulse
const unsigned long SENSOR_INTERVAL_MS = 3000;

DHT dht(DHT_PIN, DHT11);
Servo nozzleServo;

unsigned long lastSensorSend = 0;
bool pulseActive = false;
unsigned long pulseStartedAt = 0;
String pulseZone = "A1";
bool pendingStatusReport = false;
String pendingStatus = "";
String pendingFeedback = "";

void relayOn() {
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? LOW : HIGH);
}

void relayOff() {
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? HIGH : LOW);
}

int angleForZone(const String &zone) {
  for (int i = 0; i < NUM_ZONES; i++) {
    if (zone == zoneAngles[i].zone) return zoneAngles[i].angle;
  }
  return 0;
}

void startPulse(const String &zone) {
  pulseZone = zone;
  nozzleServo.write(angleForZone(zone));
  delay(300); // give the servo time to reach position before opening the valve
  relayOn();
  pulseActive = true;
  pulseStartedAt = millis();
  Serial.print("PULSE_START:");
  Serial.println(zone);
}

void stopPulse(const char* feedback) {
  relayOff();
  pulseActive = false;
  pendingStatusReport = true;
  pendingStatus = "closed";
  pendingFeedback = feedback;
  Serial.print("PULSE_END:");
  Serial.println(pulseZone);
}

void handleCommand(String line) {
  line.trim();
  if (line.length() == 0) return;

  int sep = line.indexOf(':');
  if (sep < 0) return;

  String cmd = line.substring(0, sep);
  String zone = line.substring(sep + 1);
  cmd.trim();
  zone.trim();
  cmd.toUpperCase();

  if (cmd == "WATER" || cmd == "SPRAY") {
    startPulse(zone);
  } else if (cmd == "STOP") {
    if (pulseActive) {
      stopPulse("Controller stopped pulse");
    } else {
      relayOff();
    }
  }
}

float readSoilPercent(int pin) {
  int raw = analogRead(pin);
  int pct = map(raw, SOIL_DRY, SOIL_WET, 0, 100);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

void sendSensorReading() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();

  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("DHT_READ_ERROR");
    return;
  }

  float soil1 = readSoilPercent(SOIL1_PIN);
  // Soil sensor #2 not wired yet -- uncomment once GPIO35 is connected:
  // float soil2 = readSoilPercent(SOIL2_PIN);

  Serial.print("RAW_SOIL1:");
  Serial.println(analogRead(SOIL1_PIN));

  String json = "{";
  json += "\"zone1\":" + String(soil1, 0);
  // json += ",\"zone2\":" + String(soil2, 0);
  json += ",\"temperature\":" + String(temperature, 1);
  json += ",\"humidity\":" + String(humidity, 1);
  if (pendingStatusReport) {
    json += ",\"nozzleStatus\":\"" + pendingStatus + "\"";
    json += ",\"feedbackMessage\":\"" + pendingFeedback + "\"";
  }
  json += "}";

  Serial.println(json);

  if (pendingStatusReport) {
    pendingStatusReport = false;
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(RELAY_PIN, OUTPUT);
  relayOff();

  pinMode(SOIL1_PIN, INPUT);
  pinMode(SOIL2_PIN, INPUT);

  dht.begin();
  delay(2000); // DHT11 needs a couple seconds to stabilize before its first read

  nozzleServo.setPeriodHertz(50);
  nozzleServo.attach(SERVO_PIN, 500, 2400);
  nozzleServo.write(160); // parked position, distinct from every zone angle so the
                           // first pulse always produces a visible, testable rotation

  Serial.println("BHOOMITRA_ESP32_READY");
}

void loop() {
  // Listen for commands from the PC bridge without blocking sensor reads.
  if (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    handleCommand(line);
  }

  // Close the pulse automatically after PULSE_DURATION_MS.
  if (pulseActive && millis() - pulseStartedAt >= PULSE_DURATION_MS) {
    stopPulse("Pump pulse completed");
  }

  // Periodic sensor report.
  if (millis() - lastSensorSend >= SENSOR_INTERVAL_MS) {
    lastSensorSend = millis();
    sendSensorReading();
  }
}
