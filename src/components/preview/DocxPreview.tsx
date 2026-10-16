/**
 * src/components/preview/DocxPreview.tsx
 * In-app document viewer for Microsoft Word .docx files.
 * Provides a clean reading page layout, typography, word count,
 * and an optional action to open in Formstr Pages for full editing.
 */

import React, { useState } from "react";

interface DocxPreviewProps {
  htmlContent: string;
  name: string;
  onOpenInPages?: () => void;
}

export const DocxPreview: React.FC<DocxPreviewProps> = ({
  htmlContent,
  name,
  onOpenInPages,
}) => {
  const [showRawText, setShowRawText] = useState(false);

  // Strip tags for raw text view
  const rawText = htmlContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = rawText ? rawText.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        minHeight: 0,
        gap: "12px",
      }}
    >
      {/* Top Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
          padding: "8px 14px",
          backgroundColor: "rgba(255, 255, 255, 0.05)",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "16px" }}>📄</span>
          <span style={{ fontSize: "13px", fontWeight: "600", color: "#e5e7eb" }}>
            Word Document
          </span>
          <span style={{ fontSize: "12px", color: "#9ca3af" }}>
            • {wordCount} words
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setShowRawText((prev) => !prev)}
            style={{
              padding: "6px 12px",
              backgroundColor: "transparent",
              color: "#9ca3af",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: "6px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            {showRawText ? "View Formatted" : "View Plain Text"}
          </button>

          {onOpenInPages && (
            <button
              type="button"
              onClick={onOpenInPages}
              style={{
                padding: "6px 14px",
                backgroundColor: "#2563eb",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "500",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>✏️</span>
              <span>Edit in Pages</span>
            </button>
          )}
        </div>
      </div>

      {/* Document Paper Container */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          backgroundColor: "#1e2430",
          borderRadius: "10px",
          padding: "24px 16px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "760px",
            backgroundColor: "#ffffff",
            color: "#1f2937",
            borderRadius: "8px",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.25)",
            padding: "48px 48px",
            fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
            fontSize: "15px",
            lineHeight: "1.7",
            boxSizing: "border-box",
            minHeight: "100%",
          }}
        >
          <div
            style={{
              borderBottom: "1px solid #e5e7eb",
              paddingBottom: "16px",
              marginBottom: "28px",
            }}
          >
            <h1
              style={{
                fontSize: "22px",
                fontWeight: "700",
                color: "#111827",
                margin: "0 0 4px 0",
              }}
            >
              {name.replace(/\.[^/.]+$/, "")}
            </h1>
            <span style={{ fontSize: "12px", color: "#6b7280" }}>
              DOCX Preview • Read-Only
            </span>
          </div>

          {showRawText ? (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "inherit",
                fontSize: "14px",
                margin: 0,
              }}
            >
              {rawText}
            </pre>
          ) : (
            <div
              className="docx-formatted-content"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
              style={{
                wordBreak: "break-word",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
