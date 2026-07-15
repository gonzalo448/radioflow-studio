-- Locución horaria: carpeta absoluta de voces + acción de scheduler TIME_ANNOUNCE
ALTER TABLE "AppSettings" ADD COLUMN "timeAnnounceFolderAbs" TEXT;

-- SQLite: recrear enum no es trivial; Prisma Client acepta el string en actionType.
-- Inserts/updates usan el valor texto 'TIME_ANNOUNCE' (columna Text / String en SQLite standalone).
