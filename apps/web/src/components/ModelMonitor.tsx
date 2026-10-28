import { OFFLINE_MODEL, summarizeMonitor } from "../studio/studio-state.ts";
import type { MonitorEntry } from "../studio/studio-state.ts";
import Window from "./Window.tsx";

const PIPELINE = [
  { model: "Muse Spark", job: "Designs the look from your words or photo", state: "active" },
  { model: "Muse Spark", job: "Turns edits like \"move it higher\" into commands", state: "active" },
  { model: "Muse Image", job: "Concept art for each look", state: "soon" },
  { model: "SAM", job: "Segmentation for makeup masks", state: "soon" },
] as const;

export default function ModelMonitor({ entries }: { entries: MonitorEntry[] }) {
  const summary = summarizeMonitor(entries);
  const offline = summary.calls > 0 && !summary.live && summary.failures < summary.calls;
  return (
    <Window
      id="monitor"
      title="Meta Model Monitor"
      icon="▣"
      flavor="grape"
      className="win--monitor"
      status={
        <span className="monitor__totals">
          <span>calls: {summary.calls}</span>
          <span>errors: {summary.failures}</span>
          <span>avg: {summary.avgLatencyMs} ms</span>
          <span>tokens: {summary.totalTokens}</span>
        </span>
      }
    >
      <div className="monitor">
        <ul className="pipeline" aria-label="Meta models in Look Studio">
          {PIPELINE.map((step) => (
            <li key={step.job} className={`pipeline__step pipeline__step--${step.state}`}>
              <span className="led" aria-hidden="true" />
              <strong>{step.model}</strong> {step.job}
              {step.state === "soon" && <span className="tag">coming soon</span>}
            </li>
          ))}
        </ul>
        {offline && (
          <p className="monitor__warn" role="status">
            Offline demo: the server has no Meta API key configured, so replies are canned.
          </p>
        )}
        <div className="monitor__table-wrap" tabIndex={0} aria-label="Model call log">
          <table className="monitor__table">
            <thead>
              <tr>
                <th scope="col">time</th>
                <th scope="col">call</th>
                <th scope="col">model</th>
                <th scope="col">ms</th>
                <th scope="col">tokens</th>
                <th scope="col">request id</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="monitor__empty">
                    C:\&gt; waiting for the first call to Meta... _
                  </td>
                </tr>
              )}
              {entries.map((entry) => (
                <tr key={entry.id} className={entry.ok ? undefined : "is-error"}>
                  <td>{entry.at}</td>
                  <td>/api/{entry.call}</td>
                  <td>{entry.ok ? (entry.model === OFFLINE_MODEL ? "offline demo" : entry.model) : `error: ${entry.error ?? "unknown"}`}</td>
                  <td>{entry.ok ? entry.latencyMs : "—"}</td>
                  <td>{entry.ok ? entry.tokens : "—"}</td>
                  <td className="monitor__rid">{entry.requestId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Window>
  );
}
