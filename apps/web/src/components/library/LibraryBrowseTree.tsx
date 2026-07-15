import type { ApiLibraryBrowseLabel, ApiLibraryFolderRow } from "@radioflow/shared";
import { folderDisplayName } from "../../lib/library-folder";

export type LibraryBrowseMode = "path" | "genre" | "artist" | "album";

export type LibraryBrowseTreeProps = {
  mode: LibraryBrowseMode;
  onModeChange: (mode: LibraryBrowseMode) => void;
  pathFolders: ApiLibraryFolderRow[];
  genres: ApiLibraryBrowseLabel[];
  artists: ApiLibraryBrowseLabel[];
  albums: ApiLibraryBrowseLabel[];
  pathPrefix: string;
  genreKey: string;
  artistKey: string;
  albumKey: string;
  onPathSelect: (prefix: string) => void;
  onGenreSelect: (genre: string) => void;
  onArtistSelect: (artist: string) => void;
  onAlbumSelect: (album: string) => void;
};

export function LibraryBrowseTree({
  mode,
  onModeChange,
  pathFolders,
  genres,
  artists,
  albums,
  pathPrefix,
  genreKey,
  artistKey,
  albumKey,
  onPathSelect,
  onGenreSelect,
  onArtistSelect,
  onAlbumSelect,
}: LibraryBrowseTreeProps) {
  return (
    <div className="library-browse-tree">
      <p className="library-ml-section-label">Explorar por</p>
      <div className="library-browse-tabs" role="tablist" aria-label="Tipo de biblioteca">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "path"}
          className={`library-browse-tab${mode === "path" ? " library-browse-tab--on" : ""}`}
          onClick={() => onModeChange("path")}
        >
          Carpeta
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "genre"}
          className={`library-browse-tab${mode === "genre" ? " library-browse-tab--on" : ""}`}
          onClick={() => onModeChange("genre")}
        >
          Género
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "artist"}
          className={`library-browse-tab${mode === "artist" ? " library-browse-tab--on" : ""}`}
          onClick={() => onModeChange("artist")}
        >
          Artista
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "album"}
          className={`library-browse-tab${mode === "album" ? " library-browse-tab--on" : ""}`}
          onClick={() => onModeChange("album")}
        >
          Álbum
        </button>
      </div>

      <div className="library-browse-list" role="tree">
        {mode === "path" ? (
          <>
            <button
              type="button"
              className={`library-ml-folder-btn${pathPrefix === "" ? " library-ml-folder-btn--on" : ""}`}
              onClick={() => onPathSelect("")}
            >
              Todas las carpetas
            </button>
            {pathFolders.length === 0 ? (
              <p className="muted small library-browse-empty">Cree una carpeta arriba para organizar la música.</p>
            ) : (
              pathFolders.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  className={`library-ml-folder-btn${pathPrefix === f.name ? " library-ml-folder-btn--on" : ""}`}
                  onClick={() => onPathSelect(f.name)}
                  title={`${f.count} pistas`}
                >
                  <span className="library-ml-folder-icon" aria-hidden>
                    📁
                  </span>
                  {folderDisplayName(f.name)}
                  <span className="library-ml-folder-count">{f.count}</span>
                </button>
              ))
            )}
          </>
        ) : null}

        {mode === "genre" ? (
          <>
            <button
              type="button"
              className={`library-ml-folder-btn${genreKey === "" ? " library-ml-folder-btn--on" : ""}`}
              onClick={() => onGenreSelect("")}
            >
              Todos los géneros
            </button>
            {genres.length === 0 ? (
              <p className="muted small library-browse-empty">Sin género en metadatos. Actualice etiquetas o reimporte.</p>
            ) : (
              genres.map((g) => (
                <button
                  key={g.name}
                  type="button"
                  className={`library-ml-folder-btn${genreKey === g.name ? " library-ml-folder-btn--on" : ""}`}
                  onClick={() => onGenreSelect(g.name)}
                >
                  {g.name}
                  <span className="library-ml-folder-count">{g.count}</span>
                </button>
              ))
            )}
          </>
        ) : null}

        {mode === "artist" ? (
          <>
            <button
              type="button"
              className={`library-ml-folder-btn${artistKey === "" ? " library-ml-folder-btn--on" : ""}`}
              onClick={() => onArtistSelect("")}
            >
              Todos los artistas
            </button>
            {artists.length === 0 ? (
              <p className="muted small library-browse-empty">Sin artista en metadatos.</p>
            ) : (
              artists.map((a) => {
                const key = a.name === "(Sin artista)" ? "__none__" : a.name;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`library-ml-folder-btn${artistKey === key ? " library-ml-folder-btn--on" : ""}`}
                    onClick={() => onArtistSelect(key)}
                  >
                    {a.name}
                    <span className="library-ml-folder-count">{a.count}</span>
                  </button>
                );
              })
            )}
          </>
        ) : null}

        {mode === "album" ? (
          <>
            <button
              type="button"
              className={`library-ml-folder-btn${albumKey === "" ? " library-ml-folder-btn--on" : ""}`}
              onClick={() => onAlbumSelect("")}
            >
              Todos los álbumes
            </button>
            {albums.length === 0 ? (
              <p className="muted small library-browse-empty">Sin álbum en metadatos.</p>
            ) : (
              albums.map((a) => (
                <button
                  key={a.name}
                  type="button"
                  className={`library-ml-folder-btn${albumKey === a.name ? " library-ml-folder-btn--on" : ""}`}
                  onClick={() => onAlbumSelect(a.name)}
                >
                  {a.name}
                  <span className="library-ml-folder-count">{a.count}</span>
                </button>
              ))
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
