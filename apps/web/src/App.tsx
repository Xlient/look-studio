import CameraPreview from "./components/CameraPreview.tsx";
import PlaceholderPanel from "./components/PlaceholderPanel.tsx";

export default function App() {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Look Studio</h1>
        <p>
          Scaffold preview: camera on the left, look panel on the right. Tracking is not
          implemented yet.
        </p>
      </header>
      <main className="layout">
        <CameraPreview />
        <PlaceholderPanel />
      </main>
    </div>
  );
}
