import { useEffect, useState } from "react";
import BuddyChat from "./components/BuddyChat.tsx";
import CameraPreview from "./components/CameraPreview.tsx";
import LibraryWindow from "./components/LibraryWindow.tsx";
import ModelMonitor from "./components/ModelMonitor.tsx";
import Splash from "./components/Splash.tsx";
import { canRedo, canUndo, summarizeMonitor } from "./studio/studio-state.ts";
import { historyShortcut } from "./studio/shortcuts.ts";
import { useFavorites } from "./studio/use-favorites.ts";
import { useStudio } from "./studio/use-studio.ts";
import { useWearableJobs } from "./studio/use-wearable-jobs.ts";

function Taskbar() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <footer className="taskbar">
      <span className="taskbar__start">✦ LookStart</span>
      <span className="taskbar__task">LookCam</span>
      <span className="taskbar__task">LookArtist</span>
      <span className="taskbar__task">Favorites</span>
      <span className="taskbar__task">Monitor</span>
      <span className="taskbar__clock">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
    </footer>
  );
}

function Studio() {
  const { state, send, reset, undo, redo, wear } = useStudio();
  const library = useFavorites();
  const current = state.look;
  const jobs = useWearableJobs(state.look);
  const summary = summarizeMonitor(state.monitor);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = historyShortcut(event);
      if (shortcut !== null) {
        event.preventDefault();
        if (shortcut === "undo") {
          undo();
        } else {
          redo();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const succeeded = state.monitor.some((entry) => entry.ok);
  return (
    <div className="desktop">
      <h1 className="sr-only">Look Studio</h1>
      <main className="desktop__grid">
        <CameraPreview look={state.look} />
        <BuddyChat
          messages={state.messages}
          pending={state.pending}
          streaming={state.streaming}
          hasLook={state.look !== null}
          canUndo={canUndo(state)}
          canRedo={canRedo(state)}
          online={succeeded ? summary.live : null}
          jobs={jobs}
          onSend={send}
          onReset={reset}
          onUndo={undo}
          onRedo={redo}
          onSave={current === null ? null : () => library.save(current)}
        />
        <LibraryWindow
          favorites={library.favorites}
          status={library.status}
          notice={library.notice}
          canWear={!state.pending}
          onWear={wear}
          onRename={library.rename}
          onDuplicate={library.duplicate}
          onRemove={library.remove}
          onExport={library.exportJson}
          onImport={library.importJson}
        />
        <ModelMonitor entries={state.monitor} />
      </main>
      <Taskbar />
    </div>
  );
}

export default function App() {
  const [entered, setEntered] = useState(false);
  return entered ? <Studio /> : <Splash onEnter={() => setEntered(true)} />;
}
