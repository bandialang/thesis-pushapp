import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

function ensureStateDirectoryExists(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createEmptyState() {
  return {
    sentHistory: []
  };
}

export function loadState() {
  ensureStateDirectoryExists(config.stateFilePath);

  if (!fs.existsSync(config.stateFilePath)) {
    return createEmptyState();
  }

  try {
    const raw = fs.readFileSync(config.stateFilePath, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.sentHistory)) {
      return createEmptyState();
    }

    return parsed;
  } catch {
    return createEmptyState();
  }
}

export function saveState(state) {
  ensureStateDirectoryExists(config.stateFilePath);
  fs.writeFileSync(config.stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function recordSentSelection({ dateKey, papers }) {
  const state = loadState();
  const remaining = state.sentHistory.filter((entry) => entry.dateKey !== dateKey);

  remaining.push({
    dateKey,
    paperIds: papers.map((paper) => paper.id)
  });

  remaining.sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  saveState({ sentHistory: remaining });
}
