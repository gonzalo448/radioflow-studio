import type { SchedulerActionType, SchedulerCommand } from "@radioflow/shared";
import type { GeneratorFormState } from "./playlist-generator-form";
import { defaultGeneratorFormState } from "./playlist-generator-form";

export type SchedulerWizardTemplateId =
  | "generate_hour_block"
  | "generate_short_fill"
  | "play_playlist_replace"
  | "play_playlist_append"
  | "ad_break"
  | "time_announce"
  | "play_asset"
  | "station_skip"
  | "queue_replace"
  | "stream_record_start"
  | "stream_record_stop";

export type SchedulerWizardField =
  | "generator"
  | "playlist"
  | "replaceQueue"
  | "asset"
  | "command"
  | "adBreak";

export type SchedulerWizardTemplate = {
  id: SchedulerWizardTemplateId;
  title: string;
  description: string;
  actionType: SchedulerActionType;
  defaultName: string;
  fields: SchedulerWizardField[];
  defaultReplaceQueue?: boolean;
  defaultCommand?: SchedulerCommand;
  defaultGenForm?: Partial<GeneratorFormState>;
  defaultAdSpotCount?: number;
};

export const SCHEDULER_WIZARD_TEMPLATES: SchedulerWizardTemplate[] = [
  {
    id: "generate_hour_block",
    title: "Generar bloque musical (1 h)",
    description: "Playlist Generator Pro con rotación y poner al aire reemplazando la cola.",
    actionType: "GENERATE_AND_PLAY_PLAYLIST",
    defaultName: "Bloque musical — 1 hora",
    fields: ["generator", "replaceQueue"],
    defaultReplaceQueue: true,
    defaultGenForm: { durationMin: 60, mode: "structure", order: "random", artistGap: 3 },
  },
  {
    id: "generate_short_fill",
    title: "Relleno rápido (15 min)",
    description: "Genera un bloque corto aleatorio para cubrir un hueco.",
    actionType: "GENERATE_AND_PLAY_PLAYLIST",
    defaultName: "Relleno — 15 min",
    fields: ["generator", "replaceQueue"],
    defaultReplaceQueue: false,
    defaultGenForm: { durationMin: 15, mode: "simple", order: "random", artistGap: 2 },
  },
  {
    id: "play_playlist_replace",
    title: "Poner lista guardada al aire",
    description: "Volca una playlist existente y sustituye la cola actual.",
    actionType: "PLAY_PLAYLIST",
    defaultName: "Lista al aire",
    fields: ["playlist", "replaceQueue"],
    defaultReplaceQueue: true,
  },
  {
    id: "play_playlist_append",
    title: "Añadir lista al final",
    description: "Encola una playlist guardada sin borrar lo que ya está programado.",
    actionType: "PLAY_PLAYLIST",
    defaultName: "Añadir lista",
    fields: ["playlist", "replaceQueue"],
    defaultReplaceQueue: false,
  },
  {
    id: "ad_break",
    title: "Bloque publicitario",
    description: "Inserta spots según el planificador de publicidad (override opcional).",
    actionType: "PLAY_AD_BREAK",
    defaultName: "Publicidad programada",
    fields: ["adBreak"],
    defaultAdSpotCount: 2,
  },
  {
    id: "time_announce",
    title: "Decir la hora",
    description:
      "Locución pregrabada (HRS__/MIN__) según el reloj del equipo. Se inserta al terminar la canción actual. Configure la carpeta en Marca.",
    actionType: "TIME_ANNOUNCE",
    defaultName: "Locución horaria",
    fields: [],
  },
  {
    id: "play_asset",
    title: "Encolar una pista",
    description: "Añade un archivo concreto al final de la cola al aire.",
    actionType: "PLAY_ASSET",
    defaultName: "Pista programada",
    fields: ["asset"],
  },
  {
    id: "station_skip",
    title: "Saltar pista al aire",
    description: "Avanza al siguiente ítem en cabina (comando STATION_SKIP).",
    actionType: "RUN_COMMAND",
    defaultName: "Skip cabina",
    fields: ["command"],
    defaultCommand: "STATION_SKIP",
  },
  {
    id: "queue_replace",
    title: "Sustituir cola desde lista",
    description: "Comando que reemplaza toda la cola con una playlist guardada.",
    actionType: "RUN_COMMAND",
    defaultName: "Cola desde lista",
    fields: ["command", "playlist"],
    defaultCommand: "QUEUE_FROM_PLAYLIST_REPLACE",
  },
  {
    id: "stream_record_start",
    title: "Iniciar grabación de stream",
    description: "Graba el mount Icecast activo hasta el evento de parada (P2-06).",
    actionType: "RUN_COMMAND",
    defaultName: "Grabar programa — inicio",
    fields: ["command"],
    defaultCommand: "STREAM_RECORD_START",
  },
  {
    id: "stream_record_stop",
    title: "Detener grabación de stream",
    description: "Finaliza la grabación en curso y registra el archivo en biblioteca.",
    actionType: "RUN_COMMAND",
    defaultName: "Grabar programa — fin",
    fields: ["command"],
    defaultCommand: "STREAM_RECORD_STOP",
  },
];

export function templateById(id: SchedulerWizardTemplateId): SchedulerWizardTemplate {
  return SCHEDULER_WIZARD_TEMPLATES.find((t) => t.id === id) ?? SCHEDULER_WIZARD_TEMPLATES[0];
}

export function initialGenFormForTemplate(t: SchedulerWizardTemplate): GeneratorFormState {
  return { ...defaultGeneratorFormState(), ...t.defaultGenForm };
}

export type SchedulePreset = "manual" | "in_5" | "in_15" | "in_60" | "tomorrow_7" | "custom";

export function runAtFromSchedulePreset(preset: SchedulePreset, customLocal: string): string | null {
  if (preset === "manual") return null;
  const now = new Date();
  if (preset === "in_5") return new Date(now.getTime() + 5 * 60_000).toISOString();
  if (preset === "in_15") return new Date(now.getTime() + 15 * 60_000).toISOString();
  if (preset === "in_60") return new Date(now.getTime() + 60 * 60_000).toISOString();
  if (preset === "tomorrow_7") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(7, 0, 0, 0);
    return d.toISOString();
  }
  if (preset === "custom" && customLocal.trim()) {
    const parsed = new Date(customLocal);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

export function schedulePresetLabel(preset: SchedulePreset): string {
  switch (preset) {
    case "manual":
      return "Solo manual (Ejecutar ya)";
    case "in_5":
      return "En 5 minutos";
    case "in_15":
      return "En 15 minutos";
    case "in_60":
      return "En 1 hora";
    case "tomorrow_7":
      return "Mañana 07:00";
    case "custom":
      return "Fecha y hora personalizada";
    default:
      return preset;
  }
}
