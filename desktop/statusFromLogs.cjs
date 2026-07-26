/**
 * Parse agent / download stdout into structured UI status.
 * Mirrors src/providers/progressFromLogs.ts for desktop display.
 */

function emptyCounts() {
  return { discovered: 0, downloaded: 0, uploaded: 0, skipped: 0, failed: 0 };
}

function progressFromDownloadLine(line) {
  if (/Opening Instahyre candidates URL|Opening Instahyre in Chromium/i.test(line)) {
    return { message: "Opening Instahyre candidates page…" };
  }
  if (/Instahyre filter applied/i.test(line)) {
    const match = line.match(/(\d+)\s*→\s*(\d+)\s*results/i);
    if (match) {
      return {
        message: `Filter applied: Hide viewed by me (${match[1]} → ${match[2]} results)`,
        counts: { discovered: Number(match[2]) },
      };
    }
    return { message: "Applying Instahyre filter: Hide viewed by me…" };
  }
  if (/Hide viewed by me|filter panel|could not apply filters|filter step failed/i.test(line)) {
    return { message: line.replace(/^INSTAHYRE WARNING:\s*/i, "").slice(0, 200) };
  }
  if (/\[page (\d+)\] downloading batch/i.test(line)) {
    const m = line.match(/\[page (\d+)\] downloading batch \(target (\d+), have (\d+)/i);
    if (m) {
      return {
        message: `Downloading page ${m[1]} — ${m[3]}/${m[2]} CVs so far`,
        counts: { downloaded: Number(m[3]) },
      };
    }
    return { message: "Downloading candidate resumes…" };
  }
  if (/Selected individual candidates|Selected candidates for partial/i.test(line)) {
    const m = line.match(/selected[=:\s]+(\d+)/i) || line.match(/"selected":\s*(\d+)/i);
    return {
      message: m ? `Selected ${m[1]} candidate(s) for download` : "Selecting candidates…",
    };
  }
  if (/status=downloaded\s*\|\s*count=(\d+)/i.test(line)) {
    const m = line.match(/status=downloaded\s*\|\s*count=(\d+)/i);
    return {
      message: `Page downloaded (${m?.[1] ?? "?"} resume(s) in zip)`,
      counts: m ? { downloaded: Number(m[1]) } : undefined,
    };
  }
  if (/extracted (\d+) resumes/i.test(line)) {
    const m = line.match(/extracted (\d+) resumes/i);
    return { message: `Extracted ${m?.[1]} resume file(s) from zip` };
  }
  if (/Uploading \d+ resume/i.test(line)) {
    return { message: "Uploading resumes to Google Drive…" };
  }
  if (/Drive upload complete\s*\|\s*uploaded=(\d+)/i.test(line)) {
    const m = line.match(/uploaded=(\d+)/i);
    return {
      message: `Drive upload complete (${m?.[1]} file(s))`,
      counts: m ? { uploaded: Number(m[1]) } : undefined,
    };
  }

  if (/=== Naukri login ===|Sign in in the Chrome window|=== Naukri manual login ===/i.test(line)) {
    return { message: "Waiting for Naukri login in Chrome…", phase: "login" };
  }
  if (/Naukri login detected|Subuser conflict resolved/i.test(line)) {
    return { message: "Naukri session ready — opening search…" };
  }
  if (/Active in 30 days|Hide Profiles|applying filters|filters confirmed|refusing to index/i.test(line)) {
    return {
      message: line.replace(/^Naukri:\s*/i, "").replace(/^Naukri filter:\s*/i, "").slice(0, 180),
    };
  }
  if (/waiting for filtered search results/i.test(line)) {
    return { message: "Waiting for filtered Naukri results…" };
  }
  if (/filters ready — indexing|indexing filtered result page|Indexing search page/i.test(line)) {
    return { message: "Filters ready — indexing Naukri results…" };
  }
  if (/Scanning page for profile links/i.test(line)) {
    return { message: "Indexing Naukri results for profiles…" };
  }
  if (/totalDiscovered[=:\s]+(\d+)/i.test(line)) {
    const m = line.match(/totalDiscovered[=:\s]+(\d+)/i);
    const n = Number(m?.[1] ?? 0);
    return {
      message: `Found ${n} candidate profile(s)`,
      counts: { discovered: n },
    };
  }
  if (/Opening candidate profile/i.test(line)) {
    const m = line.match(/"rank":\s*(\d+)/i) || line.match(/rank[=:\s]+(\d+)/i);
    return {
      message: m ? `Opening profile #${m[1]}…` : "Opening candidate profile…",
    };
  }
  if (/\[rank (\d+)\].*status=(\w+)/i.test(line)) {
    const m = line.match(/\[rank (\d+)\]\s*(.*?)\s*status=(\w+)/i);
    if (!m) return null;
    const rank = m[1];
    const name = m[2]?.trim() || "candidate";
    const status = m[3].toLowerCase();
    if (status === "uploaded") {
      return {
        message: `Uploaded #${rank}: ${name}`,
        counts: { uploaded: 1, downloaded: 1 },
        countsAreDeltas: true,
      };
    }
    if (status === "clicked") {
      return {
        message: `Saved #${rank}: ${name}`,
        counts: { downloaded: 1 },
        countsAreDeltas: true,
      };
    }
    if (status === "skipped") {
      return {
        message: `Skipped #${rank}: ${name}`,
        counts: { skipped: 1 },
        countsAreDeltas: true,
      };
    }
    if (status === "failed") {
      return {
        message: `Failed #${rank}: ${name}`,
        counts: { failed: 1 },
        countsAreDeltas: true,
      };
    }
    return { message: `Processing #${rank}: ${name}` };
  }
  if (/Starting downloads from rank/i.test(line)) {
    return { message: "Downloading resumes from Naukri…" };
  }

  return null;
}

function parseAgentLine(line) {
  if (/Perfect Ventures Fetch Agent/i.test(line) && /Version/i.test(line) === false) {
    return { phase: "starting", message: "Starting agent…" };
  }
  if (/Polling every/i.test(line)) {
    return { phase: "ready", message: "Ready — waiting for Fetch jobs from Caliber" };
  }
  if (/Portal user:/i.test(line)) {
    const m = line.match(/Portal user:\s*(.+)/i);
    return { message: m ? `Signed in as ${m[1].trim()}` : "Portal email loaded", soft: true };
  }
  if (/Reconnect Instahyre/i.test(line)) {
    return { phase: "login", provider: "Instahyre", message: "Reconnect Instahyre — sign in in Chrome…" };
  }
  if (/Instahyre fetch job|Instahyre job/i.test(line)) {
    const m = line.match(/job\s+([0-9a-f-]{8,})/i);
    return {
      phase: "working",
      provider: "Instahyre",
      jobId: m?.[1] || null,
      message: "Starting Instahyre download…",
      resetCounts: true,
    };
  }
  if (/Naukri.*job|job .*Naukri/i.test(line) || /\[agent\] Naukri/i.test(line)) {
    const m = line.match(/job\s+([0-9a-f-]{8,})/i);
    return {
      phase: "working",
      provider: "Naukri",
      jobId: m?.[1] || null,
      message: "Starting Naukri download…",
      resetCounts: true,
    };
  }
  if (/\[agent\] (Instahyre|Naukri) job ([0-9a-f-]{8,})/i.test(line)) {
    const m = line.match(/\[agent\] (Instahyre|Naukri) job ([0-9a-f-]{8,})/i);
    return {
      phase: "working",
      provider: m[1],
      jobId: m[2],
      message: `Working on ${m[1]} job…`,
      resetCounts: true,
    };
  }
  if (/Needs Login|sign in|login required|Instahyre login|Opening Instahyre login/i.test(line)) {
    return { phase: "login", message: "Login required — use the login buttons or Chrome window" };
  }
  if (/Download complete|ready for ranking|Creating candidates/i.test(line)) {
    const uploaded = line.match(/uploaded=(\d+)/i);
    return {
      phase: "ready",
      message: uploaded
        ? `Job finished — ${uploaded[1]} CV(s) ready for ranking in Caliber`
        : "Job finished — CVs ready for ranking in Caliber",
    };
  }
  if (/Job .* cancelled|Cancelled — automation/i.test(line)) {
    return { phase: "ready", message: "Job cancelled" };
  }
  if (/Could not launch a browser|Install Google Chrome|executable doesn.?t exist/i.test(line)) {
    return {
      phase: "error",
      message: "Google Chrome is required — install Chrome, then try again.",
    };
  }
  if (/\[agent\] Fatal:|exited with code/i.test(line)) {
    return { phase: "error", message: line.replace(/^\[agent\]\s*/i, "").slice(0, 180) };
  }
  if (/\[agent\] (Instahyre|Naukri) job failed/i.test(line)) {
    return { phase: "error", message: line.replace(/^\[agent\]\s*/i, "").slice(0, 180) };
  }
  if (/Shutting down/i.test(line)) {
    return { phase: "stopped", message: "Agent stopped" };
  }
  if (/=== Instahyre|Sign in to Instahyre/i.test(line)) {
    return { phase: "login", provider: "Instahyre", message: "Waiting for Instahyre login in Chrome…" };
  }
  if (/Instahyre login (finished|saved|complete|detected)/i.test(line)) {
    return { phase: "ready", message: "Instahyre login saved" };
  }
  if (/Naukri login (finished|saved|complete)/i.test(line)) {
    return { phase: "ready", message: "Naukri login saved" };
  }
  return null;
}

function createStatusTracker() {
  let lineBuf = "";
  const state = {
    phase: "stopped",
    message: "Agent is stopped. Enter your email and press Start.",
    provider: null,
    jobId: null,
    counts: emptyCounts(),
    activities: [],
  };

  function snapshot() {
    return {
      phase: state.phase,
      message: state.message,
      provider: state.provider,
      jobId: state.jobId,
      counts: { ...state.counts },
      activities: state.activities.slice(0, 20),
    };
  }

  function pushActivity(text, kind) {
    if (!text) return;
    const last = state.activities[0];
    if (last && last.text === text) return;
    state.activities.unshift({
      at: new Date().toISOString(),
      text: text.slice(0, 220),
      kind: kind || "info",
    });
    if (state.activities.length > 40) state.activities.length = 40;
  }

  function applyCounts(parsed) {
    if (!parsed.counts) return;
    if (parsed.countsAreDeltas) {
      for (const key of Object.keys(parsed.counts)) {
        state.counts[key] = (state.counts[key] || 0) + (parsed.counts[key] || 0);
      }
    } else {
      for (const key of Object.keys(parsed.counts)) {
        if (parsed.counts[key] != null) state.counts[key] = parsed.counts[key];
      }
    }
  }

  function applyParsed(parsed) {
    if (!parsed) return false;
    if (parsed.resetCounts) state.counts = emptyCounts();
    if (parsed.provider) state.provider = parsed.provider;
    if (parsed.jobId) state.jobId = parsed.jobId;
    if (parsed.phase) state.phase = parsed.phase;
    if (parsed.message) {
      state.message = parsed.message;
      if (!parsed.soft) {
        const kind =
          parsed.phase === "error"
            ? "error"
            : parsed.phase === "login"
              ? "login"
              : parsed.phase === "working"
                ? "work"
                : "info";
        pushActivity(parsed.message, kind);
      }
    }
    applyCounts(parsed);
    return true;
  }

  function handleLine(raw) {
    const line = raw.trim();
    if (!line) return false;
    let changed = applyParsed(parseAgentLine(line));
    changed = applyParsed(progressFromDownloadLine(line)) || changed;
    return changed;
  }

  return {
    reset(message) {
      state.phase = "stopped";
      state.message = message || "Agent is stopped. Enter your email and press Start.";
      state.provider = null;
      state.jobId = null;
      state.counts = emptyCounts();
      state.activities = [];
      lineBuf = "";
      return snapshot();
    },
    setPhase(phase, message) {
      state.phase = phase;
      if (message) {
        state.message = message;
        pushActivity(message, phase === "error" ? "error" : phase === "login" ? "login" : "info");
      }
      return snapshot();
    },
    ingest(chunk) {
      lineBuf += chunk.toString();
      const parts = lineBuf.split(/\r?\n/);
      lineBuf = parts.pop() || "";
      let changed = false;
      for (const part of parts) {
        if (handleLine(part)) changed = true;
      }
      return changed ? snapshot() : null;
    },
    getState: snapshot,
  };
}

module.exports = { createStatusTracker, progressFromDownloadLine };
