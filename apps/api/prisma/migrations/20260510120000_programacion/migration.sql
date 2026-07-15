-- Tabla programación (bloques por día en texto, hora TIME, duración en minutos)
CREATE TABLE "programacion" (
    "id" SERIAL NOT NULL,
    "dia" TEXT NOT NULL,
    "hora" TIME(6) NOT NULL,
    "duracion" INTEGER NOT NULL,
    "playlist_id" TEXT,
    "usuario_id" TEXT,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programacion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "programacion" ADD CONSTRAINT "programacion_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "programacion" ADD CONSTRAINT "programacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
