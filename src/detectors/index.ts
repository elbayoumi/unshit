import type { Detector } from '../contracts.js';
import { duplicateBlockDetector } from './clones.js';
import { cssDuplicateSelectorDetector, cssNoImportantDetector } from './css.js';
import { unusedExportDetector } from './dead-exports.js';
import { godFileDetector } from './god-file.js';
import { dartHygieneDetector, pythonBareExceptDetector, rustNoUnwrapDetector } from './polyglot.js';
import {
  magicTimerDetector,
  noDoubleCastDetector,
  noExplicitAnyDetector,
  noInlineI18nTernaryDetector,
  redundantCatchDetector,
} from './ts-ast.js';

export const BUILTIN_DETECTORS: Detector[] = [
  noExplicitAnyDetector,
  noDoubleCastDetector,
  noInlineI18nTernaryDetector,
  magicTimerDetector,
  redundantCatchDetector,
  cssNoImportantDetector,
  cssDuplicateSelectorDetector,
  godFileDetector,
  duplicateBlockDetector,
  unusedExportDetector,
  rustNoUnwrapDetector,
  dartHygieneDetector,
  pythonBareExceptDetector,
];
