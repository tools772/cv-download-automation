import { setJobProgress } from "../supabase/jobs.js";

/** Map download-script log lines to short portal progress text + optional live counts. */
export function progressFromDownloadLine(line: string): {
  message: string;
  counts?: Partial<{
    discovered: number;
    downloaded: number;
    uploaded: number;
    skipped: number;
    failed: number;
  }>;
  /** When true, counts are +1 deltas to accumulate (not absolute totals). */
  countsAreDeltas?: boolean;
} | null {
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

  if (/=== Naukri login ===|Sign in in the Chrome window/i.test(line)) {
    return { message: "Waiting for Naukri login in Chrome…" };
  }
  if (/Naukri login detected|Subuser conflict resolved/i.test(line)) {
    return { message: "Naukri session ready — opening search…" };
  }
  if (/Active in 30 days|Hide Profiles|applying filters|filters confirmed|refusing to index/i.test(line)) {
    return { message: line.replace(/^Naukri:\s*/i, "").replace(/^Naukri filter:\s*/i, "").slice(0, 180) };
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
    // Emit delta:1 — createProgressReporter accumulates totals. Never use rank
    // as a count (that made Success jump to 3 when only profile #3 uploaded).
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

/** Throttled progress reporter for a fetch job. */
export function createProgressReporter(jobId: string): (line: string) => void {
  let lastMessage = "";
  let lastAt = 0;
  let chain: Promise<void> = Promise.resolve();
  const totals = {
    discovered: 0,
    downloaded: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
  };

  return (line: string) => {
    const parsed = progressFromDownloadLine(line);
    if (!parsed) return;

    const now = Date.now();
    if (parsed.message === lastMessage && now - lastAt < 800) return;
    lastMessage = parsed.message;
    lastAt = now;

    let counts = parsed.counts;
    if (counts && parsed.countsAreDeltas) {
      if (counts.discovered != null) totals.discovered += counts.discovered;
      if (counts.downloaded != null) totals.downloaded += counts.downloaded;
      if (counts.uploaded != null) totals.uploaded += counts.uploaded;
      if (counts.skipped != null) totals.skipped += counts.skipped;
      if (counts.failed != null) totals.failed += counts.failed;
      counts = { ...totals };
    } else if (counts) {
      if (counts.discovered != null) totals.discovered = counts.discovered;
      if (counts.downloaded != null) totals.downloaded = counts.downloaded;
      if (counts.uploaded != null) totals.uploaded = counts.uploaded;
      if (counts.skipped != null) totals.skipped = counts.skipped;
      if (counts.failed != null) totals.failed = counts.failed;
    }

    chain = chain
      .then(() => setJobProgress(jobId, parsed.message, counts))
      .catch(() => undefined);
  };
}
