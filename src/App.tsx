import { BlossomServerProvider } from "./contexts/BlossomServerContext";
import { FileIndexProvider, useFileIndex } from "./contexts/FileIndexContext";
import { Header } from "./components/Header";
import { FolderSidebar } from "./components/FolderSidebar";
import { FileList } from "./components/FileList";
import { SignIn } from "./components/SignIn";
import "./App.css";

function DriveLayout() {
  const { isSignedIn } = useFileIndex();

  if (!isSignedIn) {
    return <SignIn />;
  }

  return (
    <div className="drive-layout">
      <Header />
      <div className="drive-content">
        <FolderSidebar />
        <main className="drive-main">
          <FileList />
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BlossomServerProvider>
      <FileIndexProvider>
        <DriveLayout />
      </FileIndexProvider>
    </BlossomServerProvider>
  );
}

export default App;
