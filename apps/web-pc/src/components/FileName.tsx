/** The upper-case extension of a file name ("PDF", "PNG"), shown on the document symbol. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1, dot + 5).toUpperCase() : "";
}

/** A file name with its document symbol, for the task tables (enterprise-ui-redesign):
 * the prototype's page-shaped symbol carrying the real file extension. */
export function FileName({ name }: { name: string }) {
  const ext = fileExtension(name);
  return (
    <span className="pc-file">
      <span className="pc-file__symbol" aria-hidden="true">
        {ext && <span className="pc-file__ext">{ext}</span>}
      </span>
      <span className="pc-file__name">{name}</span>
    </span>
  );
}
