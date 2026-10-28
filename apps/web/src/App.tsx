import { useEffect, useState } from "react";
import BuddyChat from "./components/BuddyChat.tsx";
import CameraPreview from "./components/CameraPreview.tsx";
import ModelMonitor from "./components/ModelMonitor.tsx";
import Splash from "./components/Splash.tsx";
import { summarizeMonitor } from "./studio/studio-state.ts";
import { useStudio } from "./studio/use-studio.ts";

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
      <span className="taskbar__task">Monitor</span>
      <span className="taskbar__clock">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
    </footer>
  );
}

function Studio() {
  const { state, send, reset } = useStudio();
  const summary = summarizeMonitor(state.monitor);
  const succeeded = state.monitor.some((entry) => entry.ok);
  return (
    <div className="desktop">
      <h1 className="sr-only">Look Studio</h1>
      <main className="desktop__grid">
        <CameraPreview look={state.look} />
        <BuddyChat
          messages={state.messages}
          pending={state.pending}
          hasLook={state.look !== null}
          online={succeeded ? summary.live : null}
          onSend={send}
          onReset={reset}
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
