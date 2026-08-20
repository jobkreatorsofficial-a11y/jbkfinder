import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Extracts plain text from an uploaded JD PDF so the recruiter can drop a file
// instead of pasting. Returns the text; the client fills it into the JD field.

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof (file as any).arrayBuffer !== "function") {
      return NextResponse.json({ ok: false, error: "No PDF uploaded." }, { status: 400 });
    }
    const buf = Buffer.from(await (file as Blob).arrayBuffer());

    // Import lazily so the module's import-time debug harness never runs during build.
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buf);
    const text = String(data.text || "").replace(/\n{3,}/g, "\n\n").trim();

    if (!text) {
      return NextResponse.json(
        { ok: false, error: "Could not read any text from that PDF. It may be a scanned image." },
        { status: 422 }
      );
    }
    return NextResponse.json({ ok: true, text });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to read the PDF." },
      { status: 500 }
    );
  }
}
