"""Preprocessing/retry regression checks; no real model or farm data is used."""
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
from PIL import Image

from main import app, predict_with_retry


CONFIG = {"input_size": 640, "retry_input_size": 1280, "confidence_threshold": 0.35}


class FakeModel:
    def __init__(self, results):
        self.results = iter(results)
        self.calls = []

    def predict(self, **kwargs):
        self.calls.append(kwargs)
        result = next(self.results)
        if isinstance(result, Exception):
            raise result
        return [result]


class RetryTests(unittest.TestCase):
    def setUp(self):
        self.image = Image.new("RGB", (40, 60), (255, 0, 0))
        empty_boxes = MagicMock()
        empty_boxes.__len__.return_value = 0
        empty_boxes.xyxy.detach().cpu().tolist.return_value = []
        empty_boxes.conf.detach().cpu().tolist.return_value = []
        empty_boxes.cls.detach().cpu().int().tolist.return_value = []
        self.empty = SimpleNamespace(boxes=empty_boxes)
        self.found = SimpleNamespace(boxes=[object()])

    def test_successful_first_pass_is_preserved_without_retry(self):
        model = FakeModel([self.found])
        result, metadata = predict_with_retry(model, self.image, CONFIG)
        self.assertIs(result, self.found)
        self.assertEqual(len(model.calls), 1)
        self.assertEqual(metadata, {"inputSize": 640, "retryUsed": False, "attemptedSizes": [640]})

    def test_empty_pass_retries_once_with_same_threshold_and_bgr_pixels(self):
        model = FakeModel([self.empty, self.found])
        with patch.dict("os.environ", {"PEST_CONFIDENCE_THRESHOLD": "0.35"}):
            result, metadata = predict_with_retry(model, self.image, CONFIG)
        self.assertIs(result, self.found)
        self.assertEqual([call["imgsz"] for call in model.calls], [640, 1280])
        self.assertEqual([call["conf"] for call in model.calls], [0.35, 0.35])
        self.assertTrue(metadata["retryUsed"])
        self.assertEqual(metadata["inputSize"], 1280)
        for call in model.calls:
            np.testing.assert_array_equal(call["source"][0, 0], [0, 0, 255])
            self.assertTrue(call["source"].flags.c_contiguous)
            self.assertEqual(call["source"].shape, (60, 40, 3))

    def test_two_empty_passes_stay_empty_without_fabricated_boxes(self):
        model = FakeModel([SimpleNamespace(boxes=None), self.empty])
        result, metadata = predict_with_retry(model, self.image, CONFIG)
        self.assertEqual(len(result.boxes), 0)
        self.assertEqual(metadata["attemptedSizes"], [640, 1280])
        self.assertEqual(len(model.calls), 2)

    def test_retry_error_is_not_treated_as_a_valid_empty_scan(self):
        model = FakeModel([self.empty, RuntimeError("retry failed")])
        with self.assertRaisesRegex(RuntimeError, "retry failed"):
            predict_with_retry(model, self.image, CONFIG)

    def test_exif_orientation_and_retry_metadata_reach_http_response(self):
        image_bytes = BytesIO()
        exif = self.image.getexif()
        exif[274] = 6
        self.image.save(image_bytes, format="JPEG", exif=exif)
        image_bytes.seek(0)
        model = FakeModel([self.empty, self.empty])
        with patch("main.load_detector", return_value=(model, ["aphids"])), patch("main.active_config", return_value=CONFIG), patch("main.classifier_fallback", return_value=None):
            response = app.test_client().post("/predict", data={"file": (image_bytes, "rotated.jpg")})
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertFalse(body["detected"])
        self.assertEqual(body["image"], {"width": 60, "height": 40})
        self.assertEqual(body["inference"]["attemptedSizes"], [640, 1280])

    def test_classifier_result_has_no_boxes_or_pressure(self):
        image_bytes = BytesIO()
        self.image.save(image_bytes, format="PNG")
        image_bytes.seek(0)
        model = FakeModel([self.empty, self.empty])
        prediction = {"classId": 1, "label": "Aphids", "confidence": 0.87}
        with patch("main.load_detector", return_value=(model, ["aphids"])), patch("main.active_config", return_value=CONFIG), patch("main.classifier_fallback", return_value=prediction):
            body = app.test_client().post("/predict", data={"file": (image_bytes, "test.png")}).get_json()
        self.assertTrue(body["detected"])
        self.assertEqual(body["identificationSource"], "classifier")
        self.assertEqual(body["primaryPrediction"]["label"], "Aphids")
        self.assertEqual(body["detections"], [])
        self.assertIsNone(body["pressure"])

    def test_missing_classifier_keeps_scan_inconclusive(self):
        image_bytes = BytesIO()
        self.image.save(image_bytes, format="PNG")
        image_bytes.seek(0)
        model = FakeModel([self.empty, self.empty])
        with patch("main.load_detector", return_value=(model, ["aphids"])), patch("main.active_config", return_value=CONFIG), patch("main.classifier_fallback", side_effect=FileNotFoundError("missing")):
            body = app.test_client().post("/predict", data={"file": (image_bytes, "test.png")}).get_json()
        self.assertFalse(body["detected"])
        self.assertIsNone(body["pressure"])


if __name__ == "__main__":
    unittest.main()
