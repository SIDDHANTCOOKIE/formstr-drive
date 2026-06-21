

interface PdfPreviewProps {
  blobUrl: string;
  name: string;
}

export function PdfPreview({ blobUrl, name }: PdfPreviewProps) {
  return <iframe src={blobUrl} className="preview-media-pdf" title={`PDF preview: ${name}`} />;
}
