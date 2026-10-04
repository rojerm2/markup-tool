import { useEffect, useState } from "react";
import {
  MEASUREMENT_UNITS,
  measurementLabel,
  convertMeasurementUnit,
  validCalibration,
  type Measurement,
  type PageCalibration,
  type MeasurementUnit,
} from "../../services/measurements";
import type { MeasurementStyle, MeasurementTool } from "./MeasurementOverlay";
import FontSizeControl from "./FontSizeControl";
import { focusCanvas } from "../../services/canvasFocus";
import type { SessionHistory } from "../../services/sessionHistory";

export default function MeasurementControls({
  page,
  tool,
  calibration,
  candidate,
  style,
  selected,
  disabled,
  lockedPage,
  onCalibrate,
  onApply,
  onStyle,
  onEdit,
  onCancel,
  history,
  revision,
}: {
  page: number;
  tool: MeasurementTool | "edit";
  calibration?: PageCalibration;
  candidate?: { a: PageCalibration["a"]; b: PageCalibration["b"] };
  style: MeasurementStyle;
  selected?: Measurement;
  disabled: boolean;
  lockedPage: boolean;
  onCalibrate: () => void;
  onApply: (value: PageCalibration) => void;
  onStyle: (style: MeasurementStyle) => void;
  onEdit: (value: Measurement) => void;
  onCancel: () => void;
  history: SessionHistory;
  revision: number;
}) {
  const [distance, setDistance] = useState(String(calibration?.distance ?? 1)),
    [unit, setUnit] = useState<MeasurementUnit>(calibration?.unit ?? "m"),
    [appearance, setAppearance] = useState<MeasurementStyle>(selected ?? style);
  useEffect(() => {
    setDistance(String(calibration?.distance ?? 1));
    setUnit(calibration?.unit ?? "m");
  }, [page, calibration]);
  useEffect(() => setAppearance(selected ?? style), [selected, style]);
  useEffect(() => {
    const reset = () => {
      setAppearance(selected ?? style);
      setDistance(String(calibration?.distance ?? 1));
      setUnit(calibration?.unit ?? "m");
    };
    reset();
    const a = history.subscribeCancellation(reset),
      b = history.subscribeSnapshotCancellation(reset);
    return () => {
      a();
      b();
    };
  }, [history, revision, page, selected, style, calibration]);
  const proposed = candidate
    ? { page, a: candidate.a, b: candidate.b, distance: Number(distance), unit }
    : null;
  const changed =
    selected &&
    (selected.color !== appearance.color ||
      selected.width !== appearance.width ||
      selected.fontSize !== appearance.fontSize);

  function change(value: MeasurementStyle) {
    setAppearance(value);
    if (!selected) onStyle(value);
  }
  return (
    <section
      className="measurement-controls"
      aria-label="Measurement properties"
    >
      <strong>Page {page} scale</strong>
      <p className="measurement-scale" role="status">
        {calibration
          ? `${calibration.distance} ${calibration.unit} between reference points`
          : "Uncalibrated · PDF units"}
      </p>
      <button disabled={disabled || lockedPage} onClick={onCalibrate}>
        {calibration ? "Change page scale" : "Calibrate page"}
      </button>
      {lockedPage && (
        <p>Unlock measurements on this page to change its scale.</p>
      )}
      {tool === "measure-calibrate" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !disabled &&
              !lockedPage &&
              proposed &&
              validCalibration(proposed)
            ) {
              onApply(proposed);
              focusCanvas(e.currentTarget);
            }
          }}
        >
          <p>
            Drag between two known points on the page, then enter their
            distance.
          </p>
          <label>
            Known distance
            <input
              aria-label="Known distance"
              type="number"
              min="0.000001"
              max="1000000000"
              step="any"
              value={distance}
              disabled={disabled || lockedPage}
              onChange={(e) => setDistance(e.target.value)}
            />
          </label>
          <label>
            Unit
            <select
              aria-label="Calibration unit"
              value={unit}
              disabled={disabled || lockedPage}
              onChange={(e) => {
                const next = e.target.value as MeasurementUnit,
                  n = Number(distance);
                if (Number.isFinite(n))
                  setDistance(String(convertMeasurementUnit(n, unit, next)));
                setUnit(next);
              }}
            >
              {MEASUREMENT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button
              type="submit"
              disabled={
                disabled ||
                lockedPage ||
                !proposed ||
                !validCalibration(proposed)
              }
            >
              Apply scale
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {tool !== "measure-calibrate" && (
        <>
          {selected && <p>{measurementLabel(selected, calibration)}</p>}
          {!selected && (
            <p>
              {tool === "measure-length"
                ? "Drag to measure a straight distance."
                : "Click polygon vertices. Enter, double-click or click the first point to finish."}
            </p>
          )}
          <label>
            Color
            <input
              aria-label="Measurement color"
              type="color"
              value={appearance.color}
              disabled={disabled}
              onChange={(e) => change({ ...appearance, color: e.target.value })}
            />
          </label>
          <label>
            Line width
            <input
              aria-label="Measurement line width"
              type="number"
              min="0.01"
              max="100"
              step="0.25"
              value={appearance.width}
              disabled={disabled}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (n >= 0.01 && n <= 100) change({ ...appearance, width: n });
              }}
            />
          </label>
          <FontSizeControl
            disabled={disabled}
            label="Measurement text size"
            value={appearance.fontSize}
            onChange={(fontSize) => {
              if (!disabled) change({ ...appearance, fontSize });
            }}
          />
          {selected && (
            <button
              disabled={disabled || !changed}
              onClick={(e) => {
                onEdit({ ...selected, ...appearance });
                focusCanvas(e.currentTarget);
              }}
            >
              Apply appearance
            </button>
          )}
        </>
      )}
      <small>
        Measurements are estimates. Verify dimensions against the source
        drawing.
      </small>
    </section>
  );
}
