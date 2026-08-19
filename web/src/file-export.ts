export async function exportFile(
  data: BlobPart | BlobPart[],
  fileName: string,
  mimeType: string,
): Promise<{ success: boolean; method: "share" | "download" }> {
  const parts = Array.isArray(data) ? data : [data];
  const blob = new Blob(parts, { type: mimeType });

  if (typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof File !== "undefined") {
    try {
      const file = new File([blob], fileName, { type: mimeType });
      if (typeof navigator.canShare === "function" ? navigator.canShare({ files: [file] }) : true) {
        await navigator.share({
          files: [file],
          title: fileName,
        });
        return { success: true, method: "share" };
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        return { success: false, method: "share" };
      }
    }
  }

  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 1500);
    return { success: true, method: "download" };
  }

  return { success: false, method: "download" };
}
