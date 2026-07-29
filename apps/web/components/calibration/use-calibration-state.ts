/**
 * @deprecated Use CalibrationProvider + hooks from `./calibration-context`.
 * Kept as a thin re-export for any lingering imports.
 */
export {
  useCalibration as useCalibrationState,
  type CalibrationState,
} from "./calibration-context";
