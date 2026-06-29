
import { openInFormstrPages } from "../../utils/docsIntegrationHelpers";

interface TextPreviewProps {
  textContent: string;
  pagesHint: string | null;
  setPagesHint: (hint: string) => void;
}

export function TextPreview({ textContent, pagesHint, setPagesHint }: TextPreviewProps) {
  const MAX_CHARS = 3000;
  const isTruncated = textContent.length > MAX_CHARS;
  const displayText = isTruncated ? textContent.slice(0, MAX_CHARS) + "\n\n... [Content truncated for preview. Download file to view full content.]" : textContent;

  const handleOpenInPages = async () => {
    await openInFormstrPages(textContent, setPagesHint);
  };

  return (
    <div className="preview-text-wrap">
      <div className="preview-doc-actions">
        <button className="preview-doc-btn" onClick={handleOpenInPages}>
          Open in Formstr Pages
        </button>
        {pagesHint && <span className="preview-doc-hint">{pagesHint}</span>}
      </div>
      <pre className="preview-text-content">{displayText}</pre>
    </div>
  );
}
