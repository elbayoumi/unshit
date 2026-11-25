interface NormalizedHookEdit {
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

export interface NormalizedHookPayload {
  filePath?: string;
  targetPath?: string;
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
  edits?: NormalizedHookEdit[];
  content?: string;
  cwd?: string;
  rootDir?: string;
  sessionId?: string;
  toolName?: string;
  file_path?: string;
  target_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  session_id?: string;
  tool_name?: string;
  path?: string;
  file?: string;
}

function pickString(objs: Array<Record<string, unknown> | null | undefined>, keys: string[]): string | undefined {
  for (const obj of objs) {
    if (!obj) continue;
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string') return value;
    }
  }
  return undefined;
}

function pickBool(objs: Array<Record<string, unknown> | null | undefined>, keys: string[]): boolean | undefined {
  for (const obj of objs) {
    if (!obj) continue;
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'boolean') return value;
    }
  }
  return undefined;
}

function normalizeEdit(raw: unknown): NormalizedHookEdit {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const oldString = pickString([r], ['old_string', 'oldString', 'old']);
  const newString = pickString([r], ['new_string', 'newString', 'new']);
  const replaceAll = pickBool([r], ['replace_all', 'replaceAll', 'replaceAllOccurrences']);
  const edit: NormalizedHookEdit = {};
  if (oldString !== undefined) {
    edit.oldString = oldString;
    edit.old_string = oldString;
  }
  if (newString !== undefined) {
    edit.newString = newString;
    edit.new_string = newString;
  }
  if (replaceAll !== undefined) {
    edit.replaceAll = replaceAll;
    edit.replace_all = replaceAll;
  }
  return edit;
}

export function normalizePayload(raw: unknown): NormalizedHookPayload {
  let base: unknown = raw;
  if (typeof raw === 'string') {
    try {
      base = JSON.parse(raw);
    } catch {
      base = {};
    }
  }
  const root = base && typeof base === 'object' ? (base as Record<string, unknown>) : {};
  const toolInput =
    root.tool_input && typeof root.tool_input === 'object'
      ? (root.tool_input as Record<string, unknown>)
      : root.toolInput && typeof root.toolInput === 'object'
        ? (root.toolInput as Record<string, unknown>)
        : root;

  const objs = [toolInput, root];

  const filePath = pickString(objs, ['file_path', 'filePath', 'path', 'file', 'targetPath', 'target_path']);
  const oldString = pickString(objs, ['old_string', 'oldString', 'old']);
  const newString = pickString(objs, ['new_string', 'newString', 'new']);
  const replaceAll = pickBool(objs, ['replace_all', 'replaceAll', 'replaceAllOccurrences']);
  const content = pickString(objs, ['content', 'newContent', 'new_content']);
  const cwd = pickString(objs, ['cwd', 'rootDir', 'root_dir', 'workingDirectory', 'working_directory']);
  const sessionId = pickString(objs, ['session_id', 'sessionId']);
  const toolName = pickString(objs, ['tool_name', 'toolName', 'tool']);

  const rawEdits = toolInput.edits ?? root.edits;
  const edits = Array.isArray(rawEdits) ? rawEdits.map(normalizeEdit) : undefined;

  const result: NormalizedHookPayload = {};
  if (filePath !== undefined) {
    result.filePath = filePath;
    result.file_path = filePath;
    result.path = filePath;
    result.targetPath = filePath;
    result.target_path = filePath;
    result.file = filePath;
  }
  if (oldString !== undefined) {
    result.oldString = oldString;
    result.old_string = oldString;
  }
  if (newString !== undefined) {
    result.newString = newString;
    result.new_string = newString;
  }
  if (replaceAll !== undefined) {
    result.replaceAll = replaceAll;
    result.replace_all = replaceAll;
  }
  if (edits !== undefined) {
    result.edits = edits;
  }
  if (content !== undefined) {
    result.content = content;
  }
  if (cwd !== undefined) {
    result.cwd = cwd;
    result.rootDir = cwd;
  }
  if (sessionId !== undefined) {
    result.sessionId = sessionId;
    result.session_id = sessionId;
  }
  if (toolName !== undefined) {
    result.toolName = toolName;
    result.tool_name = toolName;
  }
  return result;
}
