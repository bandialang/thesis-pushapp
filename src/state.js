import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

function ensureStateDirectoryExists(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createEmptyState() {
  return {
    sentHistory: [],
    sentRuns: []
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

    return {
      sentHistory: parsed.sentHistory,
      sentRuns: Array.isArray(parsed.sentRuns) ? parsed.sentRuns : []
    };
  } catch {
    return createEmptyState();
  }
}

export function saveState(state) {
  ensureStateDirectoryExists(config.stateFilePath);
  fs.writeFileSync(config.stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function pruneSentRuns(sentRuns) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return sentRuns.filter((entry) => {
    const sentAt = new Date(entry.sentAt || 0).getTime();
    return Number.isFinite(sentAt) && sentAt >= cutoff;
  });
}

export function recordSentSelection({ dateKey, papers, slotKey = null, sentAt = new Date().toISOString() }) {
  const state = loadState();
  const remaining = state.sentHistory.filter((entry) => entry.dateKey !== dateKey);

  remaining.push({
    dateKey,
    paperIds: papers.map((paper) => paper.id)
  });

  remaining.sort((left, right) => left.dateKey.localeCompare(right.dateKey));

  const sentRuns = pruneSentRuns(state.sentRuns).filter((entry) => entry.slotKey !== slotKey);
  if (slotKey) {
    sentRuns.push({
      slotKey,
      dateKey,
      sentAt
    });
  }

  saveState({ sentHistory: remaining, sentRuns });
}
