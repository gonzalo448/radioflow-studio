/** Etiqueta legible para un prefijo `uploads/…` devuelto por la API. */
export function folderDisplayName(pathPrefix: string): string {
 if (pathPrefix === "uploads") return "General";
 if (pathPrefix.startsWith("uploads/")) return pathPrefix.slice("uploads/".length);
 return pathPrefix;
}
