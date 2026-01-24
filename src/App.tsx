import { FileUpload } from "./components/FileUpload";
import { FileDownload } from "./components/FileDownload";
import "./App.css";

function App() {
  return (
    <div className="App">
      <header>
        <h1>Formstr Drive (Browser + NIP-44)</h1>
        <p>Upload and download encrypted files using your Nostr signer</p>
      </header>

      <main>
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
  );
}

export default App;
