import {agentTool} from '@/tools/agent-tool';
import {analyzeImageTool} from '@/tools/analyze-image';
import {askQuestionTool} from '@/tools/ask-question';
import {executeBashTool} from '@/tools/execute-bash';
import {fetchUrlTool} from '@/tools/fetch-url';
import {getFileOpTools} from '@/tools/file-ops';
import {diffEditTool} from '@/tools/file-ops/diff-edit';
import {stringReplaceTool} from '@/tools/file-ops/string-replace';
import {writeFileTool} from '@/tools/file-ops/write-file';
import {findFilesTool} from '@/tools/find-files';
import {getGitTools} from '@/tools/git';
import {listDirectoryTool} from '@/tools/list-directory';
import {getDiagnosticsTool} from '@/tools/lsp-get-diagnostics';
import {readFileTool} from '@/tools/read-file';
import {searchDocumentTool} from '@/tools/search-document';
import {searchFileContentsTool} from '@/tools/search-file-contents';
import {checkSkillTool} from '@/tools/skill-check';
import {writeTasksTool} from '@/tools/tasks';
import {webSearchTool} from '@/tools/web-search';
import {writePlanTool} from '@/tools/write-plan';
import {writeWalkthroughTool} from '@/tools/write-walkthrough';
import type {PdmCodeToolExport} from '@/types/index';

// Static tools (always available)
const staticTools: PdmCodeToolExport[] = [
	readFileTool,
	writeFileTool,
	stringReplaceTool,
	diffEditTool,
	executeBashTool,
	webSearchTool,
	fetchUrlTool,
	findFilesTool,
	searchFileContentsTool,
	searchDocumentTool,
	getDiagnosticsTool,
	listDirectoryTool,
	agentTool,
	analyzeImageTool,
	// Interaction tools
	askQuestionTool,
	// File operation tools
	...getFileOpTools(),
	// Task management tool
	writeTasksTool,
	// Plan mode artifact tool
	writePlanTool,
	// Completion artifact tool
	writeWalkthroughTool,
	// Skill authoring linter
	checkSkillTool,
];

/**
 * All built-in tool exports, the single source of truth for static tools.
 *
 * A function, not a top-level array: the conditional git tools are gated on
 * system capability probes, and as a `const` those probes ran at
 * module-evaluation time. That meant merely *importing* this module spawned
 * subprocesses, on the interactive path, on `--plain`, and on `--acp` alike.
 * Computed on first call instead, then cached, so the cost lands once and
 * only in processes that actually build a tool registry.
 */
let cachedToolExports: PdmCodeToolExport[] | null = null;

export function getAllToolExports(): PdmCodeToolExport[] {
	// Git tools are only registered if git is installed and we're in a repo;
	// the PR tool additionally requires the gh CLI.
	cachedToolExports ??= [...staticTools, ...getGitTools()];
	return cachedToolExports;
}
