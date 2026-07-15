-- Comandos RadioBOSS (play/stop/next/clear/load) + container anidado
ALTER TYPE "QueueEntryKind" ADD VALUE IF NOT EXISTS 'cmd';
ALTER TYPE "QueueEntryKind" ADD VALUE IF NOT EXISTS 'container';
