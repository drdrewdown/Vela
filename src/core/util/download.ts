/** Hand the user a text file to save: a JSON document under `filename`, through a transient link. */
export function downloadText(doc: Document, text: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
