import type { Detector } from '../contracts.js';
import { duplicateBlockDetector } from './clones.js';
import { cssDesignDriftDetector, cssDuplicateSelectorDetector, cssNoImportantDetector } from './css.js';
import { unusedExportDetector, unusedTypeExportDetector } from './dead-exports.js';
import { unusedFileDetector } from './unused-file.js';
import { godFileDetector } from './god-file.js';
import { importCycleDetector, layerViolationDetector } from './arch.js';
import { dartHygieneDetector, pythonBareExceptDetector, rustNoUnwrapDetector } from './polyglot.js';
import { STRUCTURE_DETECTORS } from './structure.js';
import {
  magicTimerDetector,
  noDoubleCastDetector,
  noExplicitAnyDetector,
  noInlineI18nTernaryDetector,
  redundantCatchDetector,
} from './ts-ast.js';

export const BUILTIN_DETECTORS: Detector[] = [
  importCycleDetector,
  layerViolationDetector,
  ...STRUCTURE_DETECTORS,
  noExplicitAnyDetector,
  noDoubleCastDetector,
  noInlineI18nTernaryDetector,
  magicTimerDetector,
  redundantCatchDetector,
  cssNoImportantDetector,
  cssDuplicateSelectorDetector,
  cssDesignDriftDetector,
  godFileDetector,
  duplicateBlockDetector,
  unusedExportDetector,
  unusedTypeExportDetector,
  unusedFileDetector,
  rustNoUnwrapDetector,
  dartHygieneDetector,
  pythonBareExceptDetector,
];
