-- CreateTable
CREATE TABLE "eventos" (
    "id" SERIAL NOT NULL,
    "dia" VARCHAR(20) NOT NULL,
    "hora" VARCHAR(5) NOT NULL,
    "ruta_audio" TEXT NOT NULL,
    "descripcion" TEXT,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);
