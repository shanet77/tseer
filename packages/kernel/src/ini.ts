export interface IniValue {
  value: string;
  line: number;
}

export interface IniSection {
  name: string;
  line: number;
  values: Map<string, IniValue>;
}

export interface IniWarning {
  line: number;
  message: string;
}

export interface IniDocument {
  sections: Map<string, IniSection>;
  warnings: IniWarning[];
}

function findSeparator(line: string): number {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === "\\") i++;
      else if (ch === '"') inQuotes = false;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === "=" || ch === ":") {
      return i;
    }
  }
  return -1;
}

function stripInlineComment(fragment: string): string {
  let inQuotes = false;
  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i];
    if (inQuotes) {
      if (ch === "\\") i++;
      else if (ch === '"') inQuotes = false;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if ((ch === "#" || ch === ";") && (i === 0 || /\s/.test(fragment[i - 1] ?? ""))) {
      return fragment.slice(0, i);
    }
  }
  return fragment;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(\\|"|n|t|r)/g, (_match, code: string) => {
      if (code === "n") return "\n";
      if (code === "t") return "\t";
      if (code === "r") return "\r";
      return code;
    });
  }
  return value;
}

export function parseIni(text: string): IniDocument {
  const sections = new Map<string, IniSection>();
  const warnings: IniWarning[] = [];
  let current: IniSection | undefined;

  const lines = text.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = idx + 1;
    const trimmed = (lines[idx] ?? "").trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;

    if (trimmed.startsWith("[")) {
      const match = /^\[([^\]]+)\]\s*$/.exec(trimmed);
      if (!match?.[1]) {
        warnings.push({ line, message: `ignoring malformed section header: ${trimmed}` });
        continue;
      }
      const name = match[1].trim();
      current = sections.get(name);
      if (!current) {
        current = { name, line, values: new Map() };
        sections.set(name, current);
      }
      continue;
    }

    if (!current) {
      warnings.push({ line, message: `key/value outside any section, ignoring: ${trimmed}` });
      continue;
    }

    const sep = findSeparator(trimmed);
    if (sep < 0) {
      warnings.push({ line, message: `ignoring line without a key/value separator: ${trimmed}` });
      continue;
    }
    const key = trimmed.slice(0, sep).trim();
    if (key === "") {
      warnings.push({ line, message: `ignoring entry with an empty key: ${trimmed}` });
      continue;
    }
    const value = unquote(stripInlineComment(trimmed.slice(sep + 1)).trim());
    const prev = current.values.get(key);
    if (prev) {
      warnings.push({
        line,
        message:
          `duplicate key "${key}" in [${current.name}] (first defined on line ${prev.line}), ` +
          `using the latest value`,
      });
    }
    current.values.set(key, { value, line });
  }

  return { sections, warnings };
}
