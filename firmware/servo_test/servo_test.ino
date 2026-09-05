// Minimal standalone servo test -- isolates the servo from all other logic.
// Wiring: Servo signal (orange) -> GPIO25, VCC (red) -> LM2596 5V OUT+, GND (brown) -> common GND

#include <ESP32Servo.h>

#define SERVO_PIN 25
Servo testServo;

void setup() {
  Serial.begin(115200);
  delay(500);
  testServo.setPeriodHertz(50);
  testServo.attach(SERVO_PIN, 500, 2400);
  Serial.println("SERVO_TEST_READY");
}

void loop() {
  Serial.println("Moving to 0");
  testServo.write(0);
  delay(1500);

  Serial.println("Moving to 90");
  testServo.write(90);
  delay(1500);

  Serial.println("Moving to 160");
  testServo.write(160);
  delay(1500);
}
