import { describe, expect, it } from "vitest";
import { contractDocuments } from "./document-url";

const file = (id: string, role: string, filename = `${id}.pdf`) => ({
  id,
  role,
  filename,
  mimeType: "application/pdf",
});

describe("contractDocuments", () => {
  it("puts the signed contract first, ahead of the rendering it replaced", () => {
    const docs = contractDocuments({
      id: "c1",
      files: [file("gen", "GENERATED"), file("sig", "SIGNED")],
    });
    expect(docs.map((d) => d.src)).toEqual([
      "/api/contracts/c1/files/sig",
      "/api/contracts/c1/files/gen",
    ]);
  });

  it("puts an uploaded original ahead of attachments", () => {
    const docs = contractDocuments({
      id: "c1",
      files: [file("photo", "ATTACHMENT"), file("scan", "ORIGINAL")],
    });
    expect(docs.map((d) => d.src)).toEqual([
      "/api/contracts/c1/files/scan",
      "/api/contracts/c1/files/photo",
    ]);
  });

  it("leaves the evidence log out of the panel", () => {
    const docs = contractDocuments({
      id: "c1",
      files: [file("ev", "EVIDENCE"), file("sig", "SIGNED")],
    });
    expect(docs).toHaveLength(1);
    expect(docs[0].src).toBe("/api/contracts/c1/files/sig");
  });

  it("keeps the archive's order within one role", () => {
    const docs = contractDocuments({
      id: "c1",
      files: [file("a", "ATTACHMENT"), file("b", "ATTACHMENT"), file("c", "ATTACHMENT")],
    });
    expect(docs.map((d) => d.filename)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  });

  it("answers with nothing for a contract that has no files yet", () => {
    expect(contractDocuments({ id: "c1", files: [] })).toEqual([]);
  });
});
