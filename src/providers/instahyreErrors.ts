/** Parse Instahyre download script stdout for a portal-friendly error_message. */
export function extractInstahyreFailureSummary(output: string): string {
  const plain = output.replace(/\u001b\[[0-9;]*m/g, "");

  const explicit = plain
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("INSTAHYRE ERROR:") || l.startsWith("INSTAHYRE FAILED:"));
  if (explicit.length > 0) {
    return explicit[explicit.length - 1]!.replace(/^INSTAHYRE (ERROR|FAILED):\s*/, "").slice(0, 500);
  }

  const pageFail = plain.match(/\[page \d+\] status=failed \| (.+)/);
  if (pageFail?.[1]) {
    return pageFail[1].trim().slice(0, 500);
  }

  if (/target page, context or browser has been closed|browser tab closed|browser process disconnected/i.test(plain)) {
    return (
      "The Instahyre automation browser was closed before the download finished. " +
      "Leave the Chromium window open until Caliber shows Complete."
    );
  }

  if (/Candidate list did not load within/i.test(plain)) {
    const urlMatch = plain.match(/\(https:\/\/www\.instahyre\.com[^\s)]+\)/);
    const url = urlMatch?.[0]?.slice(1, -1) ?? "your candidates URL";
    return (
      `Instahyre candidate list did not load at ${url}. ` +
      "Use the exact URL from Upload Resumes (…/employer/candidates/JOB_ID/0/). " +
      "Cancel old queued jobs if an outdated URL keeps opening."
    );
  }

  if (/Missing INSTAHYRE_CANDIDATES_URL|Missing Instahyre candidates URL/i.test(plain)) {
    return "Missing Instahyre URL on the fetch job. Paste the candidates URL in Upload Resumes and start a new fetch.";
  }

  const failedLine = plain
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("Instahyre download failed:"));
  if (failedLine) {
    return failedLine.replace(/^Instahyre download failed:\s*/, "").slice(0, 500);
  }

  return "Instahyre download failed. See Fetch Agent terminal for details.";
}
