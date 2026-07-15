import { lazy, type ComponentType } from "react";

function lazyPage<P extends Record<string, ComponentType<unknown>>>(
  loader: () => Promise<P>,
  exportName: keyof P,
) {
  return lazy(() => loader().then((m) => ({ default: m[exportName] as ComponentType<unknown> })));
}

export const StationPage = lazyPage(() => import("./pages/StationPage"), "StationPage");
export const SchedulePage = lazyPage(() => import("./pages/SchedulePage"), "SchedulePage");
export const UsuariosPage = lazyPage(() => import("./pages/UsuariosPage"), "UsuariosPage");
export const EventosPage = lazyPage(() => import("./pages/EventosPage"), "EventosPage");
export const SchedulerEventsPage = lazyPage(() => import("./pages/SchedulerEventsPage"), "SchedulerEventsPage");
export const AdsSchedulerPage = lazyPage(() => import("./pages/AdsSchedulerPage"), "AdsSchedulerPage");
export const PlaylistsPage = lazyPage(() => import("./pages/PlaylistsPage"), "PlaylistsPage");
export const PlaylistDetailPage = lazyPage(() => import("./pages/PlaylistDetailPage"), "PlaylistDetailPage");
export const InsumosPage = lazyPage(() => import("./pages/InsumosPage"), "InsumosPage");
export const Dashboard = lazyPage(() => import("./pages/Dashboard"), "Dashboard");
export const LibraryPage = lazyPage(() => import("./pages/LibraryPage"), "LibraryPage");
export const StreamingPage = lazyPage(() => import("./pages/StreamingPage"), "StreamingPage");
export const ReportsPage = lazyPage(() => import("./pages/ReportsPage"), "ReportsPage");
export const SettingsPage = lazyPage(() => import("./pages/SettingsPage"), "SettingsPage");
export const ChangePasswordPage = lazyPage(() => import("./pages/ChangePasswordPage"), "ChangePasswordPage");
export const SecurityOpsPage = lazyPage(() => import("./pages/SecurityOpsPage"), "SecurityOpsPage");
export const SesionesPage = lazyPage(() => import("./pages/SesionesPage"), "SesionesPage");
export const JinglesPage = lazyPage(() => import("./pages/JinglesPage"), "JinglesPage");
export const FxPage = lazyPage(() => import("./pages/FxPage"), "FxPage");
export const RequestsPage = lazyPage(() => import("./pages/RequestsPage"), "RequestsPage");
export const HelpPage = lazyPage(() => import("./pages/HelpPage"), "HelpPage");
export const DesktopStatusPage = lazyPage(() => import("./pages/DesktopStatusPage"), "DesktopStatusPage");
export const VoicetrackEditorPage = lazyPage(() => import("./pages/VoicetrackEditorPage"), "VoicetrackEditorPage");
export const ClockTemplatesPage = lazyPage(() => import("./pages/ClockTemplatesPage"), "ClockTemplatesPage");
export const EmitirPage = lazyPage(() => import("./pages/EmitirPage"), "EmitirPage");
export const ListenPage = lazyPage(() => import("./pages/ListenPage"), "ListenPage");
export const AzuraRadioPage = lazyPage(() => import("./pages/AzuraRadioPage"), "AzuraRadioPage");
