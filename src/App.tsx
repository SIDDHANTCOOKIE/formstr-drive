import { FileUpload } from "./components/FileUpload";
import { FileDownload } from "./components/FileDownload";
import { ServerSelector } from "./components/ServerSelector";
import { BlossomServerProvider } from "./contexts/BlossomServerContext";
import "./App.css";

function App() {
  return (
    <BlossomServerProvider>
      <div className="App">
        <header>
          <h1>Formstr Drive (Browser + NIP-44)</h1>
          <p>Upload and download encrypted files using your Nostr signer</p>
        </header>

        <main>
          <section>
            <ServerSelector />
          </section>

          <section>
            <h2>Upload File</h2>
            <FileUpload />
          </section>

          <hr />

          <section>
            <h2>Download File</h2>
            <FileDownload />
          </section>
        </main>

        <footer>
          <p>
            Built with React, Vite, and <code>window.nostr</code>
          </p>
        </footer>
      </div>
    </BlossomServerProvider>
  );
}

export default App;
