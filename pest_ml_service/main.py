import json
import os
from collections import defaultdict
from io import BytesIO
from typing import Any

import numpy as np
from flask import Flask, jsonify, request
from PIL import Image, ImageOps


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REGISTRY_PATH = os.path.join(BASE_DIR, "model_registry.json")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024

_model_cache: dict[str, Any] = {}


def load_registry() -> dict[str, Any]:
    with open(REGISTRY_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def active_config() -> dict[str, Any]:
    registry = load_registry()
    model_id = registry.get("default_model_id")
    for entry in registry.get("models", []):
        if entry.get("model_id") == model_id and entry.get("enabled", True):
            return entry
    raise RuntimeError("No enabled pest detector is configured.")


def resolve_path(config: dict[str, Any], key: str, env_key: str) -> str:
    configured = os.getenv(env_key) or str(config.get(key, ""))
    if not configured:
        return ""
    if os.path.isabs(configured):
        return configured
    return os.path.join(BASE_DIR, configured)


def load_expected_labels(config: dict[str, Any]) -> list[str]:
    labels_path = resolve_path(config, "labels_path", "PEST_LABELS_PATH")
    if not labels_path or not os.path.exists(labels_path):
        raise FileNotFoundError(f"Pest class names are missing at {labels_path or 'the configured path'}.")

    with open(labels_path, "r", encoding="utf-8") as handle:
        labels = json.load(handle)
    if not isinstance(labels, list) or not labels or not all(isinstance(item, str) and item.strip() for item in labels):
        raise ValueError("The detector class-name file must contain a non-empty JSON list.")
    return [item.strip() for item in labels]


def names_as_list(names: Any) -> list[str]:
    if isinstance(names, dict):
        return [str(names[index]) for index in sorted(names)]
    if isinstance(names, (list, tuple)):
        return [str(item) for item in names]
    raise ValueError("The YOLO checkpoint does not expose readable class names.")


def load_detector(config: dict[str, Any]):
    model_id = str(config.get("model_id", "bhoomitra_pest_detector_yolo26_v1"))
    if model_id in _model_cache:
        return _model_cache[model_id]

    model_path = resolve_path(config, "model_path", "PEST_MODEL_PATH")
    if not model_path or not os.path.exists(model_path):
        raise FileNotFoundError(f"YOLO pest detector is missing at {model_path or 'the configured path'}.")

    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise RuntimeError("Ultralytics is not installed. Install pest_ml_service/requirements.txt.") from exc

    expected_labels = load_expected_labels(config)
    model = YOLO(model_path, task="detect")
    checkpoint_labels = names_as_list(model.names)
    if checkpoint_labels != expected_labels:
        raise ValueError(
            "Checkpoint labels do not match pest_detector_yolo26_v1.classes.json. "
            f"Checkpoint: {checkpoint_labels}; configured: {expected_labels}."
        )

    _model_cache[model_id] = (model, checkpoint_labels)
    return model, checkpoint_labels


def predict_with_retry(model, image: Image.Image, config: dict[str, Any]):
    """Keep a successful normal pass; retry an empty pass once at a larger size."""
    # PIL is RGB; Ultralytics NumPy inputs must be OpenCV-style BGR.
    bgr_image = np.ascontiguousarray(np.asarray(image)[:, :, ::-1])
    input_size = int(config.get("input_size", 640))
    retry_size = int(config.get("retry_input_size", 1280))
    options = {
        "source": bgr_image,
        "conf": float(os.getenv("PEST_CONFIDENCE_THRESHOLD", str(config.get("confidence_threshold", 0.35)))),
        "iou": float(config.get("iou_threshold", 0.5)),
        "max_det": int(config.get("max_detections", 100)),
        "device": os.getenv("PEST_DEVICE", str(config.get("device", "cpu"))),
        "verbose": False,
    }
    result = model.predict(imgsz=input_size, **options)[0]
    attempted_sizes = [input_size]
    if (result.boxes is None or len(result.boxes) == 0) and retry_size > input_size:
        # Use the same confidence threshold, and do not merge/double-count boxes.
        result = model.predict(imgsz=retry_size, **options)[0]
        attempted_sizes.append(retry_size)
    return result, {
        "inputSize": attempted_sizes[-1],
        "retryUsed": len(attempted_sizes) > 1,
        "attemptedSizes": attempted_sizes,
    }


def image_pressure(visible_count: int, coverage_ratio: float) -> dict[str, Any]:
    """Return an image-level cue, never a whole-field severity estimate."""
    if visible_count >= 8 or (visible_count >= 4 and coverage_ratio >= 0.05):
        level = "high"
    elif visible_count >= 3 or (visible_count >= 2 and coverage_ratio >= 0.02):
        level = "moderate"
    else:
        level = "low"
    return {
        "level": level,
        "visibleCount": visible_count,
        "boxCoverageRatio": coverage_ratio,
        "basis": "Visible detections and their bounding-box coverage in this image only.",
    }


def classifier_fallback(image: Image.Image):
    """Identity-only fallback. Never synthesize boxes, counts or pressure."""
    import torch
    key = "classifier_fallback_v1"
    if key not in _model_cache:
        model = torch.jit.load(os.path.join(BASE_DIR, "models/pest_detector.pt"), map_location="cpu")
        model.eval()
        with open(os.path.join(BASE_DIR, "models/class_names.json"), encoding="utf-8") as handle:
            labels = json.load(handle)
        _model_cache[key] = (model, labels)
    model, labels = _model_cache[key]
    resized = image.resize((224, 224), Image.Resampling.BILINEAR)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    array = (array - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
    tensor = torch.from_numpy(array.transpose(2, 0, 1).copy()).unsqueeze(0)
    with torch.inference_mode():
        logits = model(tensor)
        if logits.shape != (1, len(labels)) or not torch.isfinite(logits).all():
            raise ValueError("Classifier output does not match its label file")
        scores = torch.softmax(logits, dim=1)[0]
    ranked = scores.argsort(descending=True)
    first, second = int(ranked[0]), int(ranked[1])
    # Conservative starting gate, not a calibrated correctness guarantee.
    if float(scores[first]) < 0.70 or float(scores[first] - scores[second]) < 0.20:
        return None
    return {"classId": first, "label": labels[first], "confidence": float(scores[first])}


def model_status() -> dict[str, Any]:
    config = active_config()
    model_path = resolve_path(config, "model_path", "PEST_MODEL_PATH")
    labels_path = resolve_path(config, "labels_path", "PEST_LABELS_PATH")
    try:
        model, labels = load_detector(config)
        del model
        return {
            "ready": True,
            "classCount": len(labels),
            "modelPath": model_path,
            "labelsPath": labels_path,
            "message": f"YOLO pest detector is ready with {len(labels)} classes.",
        }
    except Exception as exc:
        return {
            "ready": False,
            "classCount": 0,
            "modelPath": model_path,
            "labelsPath": labels_path,
            "message": str(exc),
        }


@app.get("/")
@app.get("/health")
def health():
    config = active_config()
    status = model_status()
    return jsonify(
        {
            "service": "bhoomitra-pest-detector",
            **status,
            "modelId": config.get("model_id", "bhoomitra_pest_detector_yolo26_v1"),
            "modelVersion": config.get("model_version", "1.0.0"),
            "task": "object-detection",
        }
    )


@app.get("/models")
def models():
    registry = load_registry()
    output = []
    for entry in registry.get("models", []):
        model_path = resolve_path(entry, "model_path", "PEST_MODEL_PATH")
        labels_path = resolve_path(entry, "labels_path", "PEST_LABELS_PATH")
        output.append(
            {
                **entry,
                "ready": bool(model_path and labels_path and os.path.exists(model_path) and os.path.exists(labels_path)),
            }
        )
    return jsonify({"defaultModelId": registry.get("default_model_id"), "models": output})


@app.post("/predict")
def predict():
    if "file" not in request.files:
        return jsonify({"error": "Missing image file."}), 400

    config = active_config()
    try:
        model, labels = load_detector(config)
    except Exception as exc:
        return jsonify({"error": str(exc), "ready": False}), 503

    image_file = request.files["file"]
    try:
        raw = image_file.read()
        if not raw:
            raise ValueError("The uploaded image is empty.")
        image = ImageOps.exif_transpose(Image.open(BytesIO(raw))).convert("RGB")
        source_width, source_height = image.size
        if source_width < 32 or source_height < 32:
            raise ValueError("The uploaded image is too small.")
    except Exception:
        return jsonify({"error": "The uploaded file is not a readable image."}), 400

    try:
        result, inference = predict_with_retry(model, image, config)
    except Exception as exc:
        app.logger.exception("Pest detector inference failed")
        return jsonify({"error": f"Pest detector inference failed: {exc}"}), 500

    detections: list[dict[str, Any]] = []
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    if result.boxes is not None:
        xyxy = result.boxes.xyxy.detach().cpu().tolist()
        confidences = result.boxes.conf.detach().cpu().tolist()
        class_ids = result.boxes.cls.detach().cpu().int().tolist()
        for raw_box, raw_confidence, class_id in zip(xyxy, confidences, class_ids):
            if class_id < 0 or class_id >= len(labels):
                continue
            x1 = max(0.0, min(float(source_width), float(raw_box[0])))
            y1 = max(0.0, min(float(source_height), float(raw_box[1])))
            x2 = max(x1, min(float(source_width), float(raw_box[2])))
            y2 = max(y1, min(float(source_height), float(raw_box[3])))
            width = x2 - x1
            height = y2 - y1
            area_ratio = (width * height) / max(1.0, float(source_width * source_height))
            detection = {
                "classId": int(class_id),
                "label": labels[class_id],
                "confidence": float(raw_confidence),
                "box": {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "width": width, "height": height},
                "areaRatio": area_ratio,
            }
            detections.append(detection)
            grouped[class_id].append(detection)

    summaries = []
    for class_id, items in grouped.items():
        summaries.append(
            {
                "classId": class_id,
                "label": labels[class_id],
                "confidence": max(float(item["confidence"]) for item in items),
                "meanConfidence": sum(float(item["confidence"]) for item in items) / len(items),
                "count": len(items),
                "boxCoverageRatio": min(1.0, sum(float(item["areaRatio"]) for item in items)),
            }
        )
    summaries.sort(key=lambda item: (item["confidence"], item["count"]), reverse=True)

    primary = summaries[0] if summaries else None
    source = "detector"
    if primary is None:
        try:
            primary = classifier_fallback(image)
        except Exception:
            app.logger.exception("Classifier fallback unavailable; retaining inconclusive result")
            inference["fallbackUnavailable"] = True
        if primary is not None:
            source = "classifier"
            summaries = [primary]
    primary_detections = [item for item in detections if primary and item["classId"] == primary["classId"]]
    visible_count = len(primary_detections)
    coverage_ratio = min(1.0, sum(float(item["areaRatio"]) for item in primary_detections))

    return jsonify(
        {
            "modelId": "bhoomitra_pest_classifier_v1" if source == "classifier" else config.get("model_id"),
            "modelVersion": config.get("model_version"),
            "task": "image-classification" if source == "classifier" else "object-detection",
            "identificationSource": source,
            "image": {"width": source_width, "height": source_height},
            "detected": primary is not None,
            "inference": inference,
            "primaryPrediction": primary,
            "predictions": summaries[:3],
            "detections": detections,
            "pressure": image_pressure(visible_count, coverage_ratio) if primary and source == "detector" else None,
            "limitations": "Counts and bounding boxes apply only to visible pests in this photo; they do not estimate whole-field severity.",
        }
    )


@app.errorhandler(413)
def image_too_large(_error):
    return jsonify({"error": "Image is too large. Choose an image below 12 MB."}), 413


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PEST_ML_PORT", "5001")), debug=False)
