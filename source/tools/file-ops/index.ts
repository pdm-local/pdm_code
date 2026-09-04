import type {PdmCodeToolExport} from '@/types/core';
import {fileOpTool} from './file-op';

export function getFileOpTools(): PdmCodeToolExport[] {
	return [fileOpTool];
}
